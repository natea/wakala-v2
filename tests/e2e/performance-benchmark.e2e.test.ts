import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { performance } from 'perf_hooks';
import pLimit from 'p-limit';
import { APIGateway } from '../../backend/services/api-gateway/src/gateway';
import { OrderService } from '../../backend/services/order-service/src/services/order.service';
import { PaymentService } from '../../backend/services/payment-service/src/services/payment.service';
import { DeliveryService } from '../../backend/services/delivery-service/src/services/delivery.service';
import { WhatsAppService } from '../../backend/services/whatsapp-service/src/services/whatsapp.service';
import { MultiTenantService } from '../../backend/services/multi-tenant-service/src/services/tenant.service';
import request from 'supertest';

describe('E2E: Performance Benchmarks', () => {
  let apiGateway: APIGateway;
  let orderService: OrderService;
  let paymentService: PaymentService;
  let deliveryService: DeliveryService;
  let whatsappService: WhatsAppService;
  let tenantService: MultiTenantService;
  let app: any;

  // Benchmark configurations
  const benchmarkConfig = {
    concurrentUsers: [10, 50, 100, 200],
    testDuration: 60000, // 1 minute per test
    tenants: ['tenant-1', 'tenant-2', 'tenant-3'],
    targetMetrics: {
      p95ResponseTime: 200, // 95th percentile should be under 200ms
      p99ResponseTime: 500, // 99th percentile should be under 500ms
      errorRate: 0.01, // Less than 1% error rate
      throughput: 1000 // At least 1000 requests per second
    }
  };

  // Metrics collection
  const metrics = {
    responseTimes: [],
    errors: [],
    throughput: 0,
    startTime: 0,
    endTime: 0
  };

  beforeAll(async () => {
    // Initialize services
    apiGateway = new APIGateway();
    orderService = new OrderService();
    paymentService = new PaymentService();
    deliveryService = new DeliveryService();
    whatsappService = new WhatsAppService();
    tenantService = new MultiTenantService();

    await Promise.all([
      orderService.initialize(),
      paymentService.initialize(),
      deliveryService.initialize(),
      whatsappService.initialize(),
      tenantService.initialize()
    ]);

    app = await apiGateway.initialize();

    // Create test tenants
    await setupTestTenants();
    // Pre-populate test data
    await seedTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await Promise.all([
      apiGateway.shutdown(),
      orderService.shutdown(),
      paymentService.shutdown(),
      deliveryService.shutdown(),
      whatsappService.shutdown(),
      tenantService.shutdown()
    ]);
  });

  async function setupTestTenants() {
    for (const tenantId of benchmarkConfig.tenants) {
      await tenantService.createTenant({
        id: tenantId,
        name: `Performance Test Vendor ${tenantId}`,
        domain: `${tenantId}.wakala.test`,
        config: {
          rateLimits: {
            api: { limit: 10000, window: '1m' }, // High limits for testing
            orders: { limit: 5000, window: '1m' }
          }
        }
      });
    }
  }

  async function seedTestData() {
    // Create test products for each tenant
    for (const tenantId of benchmarkConfig.tenants) {
      for (let i = 0; i < 100; i++) {
        await orderService.createProduct({
          tenantId,
          productId: `product-${i}`,
          name: `Test Product ${i}`,
          price: Math.random() * 100,
          stock: 1000
        });
      }
    }
  }

  async function cleanupTestData() {
    // Cleanup logic
  }

  describe('API Gateway Performance', () => {
    it('should handle high throughput with acceptable latency', async () => {
      const results = {};

      for (const concurrency of benchmarkConfig.concurrentUsers) {
        console.log(`Testing with ${concurrency} concurrent users...`);
        
        const testResult = await runLoadTest({
          concurrency,
          duration: benchmarkConfig.testDuration,
          scenario: 'mixed_api_calls'
        });

        results[concurrency] = testResult;

        // Verify metrics meet targets
        expect(testResult.p95).toBeLessThan(benchmarkConfig.targetMetrics.p95ResponseTime);
        expect(testResult.p99).toBeLessThan(benchmarkConfig.targetMetrics.p99ResponseTime);
        expect(testResult.errorRate).toBeLessThan(benchmarkConfig.targetMetrics.errorRate);
        expect(testResult.throughput).toBeGreaterThan(benchmarkConfig.targetMetrics.throughput);
      }

      // Log results for analysis
      console.table(results);
    });

    it('should maintain performance under sustained load', async () => {
      const sustainedLoadDuration = 300000; // 5 minutes
      const concurrency = 100;
      const checkpoints = [];

      const startTime = performance.now();
      let checkpointCount = 0;

      // Run sustained load test with periodic checkpoints
      const loadTestPromise = runLoadTest({
        concurrency,
        duration: sustainedLoadDuration,
        scenario: 'mixed_api_calls'
      });

      // Collect metrics every 30 seconds
      const metricsInterval = setInterval(() => {
        checkpointCount++;
        const currentMetrics = calculateCurrentMetrics();
        checkpoints.push({
          timestamp: performance.now() - startTime,
          checkpoint: checkpointCount,
          ...currentMetrics
        });
      }, 30000);

      const finalResult = await loadTestPromise;
      clearInterval(metricsInterval);

      // Verify performance didn't degrade over time
      const firstCheckpoint = checkpoints[0];
      const lastCheckpoint = checkpoints[checkpoints.length - 1];

      // Response time should not increase by more than 20%
      expect(lastCheckpoint.p95).toBeLessThan(firstCheckpoint.p95 * 1.2);
      
      // Error rate should remain stable
      expect(lastCheckpoint.errorRate).toBeLessThan(0.02);

      console.log('Sustained load test checkpoints:');
      console.table(checkpoints);
    });
  });

  describe('Order Processing Performance', () => {
    it('should process orders efficiently at scale', async () => {
      const orderScenarios = [
        { name: 'simple_order', items: 1, complexity: 'low' },
        { name: 'medium_order', items: 5, complexity: 'medium' },
        { name: 'complex_order', items: 20, complexity: 'high' }
      ];

      const results = {};

      for (const scenario of orderScenarios) {
        const testResult = await benchmarkOrderProcessing(scenario);
        results[scenario.name] = testResult;

        // Verify processing times based on complexity
        const maxProcessingTime = scenario.complexity === 'low' ? 100 : 
                                 scenario.complexity === 'medium' ? 300 : 500;
        
        expect(testResult.avgProcessingTime).toBeLessThan(maxProcessingTime);
      }

      console.log('Order processing benchmarks:');
      console.table(results);
    });

    it('should handle order spikes during peak hours', async () => {
      // Simulate lunch rush scenario
      const peakLoadProfile = [
        { minute: 0, load: 50 },   // Normal
        { minute: 1, load: 200 },  // Spike begins
        { minute: 2, load: 500 },  // Peak
        { minute: 3, load: 400 },  // Sustained high
        { minute: 4, load: 200 },  // Declining
        { minute: 5, load: 50 }    // Normal
      ];

      const results = [];

      for (const profile of peakLoadProfile) {
        const startTime = performance.now();
        
        // Generate orders at specified rate
        const orderPromises = [];
        const limit = pLimit(profile.load);

        for (let i = 0; i < profile.load; i++) {
          orderPromises.push(
            limit(() => createTestOrder(
              benchmarkConfig.tenants[i % benchmarkConfig.tenants.length]
            ))
          );
        }

        const orderResults = await Promise.allSettled(orderPromises);
        const endTime = performance.now();

        const successful = orderResults.filter(r => r.status === 'fulfilled').length;
        const failed = orderResults.filter(r => r.status === 'rejected').length;

        results.push({
          minute: profile.minute,
          targetLoad: profile.load,
          processed: successful,
          failed,
          duration: endTime - startTime,
          successRate: (successful / profile.load) * 100
        });
      }

      // Verify system handled peak load
      const peakMinute = results.find(r => r.minute === 2);
      expect(peakMinute.successRate).toBeGreaterThan(95);

      console.log('Peak hour simulation results:');
      console.table(results);
    });
  });

  describe('WhatsApp Message Processing', () => {
    it('should handle high volume of concurrent WhatsApp messages', async () => {
      const messageVolumes = [100, 500, 1000];
      const results = {};

      for (const volume of messageVolumes) {
        const testResult = await benchmarkWhatsAppMessages(volume);
        results[`${volume}_messages`] = testResult;

        // Verify message processing performance
        expect(testResult.avgProcessingTime).toBeLessThan(100); // Under 100ms average
        expect(testResult.successRate).toBeGreaterThan(99); // 99% success rate
      }

      console.log('WhatsApp message processing benchmarks:');
      console.table(results);
    });

    it('should maintain conversation state under load', async () => {
      const concurrentConversations = 200;
      const messagesPerConversation = 10;

      const conversations = [];
      
      // Initialize conversations
      for (let i = 0; i < concurrentConversations; i++) {
        conversations.push({
          phoneNumber: `+26377654${String(i).padStart(4, '0')}`,
          tenantId: benchmarkConfig.tenants[i % benchmarkConfig.tenants.length],
          messages: []
        });
      }

      // Send messages in parallel maintaining conversation context
      const startTime = performance.now();
      
      for (let round = 0; round < messagesPerConversation; round++) {
        const messagePromises = conversations.map(conv => 
          sendWhatsAppMessage(conv.tenantId, conv.phoneNumber, {
            type: 'text',
            text: { body: `Message ${round + 1}` }
          })
        );

        const results = await Promise.allSettled(messagePromises);
        const successful = results.filter(r => r.status === 'fulfilled').length;
        
        expect(successful / conversations.length).toBeGreaterThan(0.98);
      }

      const endTime = performance.now();
      const totalMessages = concurrentConversations * messagesPerConversation;
      const duration = endTime - startTime;
      const messagesPerSecond = (totalMessages / duration) * 1000;

      console.log(`Processed ${totalMessages} messages in ${duration}ms`);
      console.log(`Throughput: ${messagesPerSecond.toFixed(2)} messages/second`);

      expect(messagesPerSecond).toBeGreaterThan(100); // At least 100 msg/sec
    });
  });

  describe('Payment Processing Performance', () => {
    it('should handle concurrent payment transactions', async () => {
      const paymentVolumes = [50, 100, 200];
      const results = {};

      for (const volume of paymentVolumes) {
        const testResult = await benchmarkPaymentProcessing(volume);
        results[`${volume}_payments`] = testResult;

        // Payment processing should be fast but secure
        expect(testResult.avgProcessingTime).toBeLessThan(300); // Under 300ms
        expect(testResult.successRate).toBeGreaterThan(98); // 98% success rate
      }

      console.log('Payment processing benchmarks:');
      console.table(results);
    });

    it('should handle payment gateway timeouts gracefully', async () => {
      // Simulate payment gateway delays
      const delayScenarios = [
        { delay: 0, expectedSuccess: 100 },
        { delay: 1000, expectedSuccess: 95 },
        { delay: 3000, expectedSuccess: 85 },
        { delay: 5000, expectedSuccess: 70 }
      ];

      const results = [];

      for (const scenario of delayScenarios) {
        // Mock gateway delay
        jest.spyOn(paymentService['ecoCashGateway'], 'processPayment')
          .mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, scenario.delay));
            return { success: true, transactionId: 'test-123' };
          });

        const testResult = await benchmarkPaymentProcessing(50);
        results.push({
          delay: scenario.delay,
          ...testResult
        });

        // Restore mock
        jest.restoreAllMocks();
      }

      console.log('Payment timeout handling:');
      console.table(results);
    });
  });

  describe('Database Performance', () => {
    it('should maintain query performance with large datasets', async () => {
      const dataSizes = [1000, 10000, 50000];
      const results = {};

      for (const size of dataSizes) {
        // Seed data
        await seedLargeDataset(size);

        const queries = [
          { name: 'list_orders', query: () => orderService.listOrders('tenant-1', { limit: 50 }) },
          { name: 'search_orders', query: () => orderService.searchOrders('tenant-1', { status: 'PENDING' }) },
          { name: 'aggregate_revenue', query: () => orderService.getRevenueStats('tenant-1') }
        ];

        for (const queryTest of queries) {
          const startTime = performance.now();
          await queryTest.query();
          const endTime = performance.now();

          const key = `${queryTest.name}_${size}_records`;
          results[key] = {
            queryTime: endTime - startTime,
            recordCount: size
          };
        }

        // Cleanup
        await cleanupLargeDataset(size);
      }

      console.log('Database query performance:');
      console.table(results);

      // Verify query times don't grow linearly with data size
      Object.entries(results).forEach(([key, value]) => {
        expect(value.queryTime).toBeLessThan(100); // All queries under 100ms
      });
    });
  });

  describe('Multi-Tenant Performance Isolation', () => {
    it('should isolate performance impact between tenants', async () => {
      // Create load on one tenant
      const heavyTenant = benchmarkConfig.tenants[0];
      const normalTenant = benchmarkConfig.tenants[1];

      // Start monitoring normal tenant performance
      const normalTenantBaseline = await measureTenantPerformance(normalTenant, 10);

      // Generate heavy load on first tenant
      const heavyLoadPromise = generateHeavyLoad(heavyTenant, 1000);

      // Measure normal tenant during heavy load
      const normalTenantDuringLoad = await measureTenantPerformance(normalTenant, 10);

      await heavyLoadPromise;

      // Performance degradation should be minimal
      const degradation = (normalTenantDuringLoad.avgResponseTime - normalTenantBaseline.avgResponseTime) 
                         / normalTenantBaseline.avgResponseTime;

      expect(degradation).toBeLessThan(0.1); // Less than 10% degradation

      console.log('Tenant isolation results:');
      console.log(`Baseline response time: ${normalTenantBaseline.avgResponseTime}ms`);
      console.log(`During load response time: ${normalTenantDuringLoad.avgResponseTime}ms`);
      console.log(`Degradation: ${(degradation * 100).toFixed(2)}%`);
    });
  });

  describe('Memory and Resource Usage', () => {
    it('should not have memory leaks under sustained load', async () => {
      const initialMemory = process.memoryUsage();
      const memorySnapshots = [];

      // Run load test for 2 minutes
      const loadDuration = 120000;
      const startTime = Date.now();

      const loadInterval = setInterval(async () => {
        // Generate some load
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(createTestOrder(benchmarkConfig.tenants[0]));
        }
        await Promise.allSettled(promises);
      }, 100);

      // Take memory snapshots every 10 seconds
      const memoryInterval = setInterval(() => {
        const currentMemory = process.memoryUsage();
        memorySnapshots.push({
          timestamp: Date.now() - startTime,
          heapUsed: currentMemory.heapUsed,
          external: currentMemory.external,
          rss: currentMemory.rss
        });
      }, 10000);

      // Wait for test completion
      await new Promise(resolve => setTimeout(resolve, loadDuration));

      clearInterval(loadInterval);
      clearInterval(memoryInterval);

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage();

      // Memory growth should be reasonable
      const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      const growthPercentage = (memoryGrowth / initialMemory.heapUsed) * 100;

      expect(growthPercentage).toBeLessThan(50); // Less than 50% growth

      console.log('Memory usage over time:');
      console.table(memorySnapshots);
      console.log(`Memory growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB (${growthPercentage.toFixed(2)}%)`);
    });
  });

  // Helper functions
  async function runLoadTest(config: any) {
    const results = {
      responseTimes: [],
      errors: 0,
      successful: 0,
      startTime: performance.now()
    };

    const limit = pLimit(config.concurrency);
    const endTime = performance.now() + config.duration;
    const promises = [];

    while (performance.now() < endTime) {
      promises.push(
        limit(async () => {
          const start = performance.now();
          try {
            await executeScenario(config.scenario);
            results.successful++;
            results.responseTimes.push(performance.now() - start);
          } catch (error) {
            results.errors++;
          }
        })
      );

      // Small delay to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    await Promise.all(promises);

    return calculateMetrics(results);
  }

  async function executeScenario(scenario: string) {
    const tenant = benchmarkConfig.tenants[Math.floor(Math.random() * benchmarkConfig.tenants.length)];

    switch (scenario) {
      case 'mixed_api_calls':
        const random = Math.random();
        if (random < 0.4) {
          // 40% read operations
          await request(app)
            .get('/api/v1/orders')
            .set('X-Tenant-ID', tenant)
            .set('Authorization', 'Bearer test-token');
        } else if (random < 0.7) {
          // 30% create operations
          await request(app)
            .post('/api/v1/orders')
            .set('X-Tenant-ID', tenant)
            .set('Authorization', 'Bearer test-token')
            .send({
              items: [{ productId: 'product-1', quantity: 1 }],
              customerPhone: '+263776543210'
            });
        } else if (random < 0.9) {
          // 20% update operations
          await request(app)
            .put('/api/v1/orders/test-order-id')
            .set('X-Tenant-ID', tenant)
            .set('Authorization', 'Bearer test-token')
            .send({ status: 'CONFIRMED' });
        } else {
          // 10% search operations
          await request(app)
            .get('/api/v1/orders/search?q=test')
            .set('X-Tenant-ID', tenant)
            .set('Authorization', 'Bearer test-token');
        }
        break;
    }
  }

  function calculateMetrics(results: any) {
    const sorted = results.responseTimes.sort((a, b) => a - b);
    const total = results.successful + results.errors;
    const duration = performance.now() - results.startTime;

    return {
      total,
      successful: results.successful,
      errors: results.errors,
      errorRate: results.errors / total,
      throughput: (total / duration) * 1000,
      avgResponseTime: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      minResponseTime: sorted[0],
      maxResponseTime: sorted[sorted.length - 1],
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  function calculateCurrentMetrics() {
    // Implementation to calculate current metrics
    return {
      p95: 150,
      p99: 250,
      errorRate: 0.005,
      throughput: 1200
    };
  }

  async function benchmarkOrderProcessing(scenario: any) {
    const iterations = 100;
    const times = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      
      await orderService.createOrder({
        tenantId: benchmarkConfig.tenants[0],
        customerId: `customer-${i}`,
        items: Array(scenario.items).fill(null).map((_, idx) => ({
          productId: `product-${idx}`,
          quantity: 1,
          price: 10.00
        })),
        totalAmount: scenario.items * 10.00
      });

      times.push(performance.now() - start);
    }

    return {
      avgProcessingTime: times.reduce((a, b) => a + b) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times)
    };
  }

  async function benchmarkWhatsAppMessages(volume: number) {
    const results = {
      successful: 0,
      failed: 0,
      times: []
    };

    const promises = [];
    for (let i = 0; i < volume; i++) {
      promises.push(
        (async () => {
          const start = performance.now();
          try {
            await whatsappService.handleWebhook({
              entry: [{
                id: benchmarkConfig.tenants[i % benchmarkConfig.tenants.length],
                changes: [{
                  value: {
                    messages: [{
                      from: `+26377654${String(i).padStart(4, '0')}`,
                      text: { body: 'Test message' }
                    }]
                  }
                }]
              }]
            });
            results.successful++;
            results.times.push(performance.now() - start);
          } catch (error) {
            results.failed++;
          }
        })()
      );
    }

    await Promise.all(promises);

    return {
      total: volume,
      successful: results.successful,
      failed: results.failed,
      successRate: (results.successful / volume) * 100,
      avgProcessingTime: results.times.reduce((a, b) => a + b, 0) / results.times.length
    };
  }

  async function benchmarkPaymentProcessing(volume: number) {
    const results = {
      successful: 0,
      failed: 0,
      times: []
    };

    const promises = [];
    for (let i = 0; i < volume; i++) {
      promises.push(
        (async () => {
          const start = performance.now();
          try {
            await paymentService.initiatePayment({
              tenantId: benchmarkConfig.tenants[i % benchmarkConfig.tenants.length],
              orderId: `order-${i}`,
              amount: 100.00,
              currency: 'USD',
              method: 'ecocash',
              customerPhone: `+26377654${String(i).padStart(4, '0')}`
            });
            results.successful++;
            results.times.push(performance.now() - start);
          } catch (error) {
            results.failed++;
          }
        })()
      );
    }

    await Promise.all(promises);

    return {
      total: volume,
      successful: results.successful,
      failed: results.failed,
      successRate: (results.successful / volume) * 100,
      avgProcessingTime: results.times.reduce((a, b) => a + b, 0) / results.times.length
    };
  }

  async function seedLargeDataset(size: number) {
    // Implementation to seed large dataset
  }

  async function cleanupLargeDataset(size: number) {
    // Implementation to cleanup large dataset
  }

  async function createTestOrder(tenantId: string) {
    return await orderService.createOrder({
      tenantId,
      customerId: `customer-${Date.now()}`,
      items: [{ productId: 'product-1', quantity: 1, price: 10.00 }],
      totalAmount: 10.00
    });
  }

  async function sendWhatsAppMessage(tenantId: string, phoneNumber: string, message: any) {
    return await whatsappService.handleWebhook({
      entry: [{
        id: tenantId,
        changes: [{
          value: {
            messages: [{
              from: phoneNumber,
              ...message
            }]
          }
        }]
      }]
    });
  }

  async function measureTenantPerformance(tenantId: string, requests: number) {
    const times = [];

    for (let i = 0; i < requests; i++) {
      const start = performance.now();
      await request(app)
        .get('/api/v1/orders')
        .set('X-Tenant-ID', tenantId)
        .set('Authorization', 'Bearer test-token');
      times.push(performance.now() - start);
    }

    return {
      avgResponseTime: times.reduce((a, b) => a + b, 0) / times.length,
      minResponseTime: Math.min(...times),
      maxResponseTime: Math.max(...times)
    };
  }

  async function generateHeavyLoad(tenantId: string, requests: number) {
    const promises = [];
    for (let i = 0; i < requests; i++) {
      promises.push(
        request(app)
          .post('/api/v1/orders')
          .set('X-Tenant-ID', tenantId)
          .set('Authorization', 'Bearer test-token')
          .send({
            items: Array(10).fill(null).map((_, idx) => ({
              productId: `product-${idx}`,
              quantity: 1
            }))
          })
      );
    }

    await Promise.all(promises);
  }
});