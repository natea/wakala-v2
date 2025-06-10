import { Request, Response } from 'express';
import { register, Counter, Histogram, Gauge } from 'prom-client';

export class MetricsCollector {
  private httpRequestsTotal: Counter;
  private httpRequestDuration: Histogram;
  private httpRequestSize: Histogram;
  private httpResponseSize: Histogram;
  private activeConnections: Gauge;

  constructor() {
    // Clear any existing metrics
    register.clear();

    // Define metrics
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'path', 'status']
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latencies in seconds',
      labelNames: ['method', 'path', 'status'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
    });

    this.httpRequestSize = new Histogram({
      name: 'http_request_size_bytes',
      help: 'HTTP request sizes in bytes',
      labelNames: ['method', 'path'],
      buckets: [100, 1000, 10000, 100000, 1000000]
    });

    this.httpResponseSize = new Histogram({
      name: 'http_response_size_bytes',
      help: 'HTTP response sizes in bytes',
      labelNames: ['method', 'path', 'status'],
      buckets: [100, 1000, 10000, 100000, 1000000]
    });

    this.activeConnections = new Gauge({
      name: 'http_active_connections',
      help: 'Number of active HTTP connections'
    });

    // Register metrics
    register.registerMetric(this.httpRequestsTotal);
    register.registerMetric(this.httpRequestDuration);
    register.registerMetric(this.httpRequestSize);
    register.registerMetric(this.httpResponseSize);
    register.registerMetric(this.activeConnections);
  }

  public recordRequest(req: Request): void {
    this.activeConnections.inc();
    
    const size = parseInt(req.headers['content-length'] || '0', 10);
    if (size > 0) {
      this.httpRequestSize.observe(
        { method: req.method, path: this.normalizePath(req.path) },
        size
      );
    }
  }

  public recordResponse(req: Request, res: Response, duration: number): void {
    const labels = {
      method: req.method,
      path: this.normalizePath(req.path),
      status: res.statusCode.toString()
    };

    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, duration / 1000); // Convert to seconds

    const size = parseInt(res.getHeader('content-length') as string || '0', 10);
    if (size > 0) {
      this.httpResponseSize.observe(labels, size);
    }

    this.activeConnections.dec();
  }

  public getMetrics(): string {
    return register.metrics();
  }

  public get contentType(): string {
    return register.contentType;
  }

  private normalizePath(path: string): string {
    // Normalize paths to avoid high cardinality
    return path
      .replace(/\/\d+/g, '/:id') // Replace numeric IDs
      .replace(/\/[a-f0-9-]{36}/g, '/:uuid') // Replace UUIDs
      .replace(/\?.*$/, ''); // Remove query strings
  }

  public reset(): void {
    register.clear();
  }
}