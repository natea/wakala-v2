import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Browser, Page, chromium } from 'playwright';
import { MultiTenantService } from '../../backend/services/multi-tenant-service/src/services/tenant.service';
import { OrderService } from '../../backend/services/order-service/src/services/order.service';
import { PaymentService } from '../../backend/services/payment-service/src/services/payment.service';
import { WhatsAppService } from '../../backend/services/whatsapp-service/src/services/whatsapp.service';
import { AnalyticsService } from '../../backend/services/analytics-service/src/services/analytics.service';

describe('E2E: Multi-Tenant Platform Scenarios', () => {
  let browser: Browser;
  let adminPage: Page;
  let vendor1Page: Page;
  let vendor2Page: Page;
  let vendor3Page: Page;
  
  let tenantService: MultiTenantService;
  let orderService: OrderService;
  let paymentService: PaymentService;
  let whatsappService: WhatsAppService;
  let analyticsService: AnalyticsService;

  // Three different vendors in different countries
  const vendors = {
    zimbabwe: {
      id: 'uncle-charles-kitchen',
      name: 'Uncle Charles Kitchen',
      country: 'Zimbabwe',
      currency: 'USD',
      timezone: 'Africa/Harare',
      phone: '+263771234567',
      domain: 'unclecharles.wakala.africa'
    },
    southAfrica: {
      id: 'cape-town-delights',
      name: 'Cape Town Delights',
      country: 'South Africa',
      currency: 'ZAR',
      timezone: 'Africa/Johannesburg',
      phone: '+27821234567',
      domain: 'capetown.wakala.africa'
    },
    kenya: {
      id: 'nairobi-bites',
      name: 'Nairobi Bites',
      country: 'Kenya',
      currency: 'KES',
      timezone: 'Africa/Nairobi',
      phone: '+254712345678',
      domain: 'nairobi.wakala.africa'
    }
  };

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: process.env.HEADLESS !== 'false'
    });

    // Initialize services
    tenantService = new MultiTenantService();
    orderService = new OrderService();
    paymentService = new PaymentService();
    whatsappService = new WhatsAppService();
    analyticsService = new AnalyticsService();

    await Promise.all([
      tenantService.initialize(),
      orderService.initialize(),
      paymentService.initialize(),
      whatsappService.initialize(),
      analyticsService.initialize()
    ]);

    // Create browser contexts for each vendor
    adminPage = await browser.newPage();
    vendor1Page = await browser.newPage();
    vendor2Page = await browser.newPage();
    vendor3Page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
    await Promise.all([
      tenantService.shutdown(),
      orderService.shutdown(),
      paymentService.shutdown(),
      whatsappService.shutdown(),
      analyticsService.shutdown()
    ]);
  });

  describe('Platform Admin Management', () => {
    it('should login as platform admin', async () => {
      await adminPage.goto('http://admin.wakala.africa');
      
      await adminPage.fill('[data-testid="email"]', 'admin@wakala.africa');
      await adminPage.fill('[data-testid="password"]', 'AdminSecurePass123!');
      await adminPage.click('[data-testid="login-button"]');
      
      await adminPage.waitForURL('**/admin/dashboard');
      
      // Verify admin dashboard
      await expect(adminPage.locator('[data-testid="platform-stats"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="total-tenants"]')).toContainText('3');
      await expect(adminPage.locator('[data-testid="total-gmv"]')).toBeVisible();
    });

    it('should view all tenants overview', async () => {
      await adminPage.click('[data-testid="nav-tenants"]');
      
      // Verify all vendors listed
      for (const vendor of Object.values(vendors)) {
        await expect(adminPage.locator(`[data-testid="tenant-${vendor.id}"]`)).toBeVisible();
        await expect(adminPage.locator(`[data-testid="tenant-${vendor.id}-status"]`)).toContainText('Active');
        await expect(adminPage.locator(`[data-testid="tenant-${vendor.id}-country"]`)).toContainText(vendor.country);
      }
      
      // Check real-time metrics
      await expect(adminPage.locator('[data-testid="active-orders-total"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="online-drivers-total"]')).toBeVisible();
    });

    it('should monitor platform-wide performance', async () => {
      await adminPage.click('[data-testid="nav-monitoring"]');
      
      // Verify monitoring dashboard
      await expect(adminPage.locator('[data-testid="api-health"]')).toHaveClass(/healthy/);
      await expect(adminPage.locator('[data-testid="database-health"]')).toHaveClass(/healthy/);
      await expect(adminPage.locator('[data-testid="whatsapp-health"]')).toHaveClass(/healthy/);
      
      // Check performance metrics
      await expect(adminPage.locator('[data-testid="avg-response-time"]')).toContainText('ms');
      await expect(adminPage.locator('[data-testid="api-success-rate"]')).toContainText('%');
    });
  });

  describe('Simultaneous Multi-Vendor Operations', () => {
    it('should handle concurrent orders across tenants', async () => {
      // Login to each vendor dashboard
      await vendor1Page.goto(`https://${vendors.zimbabwe.domain}/vendor`);
      await loginVendor(vendor1Page, 'charles@unclecharles.co.zw', 'password123');
      
      await vendor2Page.goto(`https://${vendors.southAfrica.domain}/vendor`);
      await loginVendor(vendor2Page, 'admin@capetown.co.za', 'password123');
      
      await vendor3Page.goto(`https://${vendors.kenya.domain}/vendor`);
      await loginVendor(vendor3Page, 'admin@nairobi.co.ke', 'password123');
      
      // Verify each vendor sees only their data
      await expect(vendor1Page.locator('[data-testid="business-name"]')).toContainText('Uncle Charles Kitchen');
      await expect(vendor2Page.locator('[data-testid="business-name"]')).toContainText('Cape Town Delights');
      await expect(vendor3Page.locator('[data-testid="business-name"]')).toContainText('Nairobi Bites');
    });

    it('should process orders in different currencies simultaneously', async () => {
      // Create orders for each vendor
      const order1 = await createOrder(vendors.zimbabwe.id, {
        customerPhone: '+263776543210',
        items: [{ name: 'Sadza & Beef', price: 8.00, quantity: 1 }],
        currency: 'USD'
      });
      
      const order2 = await createOrder(vendors.southAfrica.id, {
        customerPhone: '+27823456789',
        items: [{ name: 'Bunny Chow', price: 65.00, quantity: 1 }],
        currency: 'ZAR'
      });
      
      const order3 = await createOrder(vendors.kenya.id, {
        customerPhone: '+254722345678',
        items: [{ name: 'Ugali & Nyama', price: 450.00, quantity: 1 }],
        currency: 'KES'
      });
      
      // Verify orders appear in respective dashboards
      await vendor1Page.reload();
      await expect(vendor1Page.locator('[data-testid="new-order-notification"]')).toBeVisible();
      await expect(vendor1Page.locator('[data-testid="order-amount"]')).toContainText('$8.00');
      
      await vendor2Page.reload();
      await expect(vendor2Page.locator('[data-testid="new-order-notification"]')).toBeVisible();
      await expect(vendor2Page.locator('[data-testid="order-amount"]')).toContainText('R65.00');
      
      await vendor3Page.reload();
      await expect(vendor3Page.locator('[data-testid="new-order-notification"]')).toBeVisible();
      await expect(vendor3Page.locator('[data-testid="order-amount"]')).toContainText('KSh 450');
    });

    it('should handle different payment methods per region', async () => {
      // Zimbabwe - EcoCash payment
      const payment1 = await paymentService.initiatePayment({
        tenantId: vendors.zimbabwe.id,
        orderId: 'zim-order-001',
        amount: 8.00,
        currency: 'USD',
        method: 'ecocash',
        customerPhone: '+263776543210'
      });
      expect(payment1.gateway).toBe('ecocash');
      
      // South Africa - Card payment
      const payment2 = await paymentService.initiatePayment({
        tenantId: vendors.southAfrica.id,
        orderId: 'sa-order-001',
        amount: 65.00,
        currency: 'ZAR',
        method: 'card',
        customerEmail: 'customer@test.co.za'
      });
      expect(payment2.gateway).toBe('paystack');
      
      // Kenya - M-Pesa payment
      const payment3 = await paymentService.initiatePayment({
        tenantId: vendors.kenya.id,
        orderId: 'kenya-order-001',
        amount: 450.00,
        currency: 'KES',
        method: 'mpesa',
        customerPhone: '+254722345678'
      });
      expect(payment3.gateway).toBe('mpesa');
    });
  });

  describe('Cross-Tenant Isolation Verification', () => {
    it('should prevent cross-tenant data access', async () => {
      // Try to access another tenant's order from vendor 1
      await vendor1Page.goto(`https://${vendors.zimbabwe.domain}/vendor/orders/sa-order-001`);
      await expect(vendor1Page.locator('[data-testid="error-message"]')).toContainText('Order not found');
      
      // Try to modify another tenant's settings
      const response = await vendor1Page.evaluate(async () => {
        return await fetch('/api/v1/settings', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': 'cape-town-delights' // Wrong tenant!
          },
          body: JSON.stringify({ minOrderAmount: 1000 })
        });
      });
      
      expect(response.status).toBe(403);
    });

    it('should isolate WhatsApp conversations', async () => {
      // Send message to Zimbabwe vendor
      await whatsappService.handleWebhook({
        entry: [{
          id: vendors.zimbabwe.id,
          changes: [{
            value: {
              messages: [{
                from: '+263776543210',
                text: { body: 'Hi, I want to order' }
              }]
            }
          }]
        }]
      });
      
      // Send message to SA vendor
      await whatsappService.handleWebhook({
        entry: [{
          id: vendors.southAfrica.id,
          changes: [{
            value: {
              messages: [{
                from: '+27823456789',
                text: { body: 'Hello, menu please' }
              }]
            }
          }]
        }]
      });
      
      // Verify each vendor only sees their conversations
      await vendor1Page.click('[data-testid="nav-conversations"]');
      await expect(vendor1Page.locator('[data-testid="conversation-263776543210"]')).toBeVisible();
      await expect(vendor1Page.locator('[data-testid="conversation-27823456789"]')).not.toBeVisible();
      
      await vendor2Page.click('[data-testid="nav-conversations"]');
      await expect(vendor2Page.locator('[data-testid="conversation-27823456789"]')).toBeVisible();
      await expect(vendor2Page.locator('[data-testid="conversation-263776543210"]')).not.toBeVisible();
    });

    it('should maintain separate driver pools', async () => {
      // Check drivers for each vendor
      await vendor1Page.click('[data-testid="nav-drivers"]');
      const zimDrivers = await vendor1Page.locator('[data-testid^="driver-"]').count();
      
      await vendor2Page.click('[data-testid="nav-drivers"]');
      const saDrivers = await vendor2Page.locator('[data-testid^="driver-"]').count();
      
      await vendor3Page.click('[data-testid="nav-drivers"]');
      const kenyaDrivers = await vendor3Page.locator('[data-testid^="driver-"]').count();
      
      // Verify no overlap in driver IDs
      const zimDriverIds = await getDriverIds(vendor1Page);
      const saDriverIds = await getDriverIds(vendor2Page);
      const kenyaDriverIds = await getDriverIds(vendor3Page);
      
      expect(zimDriverIds.filter(id => saDriverIds.includes(id))).toHaveLength(0);
      expect(zimDriverIds.filter(id => kenyaDriverIds.includes(id))).toHaveLength(0);
      expect(saDriverIds.filter(id => kenyaDriverIds.includes(id))).toHaveLength(0);
    });
  });

  describe('Platform-Wide Analytics', () => {
    it('should aggregate metrics while maintaining privacy', async () => {
      // Admin views platform analytics
      await adminPage.click('[data-testid="nav-analytics"]');
      
      // Verify aggregated metrics
      await expect(adminPage.locator('[data-testid="total-orders-today"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="total-gmv-today"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="active-users"]')).toBeVisible();
      
      // Verify breakdown by region
      await adminPage.click('[data-testid="view-by-region"]');
      await expect(adminPage.locator('[data-testid="zimbabwe-orders"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="south-africa-orders"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="kenya-orders"]')).toBeVisible();
      
      // Vendors should not see other vendor data
      await vendor1Page.click('[data-testid="nav-analytics"]');
      await expect(vendor1Page.locator('[data-testid="my-orders-today"]')).toBeVisible();
      await expect(vendor1Page.locator('[data-testid="platform-total"]')).not.toBeVisible();
    });

    it('should handle timezone-aware reporting', async () => {
      // Each vendor views their daily report
      const currentDate = new Date();
      
      // Zimbabwe (UTC+2)
      await vendor1Page.click('[data-testid="daily-report"]');
      await expect(vendor1Page.locator('[data-testid="report-timezone"]')).toContainText('CAT');
      
      // South Africa (UTC+2)
      await vendor2Page.click('[data-testid="daily-report"]');
      await expect(vendor2Page.locator('[data-testid="report-timezone"]')).toContainText('SAST');
      
      // Kenya (UTC+3)
      await vendor3Page.click('[data-testid="daily-report"]');
      await expect(vendor3Page.locator('[data-testid="report-timezone"]')).toContainText('EAT');
      
      // Verify different peak hours based on timezone
      const zimPeakHour = await vendor1Page.locator('[data-testid="peak-hour"]').textContent();
      const kenyaPeakHour = await vendor3Page.locator('[data-testid="peak-hour"]').textContent();
      
      expect(zimPeakHour).not.toBe(kenyaPeakHour); // Different timezones
    });
  });

  describe('Multi-Tenant Scalability', () => {
    it('should handle high concurrent load across tenants', async () => {
      const loadTestPromises = [];
      const ordersPerTenant = 50;
      
      // Generate concurrent orders for each tenant
      for (const vendor of Object.values(vendors)) {
        for (let i = 0; i < ordersPerTenant; i++) {
          loadTestPromises.push(
            createOrder(vendor.id, {
              customerPhone: `+${vendor.phone.substring(1, 4)}77654${String(i).padStart(4, '0')}`,
              items: [{ name: 'Test Item', price: 10.00, quantity: 1 }],
              currency: vendor.currency
            })
          );
        }
      }
      
      // Execute all orders concurrently
      const startTime = Date.now();
      const results = await Promise.allSettled(loadTestPromises);
      const endTime = Date.now();
      
      // Verify success rate
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const successRate = (successful / results.length) * 100;
      
      expect(successRate).toBeGreaterThan(95); // At least 95% success rate
      expect(endTime - startTime).toBeLessThan(30000); // Complete within 30 seconds
      
      // Verify data isolation maintained
      for (const vendor of Object.values(vendors)) {
        const vendorOrders = await orderService.listOrders(vendor.id);
        expect(vendorOrders.length).toBe(ordersPerTenant);
      }
    });

    it('should maintain performance with increasing tenant count', async () => {
      // Measure baseline performance
      const baselineStart = Date.now();
      await adminPage.reload();
      await adminPage.waitForSelector('[data-testid="platform-stats"]');
      const baselineLoad = Date.now() - baselineStart;
      
      // Add more test tenants
      const newTenants = [];
      for (let i = 0; i < 10; i++) {
        const tenant = await tenantService.createTenant({
          name: `Test Vendor ${i}`,
          domain: `test${i}.wakala.africa`,
          adminEmail: `admin${i}@test.com`,
          config: {
            country: 'Test Country',
            currency: 'USD'
          }
        });
        newTenants.push(tenant);
      }
      
      // Measure performance with more tenants
      const loadedStart = Date.now();
      await adminPage.reload();
      await adminPage.waitForSelector('[data-testid="platform-stats"]');
      const loadedTime = Date.now() - loadedStart;
      
      // Performance should not degrade significantly
      expect(loadedTime).toBeLessThan(baselineLoad * 1.5); // Max 50% increase
      
      // Cleanup
      for (const tenant of newTenants) {
        await tenantService.deleteTenant(tenant.id);
      }
    });
  });

  describe('Tenant Migration and Backup', () => {
    it('should export tenant data', async () => {
      // Vendor requests data export
      await vendor1Page.click('[data-testid="nav-settings"]');
      await vendor1Page.click('[data-testid="export-data"]');
      
      // Select export options
      await vendor1Page.check('[data-testid="export-orders"]');
      await vendor1Page.check('[data-testid="export-customers"]');
      await vendor1Page.check('[data-testid="export-products"]');
      await vendor1Page.selectOption('[data-testid="export-format"]', 'json');
      
      // Request export
      await vendor1Page.click('[data-testid="request-export"]');
      
      // Wait for export completion
      await vendor1Page.waitForSelector('[data-testid="export-ready"]', { timeout: 30000 });
      
      // Download export
      const downloadPromise = vendor1Page.waitForEvent('download');
      await vendor1Page.click('[data-testid="download-export"]');
      const download = await downloadPromise;
      
      expect(download.suggestedFilename()).toContain('uncle-charles-kitchen');
      expect(download.suggestedFilename()).toContain('.json');
    });

    it('should handle tenant plan upgrades', async () => {
      // Admin upgrades tenant plan
      await adminPage.click('[data-testid="nav-tenants"]');
      await adminPage.click(`[data-testid="tenant-${vendors.zimbabwe.id}-manage"]`);
      
      // View current plan
      await expect(adminPage.locator('[data-testid="current-plan"]')).toContainText('Standard');
      
      // Upgrade to Premium
      await adminPage.click('[data-testid="upgrade-plan"]');
      await adminPage.selectOption('[data-testid="new-plan"]', 'premium');
      
      // View changes
      await expect(adminPage.locator('[data-testid="api-limit-change"]')).toContainText('10,000 → 100,000');
      await expect(adminPage.locator('[data-testid="whatsapp-limit-change"]')).toContainText('1,000 → 10,000');
      
      // Confirm upgrade
      await adminPage.click('[data-testid="confirm-upgrade"]');
      
      // Verify immediate effect
      await vendor1Page.reload();
      await expect(vendor1Page.locator('[data-testid="plan-badge"]')).toContainText('Premium');
    });
  });

  // Helper functions
  async function loginVendor(page: Page, email: string, password: string) {
    await page.fill('[data-testid="email"]', email);
    await page.fill('[data-testid="password"]', password);
    await page.click('[data-testid="login-button"]');
    await page.waitForURL('**/vendor/dashboard');
  }

  async function createOrder(tenantId: string, orderData: any) {
    return await orderService.createOrder({
      tenantId,
      customerId: `customer-${Date.now()}`,
      items: orderData.items,
      totalAmount: orderData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0),
      currency: orderData.currency,
      customerPhone: orderData.customerPhone
    });
  }

  async function getDriverIds(page: Page): Promise<string[]> {
    return await page.evaluate(() => {
      const driverElements = document.querySelectorAll('[data-testid^="driver-"]');
      return Array.from(driverElements).map(el => 
        el.getAttribute('data-testid')?.replace('driver-', '') || ''
      );
    });
  }
});