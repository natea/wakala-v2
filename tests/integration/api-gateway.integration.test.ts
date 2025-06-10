import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import { APIGateway } from '../../backend/services/api-gateway/src/gateway';
import { MultiTenantService } from '../../backend/services/multi-tenant-service/src/services/tenant.service';
import { RateLimiter } from '../../backend/services/api-gateway/src/middleware/rate-limiter';
import { CircuitBreaker } from '../../backend/services/api-gateway/src/utils/circuit-breaker';

describe('API Gateway Integration Tests', () => {
  let app: any;
  let gateway: APIGateway;
  let tenantService: MultiTenantService;

  beforeAll(async () => {
    // Initialize services
    gateway = new APIGateway();
    tenantService = new MultiTenantService();
    app = await gateway.initialize();
  });

  afterAll(async () => {
    await gateway.shutdown();
  });

  describe('Service Routing', () => {
    it('should route WhatsApp webhook requests correctly', async () => {
      const webhookPayload = {
        messages: [{
          from: '263776543210',
          text: { body: 'Hi, I want to order food' },
          timestamp: Date.now()
        }]
      };

      const response = await request(app)
        .post('/api/v1/whatsapp/webhook')
        .set('X-Tenant-ID', 'uncle-charles-kitchen')
        .set('X-API-Key', 'test-api-key')
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'processed');
    });

    it('should route order service requests with tenant context', async () => {
      const orderPayload = {
        customerId: 'brenda-123',
        items: [
          { productId: 'sadza-001', quantity: 2 },
          { productId: 'chicken-001', quantity: 1 }
        ],
        deliveryAddress: '15 Baines Avenue, Harare'
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .set('X-Tenant-ID', 'uncle-charles-kitchen')
        .set('Authorization', 'Bearer test-jwt-token')
        .send(orderPayload);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('orderId');
      expect(response.body).toHaveProperty('tenantId', 'uncle-charles-kitchen');
    });

    it('should route payment service requests correctly', async () => {
      const paymentPayload = {
        orderId: 'order-123',
        amount: 15.50,
        currency: 'USD',
        paymentMethod: 'ecocash',
        phoneNumber: '263776543210'
      };

      const response = await request(app)
        .post('/api/v1/payments')
        .set('X-Tenant-ID', 'uncle-charles-kitchen')
        .set('Authorization', 'Bearer test-jwt-token')
        .send(paymentPayload);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('paymentId');
      expect(response.body).toHaveProperty('status');
    });

    it('should route delivery tracking requests', async () => {
      const response = await request(app)
        .get('/api/v1/deliveries/delivery-123/track')
        .set('X-Tenant-ID', 'uncle-charles-kitchen')
        .set('Authorization', 'Bearer test-jwt-token');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('location');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('estimatedArrival');
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits per tenant', async () => {
      const requests = Array(101).fill(null).map(() =>
        request(app)
          .get('/api/v1/orders')
          .set('X-Tenant-ID', 'test-tenant')
          .set('Authorization', 'Bearer test-jwt-token')
      );

      const responses = await Promise.all(requests);
      const rateLimitedResponses = responses.filter(r => r.status === 429);

      expect(rateLimitedResponses.length).toBeGreaterThan(0);
      expect(rateLimitedResponses[0].body).toHaveProperty('error', 'Rate limit exceeded');
    });

    it('should isolate rate limits between tenants', async () => {
      // Exhaust rate limit for tenant A
      const tenantARequests = Array(100).fill(null).map(() =>
        request(app)
          .get('/api/v1/orders')
          .set('X-Tenant-ID', 'tenant-a')
          .set('Authorization', 'Bearer test-jwt-token')
      );
      await Promise.all(tenantARequests);

      // Tenant B should still be able to make requests
      const tenantBResponse = await request(app)
        .get('/api/v1/orders')
        .set('X-Tenant-ID', 'tenant-b')
        .set('Authorization', 'Bearer test-jwt-token');

      expect(tenantBResponse.status).not.toBe(429);
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit after consecutive failures', async () => {
      // Mock service failures
      jest.spyOn(gateway['orderService'], 'getOrders')
        .mockRejectedValue(new Error('Service unavailable'));

      const requests = Array(5).fill(null).map(() =>
        request(app)
          .get('/api/v1/orders')
          .set('X-Tenant-ID', 'test-tenant')
          .set('Authorization', 'Bearer test-jwt-token')
      );

      const responses = await Promise.all(requests);
      const lastResponse = responses[responses.length - 1];

      expect(lastResponse.status).toBe(503);
      expect(lastResponse.body).toHaveProperty('error', 'Service temporarily unavailable');
    });

    it('should recover after timeout period', async () => {
      // Wait for circuit recovery
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Mock service recovery
      jest.spyOn(gateway['orderService'], 'getOrders')
        .mockResolvedValue({ orders: [] });

      const response = await request(app)
        .get('/api/v1/orders')
        .set('X-Tenant-ID', 'test-tenant')
        .set('Authorization', 'Bearer test-jwt-token');

      expect(response.status).toBe(200);
    });
  });

  describe('Authentication & Authorization', () => {
    it('should reject requests without authentication', async () => {
      const response = await request(app)
        .get('/api/v1/orders')
        .set('X-Tenant-ID', 'test-tenant');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Authentication required');
    });

    it('should reject requests with invalid tenant ID', async () => {
      const response = await request(app)
        .get('/api/v1/orders')
        .set('X-Tenant-ID', 'non-existent-tenant')
        .set('Authorization', 'Bearer test-jwt-token');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Invalid tenant');
    });

    it('should validate API keys for webhook endpoints', async () => {
      const response = await request(app)
        .post('/api/v1/whatsapp/webhook')
        .set('X-Tenant-ID', 'test-tenant')
        .set('X-API-Key', 'invalid-key')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Invalid API key');
    });
  });

  describe('Request Transformation', () => {
    it('should transform requests based on tenant configuration', async () => {
      const orderPayload = {
        items: [{ productId: 'prod-1', quantity: 2 }],
        currency: 'ZWL' // Zimbabwe Dollar
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .set('X-Tenant-ID', 'zimbabwe-vendor')
        .set('Authorization', 'Bearer test-jwt-token')
        .send(orderPayload);

      expect(response.status).toBe(201);
      // Verify currency was transformed to USD for internal processing
      expect(response.body.internalCurrency).toBe('USD');
    });
  });

  describe('Error Handling', () => {
    it('should handle service timeouts gracefully', async () => {
      jest.spyOn(gateway['orderService'], 'createOrder')
        .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 10000)));

      const response = await request(app)
        .post('/api/v1/orders')
        .set('X-Tenant-ID', 'test-tenant')
        .set('Authorization', 'Bearer test-jwt-token')
        .send({ items: [] })
        .timeout(3000);

      expect(response.status).toBe(504);
      expect(response.body).toHaveProperty('error', 'Request timeout');
    });

    it('should sanitize error messages', async () => {
      jest.spyOn(gateway['orderService'], 'createOrder')
        .mockRejectedValue(new Error('Database connection failed: password=secret123'));

      const response = await request(app)
        .post('/api/v1/orders')
        .set('X-Tenant-ID', 'test-tenant')
        .set('Authorization', 'Bearer test-jwt-token')
        .send({ items: [] });

      expect(response.status).toBe(500);
      expect(response.body.error).not.toContain('password');
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('Metrics Collection', () => {
    it('should collect request metrics per tenant', async () => {
      await request(app)
        .get('/api/v1/orders')
        .set('X-Tenant-ID', 'metrics-test-tenant')
        .set('Authorization', 'Bearer test-jwt-token');

      const metrics = await gateway.getMetrics('metrics-test-tenant');
      
      expect(metrics).toHaveProperty('requestCount');
      expect(metrics).toHaveProperty('averageResponseTime');
      expect(metrics).toHaveProperty('errorRate');
      expect(metrics.requestCount).toBeGreaterThan(0);
    });
  });
});