# Wakala Performance Optimization Guide

**Version:** 1.0  
**Last Updated:** January 10, 2025  
**Target Audience:** Engineering Team

## Table of Contents
1. [Database Query Optimization](#database-query-optimization)
2. [Caching Strategies](#caching-strategies)
3. [CDN Configuration](#cdn-configuration)
4. [Container Optimization](#container-optimization)
5. [Load Testing](#load-testing)
6. [Performance Tuning](#performance-tuning)

## Database Query Optimization

### 1. Query Analysis and Optimization

#### Identifying Slow Queries
```sql
-- Find slowest queries
SELECT 
    mean_exec_time,
    calls,
    total_exec_time,
    min_exec_time,
    max_exec_time,
    stddev_exec_time,
    query
FROM pg_stat_statements
WHERE calls > 100
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Queries with poor cache hit ratio
SELECT 
    schemaname,
    tablename,
    heap_blks_read,
    heap_blks_hit,
    CASE 
        WHEN heap_blks_hit + heap_blks_read = 0 THEN 0
        ELSE round(100.0 * heap_blks_hit / (heap_blks_hit + heap_blks_read), 2)
    END as cache_hit_ratio
FROM pg_statio_user_tables
WHERE heap_blks_read > 0
ORDER BY heap_blks_read DESC;
```

#### Query Optimization Examples

**Before: N+1 Query Problem**
```python
# Bad: Executes 1 + N queries
tenants = db.query("SELECT * FROM tenants WHERE active = true")
for tenant in tenants:
    messages = db.query(
        "SELECT COUNT(*) FROM messages WHERE tenant_id = %s",
        tenant.id
    )
    tenant.message_count = messages[0].count
```

**After: Single Query with JOIN**
```python
# Good: Single query with aggregation
query = """
    SELECT 
        t.*,
        COUNT(m.id) as message_count
    FROM tenants t
    LEFT JOIN messages m ON t.id = m.tenant_id
    WHERE t.active = true
    GROUP BY t.id
"""
tenants_with_counts = db.query(query)
```

**Before: Missing Index**
```sql
-- Slow: Full table scan
SELECT * FROM messages 
WHERE tenant_id = '123' 
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- Execution plan shows Seq Scan
```

**After: Composite Index**
```sql
-- Create composite index
CREATE INDEX CONCURRENTLY idx_messages_tenant_created 
ON messages(tenant_id, created_at DESC) 
WHERE deleted_at IS NULL;

-- Now uses Index Scan
```

### 2. Connection Pool Optimization

```python
# database.py
from sqlalchemy.pool import QueuePool
from sqlalchemy import create_engine

# Optimized connection pool settings
engine = create_engine(
    DATABASE_URL,
    poolclass=QueuePool,
    pool_size=20,           # Base number of connections
    max_overflow=10,        # Additional connections when needed
    pool_timeout=30,        # Timeout for getting connection
    pool_recycle=3600,      # Recycle connections after 1 hour
    pool_pre_ping=True,     # Test connections before use
    connect_args={
        "server_settings": {
            "application_name": "wakala_api",
            "jit": "off"
        },
        "command_timeout": 60,
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 5
    }
)

# Connection pool monitoring
@app.before_request
def log_pool_status():
    pool = engine.pool
    logger.debug(f"Pool size: {pool.size()}, "
                f"Checked out: {pool.checkedout()}, "
                f"Overflow: {pool.overflow()}")
```

### 3. Prepared Statements

```python
# Use prepared statements for frequently executed queries
class MessageRepository:
    def __init__(self, db):
        self.db = db
        self._prepare_statements()
    
    def _prepare_statements(self):
        self.db.execute("""
            PREPARE get_messages (uuid, timestamp) AS
            SELECT * FROM messages 
            WHERE tenant_id = $1 AND created_at > $2
            ORDER BY created_at DESC
            LIMIT 100
        """)
        
        self.db.execute("""
            PREPARE insert_message (uuid, uuid, text, jsonb) AS
            INSERT INTO messages (id, tenant_id, content, metadata)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        """)
    
    def get_recent_messages(self, tenant_id, since):
        return self.db.execute(
            "EXECUTE get_messages (%s, %s)",
            (tenant_id, since)
        ).fetchall()
```

### 4. Batch Operations

```python
# Batch insert optimization
def bulk_insert_messages(messages):
    """Efficiently insert multiple messages"""
    if not messages:
        return
    
    # Use COPY for best performance with large datasets
    if len(messages) > 1000:
        buffer = StringIO()
        for msg in messages:
            buffer.write(f"{msg.id}\t{msg.tenant_id}\t{msg.content}\t{msg.created_at}\n")
        buffer.seek(0)
        
        with db.connection() as conn:
            conn.cursor().copy_from(
                buffer,
                'messages',
                columns=['id', 'tenant_id', 'content', 'created_at']
            )
    else:
        # Use multi-value INSERT for smaller batches
        values = []
        params = []
        for i, msg in enumerate(messages):
            values.append(f"(${i*4+1}, ${i*4+2}, ${i*4+3}, ${i*4+4})")
            params.extend([msg.id, msg.tenant_id, msg.content, msg.created_at])
        
        query = f"""
            INSERT INTO messages (id, tenant_id, content, created_at)
            VALUES {','.join(values)}
            ON CONFLICT (id) DO NOTHING
        """
        db.execute(query, params)
```

## Caching Strategies

### 1. Multi-Level Cache Architecture

```python
# cache.py
import redis
import pickle
import hashlib
from functools import wraps
from typing import Any, Optional, Callable

class MultiLevelCache:
    def __init__(self):
        self.local_cache = {}  # L1: In-memory cache
        self.redis_client = redis.Redis(  # L2: Redis cache
            host='redis-master',
            port=6379,
            decode_responses=False,
            connection_pool_kwargs={
                'max_connections': 50,
                'socket_keepalive': True,
                'socket_keepalive_options': {
                    1: 1,  # TCP_KEEPIDLE
                    2: 5,  # TCP_KEEPINTVL
                    3: 3,  # TCP_KEEPCNT
                }
            }
        )
        self.cdn_client = CDNClient()  # L3: CDN cache
    
    def get(self, key: str, level: int = 1) -> Optional[Any]:
        """Get value from cache, checking each level"""
        # L1: Check local cache
        if level >= 1 and key in self.local_cache:
            return self.local_cache[key]['value']
        
        # L2: Check Redis
        if level >= 2:
            value = self.redis_client.get(key)
            if value:
                value = pickle.loads(value)
                # Populate L1
                self.local_cache[key] = {'value': value}
                return value
        
        # L3: Check CDN (for public data only)
        if level >= 3:
            value = self.cdn_client.get(key)
            if value:
                # Populate L1 and L2
                self.set(key, value, ttl=3600, level=2)
                return value
        
        return None
    
    def set(self, key: str, value: Any, ttl: int = 300, level: int = 2):
        """Set value in cache at specified levels"""
        # L1: Always set in local cache
        self.local_cache[key] = {
            'value': value,
            'expires': time.time() + ttl
        }
        
        # L2: Set in Redis if level >= 2
        if level >= 2:
            self.redis_client.setex(
                key,
                ttl,
                pickle.dumps(value)
            )
        
        # L3: Set in CDN if level >= 3 and data is public
        if level >= 3 and self._is_public_data(value):
            self.cdn_client.set(key, value, ttl)

# Cache decorator with smart invalidation
def cached(ttl: int = 300, level: int = 2, vary_on: list = None):
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Generate cache key
            cache_key = _generate_cache_key(func, args, kwargs, vary_on)
            
            # Try to get from cache
            cached_value = cache.get(cache_key, level)
            if cached_value is not None:
                return cached_value
            
            # Execute function and cache result
            result = func(*args, **kwargs)
            cache.set(cache_key, result, ttl, level)
            
            return result
        return wrapper
    return decorator

# Usage example
@cached(ttl=600, level=2, vary_on=['tenant_id'])
def get_tenant_stats(tenant_id: str) -> dict:
    """Expensive query cached for 10 minutes"""
    return db.query("""
        SELECT 
            COUNT(DISTINCT m.id) as message_count,
            COUNT(DISTINCT c.id) as contact_count,
            COUNT(DISTINCT u.id) as user_count
        FROM tenants t
        LEFT JOIN messages m ON t.id = m.tenant_id
        LEFT JOIN contacts c ON t.id = c.tenant_id
        LEFT JOIN users u ON t.id = u.tenant_id
        WHERE t.id = %s
    """, tenant_id)
```

### 2. Cache Warming Strategy

```python
# cache_warmer.py
import asyncio
from typing import List, Dict

class CacheWarmer:
    def __init__(self, cache: MultiLevelCache, db):
        self.cache = cache
        self.db = db
        self.warmup_queries = []
    
    def register_warmup_query(self, name: str, query: str, 
                            cache_key_fn: Callable, ttl: int = 3600):
        """Register a query to be warmed on startup"""
        self.warmup_queries.append({
            'name': name,
            'query': query,
            'cache_key_fn': cache_key_fn,
            'ttl': ttl
        })
    
    async def warm_cache(self):
        """Warm cache with frequently accessed data"""
        tasks = []
        
        # Warm tenant configurations
        tasks.append(self._warm_tenant_configs())
        
        # Warm frequently accessed queries
        for query_info in self.warmup_queries:
            tasks.append(self._execute_warmup_query(query_info))
        
        # Warm API response cache
        tasks.append(self._warm_api_responses())
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Log results
        success = sum(1 for r in results if not isinstance(r, Exception))
        logger.info(f"Cache warming completed: {success}/{len(tasks)} successful")
    
    async def _warm_tenant_configs(self):
        """Pre-load all active tenant configurations"""
        tenants = await self.db.fetch(
            "SELECT * FROM tenants WHERE active = true"
        )
        
        for tenant in tenants:
            cache_key = f"tenant:config:{tenant['id']}"
            self.cache.set(cache_key, tenant, ttl=3600, level=2)
    
    async def _warm_api_responses(self):
        """Pre-warm common API responses"""
        common_endpoints = [
            '/api/health',
            '/api/status',
            '/api/features',
        ]
        
        for endpoint in common_endpoints:
            response = await self._fetch_endpoint(endpoint)
            cache_key = f"api:response:{endpoint}"
            self.cache.set(cache_key, response, ttl=300, level=3)

# Register warmup queries on startup
warmer = CacheWarmer(cache, db)

warmer.register_warmup_query(
    name='message_templates',
    query='SELECT * FROM message_templates WHERE active = true',
    cache_key_fn=lambda row: f"template:{row['id']}",
    ttl=3600
)

warmer.register_warmup_query(
    name='popular_contacts',
    query='''
        SELECT c.*, COUNT(m.id) as message_count
        FROM contacts c
        JOIN messages m ON c.id = m.contact_id
        WHERE m.created_at > NOW() - INTERVAL '7 days'
        GROUP BY c.id
        HAVING COUNT(m.id) > 100
        ORDER BY message_count DESC
        LIMIT 1000
    ''',
    cache_key_fn=lambda row: f"contact:popular:{row['id']}",
    ttl=1800
)
```

### 3. Cache Invalidation Patterns

```python
# cache_invalidation.py
from typing import List, Set
import asyncio

class CacheInvalidator:
    def __init__(self, cache: MultiLevelCache):
        self.cache = cache
        self.invalidation_rules = {}
        self.pending_invalidations = set()
    
    def register_rule(self, entity: str, related_patterns: List[str]):
        """Register cache invalidation rules"""
        self.invalidation_rules[entity] = related_patterns
    
    async def invalidate(self, entity: str, entity_id: str, 
                        cascade: bool = True):
        """Invalidate cache entries based on rules"""
        patterns = self.invalidation_rules.get(entity, [])
        
        # Direct invalidation
        direct_keys = [
            f"{entity}:{entity_id}",
            f"{entity}:*:{entity_id}",
        ]
        
        for key_pattern in direct_keys:
            await self._invalidate_pattern(key_pattern)
        
        # Cascade invalidation
        if cascade:
            for pattern in patterns:
                formatted_pattern = pattern.format(
                    entity=entity,
                    id=entity_id
                )
                await self._invalidate_pattern(formatted_pattern)
    
    async def _invalidate_pattern(self, pattern: str):
        """Invalidate all keys matching pattern"""
        # For Redis
        cursor = 0
        while True:
            cursor, keys = await self.cache.redis_client.scan(
                cursor,
                match=pattern,
                count=100
            )
            
            if keys:
                await self.cache.redis_client.delete(*keys)
            
            if cursor == 0:
                break
        
        # For local cache
        keys_to_remove = [
            k for k in self.cache.local_cache
            if self._matches_pattern(k, pattern)
        ]
        for key in keys_to_remove:
            del self.cache.local_cache[key]
    
    def batch_invalidate(self):
        """Batch invalidations for efficiency"""
        async def process_batch():
            while True:
                await asyncio.sleep(0.1)  # 100ms batching window
                
                if self.pending_invalidations:
                    batch = list(self.pending_invalidations)
                    self.pending_invalidations.clear()
                    
                    # Group by entity type for efficient processing
                    grouped = {}
                    for entity, entity_id in batch:
                        if entity not in grouped:
                            grouped[entity] = []
                        grouped[entity].append(entity_id)
                    
                    # Process each group
                    for entity, ids in grouped.items():
                        await self._batch_invalidate_entity(entity, ids)
        
        asyncio.create_task(process_batch())

# Configure invalidation rules
invalidator = CacheInvalidator(cache)

invalidator.register_rule('tenant', [
    'tenant:stats:{id}',
    'tenant:users:{id}',
    'tenant:config:{id}',
    'api:response:/api/tenants/{id}*',
])

invalidator.register_rule('message', [
    'tenant:stats:{tenant_id}',
    'contact:conversation:{contact_id}',
    'api:response:/api/messages*',
])

invalidator.register_rule('contact', [
    'contact:*:{id}',
    'tenant:contacts:{tenant_id}',
    'api:response:/api/contacts/{id}*',
])
```

## CDN Configuration

### 1. CloudFlare Configuration

```javascript
// cloudflare-worker.js
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  
  // Cache key generation
  const cacheKey = generateCacheKey(request)
  
  // Check cache
  const cache = caches.default
  let response = await cache.match(cacheKey)
  
  if (response) {
    // Add cache hit header
    response = new Response(response.body, response)
    response.headers.set('X-Cache-Status', 'HIT')
    return response
  }
  
  // Fetch from origin
  response = await fetch(request)
  
  // Cache successful responses
  if (response.status === 200) {
    const cacheDuration = getCacheDuration(url.pathname)
    
    response = new Response(response.body, response)
    response.headers.set('Cache-Control', `public, max-age=${cacheDuration}`)
    response.headers.set('X-Cache-Status', 'MISS')
    
    // Store in cache
    event.waitUntil(cache.put(cacheKey, response.clone()))
  }
  
  return response
}

function generateCacheKey(request) {
  const url = new URL(request.url)
  
  // Normalize URL
  url.searchParams.sort()
  
  // Include important headers in cache key
  const headers = ['Accept', 'Accept-Language', 'X-Tenant-ID']
  const headerValues = headers
    .map(h => request.headers.get(h) || '')
    .join(':')
  
  return new Request(url.toString() + ':' + headerValues)
}

function getCacheDuration(pathname) {
  // Static assets - long cache
  if (pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff2?)$/)) {
    return 31536000 // 1 year
  }
  
  // API responses - shorter cache
  if (pathname.startsWith('/api/')) {
    if (pathname.includes('/static-data/')) {
      return 3600 // 1 hour
    }
    return 60 // 1 minute
  }
  
  // Default
  return 300 // 5 minutes
}
```

### 2. CDN Optimization Rules

```yaml
# cdn-rules.yaml
cache_rules:
  - pattern: "*.js|*.css"
    cache_level: standard
    edge_cache_ttl: 31536000
    browser_cache_ttl: 31536000
    
  - pattern: "/api/static/*"
    cache_level: aggressive
    edge_cache_ttl: 3600
    browser_cache_ttl: 3600
    cache_key:
      - host
      - path
      - query_string
      
  - pattern: "/api/tenants/*/config"
    cache_level: standard
    edge_cache_ttl: 300
    browser_cache_ttl: 0
    cache_key:
      - host
      - path
      - header: X-Tenant-ID
      
  - pattern: "/media/*"
    cache_level: aggressive
    edge_cache_ttl: 86400
    browser_cache_ttl: 86400
    polish: lossy
    webp: true
    
page_rules:
  - url: "api.wakala.com/*"
    settings:
      ssl: full_strict
      security_level: high
      cache_level: standard
      minify:
        javascript: true
        css: true
        html: false
        
  - url: "static.wakala.com/*"
    settings:
      cache_level: cache_everything
      edge_cache_ttl: 2592000
      browser_cache_ttl: 2592000
      automatic_https_rewrites: true
```

## Container Optimization

### 1. Dockerfile Optimization

```dockerfile
# Multi-stage build for smaller images
FROM python:3.11-slim as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
WORKDIR /build
COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

# Runtime stage
FROM python:3.11-slim

# Install runtime dependencies only
RUN apt-get update && apt-get install -y \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy Python dependencies from builder
COPY --from=builder /root/.local /root/.local

# Copy application
WORKDIR /app
COPY . .

# Create non-root user
RUN useradd -m -u 1000 wakala && chown -R wakala:wakala /app
USER wakala

# Pre-compile Python files
RUN python -m compileall -b .

# Set Python path
ENV PATH=/root/.local/bin:$PATH
ENV PYTHONPATH=/app

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# Run with optimizations
CMD ["python", "-O", "-m", "uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "4", "--loop", "uvloop"]
```

### 2. Container Resource Optimization

```yaml
# deployment-optimized.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wakala-api
spec:
  replicas: 10
  template:
    spec:
      containers:
      - name: api
        image: wakala/api:latest
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
            ephemeral-storage: "1Gi"
          limits:
            memory: "1Gi"
            cpu: "1000m"
            ephemeral-storage: "2Gi"
        
        # JVM-style memory management for Python
        env:
        - name: PYTHONMALLOC
          value: "pymalloc"
        - name: PYTHONHASHSEED
          value: "0"
        - name: MALLOC_TRIM_THRESHOLD_
          value: "100000"
        
        # Startup optimization
        startupProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 5
          failureThreshold: 30
        
        # Readiness optimization
        readinessProbe:
          httpGet:
            path: /ready
            port: 8000
          initialDelaySeconds: 5
          periodSeconds: 5
          successThreshold: 1
          failureThreshold: 3
        
        # Security context
        securityContext:
          runAsNonRoot: true
          runAsUser: 1000
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL
        
        # Volume mounts for performance
        volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: cache
          mountPath: /app/.cache
      
      # Pod-level optimizations
      dnsPolicy: ClusterFirst
      dnsConfig:
        options:
        - name: ndots
          value: "1"
      
      # Node affinity for performance
      affinity:
        nodeAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            preference:
              matchExpressions:
              - key: node.kubernetes.io/instance-type
                operator: In
                values:
                - c5.xlarge
                - c5.2xlarge
      
      volumes:
      - name: tmp
        emptyDir:
          medium: Memory
          sizeLimit: 100Mi
      - name: cache
        emptyDir:
          sizeLimit: 500Mi
```

## Load Testing

### 1. K6 Load Test Configuration

```javascript
// load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { randomItem } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Custom metrics
const errorRate = new Rate('errors');
const messagesSent = new Rate('messages_sent');

// Test configuration
export const options = {
  scenarios: {
    // Scenario 1: Gradual ramp-up
    gradual_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },
        { duration: '5m', target: 500 },
        { duration: '10m', target: 1000 },
        { duration: '5m', target: 500 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
    
    // Scenario 2: Spike test
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '30s', target: 2000 },
        { duration: '1m', target: 2000 },
        { duration: '30s', target: 100 },
      ],
      startTime: '25m',
    },
    
    // Scenario 3: Constant load
    steady_state: {
      executor: 'constant-vus',
      vus: 500,
      duration: '30m',
    },
  },
  
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.1'],
    errors: ['rate<0.1'],
    messages_sent: ['rate>0.9'],
  },
};

// Test data
const tenants = JSON.parse(open('./test-data/tenants.json'));
const contacts = JSON.parse(open('./test-data/contacts.json'));
const messages = JSON.parse(open('./test-data/messages.json'));

// Main test function
export default function() {
  const tenant = randomItem(tenants);
  const contact = randomItem(contacts);
  const message = randomItem(messages);
  
  // Set up headers
  const headers = {
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenant.id,
    'Authorization': `Bearer ${tenant.token}`,
  };
  
  // Test 1: Send message
  const sendMessageRes = http.post(
    `${__ENV.API_URL}/api/messages`,
    JSON.stringify({
      to: contact.phone,
      content: message.content,
      type: 'text',
    }),
    { headers }
  );
  
  check(sendMessageRes, {
    'message sent successfully': (r) => r.status === 201,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  
  errorRate.add(sendMessageRes.status !== 201);
  messagesSent.add(sendMessageRes.status === 201);
  
  // Test 2: Get messages
  const getMessagesRes = http.get(
    `${__ENV.API_URL}/api/messages?contact_id=${contact.id}`,
    { headers }
  );
  
  check(getMessagesRes, {
    'messages retrieved': (r) => r.status === 200,
    'has messages': (r) => JSON.parse(r.body).data.length > 0,
  });
  
  // Test 3: WebSocket connection
  const ws = new WebSocket(`${__ENV.WS_URL}/ws?token=${tenant.token}`);
  
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'ping' }));
  };
  
  ws.onmessage = (e) => {
    const message = JSON.parse(e.data);
    check(message, {
      'received pong': (m) => m.type === 'pong',
    });
    ws.close();
  };
  
  sleep(randomIntBetween(1, 3));
}

// Lifecycle hooks
export function setup() {
  // Warm up the system
  console.log('Warming up the system...');
  const warmupRequests = 100;
  
  for (let i = 0; i < warmupRequests; i++) {
    http.get(`${__ENV.API_URL}/api/health`);
  }
  
  return { startTime: new Date() };
}

export function teardown(data) {
  console.log(`Test completed. Duration: ${new Date() - data.startTime}ms`);
}
```

### 2. Load Test Execution Script

```bash
#!/bin/bash
# run-load-test.sh

# Configuration
API_URL="https://api.wakala.com"
WS_URL="wss://api.wakala.com"
GRAFANA_URL="http://grafana:3000"
INFLUX_URL="http://influxdb:8086"

# Pre-test checks
echo "🔍 Running pre-test checks..."

# Check API health
if ! curl -f "$API_URL/health" > /dev/null 2>&1; then
  echo "❌ API health check failed"
  exit 1
fi

# Create test report directory
REPORT_DIR="reports/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$REPORT_DIR"

# Run load test
echo "🚀 Starting load test..."
k6 run \
  --out influxdb="$INFLUX_URL/k6" \
  --out json="$REPORT_DIR/results.json" \
  -e API_URL="$API_URL" \
  -e WS_URL="$WS_URL" \
  load-test.js

# Generate HTML report
echo "📊 Generating report..."
k6-reporter \
  --input "$REPORT_DIR/results.json" \
  --output "$REPORT_DIR/report.html"

# Capture metrics snapshot
echo "📸 Capturing metrics..."
curl -s "$GRAFANA_URL/api/dashboards/uid/performance" \
  -H "Authorization: Bearer $GRAFANA_TOKEN" \
  > "$REPORT_DIR/dashboard-snapshot.json"

# Analyze results
echo "🔍 Analyzing results..."
python3 analyze-load-test.py \
  --results "$REPORT_DIR/results.json" \
  --output "$REPORT_DIR/analysis.md"

# Upload to S3
echo "☁️ Uploading results..."
aws s3 sync "$REPORT_DIR" "s3://wakala-load-tests/$REPORT_DIR"

echo "✅ Load test completed!"
echo "📄 Report: $REPORT_DIR/report.html"
echo "🔗 Online: https://load-tests.wakala.com/$REPORT_DIR/report.html"
```

## Performance Tuning

### 1. Application-Level Tuning

```python
# performance_config.py
import multiprocessing
from typing import Optional

class PerformanceConfig:
    """Production-optimized performance configuration"""
    
    # Process configuration
    WORKERS = multiprocessing.cpu_count() * 2
    WORKER_CLASS = "uvicorn.workers.UvicornWorker"
    WORKER_CONNECTIONS = 1000
    MAX_REQUESTS = 10000
    MAX_REQUESTS_JITTER = 1000
    
    # Thread pool configuration
    THREAD_POOL_SIZE = 50
    
    # Connection pool configuration
    DB_POOL_SIZE = 20
    DB_POOL_MAX_OVERFLOW = 10
    DB_POOL_TIMEOUT = 30
    DB_POOL_RECYCLE = 3600
    
    # Redis configuration
    REDIS_POOL_SIZE = 50
    REDIS_SOCKET_KEEPALIVE = True
    REDIS_SOCKET_KEEPALIVE_OPTIONS = {
        1: 1,   # TCP_KEEPIDLE
        2: 5,   # TCP_KEEPINTVL  
        3: 3,   # TCP_KEEPCNT
    }
    
    # HTTP client configuration
    HTTP_POOL_CONNECTIONS = 100
    HTTP_POOL_MAXSIZE = 100
    HTTP_MAX_RETRIES = 3
    HTTP_TIMEOUT = (5, 30)  # (connect, read)
    
    # Request processing
    REQUEST_TIMEOUT = 60
    KEEPALIVE_TIMEOUT = 75
    
    # Async configuration
    ASYNC_POOL_SIZE = 1000
    
    @classmethod
    def get_gunicorn_config(cls) -> dict:
        """Get Gunicorn configuration"""
        return {
            'bind': '0.0.0.0:8000',
            'workers': cls.WORKERS,
            'worker_class': cls.WORKER_CLASS,
            'worker_connections': cls.WORKER_CONNECTIONS,
            'max_requests': cls.MAX_REQUESTS,
            'max_requests_jitter': cls.MAX_REQUESTS_JITTER,
            'timeout': cls.REQUEST_TIMEOUT,
            'keepalive': cls.KEEPALIVE_TIMEOUT,
            'threads': cls.THREAD_POOL_SIZE,
            'accesslog': '-',
            'access_log_format': '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s',
            'preload_app': True,
            'reuse_port': True,
        }

# Event loop optimization
import asyncio
import uvloop

# Use uvloop for better performance
asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())

# Configure event loop
def configure_event_loop():
    loop = asyncio.get_event_loop()
    
    # Increase the default limit for concurrent tasks
    loop.set_default_executor(
        ThreadPoolExecutor(max_workers=PerformanceConfig.THREAD_POOL_SIZE)
    )
    
    # Enable debug mode in development only
    loop.set_debug(False)
    
    return loop
```

### 2. System-Level Tuning

```bash
#!/bin/bash
# system-tuning.sh

# Kernel parameters optimization
cat > /etc/sysctl.d/99-wakala.conf << EOF
# Network performance tuning
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 60
net.ipv4.tcp_keepalive_probes = 10
net.ipv4.ip_local_port_range = 1024 65535

# Memory tuning
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5

# File system tuning
fs.file-max = 2097152
fs.nr_open = 2097152

# Enable TCP BBR congestion control
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
EOF

# Apply settings
sysctl -p /etc/sysctl.d/99-wakala.conf

# Increase file descriptor limits
cat > /etc/security/limits.d/99-wakala.conf << EOF
* soft nofile 1048576
* hard nofile 1048576
* soft nproc 65535
* hard nproc 65535
EOF

# Configure systemd limits
mkdir -p /etc/systemd/system/wakala.service.d
cat > /etc/systemd/system/wakala.service.d/limits.conf << EOF
[Service]
LimitNOFILE=1048576
LimitNPROC=65535
LimitCORE=infinity
TasksMax=infinity
EOF

# Optimize disk I/O scheduler
echo noop > /sys/block/nvme0n1/queue/scheduler
echo 256 > /sys/block/nvme0n1/queue/nr_requests
echo 0 > /sys/block/nvme0n1/queue/add_random

# CPU governor for performance
for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
  echo performance > $cpu
done

# Disable transparent huge pages
echo never > /sys/kernel/mm/transparent_hugepage/enabled
echo never > /sys/kernel/mm/transparent_hugepage/defrag

# Reload systemd
systemctl daemon-reload
```

### 3. Monitoring and Alerting

```yaml
# prometheus-rules.yaml
groups:
  - name: performance_alerts
    interval: 30s
    rules:
      - alert: HighResponseTime
        expr: |
          histogram_quantile(0.95,
            sum(rate(http_request_duration_seconds_bucket[5m])) 
            by (le, endpoint)
          ) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High response time on {{ $labels.endpoint }}"
          description: "95th percentile response time is {{ $value }}s"
      
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m])) 
          / sum(rate(http_requests_total[5m])) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }}"
      
      - alert: DatabaseConnectionPoolExhaustion
        expr: |
          (pg_stat_database_numbackends / pg_settings_max_connections) > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Database connection pool near exhaustion"
          description: "{{ $value | humanizePercentage }} of connections used"
      
      - alert: CacheHitRateLow
        expr: |
          (
            sum(rate(redis_keyspace_hits_total[5m])) /
            (sum(rate(redis_keyspace_hits_total[5m])) + 
             sum(rate(redis_keyspace_misses_total[5m])))
          ) < 0.8
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Cache hit rate below threshold"
          description: "Cache hit rate is {{ $value | humanizePercentage }}"
```

## Performance Checklist

### Pre-Deployment
- [ ] Load tests pass with target metrics
- [ ] Database queries optimized (< 10ms avg)
- [ ] Cache hit ratio > 90%
- [ ] Container startup time < 30s
- [ ] Resource limits properly set
- [ ] CDN configured for static assets
- [ ] Connection pools sized appropriately
- [ ] Monitoring and alerts configured

### Post-Deployment
- [ ] Response times meet SLA
- [ ] Error rate < 0.1%
- [ ] CPU usage < 70%
- [ ] Memory usage < 80%
- [ ] No memory leaks detected
- [ ] Database connections stable
- [ ] Cache performing as expected
- [ ] CDN cache hit ratio > 90%

---

**Note:** Performance optimization is an ongoing process. Regularly review metrics and adjust configurations based on actual usage patterns.