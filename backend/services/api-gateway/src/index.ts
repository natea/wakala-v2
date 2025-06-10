import { BaseService, ServiceConfig } from '@shared/utils';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';

class ApiGatewayService extends BaseService {
  constructor() {
    const config: ServiceConfig = {
      name: 'api-gateway',
      port: parseInt(process.env.PORT || '3001', 10),
      version: '1.0.0',
      environment: (process.env.NODE_ENV as 'development' | 'staging' | 'production') || 'development',
      logLevel: (process.env.LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug') || 'info',
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    // Initialize service dependencies
    this.logger.info('Initializing API Gateway...');
    
    // Setup security middleware
    this.app.use(helmet());
    
    // Setup CORS
    const corsOptions = {
      origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true,
    };
    this.app.use(cors(corsOptions));
    
    // Setup rate limiting
    const limiter = rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api/', limiter);
  }

  protected setupRoutes(): void {
    const apiPrefix = process.env.API_PREFIX || '/api/v1';
    
    // Service proxies
    const services = [
      { path: '/whatsapp', target: 'http://whatsapp-service:3002' },
      { path: '/orders', target: 'http://order-service:3003' },
      { path: '/payments', target: 'http://payment-service:3004' },
      { path: '/delivery', target: 'http://delivery-service:3005' },
      { path: '/analytics', target: 'http://analytics-service:3006' },
      { path: '/tenants', target: 'http://multi-tenant-service:3007' },
    ];
    
    services.forEach(({ path, target }) => {
      this.app.use(
        `${apiPrefix}${path}`,
        createProxyMiddleware({
          target,
          changeOrigin: true,
          pathRewrite: { [`^${apiPrefix}${path}`]: '' },
          onError: (err, req, res) => {
            this.logger.error('Proxy error', { 
              error: err.message, 
              path: req.path,
              target 
            });
            res.status(502).json({ 
              error: { 
                code: 'SERVICE_UNAVAILABLE', 
                message: 'Service temporarily unavailable' 
              } 
            });
          },
        }),
      );
    });
    
    // API documentation endpoint
    this.app.get(`${apiPrefix}/docs`, (_req, res) => {
      res.json({
        openapi: '3.0.0',
        info: {
          title: 'Wakala API',
          version: this.config.version,
          description: 'Multi-tenant WhatsApp-based marketplace platform',
        },
        servers: [
          {
            url: `${process.env.API_URL || 'http://localhost:3001'}${apiPrefix}`,
          },
        ],
        paths: {},
      });
    });
  }

  protected async checkReadiness(): Promise<boolean> {
    // Check if dependent services are reachable
    // In a real implementation, you would check actual service health
    return true;
  }
}

// Start the service
const service = new ApiGatewayService();
service.start().catch((error) => {
  console.error('Failed to start API Gateway:', error);
  process.exit(1);
});