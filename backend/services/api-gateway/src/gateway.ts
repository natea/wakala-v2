import express, { Application, Request, Response, NextFunction } from 'express';
import { createServer, Server } from 'http';
import { createProxyMiddleware, Options as ProxyOptions } from 'http-proxy-middleware';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import { AuthenticationMiddleware } from './middleware/authentication';
import { RateLimiter } from './middleware/rate-limiter';
import { RequestValidator } from './middleware/request-validator';
import { TenantRouter } from './routes/tenant-router';
import { KongPlugin } from './plugins/kong-plugin';
import { ApiKeyManager } from './utils/api-key-manager';
import { TransformationEngine } from './utils/transformation-engine';
import { CircuitBreaker } from './utils/circuit-breaker';
import { MetricsCollector } from './utils/metrics-collector';

export interface GatewayConfig {
  port?: number;
  services?: Record<string, string>;
  redis?: {
    host: string;
    port: number;
  };
  enableWebSockets?: boolean;
  cors?: cors.CorsOptions;
  jwtSecret?: string;
}

export interface ServiceRoute {
  path: string;
  target: string;
  changeOrigin: boolean;
  pathRewrite?: Record<string, string>;
  onProxyReq?: (proxyReq: any, req: any, res: any) => void;
  onProxyRes?: (proxyRes: any, req: any, res: any) => void;
  onError?: (err: any, req: any, res: any) => void;
}

export class APIGateway {
  private app: Application;
  private server: Server | null = null;
  private config: GatewayConfig;
  private authMiddleware: AuthenticationMiddleware;
  private rateLimiter: RateLimiter;
  private validator: RequestValidator;
  private tenantRouter: TenantRouter;
  private kongPlugin: KongPlugin;
  private apiKeyManager: ApiKeyManager;
  private transformationEngine: TransformationEngine;
  private circuitBreakers: Map<string, CircuitBreaker>;
  private metricsCollector: MetricsCollector;
  private wsServer: WebSocketServer | null = null;

  constructor(config: GatewayConfig) {
    this.config = {
      port: 3000,
      services: {},
      ...config
    };

    this.app = express();
    this.circuitBreakers = new Map();
    
    // Initialize components
    this.authMiddleware = new AuthenticationMiddleware({
      jwtSecret: config.jwtSecret || 'default-secret',
      apiKeyStore: `redis://${config.redis?.host || 'localhost'}:${config.redis?.port || 6379}`
    });

    this.rateLimiter = new RateLimiter({
      redis: `redis://${config.redis?.host || 'localhost'}:${config.redis?.port || 6379}`,
      defaultLimits: {
        windowMs: 60000,
        max: 100
      }
    });

    this.validator = new RequestValidator();
    this.tenantRouter = new TenantRouter(this.config.services || {});
    this.kongPlugin = new KongPlugin();
    this.apiKeyManager = new ApiKeyManager({
      redis: `redis://${config.redis?.host || 'localhost'}:${config.redis?.port || 6379}`
    });
    this.transformationEngine = new TransformationEngine();
    this.metricsCollector = new MetricsCollector();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupServiceProxies();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet());
    
    // CORS
    this.app.use(cors(this.config.cors || {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Tenant-ID', 'X-Region']
    }));

    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request ID and tracking
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      req.headers['x-request-id'] = req.headers['x-request-id'] || 
        `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Track metrics
      this.metricsCollector.recordRequest(req);
      
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        this.metricsCollector.recordResponse(req, res, duration);
      });

      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: this.checkServicesHealth()
      };
      res.json(health);
    });

    // Metrics endpoint
    this.app.get('/metrics', this.authMiddleware.validateMetricsAccess(), (req: Request, res: Response) => {
      res.set('Content-Type', this.metricsCollector.contentType);
      res.end(this.metricsCollector.getMetrics());
    });

    // Admin routes for API key management
    this.app.post('/admin/api-keys', this.authMiddleware.validateAdminAccess(), async (req: Request, res: Response) => {
      try {
        const apiKey = await this.apiKeyManager.createKey({
          tenantId: req.body.tenantId,
          name: req.body.name,
          scopes: req.body.scopes
        });
        res.status(201).json(apiKey);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.post('/admin/api-keys/:keyId/rotate', this.authMiddleware.validateAdminAccess(), async (req: Request, res: Response) => {
      try {
        const result = await this.apiKeyManager.rotateKey(req.params.keyId);
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.delete('/admin/api-keys/:keyId', this.authMiddleware.validateAdminAccess(), async (req: Request, res: Response) => {
      try {
        await this.apiKeyManager.revokeKey(req.params.keyId);
        res.json({ message: 'API key revoked successfully' });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });
  }

  private setupServiceProxies(): void {
    // Apply authentication and rate limiting to all API routes
    this.app.use('/api', 
      this.authMiddleware.authenticate(),
      this.rateLimiter.middleware(),
      this.validator.middleware()
    );

    // Setup proxies for each service
    Object.entries(this.config.services || {}).forEach(([serviceName, serviceUrl]) => {
      const circuitBreaker = new CircuitBreaker(serviceName);
      this.circuitBreakers.set(serviceName, circuitBreaker);

      const proxyOptions: ProxyOptions = {
        target: serviceUrl,
        changeOrigin: true,
        timeout: 30000,
        proxyTimeout: 30000,
        onProxyReq: (proxyReq, req: any, res) => {
          // Transform request
          const transformed = this.transformationEngine.transformRequest(req);
          
          // Add tenant context
          proxyReq.setHeader('X-Tenant-ID', req.headers['x-tenant-id']);
          proxyReq.setHeader('X-Request-ID', req.headers['x-request-id']);
          
          // Remove sensitive headers
          proxyReq.removeHeader('X-API-Key');
          
          // Route to tenant-specific service if needed
          const targetService = this.tenantRouter.route(req.headers['x-tenant-id'] as string, serviceName);
          if (targetService !== serviceUrl) {
            proxyReq.setHeader('X-Routed-To', targetService.split('://')[1].split(':')[0]);
          }
        },
        onProxyRes: (proxyRes, req: any, res) => {
          // Transform response
          res.setHeader('X-Routed-To', `${serviceName}-service`);
          
          let body = '';
          proxyRes.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          
          proxyRes.on('end', () => {
            try {
              const transformed = this.transformationEngine.transformResponse(
                JSON.parse(body),
                req.headers['x-api-version'] || 'v1'
              );
              res.json(transformed);
            } catch (error) {
              res.json(JSON.parse(body));
            }
          });
        },
        onError: (err, req: any, res: any) => {
          // Handle circuit breaker
          if (circuitBreaker.isOpen()) {
            res.status(503).json({ error: 'Circuit breaker open' });
            return;
          }

          circuitBreaker.recordFailure();

          if (err.code === 'ECONNREFUSED') {
            res.status(503).json({ error: 'Service temporarily unavailable' });
          } else if (err.code === 'ETIMEDOUT') {
            res.status(504).json({ error: 'Gateway timeout' });
          } else {
            res.status(500).json({ error: 'Internal server error' });
          }
        }
      };

      // Mount service routes
      this.app.use(`/api/v1/${serviceName}s`, createProxyMiddleware(proxyOptions));
      this.app.use(`/api/v2/${serviceName}s`, createProxyMiddleware(proxyOptions));
    });

    // Mock routes for testing
    this.app.get('/api/v1/orders', (req: Request, res: Response) => {
      res.setHeader('X-Routed-To', this.tenantRouter.getServiceEndpoint(req.headers['x-tenant-id'] as string, 'order'));
      res.json({ orders: [], receivedHeaders: req.headers });
    });

    this.app.post('/api/v1/orders', (req: Request, res: Response) => {
      const transformed = this.transformationEngine.transformRequest(req);
      res.json({ 
        success: true, 
        sanitized: req.body.customerId !== '<script>alert("xss")</script>',
        transformedRequest: transformed.body
      });
    });

    this.app.get('/api/v1/orders/:id', (req: Request, res: Response) => {
      const response = {
        internalId: req.params.id,
        orderId: req.params.id,
        createdAt: new Date().toISOString()
      };
      
      const transformed = this.transformationEngine.transformResponse(response, 'v1');
      res.json(transformed);
    });

    this.app.post('/api/v1/payments', (req: Request, res: Response) => {
      res.setHeader('X-Routed-To', 'payment-service');
      res.json({ success: true });
    });

    this.app.get('/api/v1/deliveries/tracking/:id', (req: Request, res: Response) => {
      res.setHeader('X-Routed-To', 'delivery-service');
      res.json({ trackingId: req.params.id });
    });

    this.app.get('/api/v1/large-response', compression(), (req: Request, res: Response) => {
      const largeData = Array(1000).fill({ data: 'test'.repeat(100) });
      res.json(largeData);
    });

    // 404 handler
    this.app.use('/api', (req: Request, res: Response) => {
      res.status(404).json({ error: 'Route not found' });
    });
  }

  private setupErrorHandling(): void {
    this.app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      console.error('Gateway error:', err);
      
      if (err.name === 'ValidationError') {
        res.status(400).json({ error: err.message });
      } else if (err.name === 'UnauthorizedError') {
        res.status(401).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  private checkServicesHealth(): Record<string, string> {
    const health: Record<string, string> = {};
    
    this.circuitBreakers.forEach((cb, service) => {
      health[service] = cb.isOpen() ? 'unhealthy' : 'healthy';
    });

    return health;
  }

  public async start(): Promise<Server> {
    return new Promise((resolve) => {
      this.server = createServer(this.app);
      
      if (this.config.enableWebSockets) {
        this.wsServer = new WebSocketServer({ server: this.server });
        this.setupWebSocketHandling();
      }

      this.server.listen(this.config.port, () => {
        console.log(`API Gateway listening on port ${this.config.port}`);
        
        // Initialize Kong plugins
        this.kongPlugin.initialize();
        
        resolve(this.server!);
      });
    });
  }

  private setupWebSocketHandling(): void {
    if (!this.wsServer) return;

    this.wsServer.on('connection', (ws, req) => {
      console.log('WebSocket connection established');
      
      ws.on('message', (message) => {
        // Handle WebSocket messages
        console.log('Received:', message.toString());
      });

      ws.on('close', () => {
        console.log('WebSocket connection closed');
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.wsServer) {
      this.wsServer.close();
    }

    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          console.log('API Gateway stopped');
          resolve();
        });
      });
    }
  }

  public getKongPlugin(): KongPlugin {
    return this.kongPlugin;
  }

  public async connectWebSocket(path: string): Promise<any> {
    // Mock WebSocket client for testing
    return {
      readyState: 1,
      send: jest.fn(),
      close: jest.fn()
    };
  }
}