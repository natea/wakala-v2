# Core Algorithms Pseudocode

## 1. Conversational AI State Machine

```pseudocode
STATEMACHINE ConversationFlow {
    STATES: [
        GREETING,
        INTENT_DETECTION,
        VENDOR_ONBOARDING,
        PRODUCT_LISTING,
        CUSTOMER_SEARCH,
        SHOPPING_CART,
        CHECKOUT,
        PAYMENT,
        ORDER_TRACKING,
        DRIVER_DISPATCH,
        ERROR_RECOVERY
    ]
    
    TRANSITIONS: {
        GREETING -> INTENT_DETECTION,
        INTENT_DETECTION -> [VENDOR_ONBOARDING, CUSTOMER_SEARCH, ORDER_TRACKING],
        VENDOR_ONBOARDING -> PRODUCT_LISTING,
        PRODUCT_LISTING -> GREETING,
        CUSTOMER_SEARCH -> SHOPPING_CART,
        SHOPPING_CART -> CHECKOUT,
        CHECKOUT -> PAYMENT,
        PAYMENT -> ORDER_TRACKING,
        * -> ERROR_RECOVERY,
        ERROR_RECOVERY -> GREETING
    }
    
    FUNCTION processMessage(message, context) {
        currentState = context.state || GREETING
        
        SWITCH currentState {
            CASE GREETING:
                RETURN handleGreeting(message, context)
                
            CASE INTENT_DETECTION:
                intent = detectIntent(message.text)
                context.intent = intent
                
                IF intent == "sell" THEN
                    context.state = VENDOR_ONBOARDING
                ELSE IF intent == "buy" THEN
                    context.state = CUSTOMER_SEARCH
                ELSE IF intent == "track" THEN
                    context.state = ORDER_TRACKING
                ELSE
                    context.state = ERROR_RECOVERY
                END IF
                
                RETURN processMessage(message, context)
                
            CASE VENDOR_ONBOARDING:
                RETURN handleVendorOnboarding(message, context)
                
            CASE PRODUCT_LISTING:
                RETURN handleProductListing(message, context)
                
            CASE CUSTOMER_SEARCH:
                RETURN handleCustomerSearch(message, context)
                
            CASE SHOPPING_CART:
                RETURN handleShoppingCart(message, context)
                
            CASE CHECKOUT:
                RETURN handleCheckout(message, context)
                
            CASE PAYMENT:
                RETURN handlePayment(message, context)
                
            CASE ORDER_TRACKING:
                RETURN handleOrderTracking(message, context)
                
            CASE ERROR_RECOVERY:
                RETURN handleError(message, context)
        }
    }
    
    FUNCTION detectIntent(text) {
        // Normalize text
        normalized = text.toLowerCase().trim()
        
        // Intent patterns
        sellPatterns = ["sell", "list", "vendor", "product", "shop"]
        buyPatterns = ["buy", "purchase", "looking for", "search", "need"]
        trackPatterns = ["track", "order", "delivery", "where is", "status"]
        
        // Fuzzy matching
        FOR pattern IN sellPatterns {
            IF fuzzyMatch(normalized, pattern) > 0.8 THEN
                RETURN "sell"
            END IF
        }
        
        FOR pattern IN buyPatterns {
            IF fuzzyMatch(normalized, pattern) > 0.8 THEN
                RETURN "buy"
            END IF
        }
        
        FOR pattern IN trackPatterns {
            IF fuzzyMatch(normalized, pattern) > 0.8 THEN
                RETURN "track"
            END IF
        }
        
        // Use NLP model for complex cases
        RETURN nlpModel.classify(text)
    }
}
```

## 2. Natural Language Product Search Pipeline

```pseudocode
ALGORITHM NLPSearchPipeline {
    FUNCTION searchProducts(query, location, tenantId) {
        // Step 1: Tokenization
        tokens = tokenize(query)
        
        // Step 2: Entity Recognition
        entities = extractEntities(tokens)
        productType = entities.product_type
        attributes = entities.attributes
        priceRange = entities.price_range
        
        // Step 3: Query Expansion
        expandedTerms = []
        FOR token IN tokens {
            synonyms = getSynonyms(token, "product_search")
            expandedTerms.append(synonyms)
        }
        
        // Step 4: Build Search Query
        searchQuery = {
            must: [
                {match: {category: productType}},
                {geo_distance: {
                    distance: "10km",
                    location: location
                }}
            ],
            should: expandedTerms.map(term => ({match: {name: term}})),
            filter: []
        }
        
        IF priceRange THEN
            searchQuery.filter.append({
                range: {price: {gte: priceRange.min, lte: priceRange.max}}
            })
        END IF
        
        FOR attr IN attributes {
            searchQuery.should.append({match: {attributes: attr}})
        }
        
        // Step 5: Execute Search
        results = elasticsearch.search(searchQuery)
        
        // Step 6: Personalization
        userProfile = getUserProfile(tenantId)
        personalizedResults = personalizeResults(results, userProfile)
        
        // Step 7: Ranking
        rankedResults = rankByRelevance(personalizedResults, {
            textSimilarity: 0.4,
            locationProximity: 0.3,
            priceMatch: 0.2,
            vendorRating: 0.1
        })
        
        // Step 8: Formatting
        RETURN formatSearchResults(rankedResults)
    }
    
    FUNCTION extractEntities(tokens) {
        entities = {
            product_type: null,
            attributes: [],
            price_range: null
        }
        
        // Use pre-trained NER model
        nerResults = nerModel.predict(tokens)
        
        FOR entity IN nerResults {
            IF entity.type == "PRODUCT" THEN
                entities.product_type = entity.value
            ELSE IF entity.type == "ATTRIBUTE" THEN
                entities.attributes.append(entity.value)
            ELSE IF entity.type == "PRICE" THEN
                entities.price_range = parsePriceRange(entity.value)
            END IF
        }
        
        RETURN entities
    }
    
    FUNCTION personalizeResults(results, userProfile) {
        // Boost based on purchase history
        FOR result IN results {
            IF result.vendor_id IN userProfile.favorite_vendors {
                result.score *= 1.2
            }
            
            IF result.category IN userProfile.frequent_categories {
                result.score *= 1.1
            }
            
            // Diversity injection
            IF countSameVendor(results, result.vendor_id) > 3 {
                result.score *= 0.9
            }
        }
        
        RETURN results
    }
}
```

## 3. Payment Orchestration Algorithm

```pseudocode
ALGORITHM PaymentOrchestration {
    GATEWAYS: {
        paystack: {priority: 1, health: 1.0, methods: ["card", "bank", "ussd"]},
        ozow: {priority: 2, health: 1.0, methods: ["eft", "bank"]},
        mpesa: {priority: 3, health: 1.0, methods: ["mobile"]}
    }
    
    FUNCTION processPayment(order, paymentMethod, retryCount = 0) {
        // Step 1: Validate Order
        IF NOT validateOrder(order) THEN
            THROW InvalidOrderException
        END IF
        
        // Step 2: Idempotency Check
        idempotencyKey = generateIdempotencyKey(order.id, paymentMethod)
        existingPayment = checkIdempotency(idempotencyKey)
        IF existingPayment THEN
            RETURN existingPayment
        END IF
        
        // Step 3: Select Gateway
        gateway = selectOptimalGateway(paymentMethod, order.amount)
        
        // Step 4: Prepare Payment Request
        paymentRequest = {
            amount: order.amount,
            currency: "ZAR",
            reference: order.id,
            customer: {
                email: order.customer.email,
                phone: order.customer.phone,
                name: order.customer.name
            },
            metadata: {
                tenant_id: order.tenant_id,
                order_items: order.items.length,
                retry_count: retryCount
            }
        }
        
        // Step 5: Execute Payment
        TRY {
            // Open circuit breaker
            IF circuitBreaker.isOpen(gateway.name) THEN
                THROW GatewayUnavailableException
            END IF
            
            // Process payment
            startTime = Date.now()
            response = gateway.charge(paymentRequest)
            duration = Date.now() - startTime
            
            // Update gateway health
            updateGatewayHealth(gateway.name, true, duration)
            
            // Step 6: Handle Response
            IF response.status == "success" THEN
                // Store result
                storePaymentResult(idempotencyKey, response)
                
                // Emit event
                eventBus.emit("payment.success", {
                    order_id: order.id,
                    payment_id: response.id,
                    amount: order.amount,
                    gateway: gateway.name
                })
                
                RETURN {
                    success: true,
                    payment_id: response.id,
                    gateway: gateway.name
                }
            ELSE
                THROW PaymentFailedException(response.message)
            END IF
            
        } CATCH (Exception e) {
            // Update gateway health
            updateGatewayHealth(gateway.name, false, 0)
            circuitBreaker.recordFailure(gateway.name)
            
            // Step 7: Retry Logic
            IF retryCount < 3 AND isRetriable(e) THEN
                // Exponential backoff
                WAIT Math.pow(2, retryCount) * 1000
                
                // Try next gateway
                nextGateway = getNextGateway(paymentMethod, gateway)
                IF nextGateway THEN
                    RETURN processPayment(order, paymentMethod, retryCount + 1)
                END IF
            END IF
            
            // Emit failure event
            eventBus.emit("payment.failed", {
                order_id: order.id,
                error: e.message,
                gateway: gateway.name,
                retry_count: retryCount
            })
            
            THROW e
        }
    }
    
    FUNCTION selectOptimalGateway(method, amount) {
        eligibleGateways = []
        
        FOR gateway IN GATEWAYS {
            IF method IN gateway.methods AND gateway.health > 0.5 THEN
                eligibleGateways.append(gateway)
            END IF
        }
        
        IF eligibleGateways.length == 0 THEN
            THROW NoAvailableGatewayException
        END IF
        
        // Sort by health score and priority
        eligibleGateways.sort((a, b) => {
            healthDiff = b.health - a.health
            IF Math.abs(healthDiff) > 0.1 THEN
                RETURN healthDiff
            END IF
            RETURN a.priority - b.priority
        })
        
        RETURN eligibleGateways[0]
    }
    
    FUNCTION updateGatewayHealth(gatewayName, success, duration) {
        key = f"gateway:health:{gatewayName}"
        
        // Get current health
        current = redis.get(key) || {
            success_count: 0,
            total_count: 0,
            avg_duration: 0
        }
        
        // Update metrics
        current.total_count++
        IF success THEN
            current.success_count++
            current.avg_duration = (current.avg_duration * (current.total_count - 1) + duration) / current.total_count
        END IF
        
        // Calculate health score
        successRate = current.success_count / current.total_count
        performanceScore = Math.min(1, 1000 / current.avg_duration) // Ideal < 1 second
        
        health = successRate * 0.7 + performanceScore * 0.3
        
        // Store with TTL
        redis.setex(key, 3600, {
            ...current,
            health: health,
            last_updated: Date.now()
        })
        
        // Update in-memory
        GATEWAYS[gatewayName].health = health
    }
}
```

## 4. Order Routing Algorithm

```pseudocode
ALGORITHM OrderRouting {
    FUNCTION routeOrder(order, availableVendors) {
        // Step 1: Calculate scores for each vendor
        scoredVendors = []
        
        FOR vendor IN availableVendors {
            score = calculateVendorScore(order, vendor)
            scoredVendors.append({vendor: vendor, score: score})
        }
        
        // Step 2: Sort by score
        scoredVendors.sort((a, b) => b.score - a.score)
        
        // Step 3: Apply business rules
        filteredVendors = applyBusinessRules(scoredVendors, order)
        
        // Step 4: Select best vendor
        IF filteredVendors.length == 0 THEN
            THROW NoAvailableVendorException
        END IF
        
        selectedVendor = filteredVendors[0].vendor
        
        // Step 5: Reserve inventory
        reservationId = reserveInventory(selectedVendor, order.items)
        
        RETURN {
            vendor: selectedVendor,
            reservation_id: reservationId,
            estimated_time: calculateEstimatedTime(order, selectedVendor)
        }
    }
    
    FUNCTION calculateVendorScore(order, vendor) {
        scores = {
            distance: 0,
            availability: 0,
            performance: 0,
            cost: 0
        }
        
        // Distance score (40% weight)
        distance = calculateDistance(order.delivery_location, vendor.location)
        scores.distance = Math.max(0, 1 - (distance / 10)) * 0.4 // Normalize to 10km
        
        // Availability score (30% weight)
        availableItems = 0
        FOR item IN order.items {
            IF vendor.inventory[item.product_id] >= item.quantity THEN
                availableItems++
            END IF
        }
        scores.availability = (availableItems / order.items.length) * 0.3
        
        // Performance score (20% weight)
        metrics = getVendorMetrics(vendor.id)
        scores.performance = (
            metrics.on_time_rate * 0.5 +
            metrics.order_accuracy * 0.3 +
            metrics.customer_rating / 5 * 0.2
        ) * 0.2
        
        // Cost score (10% weight)
        vendorCost = calculateVendorCost(vendor, order)
        avgCost = getAverageCost(order.category)
        scores.cost = Math.max(0, 1 - (vendorCost / avgCost - 1)) * 0.1
        
        RETURN sum(scores.values())
    }
    
    FUNCTION applyBusinessRules(scoredVendors, order) {
        filtered = []
        
        FOR item IN scoredVendors {
            vendor = item.vendor
            
            // Rule 1: Vendor must be active
            IF NOT vendor.is_active THEN CONTINUE
            
            // Rule 2: Vendor must accept order size
            IF order.total < vendor.min_order_value THEN CONTINUE
            
            // Rule 3: Vendor must be within delivery radius
            distance = calculateDistance(order.delivery_location, vendor.location)
            IF distance > vendor.max_delivery_radius THEN CONTINUE
            
            // Rule 4: Check vendor capacity
            currentOrders = getVendorCurrentOrders(vendor.id)
            IF currentOrders >= vendor.max_concurrent_orders THEN CONTINUE
            
            // Rule 5: Check delivery time window
            IF NOT isWithinDeliveryWindow(vendor.delivery_hours, order.requested_time) THEN CONTINUE
            
            filtered.append(item)
        }
        
        RETURN filtered
    }
}
```

## 5. Driver Dispatch Algorithm

```pseudocode
ALGORITHM DriverDispatch {
    FUNCTION dispatchDriver(delivery) {
        // Step 1: Get available drivers
        availableDrivers = getAvailableDrivers(delivery.pickup_location)
        
        IF availableDrivers.length == 0 THEN
            // Queue for later dispatch
            queueDelivery(delivery)
            RETURN null
        END IF
        
        // Step 2: Score drivers
        scoredDrivers = []
        FOR driver IN availableDrivers {
            score = calculateDriverScore(delivery, driver)
            scoredDrivers.append({driver: driver, score: score})
        }
        
        // Step 3: Sort by score
        scoredDrivers.sort((a, b) => b.score - a.score)
        
        // Step 4: Offer to top drivers
        offerCount = Math.min(3, scoredDrivers.length)
        offers = []
        
        FOR i IN [0..offerCount-1] {
            driver = scoredDrivers[i].driver
            offer = createDeliveryOffer(delivery, driver)
            offers.append(offer)
            
            // Send offer
            sendOfferToDriver(driver, offer)
        }
        
        // Step 5: Wait for acceptance
        acceptedOffer = waitForAcceptance(offers, 60) // 60 second timeout
        
        IF acceptedOffer THEN
            // Confirm assignment
            confirmDriverAssignment(acceptedOffer)
            
            // Cancel other offers
            cancelRemainingOffers(offers, acceptedOffer)
            
            RETURN acceptedOffer.driver
        ELSE
            // No acceptance, try next batch
            RETURN dispatchDriver(delivery)
        END IF
    }
    
    FUNCTION calculateDriverScore(delivery, driver) {
        weights = {
            proximity: 0.4,
            rating: 0.2,
            completion_rate: 0.2,
            response_time: 0.1,
            vehicle_match: 0.1
        }
        
        scores = {}
        
        // Proximity score
        distance = calculateDistance(driver.current_location, delivery.pickup_location)
        scores.proximity = Math.max(0, 1 - (distance / 5)) * weights.proximity // 5km max
        
        // Rating score
        scores.rating = (driver.rating / 5) * weights.rating
        
        // Completion rate score
        scores.completion_rate = driver.completion_rate * weights.completion_rate
        
        // Response time score
        avgResponseTime = driver.avg_response_time || 30
        scores.response_time = Math.max(0, 1 - (avgResponseTime / 60)) * weights.response_time
        
        // Vehicle match score
        vehicleScore = 0
        IF delivery.requires_cold_storage AND driver.has_cold_storage THEN
            vehicleScore = 1
        ELSE IF delivery.size == "large" AND driver.vehicle_type == "van" THEN
            vehicleScore = 1
        ELSE IF delivery.size == "small" AND driver.vehicle_type IN ["bike", "car"] THEN
            vehicleScore = 1
        END IF
        scores.vehicle_match = vehicleScore * weights.vehicle_match
        
        // Apply surge pricing factor
        IF isSurgeTime() THEN
            surgeMultiplier = getSurgeMultiplier(delivery.area)
            RETURN sum(scores.values()) * surgeMultiplier
        END IF
        
        RETURN sum(scores.values())
    }
    
    FUNCTION createDeliveryOffer(delivery, driver) {
        // Calculate earnings
        baseFare = calculateBaseFare(delivery.distance)
        timeFare = calculateTimeFare(delivery.estimated_time)
        
        earnings = baseFare + timeFare
        
        // Apply incentives
        IF driver.completed_today < 5 THEN
            earnings *= 1.1 // 10% bonus for first 5 deliveries
        END IF
        
        IF isRushHour() THEN
            earnings *= 1.2 // 20% rush hour bonus
        END IF
        
        offer = {
            id: generateUUID(),
            delivery_id: delivery.id,
            driver_id: driver.id,
            pickup_location: delivery.pickup_location,
            dropoff_location: delivery.dropoff_location,
            estimated_distance: delivery.distance,
            estimated_time: delivery.estimated_time,
            earnings: earnings,
            expires_at: Date.now() + 60000, // 60 seconds
            created_at: Date.now()
        }
        
        // Store offer
        redis.setex(f"offer:{offer.id}", 120, offer)
        
        RETURN offer
    }
    
    FUNCTION trackDeliveryProgress(delivery, driver) {
        // Real-time tracking
        WHILE delivery.status != "completed" AND delivery.status != "cancelled" {
            // Get driver location
            location = getDriverLocation(driver.id)
            
            // Update delivery progress
            progress = calculateProgress(delivery, location)
            
            // Check for issues
            IF isDriverStationary(driver.id, 10) THEN // 10 minutes
                sendAlert("Driver stationary", delivery.id)
            END IF
            
            IF isOffRoute(location, delivery.route) THEN
                sendAlert("Driver off route", delivery.id)
            END IF
            
            // Update ETA
            newETA = calculateETA(location, delivery.dropoff_location)
            IF Math.abs(newETA - delivery.eta) > 300 THEN // 5 minutes
                updateDeliveryETA(delivery.id, newETA)
                notifyCustomer(delivery.customer_id, newETA)
            END IF
            
            // Store tracking point
            storeTrackingPoint(delivery.id, {
                location: location,
                timestamp: Date.now(),
                speed: driver.current_speed,
                heading: driver.heading
            })
            
            WAIT 30000 // 30 seconds
        }
    }
}
```

## 6. Inventory Management Algorithm

```pseudocode
ALGORITHM InventoryManagement {
    FUNCTION trackInventory(productId, tenantId) {
        // Use distributed lock for consistency
        lockKey = f"inventory_lock:{tenantId}:{productId}"
        lock = acquireDistributedLock(lockKey, 5000) // 5 second timeout
        
        TRY {
            // Get current stock
            currentStock = getStockLevel(productId, tenantId)
            
            // Check for low stock
            IF currentStock <= getReorderPoint(productId) THEN
                triggerReorderAlert(productId, tenantId)
            END IF
            
            // Update stock tracking
            updateStockMetrics(productId, {
                current_level: currentStock,
                timestamp: Date.now(),
                trend: calculateStockTrend(productId)
            })
            
            RETURN currentStock
        } FINALLY {
            releaseLock(lock)
        }
    }
    
    FUNCTION reserveStock(items, orderId, duration = 900000) { // 15 minutes
        reservations = []
        
        // Start transaction
        transaction = beginTransaction()
        
        TRY {
            FOR item IN items {
                // Check availability
                available = getAvailableStock(item.product_id, item.tenant_id)
                
                IF available < item.quantity THEN
                    THROW InsufficientStockException(item.product_id)
                END IF
                
                // Create reservation
                reservation = {
                    id: generateUUID(),
                    product_id: item.product_id,
                    quantity: item.quantity,
                    order_id: orderId,
                    expires_at: Date.now() + duration,
                    created_at: Date.now()
                }
                
                // Deduct from available stock
                updateStock(item.product_id, -item.quantity, transaction)
                
                // Store reservation
                storeReservation(reservation, transaction)
                
                reservations.append(reservation)
            }
            
            // Commit transaction
            commitTransaction(transaction)
            
            // Schedule reservation expiry
            scheduleReservationExpiry(reservations)
            
            RETURN reservations
            
        } CATCH (Exception e) {
            rollbackTransaction(transaction)
            THROW e
        }
    }
    
    FUNCTION confirmStockReservation(reservationIds) {
        FOR reservationId IN reservationIds {
            reservation = getReservation(reservationId)
            
            IF NOT reservation THEN
                CONTINUE // Already processed
            END IF
            
            // Remove reservation
            deleteReservation(reservationId)
            
            // Log stock movement
            logStockMovement({
                product_id: reservation.product_id,
                quantity: -reservation.quantity,
                type: "sale",
                reference_id: reservation.order_id,
                timestamp: Date.now()
            })
        }
    }
    
    FUNCTION releaseStockReservation(reservationIds) {
        FOR reservationId IN reservationIds {
            reservation = getReservation(reservationId)
            
            IF NOT reservation THEN
                CONTINUE // Already released
            END IF
            
            // Return stock
            updateStock(reservation.product_id, reservation.quantity)
            
            // Remove reservation
            deleteReservation(reservationId)
            
            // Log release
            logStockMovement({
                product_id: reservation.product_id,
                quantity: reservation.quantity,
                type: "reservation_release",
                reference_id: reservation.order_id,
                timestamp: Date.now()
            })
        }
    }
    
    FUNCTION predictStockout(productId, tenantId) {
        // Get historical data
        history = getStockHistory(productId, tenantId, 30) // 30 days
        
        // Calculate average daily usage
        dailyUsage = calculateDailyUsage(history)
        
        // Get current stock
        currentStock = getStockLevel(productId, tenantId)
        
        // Factor in seasonality
        seasonalFactor = getSeasonalFactor(productId, Date.now())
        adjustedUsage = dailyUsage * seasonalFactor
        
        // Calculate days until stockout
        daysUntilStockout = currentStock / adjustedUsage
        
        // Get lead time
        leadTime = getSupplierLeadTime(productId, tenantId)
        
        // Predict stockout risk
        IF daysUntilStockout <= leadTime + 2 THEN // 2 day buffer
            RETURN {
                risk: "high",
                days_remaining: daysUntilStockout,
                recommended_order_quantity: calculateEOQ(productId, tenantId),
                recommended_order_date: Date.now()
            }
        ELSE IF daysUntilStockout <= leadTime * 1.5 THEN
            RETURN {
                risk: "medium",
                days_remaining: daysUntilStockout,
                recommended_order_quantity: calculateEOQ(productId, tenantId),
                recommended_order_date: Date.now() + (daysUntilStockout - leadTime) * 86400000
            }
        ELSE
            RETURN {
                risk: "low",
                days_remaining: daysUntilStockout,
                recommended_order_quantity: null,
                recommended_order_date: null
            }
        END IF
    }
    
    FUNCTION calculateEOQ(productId, tenantId) {
        // Economic Order Quantity formula
        // EOQ = sqrt((2 * D * S) / H)
        // D = Annual demand
        // S = Ordering cost
        // H = Holding cost
        
        annualDemand = getAnnualDemand(productId, tenantId)
        orderingCost = getOrderingCost(productId, tenantId)
        holdingCost = getHoldingCost(productId, tenantId)
        
        eoq = Math.sqrt((2 * annualDemand * orderingCost) / holdingCost)
        
        // Round to supplier pack size
        packSize = getSupplierPackSize(productId)
        RETURN Math.ceil(eoq / packSize) * packSize
    }
}
```