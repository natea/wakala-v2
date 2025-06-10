import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { createServer } from 'http';
import { APIGateway } from '../gateway';
import { AuthenticationMiddleware } from '../middleware/authentication';
import { RateLimiter } from '../middleware/rate-limiter';
import { RequestValidator } from '../middleware/request-validator';
import { TenantRouter } from '../routes/tenant-router';
import { KongPlugin } from '../plugins/kong-plugin';
import { ApiKeyManager } from '../utils/api-key-manager';
import { TransformationEngine } from '../utils/transformation-engine';

// Mock dependencies
jest.mock('../plugins/kong-plugin');
jest.mock('ioredis');

describe('API Gateway', () => {
  let gateway: APIGateway;
  let server: any;

  beforeAll(async () => {
    gateway = new APIGateway({
      port: 0, // Use random port for testing
      services: {
        order: 'http://order-service:3001',
        payment: 'http://payment-service:3002',
        delivery: 'http://delivery-service:3003',
        whatsapp: 'http://whatsapp-service:3004',
        analytics: 'http://analytics-service:3005'
      },
      redis: {
        host: 'localhost',
        port: 6379
      }
    });
    server = await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
  });

  describe('Service Routing', () => {
    test('should route requests to order service', async () => {
      const response = await request(server)
        .get('/api/v1/orders')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.status).toBe(200);
      expect(response.headers['x-routed-to']).toBe('order-service');
    });

    test('should route requests to payment service', async () => {
      const response = await request(server)
        .post('/api/v1/payments')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1')
        .send({ amount: 100 });

      expect(response.status).toBe(200);
      expect(response.headers['x-routed-to']).toBe('payment-service');
    });

    test('should route requests to delivery service', async () => {
      const response = await request(server)
        .get('/api/v1/deliveries/tracking/123')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.status).toBe(200);
      expect(response.headers['x-routed-to']).toBe('delivery-service');
    });

    test('should return 404 for unknown routes', async () => {
      const response = await request(server)
        .get('/api/v1/unknown')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.status).toBe(404);
    });
  });

  describe('Authentication', () => {
    test('should reject requests without API key', async () => {
      const response = await request(server)
        .get('/api/v1/orders')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('API key required');
    });

    test('should reject requests with invalid API key', async () => {
      const response = await request(server)
        .get('/api/v1/orders')
        .set('X-API-Key', 'invalid-key')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid API key');
    });

    test('should accept requests with valid API key', async () => {
      const response = await request(server)
        .get('/api/v1/orders')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.status).toBe(200);
    });

    test('should validate JWT tokens', async () => {
      const token = 'valid-jwt-token';
      const response = await request(server)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', 'tenant1');

      expect(response.status).toBe(200);
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce rate limits per API key', async () => {
      const requests = Array(11).fill(null).map(() =>
        request(server)
          .get('/api/v1/orders')
          .set('X-API-Key', 'rate-limit-test')
          .set('X-Tenant-ID', 'tenant1')
      );

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.status === 429);

      expect(rateLimited.length).toBeGreaterThan(0);
      expect(rateLimited[0].body.error).toBe('Rate limit exceeded');
    });

    test('should provide rate limit headers', async () => {
      const response = await request(server)
        .get('/api/v1/orders')
        .set('X-API-Key', 'test-key-headers')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });

    test('should support different rate limits per tenant', async () => {
      // Premium tenant with higher limits
      const premiumRequests = Array(50).fill(null).map(() =>
        request(server)
          .get('/api/v1/orders')
          .set('X-API-Key', 'premium-key')
          .set('X-Tenant-ID', 'premium-tenant')
      );

      const premiumResponses = await Promise.all(premiumRequests);
      const premiumLimited = premiumResponses.filter(r => r.status === 429);

      expect(premiumLimited.length).toBe(0);
    });
  });

  describe('Request Validation', () => {
    test('should validate request headers', async () => {
      const response = await request(server)
        .get('/api/v1/orders')
        .set('X-API-Key', 'test-key');
      // Missing X-Tenant-ID

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required header: X-Tenant-ID');
    });

    test('should validate request body schema', async () => {
      const response = await request(server)
        .post('/api/v1/orders')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1')
        .send({ invalid: 'data' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid request body');
    });

    test('should validate query parameters', async () => {
      const response = await request(server)
        .get('/api/v1/orders?limit=invalid')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid query parameter');
    });

    test('should sanitize inputs', async () => {
      const response = await request(server)
        .post('/api/v1/orders')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1')
        .send({
          customerId: '<script>alert("xss")</script>',
          items: []
        });

      expect(response.status).toBe(200);
      expect(response.body.sanitized).toBe(true);
    });
  });

  describe('Tenant-Aware Routing', () => {
    test('should route to tenant-specific service instances', async () => {
      const response = await request(server)
        .get('/api/v1/orders')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant-us-east');

      expect(response.headers['x-routed-to']).toBe('order-service-us-east');
    });

    test('should handle multi-region tenants', async () => {
      const response = await request(server)
        .get('/api/v1/orders')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'global-tenant')
        .set('X-Region', 'eu-west');

      expect(response.headers['x-routed-to']).toBe('order-service-eu-west');
    });

    test('should enforce tenant isolation', async () => {
      const response = await request(server)
        .get('/api/v1/tenants/other-tenant/data')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Access denied to tenant resources');
    });
  });

  describe('Kong Integration', () => {
    test('should register custom Kong plugins', async () => {
      const kongPlugin = gateway.getKongPlugin();
      const plugins = await kongPlugin.listPlugins();

      expect(plugins).toContain('tenant-validator');
      expect(plugins).toContain('request-transformer');
      expect(plugins).toContain('response-transformer');
    });

    test('should apply Kong rate limiting plugin', async () => {
      const response = await request(server)
        .get('/api/v1/orders')
        .set('X-API-Key', 'kong-test')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.headers).toHaveProperty('x-kong-proxy-latency');
      expect(response.headers).toHaveProperty('x-kong-upstream-latency');
    });

    test('should use Kong for service discovery', async () => {
      const kongPlugin = gateway.getKongPlugin();
      const services = await kongPlugin.getServices();

      expect(services).toHaveProperty('order-service');
      expect(services).toHaveProperty('payment-service');
      expect(services).toHaveProperty('delivery-service');
    });
  });

  describe('API Key Management', () => {
    test('should create new API keys', async () => {
      const response = await request(server)
        .post('/admin/api-keys')
        .set('X-Admin-Token', 'admin-token')
        .send({
          tenantId: 'new-tenant',
          name: 'Production API Key',
          scopes: ['orders:read', 'orders:write']
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('key');
      expect(response.body).toHaveProperty('id');
      expect(response.body.scopes).toEqual(['orders:read', 'orders:write']);
    });

    test('should rotate API keys', async () => {
      const response = await request(server)
        .post('/admin/api-keys/key-123/rotate')
        .set('X-Admin-Token', 'admin-token');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('newKey');
      expect(response.body).toHaveProperty('oldKeyExpiresAt');
    });

    test('should revoke API keys', async () => {
      const response = await request(server)
        .delete('/admin/api-keys/key-123')
        .set('X-Admin-Token', 'admin-token');

      expect(response.status).toBe(200);

      // Verify key is revoked
      const testResponse = await request(server)
        .get('/api/v1/orders')
        .set('X-API-Key', 'revoked-key')
        .set('X-Tenant-ID', 'tenant1');

      expect(testResponse.status).toBe(401);
    });

    test('should enforce scope-based access control', async () => {
      const response = await request(server)
        .delete('/api/v1/orders/123')
        .set('X-API-Key', 'read-only-key')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Insufficient permissions');
    });
  });

  describe('Request/Response Transformation', () => {
    test('should transform request headers', async () => {
      const response = await request(server)
        .get('/api/v1/orders')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1')
        .set('X-Custom-Header', 'value');

      expect(response.body.receivedHeaders).toHaveProperty('x-tenant-id');
      expect(response.body.receivedHeaders).toHaveProperty('x-request-id');
      expect(response.body.receivedHeaders).not.toHaveProperty('x-api-key');
    });

    test('should transform request body', async () => {
      const response = await request(server)
        .post('/api/v1/orders')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1')
        .send({
          customer_id: '123',
          order_items: [{ sku: 'ABC', qty: 2 }]
        });

      expect(response.body.transformedRequest).toEqual({
        customerId: '123',
        items: [{ sku: 'ABC', quantity: 2 }]
      });
    });

    test('should transform response body', async () => {
      const response = await request(server)
        .get('/api/v1/orders/123')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.body).toHaveProperty('order_id');
      expect(response.body).toHaveProperty('created_at');
      expect(response.body).not.toHaveProperty('internalId');
    });

    test('should apply versioned transformations', async () => {
      const v1Response = await request(server)
        .get('/api/v1/orders')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1');

      const v2Response = await request(server)
        .get('/api/v2/orders')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1');

      expect(v1Response.body.version).toBe('1.0');
      expect(v2Response.body.version).toBe('2.0');
      expect(v2Response.body).toHaveProperty('additionalField');
    });
  });

  describe('Error Handling', () => {
    test('should handle service unavailable errors', async () => {
      // Mock service being down
      const response = await request(server)
        .get('/api/v1/unavailable-service')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Service temporarily unavailable');
    });

    test('should handle timeout errors', async () => {
      const response = await request(server)
        .get('/api/v1/slow-endpoint')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.status).toBe(504);
      expect(response.body.error).toBe('Gateway timeout');
    });

    test('should provide circuit breaker protection', async () => {
      // Trigger multiple failures
      for (let i = 0; i < 5; i++) {
        await request(server)
          .get('/api/v1/failing-service')
          .set('X-API-Key', 'test-key')
          .set('X-Tenant-ID', 'tenant1');
      }

      // Circuit should be open
      const response = await request(server)
        .get('/api/v1/failing-service')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Circuit breaker open');
    });
  });

  describe('Monitoring and Metrics', () => {
    test('should expose health check endpoint', async () => {
      const response = await request(server)
        .get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('services');
    });

    test('should expose metrics endpoint', async () => {
      const response = await request(server)
        .get('/metrics')
        .set('Authorization', 'Bearer metrics-token');

      expect(response.status).toBe(200);
      expect(response.text).toContain('http_requests_total');
      expect(response.text).toContain('http_request_duration_seconds');
    });

    test('should track request metrics', async () => {
      await request(server)
        .get('/api/v1/orders')
        .set('X-API-Key', 'test-key')
        .set('X-Tenant-ID', 'tenant1');

      const metricsResponse = await request(server)
        .get('/metrics')
        .set('Authorization', 'Bearer metrics-token');

      expect(metricsResponse.text).toMatch(/http_requests_total.*path="\/api\/v1\/orders"/);
    });
  });
});

describe('Authentication Middleware', () => {
  let authMiddleware: AuthenticationMiddleware;

  beforeAll(() => {
    authMiddleware = new AuthenticationMiddleware({
      jwtSecret: 'test-secret',
      apiKeyStore: 'redis://localhost:6379'
    });
  });

  test('should validate JWT tokens correctly', async () => {
    const token = authMiddleware.generateToken({ userId: '123', tenantId: 'tenant1' });
    const decoded = await authMiddleware.verifyToken(token);

    expect(decoded).toHaveProperty('userId', '123');
    expect(decoded).toHaveProperty('tenantId', 'tenant1');
  });

  test('should reject expired tokens', async () => {
    const expiredToken = authMiddleware.generateToken(
      { userId: '123' },
      { expiresIn: '-1s' }
    );

    await expect(authMiddleware.verifyToken(expiredToken))
      .rejects.toThrow('Token expired');
  });

  test('should validate API key scopes', async () => {
    const hasAccess = await authMiddleware.checkScope(
      'api-key-123',
      'orders:read'
    );

    expect(hasAccess).toBe(true);
  });
});

describe('Rate Limiter', () => {
  let rateLimiter: RateLimiter;

  beforeAll(() => {
    rateLimiter = new RateLimiter({
      redis: 'redis://localhost:6379',
      defaultLimits: {
        windowMs: 60000,
        max: 100
      }
    });
  });

  test('should track request counts accurately', async () => {
    const key = 'test-key-1';
    
    for (let i = 0; i < 5; i++) {
      await rateLimiter.checkLimit(key);
    }

    const count = await rateLimiter.getCount(key);
    expect(count).toBe(5);
  });

  test('should reset counts after window expires', async () => {
    const key = 'test-key-2';
    await rateLimiter.checkLimit(key);
    
    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    const count = await rateLimiter.getCount(key);
    expect(count).toBe(0);
  }, 2000);

  test('should support custom limits per tenant', async () => {
    const premiumLimiter = rateLimiter.withLimits({
      windowMs: 60000,
      max: 1000
    });

    const allowed = await premiumLimiter.checkLimit('premium-key');
    expect(allowed).toBe(true);
  });
});

describe('Request Validator', () => {
  let validator: RequestValidator;

  beforeAll(() => {
    validator = new RequestValidator();
  });

  test('should validate required headers', () => {
    const headers = { 'x-tenant-id': 'tenant1' };
    const result = validator.validateHeaders(headers, ['x-tenant-id']);

    expect(result.valid).toBe(true);
  });

  test('should reject missing required headers', () => {
    const headers = {};
    const result = validator.validateHeaders(headers, ['x-tenant-id']);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required header: x-tenant-id');
  });

  test('should validate JSON schema', () => {
    const schema = {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        amount: { type: 'number' }
      },
      required: ['customerId', 'amount']
    };

    const validData = { customerId: '123', amount: 100 };
    const result = validator.validateBody(validData, schema);

    expect(result.valid).toBe(true);
  });

  test('should sanitize HTML in inputs', () => {
    const input = '<script>alert("xss")</script>Hello';
    const sanitized = validator.sanitize(input);

    expect(sanitized).toBe('Hello');
  });
});

describe('API Gateway - Coverage Tests', () => {
  test('should handle WebSocket upgrades', async () => {
    // Test WebSocket handling for real-time features
    const gateway = new APIGateway({ enableWebSockets: true });
    const wsClient = await gateway.connectWebSocket('/ws');

    expect(wsClient.readyState).toBe(1); // OPEN
  });

  test('should handle CORS properly', async () => {
    const response = await request(server)
      .options('/api/v1/orders')
      .set('Origin', 'https://allowed-origin.com');

    expect(response.headers['access-control-allow-origin']).toBe('https://allowed-origin.com');
    expect(response.headers['access-control-allow-methods']).toContain('GET');
  });

  test('should compress responses', async () => {
    const response = await request(server)
      .get('/api/v1/large-response')
      .set('X-API-Key', 'test-key')
      .set('X-Tenant-ID', 'tenant1')
      .set('Accept-Encoding', 'gzip');

    expect(response.headers['content-encoding']).toBe('gzip');
  });
});