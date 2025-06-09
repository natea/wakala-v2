# Wakala OS Test Strategy & Implementation Plan
## Version 1.0 - Phase 2 Design

### 1. Test Strategy Overview

```pseudocode
TEST_STRATEGY WakalaOS:
    APPROACH: TDD London School
    COVERAGE_TARGET: 80% overall, 100% critical paths
    FRAMEWORKS:
        - Unit: Jest + TypeScript
        - Integration: TestContainers + Jest
        - E2E: Playwright + WhatsApp Test Client
        - Performance: k6
        - Security: OWASP ZAP + custom scripts
        - Chaos: Litmus + custom scenarios
    
    PRINCIPLES:
        1. Test behavior, not implementation
        2. Mock all dependencies in unit tests
        3. Fast feedback loops (<1ms per unit test)
        4. Isolated test environments
        5. Deterministic test results
```

### 2. Unit Testing Strategy (TDD London School)

```pseudocode
UNIT_TEST_FRAMEWORK:
    STRUCTURE:
        describe("ServiceName", () => {
            describe("methodName", () => {
                it("should behave correctly when given valid input", () => {
                    // Arrange
                    const mocks = setupMocks()
                    const sut = new Service(mocks)
                    
                    // Act
                    const result = sut.method(input)
                    
                    // Assert
                    expect(result).toBe(expected)
                    expect(mocks.dependency.method).toHaveBeenCalledWith(args)
                })
            })
        })
    
    MOCK_STRATEGY:
        - Mock all external dependencies
        - Use test doubles (stubs, spies, mocks)
        - Verify interactions, not state
        - Keep mocks simple and focused

TEST WhatsAppService:
    describe("WhatsAppService", () => {
        let service: WhatsAppService
        let mockConversationService: Mock<ConversationService>
        let mockTenantService: Mock<TenantService>
        let mockMessageQueue: Mock<MessageQueue>
        let mockRedis: Mock<Redis>
        
        beforeEach(() => {
            // Setup mocks
            mockConversationService = createMock<ConversationService>()
            mockTenantService = createMock<TenantService>()
            mockMessageQueue = createMock<MessageQueue>()
            mockRedis = createMock<Redis>()
            
            // Create system under test
            service = new WhatsAppService({
                conversationService: mockConversationService,
                tenantService: mockTenantService,
                messageQueue: mockMessageQueue,
                redis: mockRedis
            })
        })
        
        describe("handleWebhook", () => {
            it("should return 401 when signature is invalid", async () => {
                // Arrange
                const payload = { entry: [{ id: "123" }] }
                const invalidSignature = "invalid"
                
                // Act
                const result = await service.handleWebhook(payload, invalidSignature)
                
                // Assert
                expect(result.status).toBe(401)
                expect(mockMessageQueue.publish).not.toHaveBeenCalled()
            })
            
            it("should deduplicate messages using Redis", async () => {
                // Arrange
                const messageId = "msg_123"
                const payload = createValidWebhookPayload(messageId)
                mockRedis.exists.mockResolvedValue(true)
                
                // Act
                const result = await service.handleWebhook(payload, validSignature)
                
                // Assert
                expect(result.status).toBe(200)
                expect(mockRedis.exists).toHaveBeenCalledWith(messageId)
                expect(mockMessageQueue.publish).not.toHaveBeenCalled()
            })
            
            it("should process new messages within 3 seconds", async () => {
                // Arrange
                const payload = createValidWebhookPayload()
                mockRedis.exists.mockResolvedValue(false)
                mockTenantService.getTenantFromPhoneNumber.mockResolvedValue("tenant_123")
                
                // Act
                const startTime = Date.now()
                const result = await service.handleWebhook(payload, validSignature)
                const endTime = Date.now()
                
                // Assert
                expect(result.status).toBe(200)
                expect(endTime - startTime).toBeLessThan(3000)
                expect(mockMessageQueue.publish).toHaveBeenCalledWith(
                    "whatsapp.incoming",
                    expect.objectContaining({
                        tenantId: "tenant_123",
                        message: expect.any(Object)
                    })
                )
            })
        })
    })

TEST ConversationStateMachine:
    describe("ConversationService", () => {
        describe("processMessage", () => {
            it("should transition from IDLE to GREETING on first message", async () => {
                // Arrange
                const userId = "user_123"
                const message = { text: "Hi" }
                const context = { tenantId: "tenant_123" }
                
                mockStateStore.loadState.mockResolvedValue(null)
                mockNLP.detectIntent.mockResolvedValue({ intent: "GREETING" })
                
                // Act
                const result = await service.processMessage(userId, message, context)
                
                // Assert
                expect(mockStateStore.saveState).toHaveBeenCalledWith(
                    userId,
                    expect.objectContaining({ current: "GREETING" })
                )
                expect(result.response).toContain("Welcome")
            })
            
            it("should route to vendor flow when vendor intent detected", async () => {
                // Arrange
                const state = { current: "INTENT_DETECTION" }
                mockStateStore.loadState.mockResolvedValue(state)
                mockNLP.detectIntent.mockResolvedValue({ 
                    intent: "VENDOR",
                    confidence: 0.9
                })
                
                // Act
                const result = await service.processMessage(userId, message, context)
                
                // Assert
                expect(mockVendorStateMachine.process).toHaveBeenCalled()
                expect(result.nextState).toBe("VENDOR_FLOW")
            })
        })
    })
```

### 3. Integration Testing Strategy

```pseudocode
INTEGRATION_TEST_FRAMEWORK:
    SETUP:
        - Use TestContainers for infrastructure
        - Isolated database per test suite
        - Real message queues and caches
        - Seed data for consistency
    
    PATTERNS:
        - Test service boundaries
        - Verify data persistence
        - Check message flow
        - Validate transactions

TEST OrderServiceIntegration:
    describe("OrderService Integration", () => {
        let container: PostgreSQLContainer
        let redisContainer: RedisContainer
        let orderService: OrderService
        let catalogService: CatalogService
        let paymentService: PaymentService
        
        beforeAll(async () => {
            // Start containers
            container = await new PostgreSQLContainer()
                .withDatabase("wakala_test")
                .start()
            
            redisContainer = await new RedisContainer().start()
            
            // Run migrations
            await runMigrations(container.getConnectionUri())
            
            // Initialize services
            const db = new Database(container.getConnectionUri())
            const cache = new RedisCache(redisContainer.getConnectionUri())
            
            catalogService = new CatalogService(db, cache)
            paymentService = new PaymentService(db)
            orderService = new OrderService(db, catalogService, paymentService)
        })
        
        afterAll(async () => {
            await container.stop()
            await redisContainer.stop()
        })
        
        describe("createOrder", () => {
            it("should create order with inventory reservation", async () => {
                // Arrange
                const product = await seedProduct({
                    stock: 10,
                    price: 100
                })
                
                const orderData = {
                    customerId: "customer_123",
                    items: [{
                        productId: product.id,
                        quantity: 2
                    }],
                    deliveryAddress: seedAddress()
                }
                
                // Act
                const order = await orderService.createOrder(orderData, "tenant_123")
                
                // Assert
                expect(order.status).toBe("PAYMENT_PENDING")
                expect(order.total).toBe(200)
                
                // Verify inventory was reserved
                const updatedProduct = await catalogService.getProduct(product.id)
                expect(updatedProduct.availableStock).toBe(8)
                expect(updatedProduct.reservedStock).toBe(2)
            })
            
            it("should rollback on payment failure", async () => {
                // Arrange
                const product = await seedProduct({ stock: 5 })
                mockPaymentGateway.createIntent.mockRejectedValue(new Error("Payment failed"))
                
                // Act & Assert
                await expect(
                    orderService.createOrder(orderData, "tenant_123")
                ).rejects.toThrow("Payment failed")
                
                // Verify rollback
                const product = await catalogService.getProduct(product.id)
                expect(product.availableStock).toBe(5)
                expect(product.reservedStock).toBe(0)
            })
        })
    })

TEST MessageQueueIntegration:
    describe("Message Queue Integration", () => {
        let rabbitContainer: RabbitMQContainer
        let eventBus: EventBus
        let orderService: OrderService
        let notificationService: NotificationService
        
        beforeAll(async () => {
            rabbitContainer = await new RabbitMQContainer().start()
            
            eventBus = new EventBus(rabbitContainer.getAmqpUri())
            await eventBus.initialize()
            
            // Setup services with event bus
            orderService = new OrderService({ eventBus })
            notificationService = new NotificationService({ eventBus })
            
            // Subscribe to events
            await notificationService.subscribeToOrderEvents()
        })
        
        it("should process order events through message queue", async () => {
            // Arrange
            const orderCreatedHandler = jest.fn()
            await eventBus.subscribe("order.created", orderCreatedHandler)
            
            // Act
            const order = await orderService.createOrder(validOrderData)
            
            // Wait for async processing
            await waitFor(() => {
                expect(orderCreatedHandler).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: "order.created",
                        payload: expect.objectContaining({
                            orderId: order.id
                        })
                    })
                )
            })
        })
    })
```

### 4. End-to-End Testing Strategy

```pseudocode
E2E_TEST_FRAMEWORK:
    TOOLS:
        - Playwright for automation
        - WhatsApp Test Client
        - Test data generators
        - Visual regression testing
    
    SCENARIOS:
        - Complete user journeys
        - Cross-service workflows
        - Real payment flows (sandbox)
        - Multi-language interactions

TEST VendorOnboardingE2E:
    describe("Vendor Onboarding E2E", () => {
        let whatsappClient: WhatsAppTestClient
        let testVendor: TestUser
        
        beforeAll(async () => {
            whatsappClient = new WhatsAppTestClient({
                apiKey: process.env.WHATSAPP_TEST_API_KEY,
                phoneNumber: process.env.TEST_PHONE_NUMBER
            })
            
            testVendor = await createTestUser({
                role: "vendor",
                language: "en"
            })
        })
        
        it("should complete vendor onboarding flow", async () => {
            // Start conversation
            await whatsappClient.sendMessage("Hi, I want to sell")
            
            // Verify greeting
            const greeting = await whatsappClient.waitForMessage()
            expect(greeting.text).toContain("Great! I can help with that")
            
            // Send product image
            await whatsappClient.sendImage("./test-assets/product.jpg")
            
            const imageResponse = await whatsappClient.waitForMessage()
            expect(imageResponse.text).toContain("That looks like a great product")
            expect(imageResponse.text).toContain("What is the name")
            
            // Provide product details
            await whatsappClient.sendMessage("Fresh Tomatoes")
            await whatsappClient.waitForMessage()
            
            await whatsappClient.sendMessage("25")
            await whatsappClient.waitForMessage()
            
            await whatsappClient.sendMessage("Organic, locally grown")
            
            // Verify draft
            const draft = await whatsappClient.waitForMessage()
            expect(draft.text).toContain("DRAFT")
            expect(draft.text).toContain("Fresh Tomatoes")
            expect(draft.text).toContain("R25.00")
            expect(draft.buttons).toHaveLength(2)
            
            // Confirm listing
            await whatsappClient.clickButton("Yes, List It!")
            
            const confirmation = await whatsappClient.waitForMessage()
            expect(confirmation.text).toContain("Your product")
            expect(confirmation.text).toContain("is now live")
            
            // Verify in database
            const product = await db.query(
                "SELECT * FROM products WHERE vendor_id = ?",
                testVendor.id
            )
            expect(product).toBeDefined()
            expect(product.status).toBe("active")
        })
    })

TEST CustomerPurchaseE2E:
    describe("Customer Purchase E2E", () => {
        it("should complete purchase with payment", async () => {
            // Search for product
            await whatsappClient.sendMessage("I'm looking for a hoodie")
            
            const searchResults = await whatsappClient.waitForMessage()
            expect(searchResults.type).toBe("list")
            expect(searchResults.items).toContainEqual(
                expect.objectContaining({
                    title: expect.stringContaining("Hoodie")
                })
            )
            
            // Add to cart
            await whatsappClient.selectListItem(0)
            
            const cartUpdate = await whatsappClient.waitForMessage()
            expect(cartUpdate.text).toContain("added to your cart")
            expect(cartUpdate.buttons).toContainEqual(
                expect.objectContaining({ title: "Checkout" })
            )
            
            // Checkout
            await whatsappClient.clickButton("Checkout")
            
            // Confirm address
            const addressConfirm = await whatsappClient.waitForMessage()
            await whatsappClient.clickButton("Yes, Confirm Address")
            
            // Payment
            const paymentPrompt = await whatsappClient.waitForMessage()
            expect(paymentPrompt.buttons).toContainEqual(
                expect.objectContaining({ 
                    title: expect.stringContaining("Pay R"),
                    url: expect.stringContaining("paystack.com")
                })
            )
            
            // Simulate payment completion
            await simulatePaystackPayment(paymentPrompt.paymentId, "success")
            
            // Verify order confirmation
            const orderConfirmation = await whatsappClient.waitForMessage()
            expect(orderConfirmation.text).toContain("Payment successful")
            expect(orderConfirmation.text).toMatch(/order #\d+/)
        })
    })
```

### 5. Performance Testing Strategy

```pseudocode
PERFORMANCE_TEST_FRAMEWORK:
    TOOLS:
        - k6 for load testing
        - Grafana for visualization
        - Custom metrics collection
    
    SCENARIOS:
        - Webhook processing load
        - Concurrent user sessions
        - Database query performance
        - Cache effectiveness

TEST WebhookPerformance:
    import http from 'k6/http'
    import { check, sleep } from 'k6'
    import { Rate } from 'k6/metrics'
    
    const errorRate = new Rate('errors')
    const slaViolations = new Rate('sla_violations')
    
    export const options = {
        stages: [
            { duration: '2m', target: 100 },   // Ramp up
            { duration: '5m', target: 1000 },  // Stay at 1000 RPS
            { duration: '2m', target: 2000 },  // Peak load
            { duration: '2m', target: 0 },     // Ramp down
        ],
        thresholds: {
            http_req_duration: ['p(95)<250'], // 95% under 250ms
            errors: ['rate<0.1'],             // Error rate under 0.1%
            sla_violations: ['rate<0.01'],    // SLA violations under 1%
        },
    }
    
    export default function() {
        const payload = generateWebhookPayload()
        const params = {
            headers: {
                'Content-Type': 'application/json',
                'X-Hub-Signature-256': generateSignature(payload)
            },
            timeout: '3s'
        }
        
        const res = http.post(
            'https://api.wakala.com/webhooks/whatsapp',
            JSON.stringify(payload),
            params
        )
        
        // Check response
        const success = check(res, {
            'status is 200': (r) => r.status === 200,
            'response time < 250ms': (r) => r.timings.duration < 250,
            'response time < 3s': (r) => r.timings.duration < 3000,
        })
        
        errorRate.add(!success)
        slaViolations.add(res.timings.duration >= 3000)
        
        sleep(randomBetween(0.1, 0.5))
    }

TEST DatabasePerformance:
    describe("Database Performance", () => {
        scenarios: {
            productSearch: {
                executor: 'ramping-vus',
                startVUs: 0,
                stages: [
                    { duration: '30s', target: 50 },
                    { duration: '1m', target: 100 },
                    { duration: '30s', target: 0 },
                ],
                exec: 'searchProducts',
            },
            orderCreation: {
                executor: 'constant-arrival-rate',
                rate: 100,
                timeUnit: '1s',
                duration: '5m',
                preAllocatedVUs: 200,
                exec: 'createOrders',
            },
        },
        
        thresholds: {
            'db_query_duration{query:product_search}': ['p(95)<100'],
            'db_query_duration{query:order_insert}': ['p(95)<50'],
            'db_connection_pool_usage': ['value<0.8'],
        }
    })
    
    export function searchProducts() {
        const searchQuery = generateRandomSearchQuery()
        const start = new Date()
        
        const results = db.query(`
            SELECT * FROM products 
            WHERE tenant_id = $1 
            AND search_vector @@ plainto_tsquery($2)
            ORDER BY ts_rank(search_vector, plainto_tsquery($2)) DESC
            LIMIT 20
        `, [tenantId, searchQuery])
        
        const duration = new Date() - start
        dbQueryDuration.add(duration, { query: 'product_search' })
        
        check(results, {
            'found results': (r) => r.length > 0,
            'query time < 100ms': () => duration < 100,
        })
    }
```

### 6. Security Testing Strategy

```pseudocode
SECURITY_TEST_FRAMEWORK:
    TOOLS:
        - OWASP ZAP for scanning
        - Custom security tests
        - Dependency scanning
        - SAST/DAST integration
    
    FOCUS_AREAS:
        - Authentication & Authorization
        - Input validation
        - SQL injection prevention
        - XSS protection
        - POPIA compliance

TEST AuthenticationSecurity:
    describe("Authentication Security", () => {
        it("should prevent JWT token replay attacks", async () => {
            // Get valid token
            const token = await authenticateUser(testUser)
            
            // Use token
            await makeAuthenticatedRequest(token)
            
            // Invalidate token
            await revokeToken(token)
            
            // Attempt replay
            const response = await makeAuthenticatedRequest(token)
            expect(response.status).toBe(401)
            expect(response.body.error).toBe("Token revoked")
        })
        
        it("should enforce token expiration", async () => {
            const token = generateToken(testUser, { expiresIn: '1s' })
            
            // Immediate use should work
            const response1 = await makeAuthenticatedRequest(token)
            expect(response1.status).toBe(200)
            
            // Wait for expiration
            await sleep(2000)
            
            // Should fail after expiration
            const response2 = await makeAuthenticatedRequest(token)
            expect(response2.status).toBe(401)
            expect(response2.body.error).toBe("Token expired")
        })
    })

TEST InputValidationSecurity:
    describe("Input Validation Security", () => {
        const sqlInjectionPayloads = [
            "'; DROP TABLE users; --",
            "1' OR '1'='1",
            "admin'--",
            "1; UPDATE users SET role='admin' WHERE id=1; --"
        ]
        
        sqlInjectionPayloads.forEach(payload => {
            it(`should prevent SQL injection: ${payload}`, async () => {
                const response = await api.post('/products/search', {
                    query: payload,
                    tenantId: testTenant.id
                })
                
                // Should handle safely
                expect(response.status).toBe(200)
                expect(response.body.results).toEqual([])
                
                // Verify database integrity
                const tableExists = await db.query(
                    "SELECT EXISTS (SELECT FROM pg_tables WHERE tablename = 'users')"
                )
                expect(tableExists.rows[0].exists).toBe(true)
            })
        })
        
        const xssPayloads = [
            '<script>alert("XSS")</script>',
            '<img src=x onerror=alert("XSS")>',
            'javascript:alert("XSS")',
            '<iframe src="javascript:alert(\'XSS\')"></iframe>'
        ]
        
        xssPayloads.forEach(payload => {
            it(`should prevent XSS: ${payload}`, async () => {
                const product = await api.post('/products', {
                    name: payload,
                    description: payload,
                    price: 100
                })
                
                // Verify sanitization
                expect(product.name).not.toContain('<script>')
                expect(product.name).not.toContain('javascript:')
                expect(product.description).toBe(sanitize(payload))
            })
        })
    })

TEST POPIACompliance:
    describe("POPIA Compliance", () => {
        it("should implement right to erasure", async () => {
            // Create user with data
            const user = await createUserWithFullData()
            
            // Request erasure
            await api.post('/privacy/erasure', {
                userId: user.id,
                reason: "User request"
            })
            
            // Verify personal data removed
            const userData = await db.query(
                "SELECT * FROM users WHERE id = ?",
                user.id
            )
            
            expect(userData.phone).toBeNull()
            expect(userData.email).toBeNull()
            expect(userData.address).toBeNull()
            expect(userData.status).toBe("erased")
            
            // Verify audit trail maintained
            const auditLog = await db.query(
                "SELECT * FROM audit_logs WHERE user_id = ?",
                user.id
            )
            expect(auditLog).toHaveLength(1)
            expect(auditLog[0].action).toBe("data_erasure")
        })
        
        it("should track consent properly", async () => {
            const consentData = {
                userId: testUser.id,
                purpose: "marketing",
                granted: true
            }
            
            // Grant consent
            await api.post('/privacy/consent', consentData)
            
            // Verify consent recorded
            const consent = await db.query(
                "SELECT * FROM user_consents WHERE user_id = ?",
                testUser.id
            )
            
            expect(consent).toMatchObject({
                purpose: "marketing",
                granted: true,
                version: expect.any(String),
                granted_at: expect.any(Date)
            })
        })
    })
```

### 7. Chaos Engineering Tests

```pseudocode
CHAOS_TEST_FRAMEWORK:
    SCENARIOS:
        - Database failover
        - Service crashes
        - Network partitions
        - Resource exhaustion
        - Cascading failures

TEST DatabaseFailover:
    describe("Database Failover Chaos", () => {
        it("should handle primary database failure", async () => {
            // Start monitoring
            const metrics = startMetricsCollection()
            
            // Generate load
            const loadGenerator = startLoadGeneration({
                rps: 100,
                duration: '5m'
            })
            
            // Wait for steady state
            await sleep(30000)
            
            // Inject chaos - kill primary database
            await chaos.injectFault({
                type: "pod-kill",
                target: "postgres-primary",
                duration: "30s"
            })
            
            // Monitor during chaos
            const duringChaos = await collectMetrics(30000)
            
            // Verify system behavior
            expect(duringChaos.errorRate).toBeLessThan(0.05) // 5% error rate
            expect(duringChaos.avgLatency).toBeLessThan(1000) // 1s latency
            expect(duringChaos.availability).toBeGreaterThan(0.95) // 95% availability
            
            // Verify recovery
            await waitForRecovery()
            const afterRecovery = await collectMetrics(30000)
            expect(afterRecovery.errorRate).toBeLessThan(0.001)
        })
    })

TEST CascadingFailure:
    describe("Cascading Failure Prevention", () => {
        it("should prevent cascade when payment service fails", async () => {
            // Setup service monitoring
            const serviceHealth = monitorServices([
                'order-service',
                'catalog-service',
                'notification-service'
            ])
            
            // Inject payment service failure
            await chaos.injectFault({
                type: "service-unavailable",
                target: "payment-service",
                errorRate: 1.0
            })
            
            // Attempt operations that depend on payment
            const results = await Promise.allSettled([
                createOrder(testOrder),
                createOrder(testOrder),
                createOrder(testOrder)
            ])
            
            // Verify circuit breaker activated
            expect(results).toSatisfyAll(r => 
                r.status === 'rejected' && 
                r.reason.message.includes('Circuit breaker open')
            )
            
            // Verify other services remain healthy
            const healthAfterChaos = await serviceHealth.check()
            expect(healthAfterChaos['order-service']).toBe('healthy')
            expect(healthAfterChaos['catalog-service']).toBe('healthy')
            expect(healthAfterChaos['notification-service']).toBe('healthy')
        })
    })
```

### 8. Test Data Management

```pseudocode
TEST_DATA_FRAMEWORK:
    GENERATORS:
        - Realistic user profiles
        - Product catalogs
        - Transaction histories
        - Geographic data
    
    STRATEGIES:
        - Deterministic generation
        - Locale-specific data
        - Edge case coverage

FUNCTION generateTestUser(options):
    const locale = options.locale || 'za'
    const role = options.role || 'customer'
    
    const user = {
        id: generateUUID(),
        phone: generatePhoneNumber(locale),
        name: faker.name.findName({ locale }),
        language: selectLanguage(locale),
        location: generateLocation(locale),
        created_at: faker.date.past()
    }
    
    SWITCH role:
        CASE 'vendor':
            user.business = {
                name: faker.company.companyName(),
                category: selectBusinessCategory(),
                registration: generateBusinessRegistration(locale),
                tax_number: generateTaxNumber(locale)
            }
        CASE 'driver':
            user.vehicle = {
                type: selectVehicleType(),
                registration: generateVehicleRegistration(locale),
                capacity: calculateCapacity(user.vehicle.type)
            }
    
    RETURN user

FUNCTION generateTestProduct(vendor, options):
    const category = options.category || selectRandomCategory()
    
    const product = {
        id: generateUUID(),
        vendor_id: vendor.id,
        name: generateProductName(category, vendor.locale),
        description: generateDescription(category, vendor.locale),
        price: generatePrice(category, vendor.market),
        currency: 'ZAR',
        images: generateProductImages(category, options.imageCount || 3),
        stock: options.stock || randomBetween(0, 1000),
        categories: [category, ...getRelatedCategories(category)],
        attributes: generateProductAttributes(category),
        created_at: faker.date.recent()
    }
    
    // Add search vector
    product.search_vector = generateSearchVector(product)
    
    RETURN product

FUNCTION generateRealisticConversation(persona, intent):
    const templates = loadConversationTemplates(persona.language)
    const variations = templates[intent]
    
    const conversation = []
    
    // Add natural variations
    IF random() < 0.3:
        conversation.push({
            type: 'greeting',
            text: selectGreeting(persona.language, timeOfDay())
        })
    
    // Main intent with variations
    const mainMessage = {
        type: 'message',
        text: applyVariations(variations.main, {
            typos: persona.literacyLevel < 0.7,
            slang: persona.ageGroup === 'youth',
            abbreviations: true
        })
    }
    
    conversation.push(mainMessage)
    
    // Add follow-ups based on persona
    IF persona.trait === 'chatty':
        conversation.push(...generateSmallTalk(persona))
    
    RETURN conversation
```

### 9. Test Reporting & Metrics

```pseudocode
TEST_REPORTING_FRAMEWORK:
    METRICS:
        - Coverage by component
        - Test execution time
        - Flakiness tracking
        - Failure analysis
        - Trend visualization

FUNCTION generateTestReport(testRun):
    const report = {
        summary: {
            total: testRun.total,
            passed: testRun.passed,
            failed: testRun.failed,
            skipped: testRun.skipped,
            duration: testRun.duration,
            coverage: calculateCoverage(testRun)
        },
        
        criticalPath: {
            coverage: calculateCriticalPathCoverage(testRun),
            uncoveredPaths: identifyUncoveredCriticalPaths(testRun)
        },
        
        performance: {
            slowestTests: getTop10SlowestTests(testRun),
            averageTime: calculateAverageTestTime(testRun),
            timeByCategory: groupTestTimeByCategory(testRun)
        },
        
        reliability: {
            flakyTests: identifyFlakyTests(testRun, LAST_10_RUNS),
            failurePatterns: analyzeFailurePatterns(testRun),
            environmentIssues: detectEnvironmentIssues(testRun)
        },
        
        trends: {
            coverageTrend: getCoverageTrend(LAST_30_DAYS),
            executionTimeTrend: getExecutionTimeTrend(LAST_30_DAYS),
            failureRateTrend: getFailureRateTrend(LAST_30_DAYS)
        }
    }
    
    // Generate actionable insights
    report.recommendations = generateRecommendations(report)
    
    // Create visualizations
    report.charts = {
        coverageHeatmap: generateCoverageHeatmap(report),
        testPyramid: generateTestPyramid(report),
        trendCharts: generateTrendCharts(report.trends)
    }
    
    RETURN report

FUNCTION monitorTestHealth():
    const dashboard = {
        realtime: {
            currentlyRunning: getRunningTests(),
            queueDepth: getTestQueueDepth(),
            resourceUsage: getTestInfrastructureMetrics()
        },
        
        alerts: [
            {
                condition: "coverage < 80%",
                severity: "warning",
                action: "notify-team"
            },
            {
                condition: "critical-path-coverage < 100%",
                severity: "critical",
                action: "block-deployment"
            },
            {
                condition: "test-duration > 30m",
                severity: "warning",
                action: "investigate-performance"
            }
        ],
        
        sla: {
            target: {
                coverage: 80,
                criticalPathCoverage: 100,
                executionTime: 1800, // 30 minutes
                flakiness: 0.02 // 2%
            },
            current: calculateCurrentSLA()
        }
    }
    
    RETURN dashboard
```

### 10. Continuous Testing Pipeline

```pseudocode
CI_PIPELINE:
    STAGES:
        1. Pre-commit (local)
        2. Pull request validation
        3. Main branch testing
        4. Pre-deployment verification
        5. Post-deployment validation
        6. Production monitoring

PIPELINE Definition:
    name: Continuous Testing Pipeline
    
    on:
        - push
        - pull_request
        - schedule: "0 */4 * * *" # Every 4 hours
    
    stages:
        pre_commit:
            runs_on: local
            steps:
                - lint_code
                - type_check
                - unit_tests (changed files only)
                - security_scan (credentials)
            timeout: 5m
            
        pull_request:
            runs_on: ci_cluster
            parallel: true
            steps:
                - unit_tests (all)
                - integration_tests (critical paths)
                - security_tests (SAST)
                - performance_tests (baseline)
            timeout: 30m
            quality_gates:
                - coverage >= 80%
                - no_critical_vulnerabilities
                - performance_regression < 10%
                
        main_branch:
            runs_on: ci_cluster
            steps:
                - full_test_suite
                - e2e_tests
                - performance_tests (comprehensive)
                - security_tests (DAST)
                - chaos_tests (basic)
            timeout: 2h
            artifacts:
                - test_reports
                - coverage_reports
                - performance_profiles
                
        pre_deployment:
            runs_on: staging_cluster
            steps:
                - smoke_tests
                - integration_tests (external services)
                - performance_tests (production-like)
                - security_tests (penetration)
                - chaos_tests (comprehensive)
            timeout: 3h
            approval_required: true
            
        post_deployment:
            runs_on: production_monitoring
            steps:
                - health_checks
                - synthetic_monitoring
                - real_user_monitoring
                - performance_monitoring
                - security_monitoring
            continuous: true
            alerts:
                - error_rate > 1%
                - latency_p95 > 500ms
                - availability < 99.9%

FUNCTION runTestStage(stage, context):
    const results = {
        stage: stage,
        status: 'running',
        startTime: NOW(),
        tests: []
    }
    
    TRY:
        // Setup test environment
        const env = await setupTestEnvironment(stage, context)
        
        // Run tests in parallel where possible
        const testGroups = groupTestsByDependency(stage.tests)
        
        FOR group IN testGroups:
            const groupResults = await Promise.all(
                group.map(test => runTest(test, env))
            )
            results.tests.push(...groupResults)
        
        // Check quality gates
        const gateResults = await checkQualityGates(results, stage.qualityGates)
        
        IF NOT gateResults.passed:
            results.status = 'failed'
            results.failureReason = gateResults.failures
        ELSE:
            results.status = 'passed'
        
    CATCH error:
        results.status = 'error'
        results.error = error
        
    FINALLY:
        // Cleanup
        await cleanupTestEnvironment(env)
        results.endTime = NOW()
        results.duration = results.endTime - results.startTime
        
        // Report results
        await reportTestResults(results)
        
    RETURN results
```

This comprehensive test strategy ensures thorough coverage of the Wakala OS platform with a focus on behavior-driven development, fast feedback loops, and production reliability.