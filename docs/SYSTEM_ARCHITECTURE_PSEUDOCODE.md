# System Architecture Pseudocode

## 1. Microservices Architecture

```pseudocode
SERVICE WhatsAppService {
    DEPENDENCIES: [MessageQueue, RedisCache, TenantService]
    
    FUNCTION handleWebhook(request) {
        // Verify webhook signature
        IF NOT verifyHMAC(request.headers['x-hub-signature-256'], request.body) THEN
            RETURN 401 Unauthorized
        END IF
        
        // Acknowledge immediately for 3-second SLA
        ASYNC publishToQueue(request.body)
        RETURN 200 OK
    }
    
    FUNCTION processMessage(message) {
        // Check for duplicate
        messageId = message.id
        IF redis.exists(f"processed:{messageId}") THEN
            RETURN // Skip duplicate
        END IF
        
        // Mark as processed with 24-hour TTL
        redis.setex(f"processed:{messageId}", 86400, "1")
        
        // Extract tenant context
        tenant = tenantService.getTenantByPhone(message.from)
        
        // Route to appropriate handler
        SWITCH message.type {
            CASE "text":
                RETURN handleTextMessage(message, tenant)
            CASE "image":
                RETURN handleImageMessage(message, tenant)
            CASE "interactive":
                RETURN handleInteractiveMessage(message, tenant)
        }
    }
}

SERVICE TenantService {
    DEPENDENCIES: [PostgreSQL, RedisCache]
    
    FUNCTION getTenantByPhone(phoneNumber) {
        // Check cache first
        cacheKey = f"tenant:phone:{phoneNumber}"
        cached = redis.get(cacheKey)
        IF cached THEN RETURN cached
        
        // Query database with sharding
        shardId = calculateShard(phoneNumber)
        query = "SELECT * FROM tenants WHERE phone_number = $1"
        tenant = db.shard[shardId].query(query, phoneNumber)
        
        // Cache for 1 hour
        redis.setex(cacheKey, 3600, tenant)
        RETURN tenant
    }
    
    FUNCTION provisionTenant(tenantData) {
        // Calculate shard
        shardId = MD5(tenantData.id) % 32
        
        // Create schema
        schemaName = f"tenant_{tenantData.id}"
        db.shard[shardId].execute(f"CREATE SCHEMA {schemaName}")
        
        // Apply migrations
        FOR migration IN migrations {
            db.shard[shardId].execute(migration, schema=schemaName)
        }
        
        // Set up RLS policies
        setupRowLevelSecurity(shardId, schemaName, tenantData.id)
        
        RETURN {success: true, shardId: shardId}
    }
}

SERVICE CatalogService {
    DEPENDENCIES: [PostgreSQL, ElasticSearch, RedisCache]
    
    FUNCTION searchProducts(query, tenantId, location) {
        // Build Elasticsearch query
        esQuery = {
            bool: {
                must: [
                    {match: {name: query}},
                    {term: {tenant_id: tenantId}},
                    {geo_distance: {
                        distance: "10km",
                        location: location
                    }}
                ]
            }
        }
        
        // Search with caching
        cacheKey = f"search:{tenantId}:{MD5(query)}:{location}"
        cached = redis.get(cacheKey)
        IF cached THEN RETURN cached
        
        results = elasticsearch.search(esQuery)
        redis.setex(cacheKey, 300, results) // 5-minute cache
        
        RETURN results
    }
    
    FUNCTION syncWithWhatsApp(tenantId) {
        // Get products from database
        products = getProductsByTenant(tenantId)
        
        // Transform to WhatsApp catalog format
        catalog = []
        FOR product IN products {
            catalog.append({
                retailer_id: product.sku,
                name: product.name,
                description: product.description,
                price: product.price * 100, // Convert to cents
                currency: "ZAR",
                availability: product.stock > 0 ? "in stock" : "out of stock"
            })
        }
        
        // Upload to WhatsApp
        whatsappAPI.uploadCatalog(tenantId, catalog)
    }
}

SERVICE PaymentService {
    DEPENDENCIES: [Paystack, Ozow, RedisCache, MessageQueue]
    
    FUNCTION processPayment(order, paymentMethod) {
        // Generate idempotency key
        idempotencyKey = f"{order.id}:{timestamp}"
        
        // Check if already processed
        IF redis.exists(f"payment:{idempotencyKey}") THEN
            RETURN redis.get(f"payment:{idempotencyKey}")
        END IF
        
        // Select gateway based on method and health
        gateway = selectGateway(paymentMethod)
        
        TRY {
            // Process payment
            result = gateway.charge({
                amount: order.total,
                currency: "ZAR",
                reference: order.id,
                customer: order.customer,
                metadata: {tenant_id: order.tenantId}
            })
            
            // Cache result
            redis.setex(f"payment:{idempotencyKey}", 86400, result)
            
            // Publish success event
            messageQueue.publish("payment.success", result)
            
            RETURN result
        } CATCH (PaymentException e) {
            // Try fallback gateway
            IF hasFallback(gateway) THEN
                RETURN processPayment(order, fallbackMethod(paymentMethod))
            END IF
            
            // Publish failure event
            messageQueue.publish("payment.failed", {order: order, error: e})
            THROW e
        }
    }
    
    FUNCTION selectGateway(method) {
        // Get gateway health scores
        gateways = getAvailableGateways(method)
        
        FOR gateway IN gateways {
            health = redis.get(f"gateway:health:{gateway.name}")
            IF health > 0.8 THEN RETURN gateway
        }
        
        THROW NoHealthyGatewayException
    }
}
```

## 2. API Gateway Configuration

```pseudocode
GATEWAY KongConfiguration {
    ROUTES: [
        {
            path: "/api/v1/webhooks/whatsapp",
            service: "whatsapp-service",
            plugins: ["hmac-auth", "rate-limiting", "correlation-id"]
        },
        {
            path: "/api/v1/products",
            service: "catalog-service",
            plugins: ["jwt-auth", "rate-limiting", "request-transformer"]
        },
        {
            path: "/api/v1/orders",
            service: "order-service",
            plugins: ["jwt-auth", "rate-limiting", "response-transformer"]
        },
        {
            path: "/api/v1/payments",
            service: "payment-service",
            plugins: ["jwt-auth", "rate-limiting", "request-validator"]
        }
    ]
    
    PLUGINS: {
        "rate-limiting": {
            minute: 100,
            hour: 5000,
            policy: "tenant-id"
        },
        "jwt-auth": {
            key_claim_name: "kid",
            secret_is_base64: true,
            claims_to_verify: ["exp", "tenant_id"]
        },
        "correlation-id": {
            header_name: "X-Correlation-ID",
            generator: "uuid"
        }
    }
}
```

## 3. Message Queue Architecture

```pseudocode
QUEUE RabbitMQConfiguration {
    EXCHANGES: [
        {
            name: "whatsapp.messages",
            type: "topic",
            durable: true
        },
        {
            name: "orders",
            type: "direct",
            durable: true
        },
        {
            name: "notifications",
            type: "fanout",
            durable: true
        }
    ]
    
    QUEUES: [
        {
            name: "whatsapp.inbound",
            bindings: ["whatsapp.messages.inbound.*"],
            dlx: "dlx.whatsapp",
            ttl: 300000 // 5 minutes
        },
        {
            name: "orders.process",
            bindings: ["orders.new"],
            dlx: "dlx.orders",
            max_retries: 3
        },
        {
            name: "notifications.whatsapp",
            bindings: ["notifications"],
            priority: true
        }
    ]
    
    FUNCTION publishWithRetry(exchange, routingKey, message) {
        retries = 0
        maxRetries = 3
        
        WHILE retries < maxRetries {
            TRY {
                channel.publish(exchange, routingKey, message, {
                    persistent: true,
                    messageId: generateUUID(),
                    timestamp: Date.now(),
                    headers: {
                        "x-retry-count": retries
                    }
                })
                RETURN true
            } CATCH (Exception e) {
                retries++
                WAIT exponentialBackoff(retries)
            }
        }
        
        // Send to DLX
        channel.publish("dlx", routingKey, message)
        THROW PublishFailedException
    }
}
```

## 4. Database Sharding Strategy

```pseudocode
SHARDING PostgreSQLSharding {
    SHARDS: 32
    REPLICATION_FACTOR: 3
    
    FUNCTION calculateShard(tenantId) {
        RETURN MD5(tenantId) % SHARDS
    }
    
    FUNCTION getConnection(tenantId) {
        shardId = calculateShard(tenantId)
        pool = connectionPools[shardId]
        
        IF NOT pool OR pool.idle < MIN_IDLE_CONNECTIONS {
            pool = createConnectionPool(shardId)
        }
        
        RETURN pool.getConnection()
    }
    
    FUNCTION executeQuery(tenantId, query, params) {
        connection = getConnection(tenantId)
        
        TRY {
            // Set tenant context
            connection.execute("SET app.current_tenant = $1", tenantId)
            
            // Execute actual query
            result = connection.execute(query, params)
            
            RETURN result
        } FINALLY {
            connection.release()
        }
    }
    
    FUNCTION crossShardQuery(query, params) {
        results = []
        promises = []
        
        // Execute on all shards in parallel
        FOR shardId IN [0..SHARDS-1] {
            promise = ASYNC executeOnShard(shardId, query, params)
            promises.append(promise)
        }
        
        // Wait for all results
        results = AWAIT Promise.all(promises)
        
        // Merge and sort results
        RETURN mergeResults(results)
    }
}
```

## 5. Redis Cache Patterns

```pseudocode
CACHE RedisCachePatterns {
    FUNCTION cacheAside(key, ttl, fetchFunction) {
        // Try cache first
        cached = redis.get(key)
        IF cached THEN RETURN deserialize(cached)
        
        // Fetch from source
        data = fetchFunction()
        
        // Cache with TTL
        redis.setex(key, ttl, serialize(data))
        
        RETURN data
    }
    
    FUNCTION pubSub() {
        // Publisher
        FUNCTION publishMessage(channel, message) {
            redis.publish(channel, JSON.stringify({
                timestamp: Date.now(),
                correlationId: generateUUID(),
                data: message
            }))
        }
        
        // Subscriber
        FUNCTION subscribeToChannel(channel, handler) {
            redis.subscribe(channel)
            
            redis.on("message", (receivedChannel, message) => {
                IF receivedChannel == channel {
                    parsedMessage = JSON.parse(message)
                    handler(parsedMessage)
                }
            })
        }
    }
    
    FUNCTION sessionManagement(sessionId, data) {
        key = f"session:{sessionId}"
        
        // Store session with sliding expiry
        redis.hset(key, data)
        redis.expire(key, 3600) // 1 hour
        
        // Track active sessions
        redis.sadd("active_sessions", sessionId)
        redis.expire("active_sessions", 3600)
    }
    
    FUNCTION rateLimiting(identifier, limit, window) {
        key = f"rate_limit:{identifier}:{Math.floor(Date.now() / window)}"
        
        current = redis.incr(key)
        IF current == 1 {
            redis.expire(key, window)
        }
        
        IF current > limit {
            THROW RateLimitExceededException
        }
        
        RETURN {
            remaining: limit - current,
            reset: Math.ceil(Date.now() / window) * window
        }
    }
}
```

## 6. Service Mesh Configuration

```pseudocode
MESH IstioConfiguration {
    VIRTUAL_SERVICES: [
        {
            name: "whatsapp-service",
            http: [{
                timeout: "3s",
                retries: {
                    attempts: 3,
                    perTryTimeout: "1s",
                    retryOn: "5xx,reset,connect-failure"
                }
            }]
        },
        {
            name: "payment-service",
            http: [{
                timeout: "30s",
                retries: {
                    attempts: 2,
                    perTryTimeout: "10s",
                    retryOn: "5xx,retriable-4xx"
                }
            }]
        }
    ]
    
    DESTINATION_RULES: [
        {
            name: "circuit-breaker",
            trafficPolicy: {
                connectionPool: {
                    tcp: {maxConnections: 100},
                    http: {
                        http1MaxPendingRequests: 50,
                        http2MaxRequests: 100
                    }
                },
                outlierDetection: {
                    consecutiveErrors: 5,
                    interval: "30s",
                    baseEjectionTime: "30s",
                    maxEjectionPercent: 50
                }
            }
        }
    ]
    
    TELEMETRY: {
        metrics: {
            providers: [{name: "prometheus"}],
            overrides: [
                {
                    match: {metric: "ALL_METRICS"},
                    tagOverrides: {
                        tenant_id: {value: "request.headers['x-tenant-id']"}
                    }
                }
            ]
        },
        tracing: {
            provider: "jaeger",
            sampling: 0.1, // 10% sampling
            customTags: {
                tenant_id: {header: {name: "x-tenant-id"}}
            }
        }
    }
}
```