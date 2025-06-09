# Wakala OS System Architecture Pseudocode
## Version 1.0 - Phase 2 Design

### 1. High-Level Architecture Overview

```pseudocode
ARCHITECTURE WakalaOS:
    LAYERS:
        1. API Gateway Layer (Kong)
        2. Service Mesh Layer (Istio)
        3. Microservices Layer
        4. Data Layer (PostgreSQL + Redis)
        5. Message Queue Layer (RabbitMQ)
        6. External Services Layer
    
    COMPONENTS:
        - WhatsAppService (Webhook Handler)
        - ConversationService (State Management)
        - TenantService (Multi-tenancy)
        - CatalogService (Product Management)
        - OrderService (Order Processing)
        - PaymentService (Payment Orchestration)
        - DriverService (Delivery Management)
        - NotificationService (Alerts & Messages)
        - AnalyticsService (Metrics & Reporting)
        - AuthService (Authentication & Authorization)
```

### 2. API Gateway Design

```pseudocode
SERVICE APIGateway:
    CONFIG:
        - Rate limiting: 1000 req/sec per tenant
        - JWT validation
        - Request routing
        - Response caching
        - Circuit breaker
    
    FUNCTION handleRequest(request):
        // Validate JWT token
        IF NOT validateJWT(request.headers.authorization):
            RETURN 401 Unauthorized
        
        // Extract tenant context
        tenantId = extractTenantId(request.token)
        
        // Apply rate limiting
        IF rateLimiter.isExceeded(tenantId):
            RETURN 429 Too Many Requests
        
        // Route to appropriate service
        response = routeToService(request, tenantId)
        
        // Cache if applicable
        IF request.method == "GET":
            cache.set(request.url, response, TTL=300)
        
        RETURN response
```

### 3. WhatsApp Service Architecture

```pseudocode
SERVICE WhatsAppService:
    DEPENDENCIES:
        - ConversationService
        - TenantService
        - MessageQueue
        - Redis (deduplication)
    
    FUNCTION handleWebhook(payload):
        START_TIMER()
        
        // Verify webhook signature
        IF NOT verifyHMAC(payload, signature):
            RETURN 401 Unauthorized
        
        // Check for duplicate (idempotency)
        messageId = payload.entry[0].id
        IF redis.exists(messageId):
            RETURN 200 OK  // Already processed
        
        // Set deduplication key
        redis.setex(messageId, 86400, "1")  // 24 hour TTL
        
        // Extract message data
        message = extractMessage(payload)
        tenantId = getTenantFromPhoneNumber(message.to)
        
        // Async processing via queue
        messageQueue.publish("whatsapp.incoming", {
            tenantId: tenantId,
            message: message,
            timestamp: NOW()
        })
        
        // Ensure < 3 second response
        ENSURE_TIME() < 3000ms
        RETURN 200 OK
    
    FUNCTION sendMessage(recipient, message, tenantId):
        // Get tenant configuration
        config = tenantService.getConfig(tenantId)
        
        // Select appropriate template if needed
        IF message.type == "template":
            template = selectTemplate(message.templateName, config.language)
            message = fillTemplate(template, message.parameters)
        
        // Send via WhatsApp API
        response = whatsappAPI.send({
            to: recipient,
            type: message.type,
            content: message.content
        })
        
        // Track message status
        messageQueue.publish("whatsapp.sent", {
            messageId: response.messageId,
            tenantId: tenantId,
            status: "sent"
        })
        
        RETURN response
```

### 4. Conversation Service (State Machine)

```pseudocode
SERVICE ConversationService:
    STATES:
        - IDLE
        - GREETING
        - INTENT_DETECTION
        - VENDOR_FLOW
        - CUSTOMER_FLOW
        - DRIVER_FLOW
        - ORDER_TRACKING
        - SUPPORT
        - ERROR
    
    FUNCTION processMessage(userId, message, context):
        // Load or create conversation state
        state = loadConversationState(userId) OR createNewState(userId)
        
        // State machine logic
        SWITCH state.current:
            CASE IDLE:
                state = handleIdle(message, context)
            
            CASE GREETING:
                state = handleGreeting(message, context)
            
            CASE INTENT_DETECTION:
                intent = detectIntent(message)
                state = routeByIntent(intent, context)
            
            CASE VENDOR_FLOW:
                state = vendorStateMachine.process(message, state, context)
            
            CASE CUSTOMER_FLOW:
                state = customerStateMachine.process(message, state, context)
            
            CASE DRIVER_FLOW:
                state = driverStateMachine.process(message, state, context)
            
            DEFAULT:
                state = handleError(message, context)
        
        // Persist state
        saveConversationState(userId, state)
        
        // Generate response
        response = generateResponse(state)
        RETURN response
    
    FUNCTION detectIntent(message):
        // Natural language processing
        tokens = tokenize(message.text.toLowerCase())
        
        // Pattern matching
        IF matches(tokens, ["sell", "vendor", "list"]):
            RETURN INTENT_VENDOR
        ELSE IF matches(tokens, ["buy", "purchase", "order"]):
            RETURN INTENT_CUSTOMER
        ELSE IF matches(tokens, ["deliver", "driver", "pickup"]):
            RETURN INTENT_DRIVER
        ELSE IF matches(tokens, ["track", "status", "where"]):
            RETURN INTENT_TRACKING
        ELSE:
            RETURN INTENT_UNKNOWN
```

### 5. Multi-Tenant Architecture

```pseudocode
SERVICE TenantService:
    DATA_MODEL:
        Tenant {
            id: UUID
            name: String
            tier: ENUM(basic, premium, enterprise)
            config: {
                whatsappNumber: String
                language: String
                currency: String
                features: Array<String>
                limits: {
                    maxProducts: Integer
                    maxOrders: Integer
                    maxUsers: Integer
                }
            }
            shardId: Integer (1-32)
            status: ENUM(active, suspended, trial)
        }
    
    FUNCTION provisionTenant(tenantData):
        // Validate tenant data
        IF NOT validate(tenantData):
            THROW ValidationError
        
        // Assign to shard (consistent hashing)
        shardId = consistentHash(tenantData.id) % 32
        
        // Create database schema
        db = getShardConnection(shardId)
        db.createSchema(tenantData.id)
        
        // Apply RLS policies
        applyRowLevelSecurity(db, tenantData.id)
        
        // Initialize tenant configuration
        config = createDefaultConfig(tenantData.tier)
        
        // Register in service mesh
        istio.registerTenant(tenantData.id, config)
        
        // Publish tenant created event
        eventBus.publish("tenant.created", tenantData)
        
        RETURN tenantData
    
    FUNCTION getTenantContext(tenantId):
        // Check cache first
        context = cache.get("tenant:" + tenantId)
        IF context:
            RETURN context
        
        // Load from database
        tenant = db.query("SELECT * FROM tenants WHERE id = ?", tenantId)
        
        // Build context
        context = {
            tenantId: tenant.id,
            shardId: tenant.shardId,
            config: tenant.config,
            features: tenant.features,
            limits: tenant.limits
        }
        
        // Cache for 5 minutes
        cache.setex("tenant:" + tenantId, 300, context)
        
        RETURN context
```

### 6. Catalog Service Architecture

```pseudocode
SERVICE CatalogService:
    DEPENDENCIES:
        - Elasticsearch
        - PostgreSQL
        - Redis Cache
        - S3 (media storage)
    
    FUNCTION createProduct(productData, tenantId):
        // Validate product data
        IF NOT validateProduct(productData):
            THROW ValidationError
        
        // Process and optimize images
        optimizedImages = []
        FOR image IN productData.images:
            optimized = imageProcessor.optimize(image, {
                maxWidth: 800,
                quality: 85,
                format: "webp"
            })
            url = s3.upload(optimized, "products/" + tenantId)
            optimizedImages.append(url)
        
        // Store in database
        product = db.insert("products", {
            ...productData,
            tenant_id: tenantId,
            images: optimizedImages,
            search_vector: generateSearchVector(productData)
        })
        
        // Index in Elasticsearch
        elasticsearch.index("products", {
            id: product.id,
            tenantId: tenantId,
            name: product.name,
            description: product.description,
            price: product.price,
            location: product.vendor.location,
            categories: product.categories
        })
        
        // Invalidate cache
        cache.delete("products:tenant:" + tenantId)
        
        RETURN product
    
    FUNCTION searchProducts(query, filters, tenantId):
        // Build Elasticsearch query
        esQuery = {
            bool: {
                must: [
                    { match: { tenantId: tenantId } },
                    { multi_match: {
                        query: query,
                        fields: ["name^3", "description", "categories^2"]
                    }}
                ],
                filter: buildFilters(filters)
            }
        }
        
        // Add location filter if provided
        IF filters.location:
            esQuery.bool.filter.push({
                geo_distance: {
                    distance: filters.radius OR "10km",
                    location: filters.location
                }
            })
        
        // Execute search
        results = elasticsearch.search("products", esQuery)
        
        // Enrich with database data
        productIds = results.hits.map(hit => hit.id)
        products = db.query(
            "SELECT * FROM products WHERE id IN (?) AND tenant_id = ?",
            productIds, tenantId
        )
        
        RETURN products
```

### 7. Order Processing Architecture

```pseudocode
SERVICE OrderService:
    STATES:
        - CREATED
        - PAYMENT_PENDING
        - PAID
        - CONFIRMED
        - PREPARING
        - READY_FOR_PICKUP
        - ASSIGNED_TO_DRIVER
        - IN_TRANSIT
        - DELIVERED
        - CANCELLED
        - REFUNDED
    
    FUNCTION createOrder(orderData, tenantId):
        // Start distributed transaction
        transaction = beginTransaction()
        
        TRY:
            // Validate inventory
            FOR item IN orderData.items:
                product = catalogService.getProduct(item.productId)
                IF product.stock < item.quantity:
                    THROW InsufficientStockError
            
            // Calculate totals
            subtotal = calculateSubtotal(orderData.items)
            deliveryFee = calculateDeliveryFee(orderData.deliveryAddress)
            tax = calculateTax(subtotal, tenantId)
            total = subtotal + deliveryFee + tax
            
            // Create order record
            order = db.insert("orders", {
                tenant_id: tenantId,
                customer_id: orderData.customerId,
                items: orderData.items,
                subtotal: subtotal,
                delivery_fee: deliveryFee,
                tax: tax,
                total: total,
                status: "CREATED",
                delivery_address: orderData.deliveryAddress
            })
            
            // Reserve inventory
            FOR item IN orderData.items:
                catalogService.reserveStock(item.productId, item.quantity)
            
            // Initiate payment
            paymentIntent = paymentService.createIntent({
                orderId: order.id,
                amount: total,
                customerId: orderData.customerId,
                metadata: { tenantId: tenantId }
            })
            
            // Update order with payment intent
            db.update("orders", order.id, {
                payment_intent_id: paymentIntent.id,
                status: "PAYMENT_PENDING"
            })
            
            transaction.commit()
            
            // Publish event
            eventBus.publish("order.created", {
                orderId: order.id,
                tenantId: tenantId,
                total: total
            })
            
            RETURN order
            
        CATCH error:
            transaction.rollback()
            THROW error
    
    FUNCTION processOrderStateTransition(orderId, newStatus, metadata):
        // Load current order state
        order = db.query("SELECT * FROM orders WHERE id = ?", orderId)
        
        // Validate state transition
        IF NOT isValidTransition(order.status, newStatus):
            THROW InvalidStateTransitionError
        
        // Update order status
        db.update("orders", orderId, {
            status: newStatus,
            updated_at: NOW()
        })
        
        // Handle state-specific logic
        SWITCH newStatus:
            CASE "PAID":
                handleOrderPaid(order)
            CASE "READY_FOR_PICKUP":
                notifyAvailableDrivers(order)
            CASE "DELIVERED":
                handleOrderDelivered(order)
            CASE "CANCELLED":
                handleOrderCancelled(order)
        
        // Publish state change event
        eventBus.publish("order.status_changed", {
            orderId: orderId,
            previousStatus: order.status,
            newStatus: newStatus,
            metadata: metadata
        })
```

### 8. Payment Service Architecture

```pseudocode
SERVICE PaymentService:
    GATEWAYS:
        - Paystack
        - Ozow
        - CashOnDelivery
    
    FUNCTION orchestratePayment(paymentRequest):
        // Select gateway based on method
        gateway = selectGateway(paymentRequest.method)
        
        // Apply circuit breaker
        IF circuitBreaker.isOpen(gateway.name):
            // Try fallback gateway
            gateway = getFallbackGateway(paymentRequest.method)
            IF NOT gateway:
                THROW PaymentGatewayUnavailableError
        
        // Create idempotency key
        idempotencyKey = generateIdempotencyKey(paymentRequest)
        
        // Check for duplicate request
        existingPayment = db.query(
            "SELECT * FROM payments WHERE idempotency_key = ?",
            idempotencyKey
        )
        IF existingPayment:
            RETURN existingPayment
        
        // Process payment
        TRY:
            // Gateway-specific processing
            result = gateway.processPayment({
                amount: paymentRequest.amount,
                currency: paymentRequest.currency,
                customer: paymentRequest.customer,
                metadata: paymentRequest.metadata
            })
            
            // Record payment
            payment = db.insert("payments", {
                idempotency_key: idempotencyKey,
                gateway: gateway.name,
                amount: paymentRequest.amount,
                currency: paymentRequest.currency,
                status: result.status,
                gateway_reference: result.reference,
                created_at: NOW()
            })
            
            // Update circuit breaker
            circuitBreaker.recordSuccess(gateway.name)
            
            RETURN payment
            
        CATCH error:
            // Record failure
            circuitBreaker.recordFailure(gateway.name)
            
            // Log for reconciliation
            db.insert("payment_failures", {
                idempotency_key: idempotencyKey,
                gateway: gateway.name,
                error: error.message,
                request: paymentRequest,
                created_at: NOW()
            })
            
            THROW error
    
    FUNCTION handleWebhook(gateway, payload):
        // Verify webhook signature
        IF NOT gateway.verifyWebhook(payload):
            THROW InvalidWebhookSignatureError
        
        // Extract payment reference
        reference = gateway.extractReference(payload)
        
        // Update payment status
        payment = db.query(
            "SELECT * FROM payments WHERE gateway_reference = ?",
            reference
        )
        
        IF payment:
            newStatus = gateway.extractStatus(payload)
            db.update("payments", payment.id, {
                status: newStatus,
                webhook_data: payload,
                updated_at: NOW()
            })
            
            // Publish payment event
            eventBus.publish("payment.status_changed", {
                paymentId: payment.id,
                orderId: payment.order_id,
                previousStatus: payment.status,
                newStatus: newStatus
            })
```

### 9. Driver Management Service

```pseudocode
SERVICE DriverService:
    FUNCTION dispatchDelivery(order):
        // Get available drivers in area
        drivers = getAvailableDrivers(order.pickup_location, radius=5000)
        
        // Score and rank drivers
        scoredDrivers = []
        FOR driver IN drivers:
            score = calculateDriverScore(driver, order, {
                distanceWeight: 0.4,
                availabilityWeight: 0.3,
                performanceWeight: 0.2,
                costWeight: 0.1
            })
            scoredDrivers.append({ driver: driver, score: score })
        
        // Sort by score
        scoredDrivers.sort((a, b) => b.score - a.score)
        
        // Send notifications to top drivers
        notificationBatch = []
        FOR i IN range(0, min(5, scoredDrivers.length)):
            driver = scoredDrivers[i].driver
            
            // Create delivery offer
            offer = db.insert("delivery_offers", {
                order_id: order.id,
                driver_id: driver.id,
                offer_amount: calculateDeliveryFee(order, driver),
                expires_at: NOW() + 5 * MINUTES,
                status: "PENDING"
            })
            
            // Queue notification
            notificationBatch.append({
                driverId: driver.id,
                offerId: offer.id,
                orderDetails: summarizeOrder(order),
                fee: offer.offer_amount,
                expiresIn: 300 // seconds
            })
        
        // Send batch notifications
        notificationService.sendBatch("driver.delivery_offer", notificationBatch)
        
        // Set timeout for offer expiration
        scheduler.schedule(5 * MINUTES, () => {
            expireUnacceptedOffers(order.id)
        })
    
    FUNCTION acceptDeliveryOffer(offerId, driverId):
        // Atomic offer acceptance
        result = db.transaction(() => {
            // Lock the offer
            offer = db.queryForUpdate(
                "SELECT * FROM delivery_offers WHERE id = ? AND status = 'PENDING'",
                offerId
            )
            
            IF NOT offer:
                THROW OfferNoLongerAvailableError
            
            IF offer.driver_id != driverId:
                THROW UnauthorizedError
            
            // Check if order already assigned
            order = db.query(
                "SELECT * FROM orders WHERE id = ? AND status = 'READY_FOR_PICKUP'",
                offer.order_id
            )
            
            IF NOT order:
                THROW OrderNoLongerAvailableError
            
            // Accept offer
            db.update("delivery_offers", offerId, {
                status: "ACCEPTED",
                accepted_at: NOW()
            })
            
            // Reject other offers
            db.update(
                "UPDATE delivery_offers SET status = 'REJECTED' WHERE order_id = ? AND id != ?",
                order.id, offerId
            )
            
            // Create delivery record
            delivery = db.insert("deliveries", {
                order_id: order.id,
                driver_id: driverId,
                status: "ASSIGNED",
                fee: offer.offer_amount,
                assigned_at: NOW()
            })
            
            // Update order status
            orderService.updateStatus(order.id, "ASSIGNED_TO_DRIVER", {
                driverId: driverId,
                deliveryId: delivery.id
            })
            
            RETURN delivery
        })
        
        // Notify driver and customer
        notificationService.send("delivery.assigned", {
            driverId: driverId,
            customerId: order.customer_id,
            deliveryDetails: result
        })
        
        RETURN result
```

### 10. Event-Driven Architecture

```pseudocode
SERVICE EventBus:
    QUEUES:
        - high_priority (payment, order status)
        - normal_priority (notifications, analytics)
        - low_priority (reports, cleanup)
    
    FUNCTION publish(eventType, payload):
        // Build event envelope
        event = {
            id: generateUUID(),
            type: eventType,
            tenantId: context.tenantId,
            payload: payload,
            timestamp: NOW(),
            version: "1.0"
        }
        
        // Determine queue based on event type
        queue = selectQueue(eventType)
        
        // Publish to RabbitMQ
        rabbitMQ.publish(queue, event, {
            persistent: true,
            expiration: getEventTTL(eventType)
        })
        
        // Store in event store
        eventStore.append(event)
    
    FUNCTION subscribe(eventPattern, handler):
        // Create queue for subscriber
        queueName = generateQueueName(eventPattern, handler.name)
        
        // Bind queue to exchange with pattern
        rabbitMQ.queue(queueName).bind(exchange, eventPattern)
        
        // Consume messages
        rabbitMQ.consume(queueName, async (message) => {
            TRY:
                // Parse event
                event = JSON.parse(message.content)
                
                // Apply tenant context
                context.setTenant(event.tenantId)
                
                // Process event
                await handler.process(event)
                
                // Acknowledge message
                message.ack()
                
            CATCH error:
                // Handle retry logic
                IF message.retryCount < 3:
                    // Requeue with delay
                    message.nack(requeue=false)
                    rabbitMQ.publish(retryQueue, message, {
                        delay: exponentialBackoff(message.retryCount)
                    })
                ELSE:
                    // Send to dead letter queue
                    rabbitMQ.publish(deadLetterQueue, {
                        originalMessage: message,
                        error: error.message,
                        failedAt: NOW()
                    })
                    message.ack()
        })
```

### 11. Caching Strategy

```pseudocode
SERVICE CacheManager:
    LAYERS:
        - L1: Application memory (100MB per service)
        - L2: Redis cluster (distributed)
        - L3: Database query cache
    
    FUNCTION get(key, loader):
        // Check L1 cache
        value = memoryCache.get(key)
        IF value:
            RETURN value
        
        // Check L2 cache
        value = redis.get(key)
        IF value:
            // Populate L1
            memoryCache.set(key, value, TTL=60)
            RETURN value
        
        // Load from source
        value = loader()
        
        // Populate both cache layers
        redis.setex(key, 300, value)  // 5 minutes
        memoryCache.set(key, value, TTL=60)  // 1 minute
        
        RETURN value
    
    FUNCTION invalidate(pattern):
        // Clear L1 cache
        memoryCache.clear(pattern)
        
        // Clear L2 cache
        keys = redis.scan(pattern)
        IF keys.length > 0:
            redis.del(keys)
        
        // Publish invalidation event
        eventBus.publish("cache.invalidated", {
            pattern: pattern,
            timestamp: NOW()
        })
```

### 12. Error Handling & Recovery

```pseudocode
SYSTEM ErrorHandler:
    FUNCTION handleError(error, context):
        // Classify error
        errorType = classifyError(error)
        
        SWITCH errorType:
            CASE "TRANSIENT":
                // Retry with exponential backoff
                RETURN retryWithBackoff(context.operation, {
                    maxRetries: 3,
                    initialDelay: 100,
                    maxDelay: 5000
                })
            
            CASE "BUSINESS_LOGIC":
                // Log and return user-friendly message
                logger.warn("Business logic error", {
                    error: error,
                    context: context
                })
                RETURN {
                    code: error.code,
                    message: translateError(error, context.language)
                }
            
            CASE "SYSTEM":
                // Log, alert, and fallback
                logger.error("System error", {
                    error: error,
                    context: context,
                    stack: error.stack
                })
                
                alerting.trigger("system.error", {
                    service: context.service,
                    error: error.message,
                    severity: "high"
                })
                
                RETURN {
                    code: "SYSTEM_ERROR",
                    message: "We're experiencing technical difficulties. Please try again later."
                }
            
            CASE "SECURITY":
                // Log security event and block
                securityLogger.log("Security violation", {
                    error: error,
                    context: context,
                    ip: context.ip,
                    user: context.user
                })
                
                // Increment rate limiter
                rateLimiter.penalize(context.ip)
                
                RETURN {
                    code: "FORBIDDEN",
                    message: "Access denied"
                }
    
    FUNCTION retryWithBackoff(operation, config):
        retries = 0
        lastError = null
        
        WHILE retries < config.maxRetries:
            TRY:
                RETURN operation()
            CATCH error:
                lastError = error
                retries++
                
                IF retries < config.maxRetries:
                    delay = min(
                        config.initialDelay * (2 ** retries),
                        config.maxDelay
                    )
                    sleep(delay)
        
        THROW lastError
```

This comprehensive system architecture pseudocode provides the foundation for implementing the Wakala OS platform with all the necessary components, patterns, and considerations for a scalable, multi-tenant WhatsApp commerce system.