import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { MultiTenantService } from '../../backend/services/multi-tenant-service/src/services/tenant.service';
import { APIGateway } from '../../backend/services/api-gateway/src/gateway';
import { OrderService } from '../../backend/services/order-service/src/services/order.service';
import { PaymentService } from '../../backend/services/payment-service/src/services/payment.service';
import { WhatsAppService } from '../../backend/services/whatsapp-service/src/services/whatsapp.service';
import { AnalyticsService } from '../../backend/services/analytics-service/src/services/analytics.service';
import request from 'supertest';

describe('Multi-Tenant System Integration Tests', () => {
  let tenantService: MultiTenantService;
  let apiGateway: APIGateway;
  let orderService: OrderService;
  let paymentService: PaymentService;
  let whatsappService: WhatsAppService;
  let analyticsService: AnalyticsService;
  let app: any;

  // Test tenants
  const tenants = {
    uncleCharles: {
      id: 'uncle-charles-kitchen',
      name: 'Uncle Charles Kitchen',
      domain: 'unclecharles.wakala.com',
      config: {
        country: 'Zimbabwe',
        currency: 'USD',
        languages: ['en', 'sn', 'nd'],
        businessHours: { open: '08:00', close: '22:00' },
        features: ['whatsapp', 'multi-language', 'delivery-tracking']
      }
    },
    saVendor: {
      id: 'cape-town-delights',
      name: 'Cape Town Delights',
      domain: 'capetown.wakala.com',
      config: {
        country: 'South Africa',
        currency: 'ZAR',
        languages: ['en', 'af', 'zu'],
        businessHours: { open: '09:00', close: '21:00' },
        features: ['whatsapp', 'card-payments', 'loyalty-program']
      }
    },
    kenyaVendor: {
      id: 'nairobi-bites',
      name: 'Nairobi Bites',
      domain: 'nairobi.wakala.com',
      config: {
        country: 'Kenya',
        currency: 'KES',
        languages: ['en', 'sw'],
        businessHours: { open: '07:00', close: '23:00' },
        features: ['whatsapp', 'mpesa', 'scheduled-orders']
      }
    }
  };

  beforeAll(async () => {
    // Initialize services
    tenantService = new MultiTenantService();
    apiGateway = new APIGateway();
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

    app = await apiGateway.initialize();

    // Create test tenants
    await setupTestTenants();
  });

  afterAll(async () => {
    await cleanupTestTenants();
    await Promise.all([
      tenantService.shutdown(),
      apiGateway.shutdown(),
      orderService.shutdown(),
      paymentService.shutdown(),
      whatsappService.shutdown(),
      analyticsService.shutdown()
    ]);
  });

  async function setupTestTenants() {
    for (const tenant of Object.values(tenants)) {
      await tenantService.createTenant({
        name: tenant.name,
        domain: tenant.domain,
        adminEmail: `admin@${tenant.domain}`,
        config: tenant.config
      });
    }
  }

  async function cleanupTestTenants() {
    for (const tenant of Object.values(tenants)) {
      await tenantService.deleteTenant(tenant.id);
    }
  }

  describe('Tenant Isolation', () => {
    it('should completely isolate data between tenants', async () => {
      // Create orders for different tenants
      const order1 = await orderService.createOrder({
        tenantId: tenants.uncleCharles.id,
        customerId: 'zim-customer-001',
        items: [{ productId: 'sadza-001', quantity: 1, price: 10.00 }],
        totalAmount: 10.00
      });

      const order2 = await orderService.createOrder({
        tenantId: tenants.saVendor.id,
        customerId: 'sa-customer-001',
        items: [{ productId: 'bunny-chow-001', quantity: 1, price: 50.00 }],
        totalAmount: 50.00
      });

      // Try to access order from wrong tenant
      const wrongAccess = await orderService.getOrder(order1.orderId, tenants.saVendor.id)
        .catch(err => err);

      expect(wrongAccess).toBeInstanceOf(Error);
      expect(wrongAccess.message).toContain('not found');

      // Verify correct access
      const correctAccess1 = await orderService.getOrder(order1.orderId, tenants.uncleCharles.id);
      const correctAccess2 = await orderService.getOrder(order2.orderId, tenants.saVendor.id);

      expect(correctAccess1.orderId).toBe(order1.orderId);
      expect(correctAccess2.orderId).toBe(order2.orderId);
    });

    it('should isolate API requests by tenant', async () => {
      // Create test data for tenant 1
      await orderService.createOrder({
        tenantId: tenants.uncleCharles.id,
        customerId: 'test-customer',
        items: [{ productId: 'test-001', quantity: 1, price: 10.00 }]
      });

      // Request with correct tenant header
      const response1 = await request(app)
        .get('/api/v1/orders')
        .set('X-Tenant-ID', tenants.uncleCharles.id)
        .set('Authorization', 'Bearer test-token');

      expect(response1.status).toBe(200);
      expect(response1.body.orders).toBeDefined();
      expect(response1.body.orders.length).toBeGreaterThan(0);

      // Request with different tenant header
      const response2 = await request(app)
        .get('/api/v1/orders')
        .set('X-Tenant-ID', tenants.saVendor.id)
        .set('Authorization', 'Bearer test-token');

      expect(response2.status).toBe(200);
      expect(response2.body.orders).toBeDefined();
      
      // Orders should be different
      const orderIds1 = response1.body.orders.map(o => o.orderId);
      const orderIds2 = response2.body.orders.map(o => o.orderId);
      expect(orderIds1).not.toEqual(expect.arrayContaining(orderIds2));
    });

    it('should isolate WhatsApp configurations', async () => {
      // Configure WhatsApp for each tenant
      await whatsappService.configureTenant(tenants.uncleCharles.id, {
        phoneNumberId: 'zim-phone-id',
        accessToken: 'zim-access-token',
        webhookVerifyToken: 'zim-verify-token',
        businessAccountId: 'zim-business-id'
      });

      await whatsappService.configureTenant(tenants.saVendor.id, {
        phoneNumberId: 'sa-phone-id',
        accessToken: 'sa-access-token',
        webhookVerifyToken: 'sa-verify-token',
        businessAccountId: 'sa-business-id'
      });

      // Verify configurations are isolated
      const config1 = await whatsappService.getTenantConfig(tenants.uncleCharles.id);
      const config2 = await whatsappService.getTenantConfig(tenants.saVendor.id);

      expect(config1.phoneNumberId).toBe('zim-phone-id');
      expect(config2.phoneNumberId).toBe('sa-phone-id');
      expect(config1.accessToken).not.toBe(config2.accessToken);
    });

    it('should enforce tenant-specific rate limits', async () => {
      // Configure different rate limits
      await tenantService.updateTenantConfig(tenants.uncleCharles.id, {
        rateLimits: {
          orders: { limit: 10, window: '1m' },
          api: { limit: 100, window: '1m' }
        }
      });

      await tenantService.updateTenantConfig(tenants.saVendor.id, {
        rateLimits: {
          orders: { limit: 20, window: '1m' },
          api: { limit: 200, window: '1m' }
        }
      });

      // Make requests up to limit for tenant 1
      const requests1 = Array(11).fill(null).map(() =>
        request(app)
          .get('/api/v1/orders')
          .set('X-Tenant-ID', tenants.uncleCharles.id)
          .set('Authorization', 'Bearer test-token')
      );

      const responses1 = await Promise.all(requests1);
      const limited1 = responses1.filter(r => r.status === 429);
      expect(limited1.length).toBe(1); // 11th request should be limited

      // Tenant 2 should still be able to make requests
      const response2 = await request(app)
        .get('/api/v1/orders')
        .set('X-Tenant-ID', tenants.saVendor.id)
        .set('Authorization', 'Bearer test-token');

      expect(response2.status).toBe(200);
    });
  });

  describe('Tenant Configuration Management', () => {
    it('should apply tenant-specific payment configurations', async () => {
      // Zimbabwe tenant - EcoCash
      const payment1 = await paymentService.initiatePayment({
        tenantId: tenants.uncleCharles.id,
        orderId: 'test-order-001',
        amount: 10.00,
        currency: 'USD',
        method: 'ecocash'
      });

      expect(payment1.gateway).toBe('ecocash');
      expect(payment1.currency).toBe('USD');

      // South Africa tenant - Card payments
      const payment2 = await paymentService.initiatePayment({
        tenantId: tenants.saVendor.id,
        orderId: 'test-order-002',
        amount: 100.00,
        currency: 'ZAR',
        method: 'card'
      });

      expect(payment2.gateway).toBe('paystack');
      expect(payment2.currency).toBe('ZAR');

      // Kenya tenant - M-Pesa
      const payment3 = await paymentService.initiatePayment({
        tenantId: tenants.kenyaVendor.id,
        orderId: 'test-order-003',
        amount: 1000.00,
        currency: 'KES',
        method: 'mpesa'
      });

      expect(payment3.gateway).toBe('mpesa');
      expect(payment3.currency).toBe('KES');
    });

    it('should apply tenant-specific business rules', async () => {
      // Configure minimum order amounts
      await tenantService.updateTenantConfig(tenants.uncleCharles.id, {
        businessRules: {
          minOrderAmount: 5.00,
          maxOrderAmount: 500.00,
          deliveryRadius: 10 // km
        }
      });

      await tenantService.updateTenantConfig(tenants.saVendor.id, {
        businessRules: {
          minOrderAmount: 50.00,
          maxOrderAmount: 2000.00,
          deliveryRadius: 25 // km
        }
      });

      // Test minimum order validation
      const smallOrder1 = await orderService.createOrder({
        tenantId: tenants.uncleCharles.id,
        customerId: 'test-customer',
        items: [{ productId: 'test', quantity: 1, price: 3.00 }],
        totalAmount: 3.00
      }).catch(err => err);

      expect(smallOrder1).toBeInstanceOf(Error);
      expect(smallOrder1.message).toContain('Minimum order amount is 5.00');

      // Valid order for tenant 1
      const validOrder1 = await orderService.createOrder({
        tenantId: tenants.uncleCharles.id,
        customerId: 'test-customer',
        items: [{ productId: 'test', quantity: 1, price: 10.00 }],
        totalAmount: 10.00
      });

      expect(validOrder1.orderId).toBeDefined();

      // Same amount would be invalid for tenant 2
      const smallOrder2 = await orderService.createOrder({
        tenantId: tenants.saVendor.id,
        customerId: 'test-customer',
        items: [{ productId: 'test', quantity: 1, price: 10.00 }],
        totalAmount: 10.00
      }).catch(err => err);

      expect(smallOrder2).toBeInstanceOf(Error);
      expect(smallOrder2.message).toContain('Minimum order amount is 50.00');
    });

    it('should handle tenant-specific languages', async () => {
      // Send WhatsApp message in Shona for Zimbabwe tenant
      const shonaMessage = {
        entry: [{
          id: tenants.uncleCharles.id,
          changes: [{
            value: {
              messages: [{
                from: '263776543210',
                text: { body: 'Ndoda kuona menu' }
              }]
            }
          }]
        }]
      };

      const response1 = await whatsappService.handleWebhook(shonaMessage);
      expect(response1.language).toBe('sn');

      // Send WhatsApp message in Afrikaans for SA tenant
      const afrikaansMessage = {
        entry: [{
          id: tenants.saVendor.id,
          changes: [{
            value: {
              messages: [{
                from: '27823456789',
                text: { body: 'Ek wil die spyskaart sien' }
              }]
            }
          }]
        }]
      };

      const response2 = await whatsappService.handleWebhook(afrikaansMessage);
      expect(response2.language).toBe('af');
    });
  });

  describe('Tenant Lifecycle Management', () => {
    it('should handle tenant creation with full setup', async () => {
      const newTenant = {
        name: 'Lagos Kitchen',
        domain: 'lagos.wakala.com',
        adminEmail: 'admin@lagos.wakala.com',
        config: {
          country: 'Nigeria',
          currency: 'NGN',
          languages: ['en', 'yo', 'ig'],
          paymentMethods: ['card', 'bank_transfer'],
          features: ['whatsapp', 'ussd', 'web-ordering']
        }
      };

      const tenant = await tenantService.createTenant(newTenant);

      expect(tenant.id).toBeDefined();
      expect(tenant.status).toBe('ACTIVE');

      // Verify all services are configured
      const whatsappConfig = await whatsappService.getTenantConfig(tenant.id);
      expect(whatsappConfig).toBeDefined();

      const paymentConfig = await paymentService.getTenantConfig(tenant.id);
      expect(paymentConfig.supportedMethods).toContain('card');
      expect(paymentConfig.defaultCurrency).toBe('NGN');

      // Cleanup
      await tenantService.deleteTenant(tenant.id);
    });

    it('should handle tenant suspension', async () => {
      const testTenantId = tenants.uncleCharles.id;

      // Suspend tenant
      await tenantService.suspendTenant(testTenantId, 'Payment overdue');

      // Verify API requests are blocked
      const response = await request(app)
        .get('/api/v1/orders')
        .set('X-Tenant-ID', testTenantId)
        .set('Authorization', 'Bearer test-token');

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Tenant suspended');

      // Verify webhooks are rejected
      const webhookResponse = await whatsappService.handleWebhook({
        entry: [{
          id: testTenantId,
          changes: [{
            value: {
              messages: [{
                from: '263776543210',
                text: { body: 'Hello' }
              }]
            }
          }]
        }]
      }).catch(err => err);

      expect(webhookResponse).toBeInstanceOf(Error);
      expect(webhookResponse.message).toContain('suspended');

      // Reactivate tenant
      await tenantService.reactivateTenant(testTenantId);

      // Verify access is restored
      const response2 = await request(app)
        .get('/api/v1/orders')
        .set('X-Tenant-ID', testTenantId)
        .set('Authorization', 'Bearer test-token');

      expect(response2.status).toBe(200);
    });

    it('should handle tenant data export', async () => {
      const tenantId = tenants.uncleCharles.id;

      // Create some data
      const orders = [];
      for (let i = 0; i < 3; i++) {
        const order = await orderService.createOrder({
          tenantId,
          customerId: `export-customer-${i}`,
          items: [{ productId: 'test', quantity: 1, price: 10.00 }],
          totalAmount: 10.00
        });
        orders.push(order);
      }

      // Request data export
      const exportRequest = await tenantService.requestDataExport(tenantId, {
        includeOrders: true,
        includeCustomers: true,
        includePayments: true,
        includeAnalytics: true,
        format: 'json'
      });

      expect(exportRequest.exportId).toBeDefined();
      expect(exportRequest.status).toBe('PROCESSING');

      // Wait for export to complete (in real scenario, this would be async)
      await new Promise(resolve => setTimeout(resolve, 1000));

      const exportStatus = await tenantService.getExportStatus(exportRequest.exportId);
      expect(exportStatus.status).toBe('COMPLETED');
      expect(exportStatus.downloadUrl).toBeDefined();

      // Verify export contains expected data
      const exportData = await tenantService.downloadExport(exportRequest.exportId);
      expect(exportData.orders).toHaveLength(orders.length);
      expect(exportData.tenantId).toBe(tenantId);
    });
  });

  describe('Cross-Tenant Analytics', () => {
    it('should aggregate platform-wide metrics while respecting isolation', async () => {
      // Create orders for multiple tenants
      const orderPromises = [];
      
      for (const tenant of Object.values(tenants)) {
        for (let i = 0; i < 5; i++) {
          orderPromises.push(
            orderService.createOrder({
              tenantId: tenant.id,
              customerId: `customer-${i}`,
              items: [{ productId: 'test', quantity: 1, price: 20.00 }],
              totalAmount: 20.00
            })
          );
        }
      }

      await Promise.all(orderPromises);

      // Get platform metrics (admin only)
      const platformMetrics = await analyticsService.getPlatformMetrics({
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endDate: new Date()
      });

      expect(platformMetrics.totalTenants).toBe(3);
      expect(platformMetrics.totalOrders).toBeGreaterThanOrEqual(15);
      expect(platformMetrics.totalRevenue).toBeGreaterThanOrEqual(300);

      // Verify individual tenant can only see their metrics
      const tenant1Metrics = await analyticsService.getTenantMetrics(
        tenants.uncleCharles.id,
        {
          startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          endDate: new Date()
        }
      );

      expect(tenant1Metrics.orders).toBeGreaterThanOrEqual(5);
      expect(tenant1Metrics.revenue).toBeGreaterThanOrEqual(100);
      
      // Should not contain data from other tenants
      expect(tenant1Metrics).not.toHaveProperty('totalTenants');
    });

    it('should track tenant resource usage', async () => {
      const tenantId = tenants.uncleCharles.id;

      // Simulate API calls
      for (let i = 0; i < 50; i++) {
        await request(app)
          .get('/api/v1/products')
          .set('X-Tenant-ID', tenantId)
          .set('Authorization', 'Bearer test-token');
      }

      // Get usage metrics
      const usage = await tenantService.getResourceUsage(tenantId, {
        period: 'current_month'
      });

      expect(usage.apiCalls).toBeGreaterThanOrEqual(50);
      expect(usage.bandwidth).toBeGreaterThan(0);
      expect(usage.storage).toBeGreaterThanOrEqual(0);
      expect(usage.whatsappMessages).toBeGreaterThanOrEqual(0);

      // Check against limits
      const limits = await tenantService.getResourceLimits(tenantId);
      expect(usage.apiCalls).toBeLessThan(limits.apiCalls);
    });
  });

  describe('Multi-Tenant Security', () => {
    it('should prevent SQL injection across tenants', async () => {
      const maliciousOrderData = {
        tenantId: tenants.uncleCharles.id + "'; DROP TABLE orders; --",
        customerId: 'test-customer',
        items: [{ productId: 'test', quantity: 1, price: 10.00 }]
      };

      const result = await orderService.createOrder(maliciousOrderData)
        .catch(err => err);

      expect(result).toBeInstanceOf(Error);

      // Verify tables still exist
      const orders = await orderService.listOrders(tenants.uncleCharles.id);
      expect(orders).toBeDefined();
    });

    it('should validate and sanitize tenant domains', async () => {
      const invalidDomains = [
        'javascript:alert(1)',
        '<script>alert(1)</script>',
        'https://evil.com',
        '../../../etc/passwd',
        'localhost'
      ];

      for (const domain of invalidDomains) {
        const result = await tenantService.createTenant({
          name: 'Test Tenant',
          domain,
          adminEmail: 'test@test.com'
        }).catch(err => err);

        expect(result).toBeInstanceOf(Error);
        expect(result.message).toContain('Invalid domain');
      }
    });

    it('should enforce tenant API key security', async () => {
      // Generate API keys for tenant
      const apiKey1 = await tenantService.generateApiKey(tenants.uncleCharles.id, {
        name: 'Production Key',
        permissions: ['orders:read', 'orders:write']
      });

      const apiKey2 = await tenantService.generateApiKey(tenants.saVendor.id, {
        name: 'Production Key',
        permissions: ['orders:read']
      });

      // Use tenant 1's key for tenant 2's request
      const response = await request(app)
        .get('/api/v1/orders')
        .set('X-Tenant-ID', tenants.saVendor.id)
        .set('X-API-Key', apiKey1.key);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Invalid API key for tenant');

      // Use correct key
      const response2 = await request(app)
        .get('/api/v1/orders')
        .set('X-Tenant-ID', tenants.saVendor.id)
        .set('X-API-Key', apiKey2.key);

      expect(response2.status).toBe(200);
    });
  });

  describe('Tenant Migration and Scaling', () => {
    it('should handle tenant data migration', async () => {
      const sourceTenantId = 'migration-source-tenant';
      const targetTenantId = 'migration-target-tenant';

      // Create source tenant with data
      await tenantService.createTenant({
        id: sourceTenantId,
        name: 'Source Tenant',
        domain: 'source.wakala.com'
      });

      // Create some data
      const orders = [];
      for (let i = 0; i < 10; i++) {
        const order = await orderService.createOrder({
          tenantId: sourceTenantId,
          customerId: `customer-${i}`,
          items: [{ productId: 'test', quantity: 1, price: 10.00 }]
        });
        orders.push(order);
      }

      // Initiate migration
      const migration = await tenantService.migrateTenant({
        sourceTenantId,
        targetTenantId,
        options: {
          copyData: true,
          preserveIds: false,
          includeHistory: true
        }
      });

      expect(migration.status).toBe('IN_PROGRESS');

      // Wait for migration
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify data in new tenant
      const migratedOrders = await orderService.listOrders(targetTenantId);
      expect(migratedOrders.length).toBe(orders.length);

      // Cleanup
      await tenantService.deleteTenant(sourceTenantId);
      await tenantService.deleteTenant(targetTenantId);
    });

    it('should handle tenant sharding for scale', async () => {
      // Create high-volume tenant
      const highVolumeTenant = await tenantService.createTenant({
        name: 'High Volume Vendor',
        domain: 'highvolume.wakala.com',
        tier: 'ENTERPRISE'
      });

      // Verify tenant is assigned to dedicated shard
      const shardInfo = await tenantService.getShardInfo(highVolumeTenant.id);
      expect(shardInfo.shardId).toBeDefined();
      expect(shardInfo.isDedicated).toBe(true);

      // Create regular tenant
      const regularTenant = await tenantService.createTenant({
        name: 'Regular Vendor',
        domain: 'regular.wakala.com',
        tier: 'STANDARD'
      });

      // Verify regular tenant is on shared shard
      const regularShardInfo = await tenantService.getShardInfo(regularTenant.id);
      expect(regularShardInfo.isDedicated).toBe(false);

      // Cleanup
      await tenantService.deleteTenant(highVolumeTenant.id);
      await tenantService.deleteTenant(regularTenant.id);
    });
  });
});