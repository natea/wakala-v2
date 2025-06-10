import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AnalyticsService } from '../services/analytics.service';
import { EventProcessor } from '../processors/event-processor';
import { MetricsAggregator } from '../aggregators/metrics-aggregator';
import { ReportingEngine } from '../services/reporting-engine';
import { DataWarehouse } from '../services/data-warehouse';
import { KafkaEventStream } from '../services/kafka-event-stream';
import { AnalyticsRepository } from '../repositories/analytics.repository';
import {
  AnalyticsEvent,
  EventType,
  Metric,
  Report,
  AggregationPeriod,
  TimeSeriesData
} from '../interfaces/analytics.interfaces';

// Mock Kafka
jest.mock('kafkajs');

describe('Analytics Service', () => {
  let analyticsService: AnalyticsService;
  let eventProcessor: EventProcessor;
  let metricsAggregator: MetricsAggregator;
  let reportingEngine: ReportingEngine;
  let dataWarehouse: DataWarehouse;
  let kafkaStream: jest.Mocked<KafkaEventStream>;
  let analyticsRepository: jest.Mocked<AnalyticsRepository>;

  beforeEach(() => {
    analyticsRepository = new AnalyticsRepository() as jest.Mocked<AnalyticsRepository>;
    kafkaStream = new KafkaEventStream({}) as jest.Mocked<KafkaEventStream>;
    
    eventProcessor = new EventProcessor(analyticsRepository);
    metricsAggregator = new MetricsAggregator(analyticsRepository);
    reportingEngine = new ReportingEngine(analyticsRepository, metricsAggregator);
    dataWarehouse = new DataWarehouse(analyticsRepository);
    
    analyticsService = new AnalyticsService(
      eventProcessor,
      metricsAggregator,
      reportingEngine,
      dataWarehouse,
      kafkaStream
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Event Collection', () => {
    test('should collect and process analytics events', async () => {
      const event: AnalyticsEvent = {
        id: 'evt-123',
        type: EventType.ORDER_CREATED,
        tenantId: 'tenant-123',
        userId: 'user-456',
        timestamp: new Date(),
        properties: {
          orderId: 'order-789',
          amount: 5000,
          items: 3,
          paymentMethod: 'card'
        },
        context: {
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          platform: 'whatsapp'
        }
      };

      await analyticsService.trackEvent(event);

      expect(eventProcessor.process).toHaveBeenCalledWith(event);
      expect(kafkaStream.publishEvent).toHaveBeenCalledWith(event);
    });

    test('should validate event schema', async () => {
      const invalidEvent = {
        type: 'INVALID_TYPE',
        timestamp: 'not-a-date'
      };

      await expect(analyticsService.trackEvent(invalidEvent as any))
        .rejects.toThrow('Invalid event schema');
    });

    test('should batch events for efficiency', async () => {
      const events: AnalyticsEvent[] = Array(100).fill(null).map((_, i) => ({
        id: `evt-${i}`,
        type: EventType.PAGE_VIEW,
        tenantId: 'tenant-123',
        timestamp: new Date(),
        properties: { page: `/page-${i}` }
      }));

      await analyticsService.trackBatch(events);

      expect(kafkaStream.publishBatch).toHaveBeenCalledWith(events);
      expect(eventProcessor.processBatch).toHaveBeenCalledWith(events);
    });

    test('should handle event enrichment', async () => {
      const event: AnalyticsEvent = {
        id: 'evt-123',
        type: EventType.USER_LOGIN,
        userId: 'user-123',
        timestamp: new Date(),
        properties: {}
      };

      const enrichedEvent = await eventProcessor.enrich(event);

      expect(enrichedEvent).toHaveProperty('properties.userSegment');
      expect(enrichedEvent).toHaveProperty('properties.sessionId');
      expect(enrichedEvent).toHaveProperty('context.location');
    });
  });

  describe('Event Streaming with Kafka', () => {
    test('should configure Kafka producers and consumers', async () => {
      await analyticsService.initialize();

      expect(kafkaStream.connect).toHaveBeenCalled();
      expect(kafkaStream.createTopics).toHaveBeenCalledWith([
        'analytics-events',
        'analytics-metrics',
        'analytics-alerts'
      ]);
    });

    test('should handle Kafka connection failures', async () => {
      kafkaStream.connect.mockRejectedValue(new Error('Connection failed'));
      
      await expect(analyticsService.initialize())
        .rejects.toThrow('Failed to initialize analytics service');
    });

    test('should process events from Kafka stream', async () => {
      const mockConsumer = {
        subscribe: jest.fn(),
        run: jest.fn()
      };

      kafkaStream.getConsumer.mockReturnValue(mockConsumer as any);

      await analyticsService.startEventConsumer();

      expect(mockConsumer.subscribe).toHaveBeenCalledWith({
        topics: ['analytics-events'],
        fromBeginning: false
      });
    });

    test('should handle event processing errors', async () => {
      const faultyEvent = {
        id: 'evt-faulty',
        type: EventType.ORDER_CREATED,
        properties: { amount: 'not-a-number' }
      };

      eventProcessor.process.mockRejectedValue(new Error('Processing failed'));

      await analyticsService.trackEvent(faultyEvent as any);

      expect(analyticsRepository.saveToDeadLetter).toHaveBeenCalledWith(
        faultyEvent,
        'Processing failed'
      );
    });
  });

  describe('Metrics Aggregation', () => {
    test('should aggregate metrics by period', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const metrics = await metricsAggregator.aggregate(
        EventType.ORDER_CREATED,
        AggregationPeriod.DAILY,
        startDate,
        endDate
      );

      expect(metrics).toHaveProperty('totalCount');
      expect(metrics).toHaveProperty('uniqueUsers');
      expect(metrics).toHaveProperty('totalRevenue');
      expect(metrics).toHaveProperty('averageOrderValue');
      expect(metrics.timeSeries).toHaveLength(31);
    });

    test('should calculate real-time metrics', async () => {
      const realtimeMetrics = await metricsAggregator.getRealtimeMetrics();

      expect(realtimeMetrics).toHaveProperty('activeUsers');
      expect(realtimeMetrics).toHaveProperty('ordersPerMinute');
      expect(realtimeMetrics).toHaveProperty('revenueToday');
      expect(realtimeMetrics).toHaveProperty('conversionRate');
    });

    test('should compute custom metrics', async () => {
      const customMetric = {
        name: 'cart_abandonment_rate',
        formula: 'abandoned_carts / total_carts * 100',
        filters: { timeRange: 'last_7_days' }
      };

      const result = await metricsAggregator.computeCustomMetric(customMetric);

      expect(result).toHaveProperty('value');
      expect(result).toHaveProperty('trend');
      expect(result).toHaveProperty('comparison');
    });

    test('should handle time series data', async () => {
      const timeSeries = await metricsAggregator.getTimeSeries(
        'revenue',
        AggregationPeriod.HOURLY,
        new Date('2024-01-01'),
        new Date('2024-01-02')
      );

      expect(timeSeries).toHaveLength(24);
      expect(timeSeries[0]).toHaveProperty('timestamp');
      expect(timeSeries[0]).toHaveProperty('value');
    });
  });

  describe('Reporting Engine', () => {
    test('should generate standard reports', async () => {
      const report = await reportingEngine.generateReport({
        type: 'sales_summary',
        period: 'monthly',
        tenantId: 'tenant-123',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31')
      });

      expect(report).toHaveProperty('id');
      expect(report).toHaveProperty('data');
      expect(report.data).toHaveProperty('totalSales');
      expect(report.data).toHaveProperty('topProducts');
      expect(report.data).toHaveProperty('customerSegments');
    });

    test('should support custom report templates', async () => {
      const template = {
        name: 'customer_behavior',
        metrics: ['page_views', 'session_duration', 'bounce_rate'],
        dimensions: ['device', 'location', 'referrer'],
        filters: { userType: 'new' }
      };

      const report = await reportingEngine.generateCustomReport(template);

      expect(report.metrics).toEqual(template.metrics);
      expect(report.data).toHaveProperty('segments');
    });

    test('should schedule recurring reports', async () => {
      const schedule = {
        reportType: 'daily_summary',
        frequency: 'daily',
        time: '09:00',
        recipients: ['admin@tenant.com'],
        format: 'pdf'
      };

      const scheduled = await reportingEngine.scheduleReport(schedule);

      expect(scheduled).toHaveProperty('id');
      expect(scheduled.nextRun).toBeInstanceOf(Date);
    });

    test('should export reports in multiple formats', async () => {
      const report = { id: 'report-123', data: { sales: 10000 } };

      const pdf = await reportingEngine.exportReport(report, 'pdf');
      const excel = await reportingEngine.exportReport(report, 'excel');
      const csv = await reportingEngine.exportReport(report, 'csv');

      expect(pdf).toHaveProperty('buffer');
      expect(excel).toHaveProperty('buffer');
      expect(csv).toHaveProperty('content');
    });
  });

  describe('Data Warehousing', () => {
    test('should ETL raw events to warehouse', async () => {
      const events = [
        { id: 'evt-1', type: EventType.ORDER_CREATED, properties: { amount: 1000 } },
        { id: 'evt-2', type: EventType.ORDER_CREATED, properties: { amount: 2000 } }
      ];

      await dataWarehouse.processEvents(events);

      expect(dataWarehouse.transform).toHaveBeenCalledWith(events);
      expect(dataWarehouse.load).toHaveBeenCalledWith(
        'fact_orders',
        expect.any(Array)
      );
    });

    test('should maintain dimension tables', async () => {
      await dataWarehouse.updateDimensions();

      expect(dataWarehouse.updateDimensionTable).toHaveBeenCalledWith('dim_users');
      expect(dataWarehouse.updateDimensionTable).toHaveBeenCalledWith('dim_products');
      expect(dataWarehouse.updateDimensionTable).toHaveBeenCalledWith('dim_time');
    });

    test('should optimize query performance', async () => {
      const query = 'SELECT * FROM fact_orders WHERE date >= ?';
      const optimized = await dataWarehouse.optimizeQuery(query);

      expect(optimized).toContain('WITH');
      expect(optimized).toContain('INDEX');
    });

    test('should handle data retention policies', async () => {
      await dataWarehouse.applyRetentionPolicy({
        table: 'raw_events',
        retentionDays: 90
      });

      expect(analyticsRepository.deleteOldData).toHaveBeenCalledWith(
        'raw_events',
        expect.any(Date)
      );
    });
  });

  describe('Real-time Analytics', () => {
    test('should provide live dashboard data', async () => {
      const dashboardData = await analyticsService.getLiveDashboard('tenant-123');

      expect(dashboardData).toHaveProperty('activeUsers');
      expect(dashboardData).toHaveProperty('currentOrders');
      expect(dashboardData).toHaveProperty('revenueToday');
      expect(dashboardData).toHaveProperty('topProducts');
      expect(dashboardData.lastUpdated).toBeInstanceOf(Date);
    });

    test('should stream metrics via WebSocket', async () => {
      const mockWs = { send: jest.fn() };
      
      await analyticsService.streamMetrics(mockWs as any, {
        metrics: ['orders', 'revenue'],
        interval: 1000
      });

      // Wait for first update
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('orders')
      );
    });

    test('should detect anomalies in real-time', async () => {
      const anomaly = {
        metric: 'order_volume',
        current: 1000,
        expected: 100,
        deviation: 900,
        severity: 'high'
      };

      await analyticsService.detectAnomalies();

      expect(analyticsRepository.saveAnomaly).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'high' })
      );
    });
  });

  describe('Tenant Analytics', () => {
    test('should isolate tenant data', async () => {
      const tenantMetrics = await analyticsService.getTenantMetrics('tenant-123');

      expect(tenantMetrics).not.toContain(
        expect.objectContaining({ tenantId: 'tenant-456' })
      );
    });

    test('should compare tenant performance', async () => {
      const comparison = await analyticsService.compareTenants(
        ['tenant-123', 'tenant-456'],
        { metric: 'revenue', period: 'monthly' }
      );

      expect(comparison).toHaveLength(2);
      expect(comparison[0]).toHaveProperty('tenantId');
      expect(comparison[0]).toHaveProperty('metrics');
    });

    test('should generate tenant insights', async () => {
      const insights = await analyticsService.generateInsights('tenant-123');

      expect(insights).toContain(
        expect.objectContaining({
          type: 'growth_opportunity',
          confidence: expect.any(Number)
        })
      );
    });
  });

  describe('Performance Optimization', () => {
    test('should cache frequently accessed metrics', async () => {
      // First call - cache miss
      await analyticsService.getMetric('daily_revenue', { tenantId: 'tenant-123' });
      expect(analyticsRepository.getFromCache).toHaveBeenCalled();
      expect(metricsAggregator.calculate).toHaveBeenCalled();

      // Second call - cache hit
      await analyticsService.getMetric('daily_revenue', { tenantId: 'tenant-123' });
      expect(analyticsRepository.getFromCache).toHaveBeenCalledTimes(2);
      expect(metricsAggregator.calculate).toHaveBeenCalledTimes(1);
    });

    test('should use materialized views', async () => {
      await analyticsService.refreshMaterializedViews();

      expect(dataWarehouse.refreshView).toHaveBeenCalledWith('mv_daily_sales');
      expect(dataWarehouse.refreshView).toHaveBeenCalledWith('mv_user_segments');
    });

    test('should partition large tables', async () => {
      await dataWarehouse.partitionTable('events', 'date', 'monthly');

      expect(analyticsRepository.getPartitions).toHaveBeenCalledWith('events');
      expect(analyticsRepository.createPartition).toHaveBeenCalled();
    });
  });

  describe('Export and Integration', () => {
    test('should export data to external systems', async () => {
      const exportConfig = {
        destination: 'bigquery',
        dataset: 'analytics',
        table: 'events',
        schedule: 'hourly'
      };

      await analyticsService.configureExport(exportConfig);

      expect(dataWarehouse.setupExportPipeline).toHaveBeenCalledWith(exportConfig);
    });

    test('should provide API for third-party integrations', async () => {
      const apiKey = await analyticsService.generateAPIKey('tenant-123', {
        permissions: ['read:metrics', 'read:reports'],
        rateLimit: 1000
      });

      expect(apiKey).toMatch(/^ak_[a-zA-Z0-9]{32}$/);
    });

    test('should support webhook notifications', async () => {
      const webhook = {
        url: 'https://tenant.com/webhook',
        events: ['anomaly_detected', 'report_generated'],
        secret: 'webhook-secret'
      };

      await analyticsService.registerWebhook(webhook);

      // Trigger an event
      await analyticsService.detectAnomalies();

      expect(analyticsService.sendWebhook).toHaveBeenCalledWith(
        webhook.url,
        expect.objectContaining({ event: 'anomaly_detected' })
      );
    });
  });

  describe('Analytics Service - Full Coverage', () => {
    test('should handle timezone conversions', () => {
      const utcDate = new Date('2024-01-01T12:00:00Z');
      const localDate = analyticsService.convertToTimezone(utcDate, 'Africa/Nairobi');
      
      expect(localDate.getHours()).toBe(15); // UTC+3
    });

    test('should calculate cohort retention', async () => {
      const retention = await analyticsService.calculateCohortRetention({
        cohortPeriod: 'weekly',
        retentionPeriod: 'daily',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-02-01')
      });

      expect(retention).toHaveProperty('cohorts');
      expect(retention.cohorts[0]).toHaveProperty('retentionRates');
    });

    test('should perform funnel analysis', async () => {
      const funnel = await analyticsService.analyzeFunnel({
        steps: [
          { event: 'page_view', property: 'page', value: '/products' },
          { event: 'add_to_cart' },
          { event: 'checkout' },
          { event: 'purchase' }
        ],
        timeWindow: '1 hour'
      });

      expect(funnel).toHaveProperty('conversionRates');
      expect(funnel).toHaveProperty('dropoffRates');
      expect(funnel).toHaveProperty('averageTime');
    });

    test('should segment users', async () => {
      const segments = await analyticsService.segmentUsers({
        criteria: [
          { property: 'total_orders', operator: '>', value: 5 },
          { property: 'last_order_days_ago', operator: '<', value: 30 }
        ]
      });

      expect(segments).toHaveProperty('segments');
      expect(segments.segments[0]).toHaveProperty('userCount');
      expect(segments.segments[0]).toHaveProperty('characteristics');
    });

    test('should forecast metrics', async () => {
      const forecast = await analyticsService.forecastMetric({
        metric: 'daily_revenue',
        method: 'arima',
        periods: 30,
        confidence: 0.95
      });

      expect(forecast).toHaveProperty('predictions');
      expect(forecast).toHaveProperty('upperBound');
      expect(forecast).toHaveProperty('lowerBound');
      expect(forecast.predictions).toHaveLength(30);
    });
  });
});