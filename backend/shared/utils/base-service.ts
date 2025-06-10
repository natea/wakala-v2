import express, { Application, Request, Response, NextFunction } from 'express';
import { Server } from 'http';
import winston from 'winston';
import { register, collectDefaultMetrics, Counter, Histogram } from 'prom-client';
import { z } from 'zod';

// Service configuration schema
const ServiceConfigSchema = z.object({
  name: z.string(),
  port: z.number().min(1).max(65535),
  version: z.string().default('1.0.0'),
  environment: z.enum(['development', 'staging', 'production']).default('development'),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;

// Base error class
export class ServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ServiceError';
    Error.captureStackTrace(this, this.constructor);
  }
}

// Metrics
const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
});

const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

export abstract class BaseService {
  protected app: Application;
  protected server: Server | null = null;
  protected logger: winston.Logger;
  protected config: ServiceConfig;
  private shutdownHandlers: Array<() => Promise<void>> = [];

  constructor(config: ServiceConfig) {
    this.config = ServiceConfigSchema.parse(config);
    this.app = express();
    this.logger = this.createLogger();
    this.setupBaseMiddleware();
    this.setupMetrics();
    this.setupGracefulShutdown();
  }

  private createLogger(): winston.Logger {
    return winston.createLogger({
      level: this.config.logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      defaultMeta: {
        service: this.config.name,
        environment: this.config.environment,
        version: this.config.version,
      },
      transports: [
        new winston.transports.Console({
          format:
            this.config.environment === 'development'
              ? winston.format.combine(winston.format.colorize(), winston.format.simple())
              : winston.format.json(),
        }),
      ],
    });
  }

  private setupBaseMiddleware(): void {
    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request ID middleware
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      req.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      next();
    });

    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        this.logger.info('HTTP Request', {
          requestId: req.id,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });

        // Record metrics
        const route = req.route?.path || 'unknown';
        const labels = {
          method: req.method,
          route,
          status_code: res.statusCode.toString(),
        };
        httpRequestDuration.observe(labels, duration / 1000);
        httpRequestTotal.inc(labels);
      });

      next();
    });

    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'healthy',
        service: this.config.name,
        version: this.config.version,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    });

    // Readiness check endpoint
    this.app.get('/ready', async (_req: Request, res: Response) => {
      try {
        const isReady = await this.checkReadiness();
        if (isReady) {
          res.json({ status: 'ready' });
        } else {
          res.status(503).json({ status: 'not ready' });
        }
      } catch (error) {
        res.status(503).json({ status: 'not ready', error: String(error) });
      }
    });
  }

  private setupMetrics(): void {
    collectDefaultMetrics({ prefix: `${this.config.name}_` });

    this.app.get('/metrics', async (_req: Request, res: Response) => {
      try {
        res.set('Content-Type', register.contentType);
        const metrics = await register.metrics();
        res.end(metrics);
      } catch (error) {
        res.status(500).end();
      }
    });
  }

  private setupGracefulShutdown(): void {
    const gracefulShutdown = async (signal: string): Promise<void> => {
      this.logger.info(`Received ${signal}, starting graceful shutdown...`);

      // Stop accepting new connections
      if (this.server) {
        this.server.close(() => {
          this.logger.info('HTTP server closed');
        });
      }

      // Run custom shutdown handlers
      try {
        await Promise.all(this.shutdownHandlers.map((handler) => handler()));
      } catch (error) {
        this.logger.error('Error during shutdown', { error });
      }

      // Force exit after timeout
      setTimeout(() => {
        this.logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }

  protected addShutdownHandler(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }

  protected setupErrorHandling(): void {
    // 404 handler
    this.app.use((_req: Request, res: Response) => {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      });
    });

    // Global error handler
    this.app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
      this.logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        requestId: req.id,
        method: req.method,
        path: req.path,
      });

      if (err instanceof ServiceError) {
        res.status(err.statusCode).json({
          error: {
            code: err.code || 'INTERNAL_ERROR',
            message: err.message,
            details: err.details,
            requestId: req.id,
          },
        });
      } else {
        res.status(500).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
            requestId: req.id,
          },
        });
      }
    });
  }

  public async start(): Promise<void> {
    try {
      await this.initialize();
      this.setupRoutes();
      this.setupErrorHandling();

      this.server = this.app.listen(this.config.port, () => {
        this.logger.info(`${this.config.name} started`, {
          port: this.config.port,
          environment: this.config.environment,
          version: this.config.version,
        });
      });
    } catch (error) {
      this.logger.error('Failed to start service', { error });
      throw error;
    }
  }

  // Abstract methods to be implemented by derived services
  protected abstract initialize(): Promise<void>;
  protected abstract setupRoutes(): void;
  protected abstract checkReadiness(): Promise<boolean>;
}

// Request type augmentation
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}