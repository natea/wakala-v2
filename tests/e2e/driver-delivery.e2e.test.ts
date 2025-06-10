import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Browser, Page, chromium } from 'playwright';
import { DeliveryService } from '../../backend/services/delivery-service/src/services/delivery.service';
import { OrderService } from '../../backend/services/order-service/src/services/order.service';
import { NotificationService } from '../../backend/services/order-service/src/services/notification.service';
import { WhatsAppService } from '../../backend/services/whatsapp-service/src/services/whatsapp.service';
import WebSocket from 'ws';

describe('E2E: David Driver Delivery Flow', () => {
  let browser: Browser;
  let page: Page;
  let deliveryService: DeliveryService;
  let orderService: OrderService;
  let notificationService: NotificationService;
  let whatsappService: WhatsAppService;
  let websocket: WebSocket;

  const davidProfile = {
    id: 'david-driver-001',
    name: 'David Chikwature',
    phone: '+263778901234',
    email: 'david.driver@wakala.com',
    vehicle: {
      type: 'motorcycle',
      make: 'Honda',
      model: 'CB125',
      plateNumber: 'ABC 1234',
      color: 'Red'
    },
    documents: {
      driversLicense: 'DL-ZW-123456',
      vehicleRegistration: 'VR-2023-001',
      insurance: 'INS-2023-456'
    },
    workingAreas: ['Harare CBD', 'Avondale', 'Borrowdale', 'Mount Pleasant'],
    rating: 4.8,
    completedDeliveries: 1523
  };

  const tenantId = 'uncle-charles-kitchen';

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: process.env.HEADLESS !== 'false'
    });
    page = await browser.newPage();

    // Initialize services
    deliveryService = new DeliveryService();
    orderService = new OrderService();
    notificationService = new NotificationService();
    whatsappService = new WhatsAppService();

    await Promise.all([
      deliveryService.initialize(),
      orderService.initialize(),
      notificationService.initialize(),
      whatsappService.initialize()
    ]);

    // Register David as a driver
    await deliveryService.registerDriver({
      ...davidProfile,
      tenantIds: [tenantId],
      status: 'AVAILABLE'
    });
  });

  afterAll(async () => {
    if (websocket) websocket.close();
    await browser.close();
    await Promise.all([
      deliveryService.shutdown(),
      orderService.shutdown(),
      notificationService.shutdown(),
      whatsappService.shutdown()
    ]);
  });

  describe('Driver Mobile App Experience', () => {
    it('should login to driver app', async () => {
      // Navigate to driver app
      await page.goto('http://localhost:3000/driver');
      
      // Login
      await page.fill('[data-testid="phone-number"]', davidProfile.phone);
      await page.fill('[data-testid="pin"]', '1234'); // David's PIN
      await page.click('[data-testid="login-button"]');
      
      // Wait for dashboard
      await page.waitForURL('**/driver/dashboard');
      
      // Verify driver info displayed
      await expect(page.locator('[data-testid="driver-name"]')).toContainText('David Chikwature');
      await expect(page.locator('[data-testid="driver-rating"]')).toContainText('4.8');
      await expect(page.locator('[data-testid="total-deliveries"]')).toContainText('1523');
    });

    it('should update availability status', async () => {
      // Toggle to available
      await page.click('[data-testid="availability-toggle"]');
      
      // Verify status changed
      await expect(page.locator('[data-testid="status-indicator"]')).toHaveClass(/online/);
      await expect(page.locator('[data-testid="status-text"]')).toContainText('Available for deliveries');
      
      // Start location sharing
      const locationPermission = page.locator('[data-testid="enable-location"]');
      if (await locationPermission.isVisible()) {
        await locationPermission.click();
        
        // Mock geolocation
        await page.context().setGeolocation({
          latitude: -17.8319,
          longitude: 31.0456
        });
      }
      
      // Verify location updated
      await expect(page.locator('[data-testid="current-location"]')).toContainText('Near Uncle Charles Kitchen');
    });

    it('should connect to real-time delivery updates', async () => {
      // Connect WebSocket for real-time updates
      websocket = new WebSocket('ws://localhost:3000/driver/ws');
      
      await new Promise((resolve) => {
        websocket.on('open', () => {
          websocket.send(JSON.stringify({
            type: 'AUTH',
            driverId: davidProfile.id,
            token: 'driver-auth-token'
          }));
          resolve(true);
        });
      });
      
      // Verify connection status
      await expect(page.locator('[data-testid="connection-status"]')).toHaveClass(/connected/);
    });

    it('should receive and preview delivery request', async () => {
      // Create a test order ready for delivery
      const order = await orderService.createOrder({
        tenantId,
        customerId: 'test-customer-001',
        items: [
          { productId: 'sadza-beef', quantity: 2, price: 8.00 },
          { productId: 'chicken', quantity: 1, price: 7.50 }
        ],
        totalAmount: 23.50,
        deliveryAddress: {
          street: '15 Baines Avenue',
          area: 'Avondale',
          city: 'Harare',
          coordinates: { lat: -17.7945, lng: 31.0488 }
        },
        customerPhone: '+263776543210',
        customerName: 'Brenda Moyo'
      });

      // Mark as ready for pickup
      await orderService.updateOrderStatus(order.orderId, 'READY_FOR_PICKUP');

      // Create delivery request
      const delivery = await deliveryService.createDeliveryRequest({
        orderId: order.orderId,
        tenantId,
        pickupLocation: {
          name: 'Uncle Charles Kitchen',
          address: '123 Samora Machel Avenue',
          coordinates: { lat: -17.8319, lng: 31.0456 }
        },
        dropoffLocation: {
          name: 'Brenda Moyo',
          address: '15 Baines Avenue, Avondale',
          coordinates: { lat: -17.7945, lng: 31.0488 }
        },
        estimatedDistance: 5.2, // km
        estimatedDuration: 15, // minutes
        deliveryFee: 5.00
      });

      // Wait for notification to appear
      await page.waitForSelector('[data-testid="delivery-request-modal"]', { timeout: 5000 });
      
      // Verify request details
      await expect(page.locator('[data-testid="pickup-location"]')).toContainText('Uncle Charles Kitchen');
      await expect(page.locator('[data-testid="dropoff-location"]')).toContainText('Baines Avenue');
      await expect(page.locator('[data-testid="distance"]')).toContainText('5.2 km');
      await expect(page.locator('[data-testid="estimated-time"]')).toContainText('15 min');
      await expect(page.locator('[data-testid="delivery-fee"]')).toContainText('$5.00');
      
      // Verify countdown timer
      await expect(page.locator('[data-testid="accept-timer"]')).toBeVisible();
      
      return { orderId: order.orderId, deliveryId: delivery.deliveryId };
    });

    it('should accept delivery and navigate to pickup', async () => {
      // Accept delivery
      await page.click('[data-testid="accept-delivery"]');
      
      // Wait for confirmation
      await expect(page.locator('[data-testid="acceptance-confirmed"]')).toBeVisible();
      
      // Verify navigation started
      await expect(page.locator('[data-testid="navigation-view"]')).toBeVisible();
      await expect(page.locator('[data-testid="destination-type"]')).toContainText('Pickup Location');
      await expect(page.locator('[data-testid="eta"]')).toContainText('ETA: 5 min');
      
      // Verify turn-by-turn directions
      await expect(page.locator('[data-testid="next-turn"]')).toBeVisible();
      await expect(page.locator('[data-testid="next-turn-distance"]')).toContainText('200m');
      
      // Update location along the route
      const route = [
        { lat: -17.8310, lng: 31.0460 },
        { lat: -17.8305, lng: 31.0458 },
        { lat: -17.8319, lng: 31.0456 } // Arrival at pickup
      ];
      
      for (const point of route) {
        await page.context().setGeolocation(point);
        await page.waitForTimeout(1000); // Simulate movement
      }
      
      // Verify arrival at pickup
      await expect(page.locator('[data-testid="arrival-notification"]')).toContainText('You have arrived at pickup');
      await expect(page.locator('[data-testid="pickup-actions"]')).toBeVisible();
    });

    it('should handle order pickup process', async () => {
      // Click arrived at pickup
      await page.click('[data-testid="confirm-arrival-pickup"]');
      
      // Verify vendor notification sent
      const vendorNotifications = await notificationService.getNotifications('vendor-001');
      expect(vendorNotifications.some(n => 
        n.type === 'DRIVER_ARRIVED' && n.driverId === davidProfile.id
      )).toBe(true);
      
      // Display order details
      await expect(page.locator('[data-testid="order-items"]')).toBeVisible();
      await expect(page.locator('[data-testid="order-item-0"]')).toContainText('Sadza & Beef Stew x2');
      await expect(page.locator('[data-testid="order-item-1"]')).toContainText('Grilled Chicken x1');
      
      // Verify order with vendor
      await page.click('[data-testid="verify-order-button"]');
      
      // Enter order verification code (provided by vendor)
      await page.fill('[data-testid="verification-code"]', '4567');
      await page.click('[data-testid="submit-verification"]');
      
      // Confirm pickup
      await page.click('[data-testid="confirm-pickup"]');
      
      // Take photo of order (mock)
      const photoInput = await page.locator('[data-testid="pickup-photo"]');
      await photoInput.setInputFiles({
        name: 'pickup-photo.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('fake-photo-data')
      });
      
      // Submit pickup confirmation
      await page.click('[data-testid="complete-pickup"]');
      
      // Verify navigation switches to dropoff
      await expect(page.locator('[data-testid="destination-type"]')).toContainText('Delivery Location');
      await expect(page.locator('[data-testid="customer-name"]')).toContainText('Brenda Moyo');
      await expect(page.locator('[data-testid="customer-phone"]')).toBeVisible();
    });

    it('should navigate to customer and handle delivery', async () => {
      // Start navigation to customer
      await page.click('[data-testid="start-delivery"]');
      
      // Verify customer notified
      const customerMessages = await whatsappService.getSentMessages('+263776543210');
      expect(customerMessages.some(m => 
        m.text?.includes('Driver is on the way') && m.text?.includes('David')
      )).toBe(true);
      
      // Simulate route to customer
      const deliveryRoute = [
        { lat: -17.8300, lng: 31.0470 },
        { lat: -17.8150, lng: 31.0480 },
        { lat: -17.8000, lng: 31.0485 },
        { lat: -17.7945, lng: 31.0488 } // Customer location
      ];
      
      for (let i = 0; i < deliveryRoute.length; i++) {
        await page.context().setGeolocation(deliveryRoute[i]);
        
        // Update ETA
        const remainingTime = (deliveryRoute.length - i - 1) * 3;
        await expect(page.locator('[data-testid="customer-eta"]')).toContainText(`${remainingTime} min`);
        
        await page.waitForTimeout(2000);
      }
      
      // Verify arrival
      await expect(page.locator('[data-testid="arrival-notification"]')).toContainText('You have arrived');
      
      // Notify customer of arrival
      await page.click('[data-testid="notify-customer-arrival"]');
      
      // Verify WhatsApp notification sent
      const arrivalMessages = await whatsappService.getSentMessages('+263776543210');
      expect(arrivalMessages.some(m => 
        m.text?.includes('Driver has arrived') && m.text?.includes('outside')
      )).toBe(true);
    });

    it('should complete delivery with proof', async () => {
      // Customer comes to collect
      await page.click('[data-testid="customer-collected"]');
      
      // Verify customer identity
      await expect(page.locator('[data-testid="verify-customer-prompt"]')).toContainText('Please verify customer');
      
      // Options for verification
      await page.click('[data-testid="verify-by-code"]');
      await page.fill('[data-testid="customer-code"]', '8901'); // Code sent to customer
      await page.click('[data-testid="verify-code"]');
      
      // Take proof of delivery photo
      const proofPhotoInput = await page.locator('[data-testid="delivery-proof-photo"]');
      await proofPhotoInput.setInputFiles({
        name: 'delivery-proof.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('fake-delivery-photo')
      });
      
      // Add delivery notes
      await page.fill('[data-testid="delivery-notes"]', 'Delivered to customer at gate. All items in good condition.');
      
      // Rate customer (optional)
      await page.click('[data-testid="rate-customer-5"]');
      
      // Complete delivery
      await page.click('[data-testid="complete-delivery"]');
      
      // Verify completion
      await expect(page.locator('[data-testid="delivery-completed"]')).toBeVisible();
      await expect(page.locator('[data-testid="delivery-summary"]')).toContainText('Delivery Completed Successfully');
      await expect(page.locator('[data-testid="earnings"]')).toContainText('$5.00');
    });

    it('should update driver statistics', async () => {
      // Return to dashboard
      await page.click('[data-testid="back-to-dashboard"]');
      
      // Verify stats updated
      await expect(page.locator('[data-testid="todays-deliveries"]')).toContainText('1');
      await expect(page.locator('[data-testid="todays-earnings"]')).toContainText('$5.00');
      await expect(page.locator('[data-testid="total-deliveries"]')).toContainText('1524'); // Incremented
      
      // Check delivery history
      await page.click('[data-testid="nav-history"]');
      
      // Verify latest delivery appears
      await expect(page.locator('[data-testid="delivery-history-0"]')).toContainText('Brenda Moyo');
      await expect(page.locator('[data-testid="delivery-history-0"]')).toContainText('$5.00');
      await expect(page.locator('[data-testid="delivery-history-0"]')).toContainText('Completed');
    });
  });

  describe('Driver Earnings and Payouts', () => {
    it('should display earnings breakdown', async () => {
      await page.click('[data-testid="nav-earnings"]');
      
      // Verify earnings summary
      await expect(page.locator('[data-testid="today-earnings"]')).toContainText('$5.00');
      await expect(page.locator('[data-testid="week-earnings"]')).toContainText('$125.00');
      await expect(page.locator('[data-testid="month-earnings"]')).toContainText('$2,340.00');
      
      // View detailed breakdown
      await page.click('[data-testid="view-details"]');
      
      // Verify breakdown categories
      await expect(page.locator('[data-testid="base-earnings"]')).toContainText('$2,000.00');
      await expect(page.locator('[data-testid="distance-bonus"]')).toContainText('$200.00');
      await expect(page.locator('[data-testid="peak-time-bonus"]')).toContainText('$100.00');
      await expect(page.locator('[data-testid="tips"]')).toContainText('$40.00');
    });

    it('should request payout', async () => {
      // Check available balance
      await expect(page.locator('[data-testid="available-balance"]')).toContainText('$500.00');
      
      // Request payout
      await page.click('[data-testid="request-payout"]');
      
      // Select payout method
      await page.selectOption('[data-testid="payout-method"]', 'ecocash');
      await page.fill('[data-testid="payout-amount"]', '450.00');
      
      // Verify EcoCash number
      await expect(page.locator('[data-testid="ecocash-number"]')).toHaveValue(davidProfile.phone);
      
      // Submit request
      await page.click('[data-testid="submit-payout"]');
      
      // Confirm
      await page.click('[data-testid="confirm-payout"]');
      
      // Verify success
      await expect(page.locator('[data-testid="payout-success"]')).toBeVisible();
      await expect(page.locator('[data-testid="payout-reference"]')).toContainText('PAY-');
      await expect(page.locator('[data-testid="payout-status"]')).toContainText('Processing');
    });
  });

  describe('Handling Special Scenarios', () => {
    it('should handle customer not available', async () => {
      // Create another delivery
      const order = await createTestOrder();
      const delivery = await assignDeliveryToDriver(order.orderId, davidProfile.id);
      
      // Navigate to delivery screen
      await page.goto(`http://localhost:3000/driver/delivery/${delivery.deliveryId}`);
      
      // Arrive at customer location
      await page.click('[data-testid="arrived-at-customer"]');
      
      // Try to contact customer
      await page.click('[data-testid="contact-customer"]');
      await page.click('[data-testid="call-customer"]');
      
      // Wait 5 minutes (simulated)
      await page.click('[data-testid="start-wait-timer"]');
      
      // After timeout, mark customer unavailable
      await page.waitForSelector('[data-testid="customer-not-available-option"]', { timeout: 10000 });
      await page.click('[data-testid="customer-not-available-option"]');
      
      // Follow return process
      await page.click('[data-testid="return-to-vendor"]');
      
      // Verify return navigation
      await expect(page.locator('[data-testid="destination-type"]')).toContainText('Return to Vendor');
      
      // Complete return
      await page.click('[data-testid="complete-return"]');
      
      // Verify compensation for return trip
      await expect(page.locator('[data-testid="return-compensation"]')).toContainText('$2.50');
    });

    it('should handle order cancellation mid-delivery', async () => {
      // Create delivery and start it
      const order = await createTestOrder();
      const delivery = await assignDeliveryToDriver(order.orderId, davidProfile.id);
      
      // Start delivery
      await page.goto(`http://localhost:3000/driver/delivery/${delivery.deliveryId}`);
      await page.click('[data-testid="start-delivery"]');
      
      // Customer cancels order
      await orderService.cancelOrder(order.orderId, 'Customer requested cancellation');
      
      // Driver receives cancellation notification
      await page.waitForSelector('[data-testid="order-cancelled-modal"]');
      
      // Verify cancellation details
      await expect(page.locator('[data-testid="cancellation-reason"]')).toContainText('Customer requested');
      await expect(page.locator('[data-testid="cancellation-compensation"]')).toContainText('$3.00');
      
      // Acknowledge cancellation
      await page.click('[data-testid="acknowledge-cancellation"]');
      
      // Verify returned to available status
      await expect(page.locator('[data-testid="status-indicator"]')).toHaveClass(/available/);
    });

    it('should handle vehicle breakdown', async () => {
      // Report vehicle issue during delivery
      await page.click('[data-testid="report-issue"]');
      await page.selectOption('[data-testid="issue-type"]', 'vehicle_breakdown');
      await page.fill('[data-testid="issue-description"]', 'Motorcycle engine stopped working');
      
      // Upload photo of issue
      const issuePhotoInput = await page.locator('[data-testid="issue-photo"]');
      await issuePhotoInput.setInputFiles({
        name: 'breakdown-photo.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('fake-breakdown-photo')
      });
      
      // Submit issue
      await page.click('[data-testid="submit-issue"]');
      
      // Verify reassignment process started
      await expect(page.locator('[data-testid="reassignment-notice"]')).toContainText('Finding another driver');
      
      // Verify driver set to unavailable
      const driverStatus = await deliveryService.getDriverStatus(davidProfile.id);
      expect(driverStatus).toBe('UNAVAILABLE');
      
      // Verify support ticket created
      await expect(page.locator('[data-testid="support-ticket-number"]')).toBeVisible();
    });
  });

  describe('Driver Performance and Feedback', () => {
    it('should display performance metrics', async () => {
      await page.click('[data-testid="nav-performance"]');
      
      // Verify performance indicators
      await expect(page.locator('[data-testid="acceptance-rate"]')).toContainText('95%');
      await expect(page.locator('[data-testid="completion-rate"]')).toContainText('98%');
      await expect(page.locator('[data-testid="on-time-rate"]')).toContainText('92%');
      await expect(page.locator('[data-testid="customer-rating"]')).toContainText('4.8');
      
      // View feedback
      await page.click('[data-testid="view-feedback"]');
      
      // Verify recent feedback
      await expect(page.locator('[data-testid="feedback-item-0"]')).toContainText('Great service!');
      await expect(page.locator('[data-testid="feedback-item-0-rating"]')).toContainText('5');
    });

    it('should handle performance incentives', async () => {
      await page.click('[data-testid="nav-incentives"]');
      
      // View active challenges
      await expect(page.locator('[data-testid="weekly-challenge"]')).toContainText('Complete 50 deliveries');
      await expect(page.locator('[data-testid="challenge-progress"]')).toContainText('45/50');
      await expect(page.locator('[data-testid="challenge-reward"]')).toContainText('$50 bonus');
      
      // View achievement badges
      await expect(page.locator('[data-testid="badge-speed-demon"]')).toHaveClass(/unlocked/);
      await expect(page.locator('[data-testid="badge-5-star-hero"]')).toHaveClass(/unlocked/);
    });
  });

  // Helper functions
  async function createTestOrder() {
    return await orderService.createOrder({
      tenantId,
      customerId: 'test-customer-002',
      items: [{ productId: 'test-item', quantity: 1, price: 10.00 }],
      totalAmount: 10.00,
      deliveryAddress: {
        street: 'Test Street',
        coordinates: { lat: -17.8, lng: 31.05 }
      }
    });
  }

  async function assignDeliveryToDriver(orderId: string, driverId: string) {
    return await deliveryService.createDelivery({
      orderId,
      tenantId,
      driverId,
      pickupLocation: { coordinates: { lat: -17.8319, lng: 31.0456 } },
      dropoffLocation: { coordinates: { lat: -17.8, lng: 31.05 } }
    });
  }
});