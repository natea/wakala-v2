import express, { Application } from 'express';
import { createServer, Server } from 'http';

export interface GatewayConfig {
  port?: number;
  services?: Record<string, string>;
  redis?: {
    host: string;
    port: number;
  };
  enableWebSockets?: boolean;
  cors?: any;
  jwtSecret?: string;
}

export class APIGateway {
  private app: Application;
  private server: Server | null = null;
  private config: GatewayConfig;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
  }

  private setupRoutes(): void {
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', service: 'api-gateway' });
    });
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer(this.app);
      this.server.listen(this.config.port || 3001, () => {
        console.log(`API Gateway listening on port ${this.config.port || 3001}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('API Gateway stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}