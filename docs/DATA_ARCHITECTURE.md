# Data Architecture Design

## Executive Summary

This document defines the comprehensive data architecture for Wakala OS, including PostgreSQL schemas for multi-tenancy, table structures with Row-Level Security (RLS) policies, data models for all entities, caching strategies with Redis, and data migration/backup approaches.

## 1. Multi-Tenant Database Architecture

### 1.1 Sharding Strategy

```sql
-- Shard distribution configuration
CREATE TABLE shard_map (
    shard_id INTEGER PRIMARY KEY,
    shard_name VARCHAR(50) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INTEGER DEFAULT 5432,
    database_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    capacity_percentage DECIMAL(5,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tenant to shard mapping
CREATE TABLE tenant_shard_mapping (
    tenant_id UUID PRIMARY KEY,
    shard_id INTEGER REFERENCES shard_map(shard_id),
    schema_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(shard_id, schema_name)
);

-- Function to calculate shard for new tenant
CREATE OR REPLACE FUNCTION calculate_tenant_shard(tenant_id UUID)
RETURNS INTEGER AS $$
DECLARE
    shard_count INTEGER;
    target_shard INTEGER;
BEGIN
    SELECT COUNT(*) INTO shard_count FROM shard_map WHERE status = 'active';
    target_shard := abs(hashtext(tenant_id::text)) % shard_count;
    RETURN target_shard;
END;
$$ LANGUAGE plpgsql;
```

### 1.2 Schema Isolation Pattern

```sql
-- Base tenant schema template
CREATE SCHEMA IF NOT EXISTS tenant_template;

-- Switch to template schema
SET search_path TO tenant_template;

-- Core tenant tables
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(15) UNIQUE NOT NULL,
    name VARCHAR(255),
    email VARCHAR(255),
    whatsapp_verified BOOLEAN DEFAULT false,
    role VARCHAR(50) NOT NULL DEFAULT 'customer',
    status VARCHAR(20) DEFAULT 'active',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    business_name VARCHAR(255) NOT NULL,
    business_type VARCHAR(100),
    registration_number VARCHAR(100),
    tax_number VARCHAR(100),
    address JSONB NOT NULL,
    location GEOGRAPHY(POINT, 4326),
    operating_hours JSONB DEFAULT '{}',
    payment_methods JSONB DEFAULT '["cash"]',
    delivery_radius INTEGER DEFAULT 5000, -- meters
    minimum_order_value DECIMAL(10,2) DEFAULT 0,
    rating DECIMAL(3,2) DEFAULT 5.00,
    total_orders INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    parent_id UUID REFERENCES categories(id),
    description TEXT,
    image_url TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID REFERENCES vendors(id),
    category_id UUID REFERENCES categories(id),
    sku VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    compare_at_price DECIMAL(10,2),
    cost DECIMAL(10,2),
    currency VARCHAR(3) DEFAULT 'ZAR',
    unit VARCHAR(50) DEFAULT 'each',
    weight DECIMAL(10,3),
    dimensions JSONB,
    images JSONB DEFAULT '[]',
    tags TEXT[],
    status VARCHAR(20) DEFAULT 'active',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vendor_id, sku)
);

CREATE TABLE inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES products(id),
    location_id UUID,
    quantity INTEGER NOT NULL DEFAULT 0,
    reserved_quantity INTEGER DEFAULT 0,
    reorder_point INTEGER DEFAULT 10,
    reorder_quantity INTEGER DEFAULT 50,
    last_restock_date TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT positive_quantity CHECK (quantity >= 0),
    CONSTRAINT valid_reserved CHECK (reserved_quantity >= 0 AND reserved_quantity <= quantity)
);

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    date_of_birth DATE,
    gender VARCHAR(20),
    preferred_language VARCHAR(10) DEFAULT 'en',
    addresses JSONB DEFAULT '[]',
    payment_methods JSONB DEFAULT '[]',
    preferences JSONB DEFAULT '{}',
    lifetime_value DECIMAL(12,2) DEFAULT 0,
    total_orders INTEGER DEFAULT 0,
    last_order_date TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id UUID REFERENCES customers(id),
    vendor_id UUID REFERENCES vendors(id),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    subtotal DECIMAL(10,2) NOT NULL,
    tax_amount DECIMAL(10,2) DEFAULT 0,
    delivery_fee DECIMAL(10,2) DEFAULT 0,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    total_amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'ZAR',
    payment_method VARCHAR(50),
    payment_status VARCHAR(50) DEFAULT 'pending',
    delivery_address JSONB NOT NULL,
    delivery_location GEOGRAPHY(POINT, 4326),
    delivery_instructions TEXT,
    estimated_delivery_time TIMESTAMP,
    actual_delivery_time TIMESTAMP,
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id),
    product_id UUID REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    tax_amount DECIMAL(10,2) DEFAULT 0,
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT positive_quantity CHECK (quantity > 0)
);

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id),
    transaction_id VARCHAR(255) UNIQUE,
    gateway VARCHAR(50) NOT NULL,
    gateway_reference VARCHAR(255),
    method VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'ZAR',
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    gateway_response JSONB,
    processed_at TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id),
    driver_id UUID,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    pickup_location GEOGRAPHY(POINT, 4326),
    pickup_address JSONB,
    dropoff_location GEOGRAPHY(POINT, 4326),
    dropoff_address JSONB,
    distance_meters INTEGER,
    estimated_duration_minutes INTEGER,
    actual_duration_minutes INTEGER,
    route_polyline TEXT,
    tracking_url TEXT,
    proof_of_delivery JSONB,
    driver_notes TEXT,
    customer_rating INTEGER,
    customer_feedback TEXT,
    metadata JSONB DEFAULT '{}',
    assigned_at TIMESTAMP,
    picked_up_at TIMESTAMP,
    delivered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    license_number VARCHAR(100) UNIQUE NOT NULL,
    vehicle_type VARCHAR(50) NOT NULL,
    vehicle_registration VARCHAR(50) NOT NULL,
    vehicle_make VARCHAR(100),
    vehicle_model VARCHAR(100),
    vehicle_year INTEGER,
    has_cold_storage BOOLEAN DEFAULT false,
    current_location GEOGRAPHY(POINT, 4326),
    is_available BOOLEAN DEFAULT false,
    rating DECIMAL(3,2) DEFAULT 5.00,
    total_deliveries INTEGER DEFAULT 0,
    total_earnings DECIMAL(12,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_users_phone ON users(phone_number);
CREATE INDEX idx_vendors_location ON vendors USING GIST(location);
CREATE INDEX idx_products_vendor ON products(vendor_id);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_inventory_product ON inventory(product_id);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_vendor ON orders(vendor_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_deliveries_order ON deliveries(order_id);
CREATE INDEX idx_deliveries_driver ON deliveries(driver_id);
CREATE INDEX idx_deliveries_status ON deliveries(status);
CREATE INDEX idx_drivers_location ON drivers USING GIST(current_location);
CREATE INDEX idx_drivers_available ON drivers(is_available) WHERE is_available = true;
```

### 1.3 Row-Level Security (RLS) Policies

```sql
-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;

-- Create tenant context function
CREATE OR REPLACE FUNCTION current_tenant_id() 
RETURNS UUID AS $$
    SELECT current_setting('app.current_tenant_id')::UUID;
$$ LANGUAGE sql SECURITY DEFINER;

-- RLS Policies for users table
CREATE POLICY tenant_isolation_users ON users
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM tenant_users 
            WHERE tenant_users.user_id = users.id 
            AND tenant_users.tenant_id = current_tenant_id()
        )
    );

-- RLS Policies for vendors table
CREATE POLICY tenant_isolation_vendors ON vendors
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users u
            JOIN tenant_users tu ON u.id = tu.user_id
            WHERE u.id = vendors.user_id
            AND tu.tenant_id = current_tenant_id()
        )
    );

-- RLS Policies for products table
CREATE POLICY tenant_isolation_products ON products
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM vendors v
            JOIN users u ON v.user_id = u.id
            JOIN tenant_users tu ON u.id = tu.user_id
            WHERE v.id = products.vendor_id
            AND tu.tenant_id = current_tenant_id()
        )
    );

-- RLS Policies for orders table
CREATE POLICY tenant_isolation_orders ON orders
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM customers c
            JOIN users u ON c.user_id = u.id
            JOIN tenant_users tu ON u.id = tu.user_id
            WHERE c.id = orders.customer_id
            AND tu.tenant_id = current_tenant_id()
        )
        OR
        EXISTS (
            SELECT 1 FROM vendors v
            JOIN users u ON v.user_id = u.id
            JOIN tenant_users tu ON u.id = tu.user_id
            WHERE v.id = orders.vendor_id
            AND tu.tenant_id = current_tenant_id()
        )
    );
```

## 2. Core Data Models

### 2.1 User and Authentication Models

```sql
-- Authentication and session management
CREATE TABLE auth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    token_type VARCHAR(50) NOT NULL, -- 'access', 'refresh', 'reset'
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    device_info JSONB,
    expires_at TIMESTAMP NOT NULL,
    last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Permissions and roles
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '[]',
    is_system BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_roles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    granted_by UUID REFERENCES users(id),
    PRIMARY KEY (user_id, role_id)
);
```

### 2.2 Product and Inventory Models

```sql
-- Product variants and options
CREATE TABLE product_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    values JSONB NOT NULL DEFAULT '[]',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    options JSONB NOT NULL DEFAULT '{}',
    price DECIMAL(10,2),
    compare_at_price DECIMAL(10,2),
    cost DECIMAL(10,2),
    weight DECIMAL(10,3),
    dimensions JSONB,
    image_url TEXT,
    status VARCHAR(20) DEFAULT 'active',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, sku)
);

-- Inventory tracking
CREATE TABLE inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_id UUID REFERENCES inventory(id),
    movement_type VARCHAR(50) NOT NULL, -- 'restock', 'sale', 'adjustment', 'return'
    quantity INTEGER NOT NULL,
    reference_type VARCHAR(50), -- 'order', 'return', 'adjustment'
    reference_id UUID,
    notes TEXT,
    performed_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_id UUID REFERENCES inventory(id),
    order_id UUID REFERENCES orders(id),
    quantity INTEGER NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 2.3 Order and Transaction Models

```sql
-- Order status tracking
CREATE TABLE order_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    from_status VARCHAR(50),
    to_status VARCHAR(50) NOT NULL,
    reason TEXT,
    notes TEXT,
    changed_by UUID REFERENCES users(id),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Refunds and returns
CREATE TABLE returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id),
    return_number VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'requested',
    reason VARCHAR(255) NOT NULL,
    description TEXT,
    refund_amount DECIMAL(10,2),
    refund_method VARCHAR(50),
    items JSONB NOT NULL DEFAULT '[]',
    processed_by UUID REFERENCES users(id),
    processed_at TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Discounts and promotions
CREATE TABLE promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL, -- 'percentage', 'fixed', 'bogo'
    value DECIMAL(10,2) NOT NULL,
    minimum_order_value DECIMAL(10,2),
    maximum_discount DECIMAL(10,2),
    usage_limit INTEGER,
    usage_count INTEGER DEFAULT 0,
    customer_usage_limit INTEGER DEFAULT 1,
    applicable_products JSONB DEFAULT '[]',
    applicable_categories JSONB DEFAULT '[]',
    applicable_vendors JSONB DEFAULT '[]',
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_promotions (
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    promotion_id UUID REFERENCES promotions(id),
    discount_amount DECIMAL(10,2) NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (order_id, promotion_id)
);
```

### 2.4 Communication Models

```sql
-- WhatsApp messaging
CREATE TABLE whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id VARCHAR(255) UNIQUE NOT NULL,
    conversation_id VARCHAR(255) NOT NULL,
    from_number VARCHAR(15) NOT NULL,
    to_number VARCHAR(15) NOT NULL,
    direction VARCHAR(20) NOT NULL, -- 'inbound', 'outbound'
    type VARCHAR(50) NOT NULL, -- 'text', 'image', 'document', 'location', 'interactive'
    content JSONB NOT NULL,
    status VARCHAR(50) DEFAULT 'sent',
    status_timestamp TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id VARCHAR(255) UNIQUE NOT NULL,
    user_id UUID REFERENCES users(id),
    state VARCHAR(50) NOT NULL DEFAULT 'active',
    context JSONB DEFAULT '{}',
    last_message_at TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    type VARCHAR(50) NOT NULL,
    channel VARCHAR(50) NOT NULL, -- 'whatsapp', 'sms', 'email', 'push'
    title VARCHAR(255),
    content TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'pending',
    sent_at TIMESTAMP,
    read_at TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 2.5 Analytics Models

```sql
-- Event tracking
CREATE TABLE analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    user_id UUID REFERENCES users(id),
    session_id UUID,
    properties JSONB DEFAULT '{}',
    context JSONB DEFAULT '{}',
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (timestamp);

-- Create monthly partitions for analytics
CREATE TABLE analytics_events_y2024m01 PARTITION OF analytics_events
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- Aggregated metrics
CREATE TABLE daily_metrics (
    date DATE NOT NULL,
    metric_type VARCHAR(100) NOT NULL,
    dimensions JSONB NOT NULL DEFAULT '{}',
    values JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (date, metric_type, dimensions)
);

-- User behavior tracking
CREATE TABLE user_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    activity_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 3. Redis Caching Strategy

### 3.1 Cache Key Patterns

```yaml
cache_key_patterns:
  # User and session data
  user:
    pattern: "user:{user_id}"
    ttl: 3600 # 1 hour
    data: user profile, roles, permissions
  
  session:
    pattern: "session:{session_id}"
    ttl: 86400 # 24 hours
    data: session data, user context
  
  # Product catalog
  product:
    pattern: "product:{tenant_id}:{product_id}"
    ttl: 1800 # 30 minutes
    data: product details, variants, pricing
  
  product_list:
    pattern: "products:{tenant_id}:{category_id}:page:{page}"
    ttl: 300 # 5 minutes
    data: paginated product list
  
  # Inventory
  inventory:
    pattern: "inventory:{product_id}"
    ttl: 60 # 1 minute
    data: current stock level
  
  # Orders
  order:
    pattern: "order:{order_id}"
    ttl: 300 # 5 minutes
    data: order details, items, status
  
  # Search results
  search:
    pattern: "search:{tenant_id}:{query_hash}"
    ttl: 600 # 10 minutes
    data: search results
  
  # Rate limiting
  rate_limit:
    pattern: "rate:{identifier}:{window}"
    ttl: 3600 # 1 hour
    data: request count
  
  # Real-time tracking
  driver_location:
    pattern: "driver:location:{driver_id}"
    ttl: 30 # 30 seconds
    data: current location, speed, heading
  
  delivery_tracking:
    pattern: "delivery:tracking:{delivery_id}"
    ttl: 60 # 1 minute
    data: current status, location, ETA
```

### 3.2 Cache Implementation

```typescript
// Cache service implementation
class CacheService {
  private redis: RedisClient;
  private defaultTTL: number = 300; // 5 minutes

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch {
      return value as T;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    const serialized = typeof value === 'string' 
      ? value 
      : JSON.stringify(value);
    
    if (ttl) {
      await this.redis.setex(key, ttl, serialized);
    } else {
      await this.redis.setex(key, this.defaultTTL, serialized);
    }
  }

  async invalidate(pattern: string): Promise<void> {
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  // Cache-aside pattern
  async getOrSet<T>(
    key: string, 
    factory: () => Promise<T>, 
    ttl?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached) return cached;
    
    const value = await factory();
    await this.set(key, value, ttl);
    
    return value;
  }

  // Sliding window for rate limiting
  async incrementSlidingWindow(
    key: string, 
    windowMs: number
  ): Promise<number> {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now, `${now}-${Math.random()}`);
    pipeline.zcard(key);
    pipeline.expire(key, Math.ceil(windowMs / 1000));
    
    const results = await pipeline.exec();
    return results[2][1] as number;
  }
}
```

### 3.3 Cache Warming Strategy

```sql
-- Materialized views for cache warming
CREATE MATERIALIZED VIEW mv_popular_products AS
SELECT 
    p.id,
    p.vendor_id,
    p.name,
    p.price,
    p.images,
    COUNT(DISTINCT oi.order_id) as order_count,
    SUM(oi.quantity) as total_sold,
    AVG(r.rating) as avg_rating
FROM products p
LEFT JOIN order_items oi ON p.id = oi.product_id
LEFT JOIN reviews r ON p.id = r.product_id
WHERE p.status = 'active'
GROUP BY p.id
ORDER BY order_count DESC;

CREATE INDEX idx_mv_popular_vendor ON mv_popular_products(vendor_id);

-- Refresh strategy
CREATE OR REPLACE FUNCTION refresh_cache_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_popular_products;
    -- Add other materialized views
END;
$$ LANGUAGE plpgsql;

-- Schedule refresh
SELECT cron.schedule('refresh-cache-views', '*/15 * * * *', 'SELECT refresh_cache_views()');
```

## 4. Data Migration Strategy

### 4.1 Schema Migration Framework

```sql
-- Migration tracking table
CREATE TABLE schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    execution_time_ms INTEGER,
    checksum VARCHAR(64),
    applied_by VARCHAR(255)
);

-- Migration log table
CREATE TABLE migration_log (
    id SERIAL PRIMARY KEY,
    version VARCHAR(255) NOT NULL,
    operation VARCHAR(50) NOT NULL, -- 'apply', 'rollback'
    status VARCHAR(20) NOT NULL, -- 'started', 'completed', 'failed'
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

-- Sample migration procedures
CREATE OR REPLACE FUNCTION apply_migration(
    p_version VARCHAR,
    p_name VARCHAR,
    p_up_script TEXT,
    p_checksum VARCHAR
) RETURNS void AS $$
DECLARE
    v_start_time TIMESTAMP;
    v_end_time TIMESTAMP;
    v_execution_time INTEGER;
BEGIN
    -- Check if already applied
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = p_version) THEN
        RAISE NOTICE 'Migration % already applied', p_version;
        RETURN;
    END IF;
    
    -- Log start
    INSERT INTO migration_log (version, operation, status)
    VALUES (p_version, 'apply', 'started');
    
    v_start_time := clock_timestamp();
    
    -- Execute migration
    BEGIN
        EXECUTE p_up_script;
        
        v_end_time := clock_timestamp();
        v_execution_time := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time));
        
        -- Record successful migration
        INSERT INTO schema_migrations (version, name, execution_time_ms, checksum)
        VALUES (p_version, p_name, v_execution_time, p_checksum);
        
        -- Update log
        UPDATE migration_log 
        SET status = 'completed', 
            completed_at = v_end_time
        WHERE version = p_version 
        AND operation = 'apply' 
        AND status = 'started';
        
    EXCEPTION WHEN OTHERS THEN
        -- Log failure
        UPDATE migration_log 
        SET status = 'failed', 
            error_message = SQLERRM,
            completed_at = clock_timestamp()
        WHERE version = p_version 
        AND operation = 'apply' 
        AND status = 'started';
        
        RAISE;
    END;
END;
$$ LANGUAGE plpgsql;
```

### 4.2 Tenant Data Migration

```sql
-- Tenant migration procedures
CREATE OR REPLACE FUNCTION migrate_tenant_to_shard(
    p_tenant_id UUID,
    p_target_shard INTEGER
) RETURNS void AS $$
DECLARE
    v_source_shard INTEGER;
    v_schema_name VARCHAR;
    v_migration_id UUID;
BEGIN
    -- Get current shard
    SELECT shard_id, schema_name 
    INTO v_source_shard, v_schema_name
    FROM tenant_shard_mapping 
    WHERE tenant_id = p_tenant_id;
    
    IF v_source_shard = p_target_shard THEN
        RAISE NOTICE 'Tenant already on target shard';
        RETURN;
    END IF;
    
    -- Create migration record
    v_migration_id := gen_random_uuid();
    INSERT INTO tenant_migrations (
        id, tenant_id, source_shard, target_shard, status
    ) VALUES (
        v_migration_id, p_tenant_id, v_source_shard, p_target_shard, 'started'
    );
    
    -- Copy schema to target shard
    PERFORM copy_tenant_schema(
        v_source_shard, p_target_shard, v_schema_name
    );
    
    -- Sync data during migration
    PERFORM sync_tenant_data(
        p_tenant_id, v_source_shard, p_target_shard
    );
    
    -- Switch tenant to new shard
    UPDATE tenant_shard_mapping 
    SET shard_id = p_target_shard 
    WHERE tenant_id = p_tenant_id;
    
    -- Mark migration complete
    UPDATE tenant_migrations 
    SET status = 'completed', 
        completed_at = CURRENT_TIMESTAMP 
    WHERE id = v_migration_id;
    
    -- Schedule cleanup of old data
    PERFORM schedule_tenant_cleanup(p_tenant_id, v_source_shard);
    
END;
$$ LANGUAGE plpgsql;
```

### 4.3 Zero-Downtime Migration Patterns

```typescript
// Blue-green migration strategy
class MigrationOrchestrator {
  async performZeroDowntimeMigration(
    migration: Migration
  ): Promise<void> {
    // Phase 1: Prepare
    await this.createShadowTables(migration);
    await this.setupTriggers(migration);
    
    // Phase 2: Initial sync
    await this.performInitialDataSync(migration);
    
    // Phase 3: Continuous sync
    const syncJob = await this.startContinuousSync(migration);
    
    // Phase 4: Verify data integrity
    const isValid = await this.verifyDataIntegrity(migration);
    if (!isValid) {
      throw new MigrationIntegrityError();
    }
    
    // Phase 5: Switch over
    await this.performAtomicSwitch(migration);
    
    // Phase 6: Cleanup
    await syncJob.stop();
    await this.cleanupOldStructures(migration);
  }
  
  private async createShadowTables(migration: Migration) {
    for (const table of migration.tables) {
      await this.db.query(`
        CREATE TABLE ${table}_new 
        (LIKE ${table} INCLUDING ALL)
      `);
    }
  }
  
  private async setupTriggers(migration: Migration) {
    for (const table of migration.tables) {
      await this.db.query(`
        CREATE TRIGGER ${table}_sync_trigger
        AFTER INSERT OR UPDATE OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION sync_to_shadow_table()
      `);
    }
  }
}
```

## 5. Backup and Recovery Strategy

### 5.1 Backup Configuration

```yaml
backup_strategy:
  continuous_archiving:
    enabled: true
    wal_level: replica
    archive_mode: on
    archive_command: 'aws s3 cp %p s3://wakala-backups/wal/%f'
    
  scheduled_backups:
    full_backup:
      schedule: "0 2 * * 0"  # Weekly at 2 AM on Sunday
      retention_days: 30
      compression: gzip
      encryption: AES-256
      
    incremental_backup:
      schedule: "0 2 * * 1-6"  # Daily at 2 AM except Sunday
      retention_days: 7
      
    transaction_log_backup:
      schedule: "*/15 * * * *"  # Every 15 minutes
      retention_hours: 48
      
  backup_locations:
    primary: s3://wakala-backups/primary/
    secondary: s3://wakala-backups-dr/secondary/
    
  point_in_time_recovery:
    enabled: true
    retention_period: 7  # days
```

### 5.2 Backup Implementation

```sql
-- Backup procedures
CREATE OR REPLACE FUNCTION perform_tenant_backup(
    p_tenant_id UUID,
    p_backup_type VARCHAR DEFAULT 'full'
) RETURNS TABLE(
    backup_id UUID,
    size_bytes BIGINT,
    duration_seconds INTEGER,
    location TEXT
) AS $$
DECLARE
    v_backup_id UUID;
    v_start_time TIMESTAMP;
    v_end_time TIMESTAMP;
    v_schema_name VARCHAR;
    v_backup_path TEXT;
    v_size BIGINT;
BEGIN
    v_backup_id := gen_random_uuid();
    v_start_time := clock_timestamp();
    
    -- Get tenant schema
    SELECT schema_name INTO v_schema_name
    FROM tenant_shard_mapping
    WHERE tenant_id = p_tenant_id;
    
    -- Create backup
    v_backup_path := format(
        's3://wakala-backups/tenants/%s/%s/%s.dump',
        p_tenant_id,
        to_char(CURRENT_DATE, 'YYYY/MM/DD'),
        v_backup_id
    );
    
    -- Log backup start
    INSERT INTO backup_log (
        backup_id, tenant_id, backup_type, status, started_at
    ) VALUES (
        v_backup_id, p_tenant_id, p_backup_type, 'started', v_start_time
    );
    
    -- Perform backup based on type
    IF p_backup_type = 'full' THEN
        PERFORM pg_dump_to_s3(v_schema_name, v_backup_path);
    ELSIF p_backup_type = 'incremental' THEN
        PERFORM pg_dump_incremental_to_s3(v_schema_name, v_backup_path);
    END IF;
    
    v_end_time := clock_timestamp();
    
    -- Get backup size
    SELECT size_bytes INTO v_size
    FROM aws_s3_stat(v_backup_path);
    
    -- Update backup log
    UPDATE backup_log
    SET status = 'completed',
        completed_at = v_end_time,
        size_bytes = v_size,
        location = v_backup_path
    WHERE backup_id = v_backup_id;
    
    RETURN QUERY
    SELECT 
        v_backup_id,
        v_size,
        EXTRACT(SECONDS FROM (v_end_time - v_start_time))::INTEGER,
        v_backup_path;
END;
$$ LANGUAGE plpgsql;

-- Recovery procedures
CREATE OR REPLACE FUNCTION restore_tenant_backup(
    p_backup_id UUID,
    p_target_tenant_id UUID DEFAULT NULL
) RETURNS void AS $$
DECLARE
    v_backup_record RECORD;
    v_target_schema VARCHAR;
BEGIN
    -- Get backup details
    SELECT * INTO v_backup_record
    FROM backup_log
    WHERE backup_id = p_backup_id
    AND status = 'completed';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Backup not found or incomplete';
    END IF;
    
    -- Determine target schema
    IF p_target_tenant_id IS NULL THEN
        p_target_tenant_id := v_backup_record.tenant_id;
    END IF;
    
    SELECT schema_name INTO v_target_schema
    FROM tenant_shard_mapping
    WHERE tenant_id = p_target_tenant_id;
    
    -- Create restore point
    PERFORM pg_create_restore_point(
        format('before_restore_%s', p_backup_id)
    );
    
    -- Perform restore
    PERFORM pg_restore_from_s3(
        v_backup_record.location,
        v_target_schema
    );
    
    -- Log restore
    INSERT INTO restore_log (
        restore_id, backup_id, target_tenant_id, status, completed_at
    ) VALUES (
        gen_random_uuid(), p_backup_id, p_target_tenant_id, 
        'completed', CURRENT_TIMESTAMP
    );
END;
$$ LANGUAGE plpgsql;
```

### 5.3 Disaster Recovery Plan

```yaml
disaster_recovery:
  rpo: 15  # Recovery Point Objective in minutes
  rto: 60  # Recovery Time Objective in minutes
  
  replication:
    type: streaming
    mode: async
    max_lag_bytes: 10485760  # 10MB
    
  failover_strategy:
    automatic: true
    health_check_interval: 10  # seconds
    failed_checks_threshold: 3
    
  regions:
    primary: af-south-1
    standby: eu-west-1
    
  testing:
    schedule: "0 0 1 * *"  # Monthly
    type: "full_failover_test"
    notification_channels:
      - email: ops@wakala.os
      - slack: "#dr-testing"
```

## 6. Data Governance and Compliance

### 6.1 Data Retention Policies

```sql
-- Data retention configuration
CREATE TABLE data_retention_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(255) NOT NULL,
    retention_days INTEGER NOT NULL,
    archive_after_days INTEGER,
    delete_after_days INTEGER,
    conditions JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Automated data purging
CREATE OR REPLACE FUNCTION apply_retention_policies()
RETURNS void AS $$
DECLARE
    v_policy RECORD;
    v_deleted_count INTEGER;
BEGIN
    FOR v_policy IN 
        SELECT * FROM data_retention_policies WHERE is_active = true
    LOOP
        -- Archive old data
        IF v_policy.archive_after_days IS NOT NULL THEN
            EXECUTE format(
                'INSERT INTO %I_archive SELECT * FROM %I WHERE created_at < CURRENT_DATE - INTERVAL ''%s days'' %s',
                v_policy.table_name,
                v_policy.table_name,
                v_policy.archive_after_days,
                CASE WHEN v_policy.conditions != '{}' 
                    THEN 'AND ' || jsonb_to_sql_conditions(v_policy.conditions)
                    ELSE ''
                END
            );
        END IF;
        
        -- Delete expired data
        IF v_policy.delete_after_days IS NOT NULL THEN
            EXECUTE format(
                'DELETE FROM %I WHERE created_at < CURRENT_DATE - INTERVAL ''%s days'' %s',
                v_policy.table_name,
                v_policy.delete_after_days,
                CASE WHEN v_policy.conditions != '{}' 
                    THEN 'AND ' || jsonb_to_sql_conditions(v_policy.conditions)
                    ELSE ''
                END
            );
            
            GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
            
            -- Log deletion
            INSERT INTO data_deletion_log (
                table_name, deleted_count, policy_id, executed_at
            ) VALUES (
                v_policy.table_name, v_deleted_count, v_policy.id, CURRENT_TIMESTAMP
            );
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Schedule retention job
SELECT cron.schedule('apply-retention-policies', '0 3 * * *', 'SELECT apply_retention_policies()');
```

### 6.2 Data Privacy and POPIA Compliance

```sql
-- Personal data tracking
CREATE TABLE personal_data_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(255) NOT NULL,
    column_name VARCHAR(255) NOT NULL,
    data_category VARCHAR(100) NOT NULL, -- 'name', 'contact', 'financial', 'health'
    sensitivity_level VARCHAR(50) NOT NULL, -- 'public', 'internal', 'confidential', 'restricted'
    encryption_required BOOLEAN DEFAULT false,
    anonymization_method VARCHAR(100),
    retention_period_days INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(table_name, column_name)
);

-- Data subject requests
CREATE TABLE data_subject_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_type VARCHAR(50) NOT NULL, -- 'access', 'rectification', 'erasure', 'portability'
    subject_id UUID NOT NULL,
    subject_type VARCHAR(50) NOT NULL, -- 'customer', 'vendor', 'driver'
    status VARCHAR(50) DEFAULT 'pending',
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    processed_by UUID REFERENCES users(id),
    response JSONB,
    metadata JSONB DEFAULT '{}'
);

-- Consent management
CREATE TABLE consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL,
    subject_type VARCHAR(50) NOT NULL,
    purpose VARCHAR(255) NOT NULL,
    lawful_basis VARCHAR(100) NOT NULL,
    consent_given BOOLEAN NOT NULL,
    consent_text TEXT,
    version VARCHAR(50),
    ip_address INET,
    given_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    withdrawn_at TIMESTAMP,
    expires_at TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

-- Audit trail
CREATE TABLE data_access_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    table_name VARCHAR(255),
    record_id UUID,
    ip_address INET,
    user_agent TEXT,
    purpose VARCHAR(255),
    accessed_fields TEXT[],
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (created_at);
```

## 7. Performance Optimization

### 7.1 Indexing Strategy

```sql
-- Partial indexes for common queries
CREATE INDEX idx_orders_active ON orders(created_at DESC) 
WHERE status NOT IN ('completed', 'cancelled');

CREATE INDEX idx_products_available ON products(vendor_id, category_id) 
WHERE status = 'active' AND inventory_quantity > 0;

CREATE INDEX idx_drivers_available_location ON drivers USING GIST(current_location) 
WHERE is_available = true AND status = 'active';

-- Composite indexes for complex queries
CREATE INDEX idx_order_customer_status ON orders(customer_id, status, created_at DESC);
CREATE INDEX idx_product_search ON products USING GIN(
    to_tsvector('english', name || ' ' || COALESCE(description, ''))
);

-- Function-based indexes
CREATE INDEX idx_orders_date ON orders(DATE(created_at));
CREATE INDEX idx_users_phone_normalized ON users(regexp_replace(phone_number, '[^0-9]', '', 'g'));
```

### 7.2 Query Optimization

```sql
-- Optimized views for common queries
CREATE OR REPLACE VIEW v_order_summary AS
SELECT 
    o.id,
    o.order_number,
    o.status,
    o.total_amount,
    o.created_at,
    c.first_name || ' ' || c.last_name as customer_name,
    c.phone_number as customer_phone,
    v.business_name as vendor_name,
    COUNT(oi.id) as item_count,
    d.status as delivery_status,
    d.estimated_delivery_time
FROM orders o
JOIN customers c ON o.customer_id = c.id
JOIN vendors v ON o.vendor_id = v.id
LEFT JOIN order_items oi ON o.id = oi.order_id
LEFT JOIN deliveries d ON o.id = d.order_id
GROUP BY o.id, c.id, v.id, d.id;

-- Materialized view for analytics
CREATE MATERIALIZED VIEW mv_daily_sales_summary AS
SELECT 
    DATE(o.created_at) as sale_date,
    o.vendor_id,
    COUNT(DISTINCT o.id) as order_count,
    COUNT(DISTINCT o.customer_id) as unique_customers,
    SUM(o.total_amount) as total_revenue,
    AVG(o.total_amount) as avg_order_value,
    SUM(oi.quantity) as items_sold
FROM orders o
JOIN order_items oi ON o.id = oi.order_id
WHERE o.status = 'completed'
GROUP BY DATE(o.created_at), o.vendor_id
WITH DATA;

CREATE UNIQUE INDEX idx_mv_daily_sales ON mv_daily_sales_summary(sale_date, vendor_id);

-- Auto-refresh materialized views
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_sales_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_popular_products;
END;
$$ LANGUAGE plpgsql;

SELECT cron.schedule('refresh-materialized-views', '0 * * * *', 'SELECT refresh_materialized_views()');
```

### 7.3 Connection Pooling Configuration

```yaml
connection_pooling:
  pgbouncer:
    pool_mode: transaction
    max_client_conn: 1000
    default_pool_size: 25
    min_pool_size: 10
    reserve_pool_size: 5
    reserve_pool_timeout: 3
    max_db_connections: 100
    
  application_pools:
    read_pool:
      size: 50
      overflow: 10
      timeout: 30
      recycle: 3600
      
    write_pool:
      size: 20
      overflow: 5
      timeout: 30
      recycle: 1800
      
    analytics_pool:
      size: 10
      overflow: 5
      timeout: 300
      recycle: 7200
```

## 8. Monitoring and Maintenance

### 8.1 Database Health Monitoring

```sql
-- Table for tracking database metrics
CREATE TABLE database_metrics (
    id SERIAL PRIMARY KEY,
    metric_name VARCHAR(100) NOT NULL,
    metric_value NUMERIC,
    metric_unit VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Monitor table sizes
CREATE OR REPLACE FUNCTION monitor_table_sizes()
RETURNS TABLE(
    schema_name TEXT,
    table_name TEXT,
    total_size BIGINT,
    table_size BIGINT,
    indexes_size BIGINT,
    toast_size BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        schemaname::TEXT,
        tablename::TEXT,
        pg_total_relation_size((schemaname||'.'||tablename)::regclass) as total_size,
        pg_relation_size((schemaname||'.'||tablename)::regclass) as table_size,
        pg_indexes_size((schemaname||'.'||tablename)::regclass) as indexes_size,
        pg_total_relation_size((schemaname||'.'||tablename)::regclass) - 
            pg_relation_size((schemaname||'.'||tablename)::regclass) - 
            pg_indexes_size((schemaname||'.'||tablename)::regclass) as toast_size
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY total_size DESC;
END;
$$ LANGUAGE plpgsql;

-- Monitor query performance
CREATE OR REPLACE VIEW v_slow_queries AS
SELECT 
    query,
    calls,
    total_time,
    mean_time,
    min_time,
    max_time,
    stddev_time,
    rows
FROM pg_stat_statements
WHERE mean_time > 100  -- queries taking more than 100ms on average
ORDER BY mean_time DESC;

-- Vacuum and analyze automation
CREATE OR REPLACE FUNCTION auto_maintenance()
RETURNS void AS $$
DECLARE
    v_table RECORD;
BEGIN
    -- Vacuum tables that need it
    FOR v_table IN 
        SELECT 
            schemaname,
            tablename,
            n_dead_tup,
            n_live_tup
        FROM pg_stat_user_tables
        WHERE n_dead_tup > n_live_tup * 0.2  -- 20% dead tuples
        AND n_live_tup > 10000
    LOOP
        EXECUTE format('VACUUM ANALYZE %I.%I', v_table.schemaname, v_table.tablename);
    END LOOP;
END;
$$ LANGUAGE plpgsql;
```

## Conclusion

This data architecture provides a robust foundation for Wakala OS with:

1. **Multi-tenant isolation** through schema separation and RLS policies
2. **Scalability** via sharding and efficient caching strategies
3. **Performance** through optimized indexes and materialized views
4. **Reliability** with comprehensive backup and recovery procedures
5. **Compliance** with POPIA requirements and data governance
6. **Maintainability** through automated monitoring and maintenance

The architecture supports both current requirements and future growth while maintaining data integrity, security, and performance.