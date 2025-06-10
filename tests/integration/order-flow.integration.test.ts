import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { OrderService } from '../../backend/services/order-service/src/services/order.service';
import { PaymentService } from '../../backend/services/payment-service/src/services/payment.service';
import { DeliveryService } from '../../backend/services/delivery-service/src/services/delivery.service';
import { OrchestrationEngine } from '../../backend/services/orchestration-engine/src/engines/workflow.engine';
import { NotificationService } from '../../backend/services/order-service/src/services/notification.service';
import { InventoryService } from '../../backend/services/order-service/src/services/inventory.service';
import { VendorAssignmentService } from '../../backend/services/order-service/src/services/vendor-assignment.service';

describe('Order Flow Integration Tests', () => {
  let orderService: OrderService;
  let paymentService: PaymentService;
  let deliveryService: DeliveryService;
  let orchestrationEngine: OrchestrationEngine;
  let notificationService: NotificationService;
  let inventoryService: InventoryService;
  let vendorAssignmentService: VendorAssignmentService;

  const tenantId = 'uncle-charles-kitchen';
  const customerId = 'brenda-test-123';
  const vendorId = 'vendor-001';
  const driverId = 'david-driver-001';

  beforeAll(async () => {
    orderService = new OrderService();
    paymentService = new PaymentService();
    deliveryService = new DeliveryService();
    orchestrationEngine = new OrchestrationEngine();
    notificationService = new NotificationService();
    inventoryService = new InventoryService();
    vendorAssignmentService = new VendorAssignmentService();

    await Promise.all([
      orderService.initialize(),
      paymentService.initialize(),
      deliveryService.initialize(),
      orchestrationEngine.initialize()
    ]);

    // Setup test data
    await setupTestInventory();
    await setupTestVendors();
    await setupTestDrivers();
  });

  afterAll(async () => {
    await cleanupTestData();
    await Promise.all([
      orderService.shutdown(),
      paymentService.shutdown(),
      deliveryService.shutdown(),
      orchestrationEngine.shutdown()
    ]);
  });

  async function setupTestInventory() {
    const products = [
      { id: 'sadza-001', name: 'Sadza', price: 2.00, stock: 100 },
      { id: 'chicken-001', name: 'Grilled Chicken', price: 8.00, stock: 50 },
      { id: 'beef-001', name: 'Beef Stew', price: 10.00, stock: 30 },
      { id: 'veggies-001', name: 'Mixed Vegetables', price: 3.00, stock: 80 }
    ];

    for (const product of products) {
      await inventoryService.addProduct(tenantId, product);
    }
  }

  async function setupTestVendors() {
    await vendorAssignmentService.registerVendor(tenantId, {
      id: vendorId,
      name: "Uncle Charles Kitchen - Main",
      location: { lat: -17.8319, lng: 31.0456 },
      operatingHours: { open: '08:00', close: '22:00' },
      capacity: 50
    });
  }

  async function setupTestDrivers() {
    await deliveryService.registerDriver({
      id: driverId,
      name: 'David Test Driver',
      phone: '263771234567',
      vehicle: { type: 'motorcycle', plateNumber: 'ABC123' },
      tenantIds: [tenantId],
      currentLocation: { lat: -17.8300, lng: 31.0500 }
    });
  }

  async function cleanupTestData() {
    // Cleanup logic here
  }

  describe('Complete Order Lifecycle', () => {
    let orderId: string;
    let paymentId: string;
    let deliveryId: string;

    it('should create order with inventory validation', async () => {
      const orderData = {
        customerId,
        tenantId,
        items: [
          { productId: 'sadza-001', quantity: 2, price: 2.00 },
          { productId: 'chicken-001', quantity: 1, price: 8.00 }
        ],
        deliveryAddress: {
          street: '15 Baines Avenue',
          city: 'Harare',
          coordinates: { lat: -17.8292, lng: 31.0522 }
        },
        customerPhone: '263776543210'
      };

      const result = await orderService.createOrder(orderData);

      expect(result).toBeDefined();
      expect(result.orderId).toBeDefined();
      expect(result.status).toBe('PENDING');
      expect(result.totalAmount).toBe(12.00);
      expect(result.vendorId).toBe(vendorId);

      orderId = result.orderId;

      // Verify inventory was reserved
      const sadzaStock = await inventoryService.getProductStock(tenantId, 'sadza-001');
      expect(sadzaStock.available).toBe(98); // 100 - 2
      expect(sadzaStock.reserved).toBe(2);
    });

    it('should process payment and update order status', async () => {
      const paymentData = {
        orderId,
        tenantId,
        amount: 12.00,
        currency: 'USD',
        method: 'ecocash',
        customerPhone: '263776543210'
      };

      const paymentResult = await paymentService.initiatePayment(paymentData);

      expect(paymentResult).toBeDefined();
      expect(paymentResult.paymentId).toBeDefined();
      expect(paymentResult.status).toBe('PENDING');
      expect(paymentResult.paymentUrl).toBeDefined();

      paymentId = paymentResult.paymentId;

      // Simulate successful payment webhook
      const webhookData = {
        reference: paymentId,
        status: 'SUCCESS',
        amount: 12.00,
        transactionId: 'eco-txn-123456'
      };

      await paymentService.handleWebhook(webhookData);

      // Verify order status was updated
      const order = await orderService.getOrder(orderId, tenantId);
      expect(order.status).toBe('CONFIRMED');
      expect(order.paymentStatus).toBe('PAID');

      // Verify inventory was committed
      const sadzaStock = await inventoryService.getProductStock(tenantId, 'sadza-001');
      expect(sadzaStock.available).toBe(98);
      expect(sadzaStock.reserved).toBe(0);
    });

    it('should notify vendor and handle acceptance', async () => {
      // Verify vendor notification was sent
      const vendorNotifications = await notificationService.getNotifications(vendorId);
      const orderNotification = vendorNotifications.find(n => 
        n.type === 'NEW_ORDER' && n.orderId === orderId
      );

      expect(orderNotification).toBeDefined();
      expect(orderNotification.status).toBe('SENT');

      // Vendor accepts order
      const acceptResult = await orderService.vendorAcceptOrder(orderId, vendorId);

      expect(acceptResult.success).toBe(true);
      
      // Verify order status
      const order = await orderService.getOrder(orderId, tenantId);
      expect(order.status).toBe('PREPARING');
      expect(order.vendorAcceptedAt).toBeDefined();

      // Verify customer was notified
      const customerNotifications = await notificationService.getNotifications(customerId);
      const acceptNotification = customerNotifications.find(n => 
        n.type === 'ORDER_ACCEPTED' && n.orderId === orderId
      );
      expect(acceptNotification).toBeDefined();
    });

    it('should handle order preparation stages', async () => {
      // Update preparation progress
      const stages = [
        { stage: 'COOKING_STARTED', estimatedMinutes: 15 },
        { stage: 'COOKING_50_PERCENT', estimatedMinutes: 8 },
        { stage: 'COOKING_COMPLETED', estimatedMinutes: 2 },
        { stage: 'PACKED', estimatedMinutes: 0 }
      ];

      for (const stage of stages) {
        await orderService.updatePreparationStatus(orderId, vendorId, stage);

        // Verify customer received update
        const notifications = await notificationService.getRecentNotifications(customerId, 1);
        expect(notifications[0].type).toBe('PREPARATION_UPDATE');
        expect(notifications[0].data.stage).toBe(stage.stage);

        // Small delay between updates
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Mark as ready for pickup
      await orderService.markReadyForPickup(orderId, vendorId);

      const order = await orderService.getOrder(orderId, tenantId);
      expect(order.status).toBe('READY_FOR_PICKUP');
    });

    it('should assign delivery and track driver', async () => {
      const deliveryRequest = {
        orderId,
        tenantId,
        pickupLocation: {
          name: "Uncle Charles Kitchen - Main",
          coordinates: { lat: -17.8319, lng: 31.0456 }
        },
        dropoffLocation: {
          name: "15 Baines Avenue",
          coordinates: { lat: -17.8292, lng: 31.0522 }
        },
        customerPhone: '263776543210'
      };

      const deliveryResult = await deliveryService.createDelivery(deliveryRequest);

      expect(deliveryResult).toBeDefined();
      expect(deliveryResult.deliveryId).toBeDefined();
      expect(deliveryResult.driverId).toBe(driverId);
      expect(deliveryResult.estimatedDuration).toBeDefined();
      expect(deliveryResult.estimatedDistance).toBeDefined();

      deliveryId = deliveryResult.deliveryId;

      // Verify driver was notified
      const driverNotifications = await notificationService.getNotifications(driverId);
      const deliveryNotification = driverNotifications.find(n => 
        n.type === 'NEW_DELIVERY_REQUEST' && n.deliveryId === deliveryId
      );
      expect(deliveryNotification).toBeDefined();
    });

    it('should track delivery progress', async () => {
      // Driver accepts delivery
      await deliveryService.driverAcceptDelivery(deliveryId, driverId);

      // Simulate driver movement
      const routePoints = [
        { lat: -17.8310, lng: 31.0480, status: 'EN_ROUTE_TO_PICKUP' },
        { lat: -17.8319, lng: 31.0456, status: 'ARRIVED_AT_PICKUP' },
        { lat: -17.8319, lng: 31.0456, status: 'PICKED_UP' },
        { lat: -17.8305, lng: 31.0489, status: 'EN_ROUTE_TO_CUSTOMER' },
        { lat: -17.8292, lng: 31.0522, status: 'ARRIVED_AT_CUSTOMER' }
      ];

      for (const point of routePoints) {
        await deliveryService.updateDriverLocation(deliveryId, driverId, {
          coordinates: { lat: point.lat, lng: point.lng },
          heading: 180,
          speed: 30
        });

        if (point.status) {
          await deliveryService.updateDeliveryStatus(deliveryId, driverId, point.status);
        }

        // Verify real-time tracking
        const tracking = await deliveryService.getDeliveryTracking(deliveryId);
        expect(tracking.currentLocation.lat).toBeCloseTo(point.lat, 4);
        expect(tracking.currentLocation.lng).toBeCloseTo(point.lng, 4);

        // Small delay between updates
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Verify customer received all updates
      const customerNotifications = await notificationService.getNotifications(customerId);
      const trackingNotifications = customerNotifications.filter(n => 
        n.type === 'DELIVERY_UPDATE' && n.deliveryId === deliveryId
      );
      expect(trackingNotifications.length).toBeGreaterThan(3);
    });

    it('should complete delivery with proof', async () => {
      // Complete delivery
      const completionData = {
        deliveryId,
        driverId,
        proofOfDelivery: {
          type: 'PHOTO',
          photoUrl: 'https://storage.wakala.com/deliveries/proof-123.jpg',
          recipientName: 'Brenda',
          notes: 'Delivered to customer at gate'
        }
      };

      await deliveryService.completeDelivery(completionData);

      // Verify delivery status
      const delivery = await deliveryService.getDelivery(deliveryId);
      expect(delivery.status).toBe('DELIVERED');
      expect(delivery.completedAt).toBeDefined();
      expect(delivery.proofOfDelivery).toBeDefined();

      // Verify order status
      const order = await orderService.getOrder(orderId, tenantId);
      expect(order.status).toBe('DELIVERED');
      expect(order.deliveredAt).toBeDefined();

      // Verify customer notification
      const notifications = await notificationService.getRecentNotifications(customerId, 1);
      expect(notifications[0].type).toBe('ORDER_DELIVERED');
      expect(notifications[0].data).toHaveProperty('proofUrl');
    });

    it('should handle customer feedback', async () => {
      const feedback = {
        orderId,
        customerId,
        rating: 5,
        foodRating: 5,
        deliveryRating: 4,
        comment: 'Great food! Delivery was a bit late but driver was friendly.',
        wouldOrderAgain: true
      };

      await orderService.submitFeedback(feedback);

      // Verify feedback was recorded
      const order = await orderService.getOrder(orderId, tenantId);
      expect(order.feedback).toBeDefined();
      expect(order.feedback.rating).toBe(5);

      // Verify vendor metrics were updated
      const vendorMetrics = await orderService.getVendorMetrics(vendorId, tenantId);
      expect(vendorMetrics.averageRating).toBeGreaterThanOrEqual(4);
      expect(vendorMetrics.totalOrders).toBeGreaterThan(0);

      // Verify driver metrics were updated
      const driverMetrics = await deliveryService.getDriverMetrics(driverId);
      expect(driverMetrics.averageRating).toBeGreaterThanOrEqual(4);
      expect(driverMetrics.completedDeliveries).toBeGreaterThan(0);
    });
  });

  describe('Error Scenarios and Compensation', () => {
    it('should handle payment failure and compensate', async () => {
      // Create order
      const orderData = {
        customerId: 'customer-fail-test',
        tenantId,
        items: [{ productId: 'sadza-001', quantity: 1, price: 2.00 }],
        deliveryAddress: { street: 'Test Street', coordinates: { lat: -17.8, lng: 31.0 } }
      };

      const order = await orderService.createOrder(orderData);
      const orderId = order.orderId;

      // Check inventory was reserved
      const stockBefore = await inventoryService.getProductStock(tenantId, 'sadza-001');
      const reservedBefore = stockBefore.reserved;

      // Initiate payment
      const payment = await paymentService.initiatePayment({
        orderId,
        tenantId,
        amount: 2.00,
        currency: 'USD',
        method: 'ecocash',
        customerPhone: '263776543210'
      });

      // Simulate payment failure
      await paymentService.handleWebhook({
        reference: payment.paymentId,
        status: 'FAILED',
        reason: 'Insufficient funds'
      });

      // Verify order was cancelled
      const cancelledOrder = await orderService.getOrder(orderId, tenantId);
      expect(cancelledOrder.status).toBe('CANCELLED');
      expect(cancelledOrder.cancellationReason).toContain('Payment failed');

      // Verify inventory was released
      const stockAfter = await inventoryService.getProductStock(tenantId, 'sadza-001');
      expect(stockAfter.reserved).toBe(reservedBefore - 1);

      // Verify customer was notified
      const notifications = await notificationService.getNotifications('customer-fail-test');
      const failureNotification = notifications.find(n => 
        n.type === 'PAYMENT_FAILED' && n.orderId === orderId
      );
      expect(failureNotification).toBeDefined();
    });

    it('should handle vendor rejection', async () => {
      const orderData = {
        customerId: 'customer-reject-test',
        tenantId,
        items: [{ productId: 'beef-001', quantity: 5, price: 10.00 }],
        deliveryAddress: { street: 'Test Street', coordinates: { lat: -17.8, lng: 31.0 } }
      };

      const order = await orderService.createOrder(orderData);
      
      // Process payment
      await paymentService.handleWebhook({
        reference: order.paymentId,
        status: 'SUCCESS',
        amount: 50.00
      });

      // Vendor rejects order
      await orderService.vendorRejectOrder(order.orderId, vendorId, 'Out of beef stock');

      // Verify order was cancelled
      const rejectedOrder = await orderService.getOrder(order.orderId, tenantId);
      expect(rejectedOrder.status).toBe('CANCELLED');
      expect(rejectedOrder.cancellationReason).toContain('Vendor rejected');

      // Verify refund was initiated
      const refund = await paymentService.getRefund(order.paymentId);
      expect(refund).toBeDefined();
      expect(refund.status).toBe('PENDING');
      expect(refund.amount).toBe(50.00);

      // Verify customer notification
      const notifications = await notificationService.getNotifications('customer-reject-test');
      const rejectionNotification = notifications.find(n => 
        n.type === 'ORDER_REJECTED' && n.orderId === order.orderId
      );
      expect(rejectionNotification).toBeDefined();
      expect(rejectionNotification.data.reason).toContain('Out of beef stock');
    });

    it('should handle delivery cancellation', async () => {
      // Create and confirm order
      const orderData = {
        customerId: 'customer-delivery-cancel',
        tenantId,
        items: [{ productId: 'chicken-001', quantity: 1, price: 8.00 }],
        deliveryAddress: { street: 'Remote Street', coordinates: { lat: -17.9, lng: 31.1 } }
      };

      const order = await orderService.createOrder(orderData);
      
      // Process payment
      await paymentService.handleWebhook({
        reference: order.paymentId,
        status: 'SUCCESS',
        amount: 8.00
      });

      // Vendor accepts and prepares
      await orderService.vendorAcceptOrder(order.orderId, vendorId);
      await orderService.markReadyForPickup(order.orderId, vendorId);

      // Create delivery
      const delivery = await deliveryService.createDelivery({
        orderId: order.orderId,
        tenantId,
        pickupLocation: { coordinates: { lat: -17.8319, lng: 31.0456 } },
        dropoffLocation: { coordinates: { lat: -17.9, lng: 31.1 } }
      });

      // Driver cancels after accepting
      await deliveryService.driverAcceptDelivery(delivery.deliveryId, driverId);
      await deliveryService.driverCancelDelivery(delivery.deliveryId, driverId, 'Vehicle breakdown');

      // Verify new driver was assigned
      const updatedDelivery = await deliveryService.getDelivery(delivery.deliveryId);
      expect(updatedDelivery.driverId).not.toBe(driverId);
      expect(updatedDelivery.status).toBe('ASSIGNED');

      // Verify customer was notified
      const notifications = await notificationService.getNotifications('customer-delivery-cancel');
      const reassignmentNotification = notifications.find(n => 
        n.type === 'DELIVERY_REASSIGNED' && n.orderId === order.orderId
      );
      expect(reassignmentNotification).toBeDefined();
    });

    it('should handle partial refunds for damaged items', async () => {
      // Create multi-item order
      const orderData = {
        customerId: 'customer-partial-refund',
        tenantId,
        items: [
          { productId: 'sadza-001', quantity: 2, price: 2.00 },
          { productId: 'chicken-001', quantity: 1, price: 8.00 },
          { productId: 'veggies-001', quantity: 1, price: 3.00 }
        ],
        deliveryAddress: { street: 'Test Avenue', coordinates: { lat: -17.83, lng: 31.05 } }
      };

      const order = await orderService.createOrder(orderData);
      
      // Complete order flow
      await paymentService.handleWebhook({
        reference: order.paymentId,
        status: 'SUCCESS',
        amount: 15.00
      });

      await orderService.vendorAcceptOrder(order.orderId, vendorId);
      await orderService.markReadyForPickup(order.orderId, vendorId);

      const delivery = await deliveryService.createDelivery({
        orderId: order.orderId,
        tenantId,
        pickupLocation: { coordinates: { lat: -17.8319, lng: 31.0456 } },
        dropoffLocation: { coordinates: { lat: -17.83, lng: 31.05 } }
      });

      await deliveryService.completeDelivery({
        deliveryId: delivery.deliveryId,
        driverId,
        proofOfDelivery: { type: 'SIGNATURE' }
      });

      // Customer reports damaged item
      const complaint = await orderService.reportIssue({
        orderId: order.orderId,
        customerId: 'customer-partial-refund',
        issueType: 'DAMAGED_ITEM',
        affectedItems: ['chicken-001'],
        description: 'Chicken was cold and seemed spoiled',
        requestedResolution: 'PARTIAL_REFUND'
      });

      // Process partial refund
      const refund = await paymentService.processPartialRefund({
        orderId: order.orderId,
        originalPaymentId: order.paymentId,
        refundItems: [{ productId: 'chicken-001', amount: 8.00 }],
        reason: 'Damaged item - customer complaint'
      });

      expect(refund.amount).toBe(8.00);
      expect(refund.status).toBe('PROCESSED');

      // Verify order history
      const orderWithRefund = await orderService.getOrder(order.orderId, tenantId);
      expect(orderWithRefund.partialRefund).toBeDefined();
      expect(orderWithRefund.partialRefund.amount).toBe(8.00);
      expect(orderWithRefund.finalAmount).toBe(7.00); // 15 - 8
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple simultaneous orders', async () => {
      const orderPromises = [];
      const customerIds = ['concurrent-1', 'concurrent-2', 'concurrent-3', 'concurrent-4', 'concurrent-5'];

      // Create 5 orders simultaneously
      for (const customerId of customerIds) {
        const orderPromise = orderService.createOrder({
          customerId,
          tenantId,
          items: [
            { productId: 'sadza-001', quantity: 2, price: 2.00 },
            { productId: 'chicken-001', quantity: 1, price: 8.00 }
          ],
          deliveryAddress: { 
            street: `${customerId} Street`, 
            coordinates: { lat: -17.83, lng: 31.05 } 
          }
        });
        orderPromises.push(orderPromise);
      }

      const orders = await Promise.all(orderPromises);

      // Verify all orders were created
      expect(orders).toHaveLength(5);
      orders.forEach(order => {
        expect(order.orderId).toBeDefined();
        expect(order.status).toBe('PENDING');
      });

      // Verify inventory was properly managed
      const sadzaStock = await inventoryService.getProductStock(tenantId, 'sadza-001');
      expect(sadzaStock.reserved).toBe(10); // 5 orders * 2 quantity each
    });

    it('should handle race conditions in delivery assignment', async () => {
      // Register multiple drivers
      const driverIds = ['race-driver-1', 'race-driver-2', 'race-driver-3'];
      for (const driverId of driverIds) {
        await deliveryService.registerDriver({
          id: driverId,
          name: `Test Driver ${driverId}`,
          currentLocation: { lat: -17.8319, lng: 31.0456 },
          tenantIds: [tenantId]
        });
      }

      // Create order ready for delivery
      const order = await orderService.createOrder({
        customerId: 'race-condition-customer',
        tenantId,
        items: [{ productId: 'sadza-001', quantity: 1, price: 2.00 }]
      });

      await paymentService.handleWebhook({
        reference: order.paymentId,
        status: 'SUCCESS'
      });

      await orderService.vendorAcceptOrder(order.orderId, vendorId);
      await orderService.markReadyForPickup(order.orderId, vendorId);

      // Multiple drivers try to accept simultaneously
      const acceptPromises = driverIds.map(driverId => 
        deliveryService.createDelivery({
          orderId: order.orderId,
          tenantId,
          driverId, // Specific driver assignment
          pickupLocation: { coordinates: { lat: -17.8319, lng: 31.0456 } },
          dropoffLocation: { coordinates: { lat: -17.83, lng: 31.05 } }
        }).catch(err => ({ error: err.message }))
      );

      const results = await Promise.all(acceptPromises);

      // Only one should succeed
      const successful = results.filter(r => r.deliveryId);
      const failed = results.filter(r => r.error);

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(2);
      expect(failed[0].error).toContain('already assigned');
    });
  });

  describe('Saga Pattern - Complex Workflows', () => {
    it('should execute complete order saga with all compensations', async () => {
      const sagaContext = {
        customerId: 'saga-test-customer',
        tenantId,
        orderData: {
          items: [
            { productId: 'sadza-001', quantity: 3, price: 2.00 },
            { productId: 'beef-001', quantity: 2, price: 10.00 }
          ],
          deliveryAddress: { street: 'Saga Street', coordinates: { lat: -17.83, lng: 31.05 } },
          specialInstructions: 'Please call on arrival'
        }
      };

      // Execute order creation saga
      const sagaResult = await orchestrationEngine.executeSaga('CREATE_ORDER_SAGA', sagaContext);

      expect(sagaResult.success).toBe(true);
      expect(sagaResult.orderId).toBeDefined();
      expect(sagaResult.steps).toContain('INVENTORY_RESERVED');
      expect(sagaResult.steps).toContain('ORDER_CREATED');
      expect(sagaResult.steps).toContain('PAYMENT_INITIATED');
      expect(sagaResult.steps).toContain('NOTIFICATIONS_SENT');

      // Simulate payment success to continue saga
      await orchestrationEngine.handleEvent({
        type: 'PAYMENT_COMPLETED',
        orderId: sagaResult.orderId,
        paymentId: sagaResult.paymentId,
        status: 'SUCCESS'
      });

      // Verify saga continued
      const order = await orderService.getOrder(sagaResult.orderId, tenantId);
      expect(order.status).toBe('CONFIRMED');

      // Test compensation - simulate vendor unavailable
      await orchestrationEngine.handleEvent({
        type: 'VENDOR_UNAVAILABLE',
        orderId: sagaResult.orderId,
        reason: 'Kitchen closed unexpectedly'
      });

      // Verify compensations executed
      const compensatedOrder = await orderService.getOrder(sagaResult.orderId, tenantId);
      expect(compensatedOrder.status).toBe('CANCELLED');

      // Check all compensations
      const refund = await paymentService.getRefund(sagaResult.paymentId);
      expect(refund.status).toBe('PROCESSED');

      const inventory = await inventoryService.getProductStock(tenantId, 'sadza-001');
      expect(inventory.reserved).toBe(0); // Released
    });
  });
});