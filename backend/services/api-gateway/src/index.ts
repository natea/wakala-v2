import { APIGateway } from './gateway';

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  services: {
    order: process.env.ORDER_SERVICE_URL || 'http://order-service:3001',
    payment: process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3002',
    delivery: process.env.DELIVERY_SERVICE_URL || 'http://delivery-service:3003',
    whatsapp: process.env.WHATSAPP_SERVICE_URL || 'http://whatsapp-service:3004',
    analytics: process.env.ANALYTICS_SERVICE_URL || 'http://analytics-service:3005'
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10)
  },
  jwtSecret: process.env.JWT_SECRET || 'default-jwt-secret',
  enableWebSockets: process.env.ENABLE_WEBSOCKETS === 'true',
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    credentials: true
  }
};

const gateway = new APIGateway(config);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing API Gateway');
  await gateway.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing API Gateway');
  await gateway.stop();
  process.exit(0);
});

// Start the gateway
gateway.start().catch((error) => {
  console.error('Failed to start API Gateway:', error);
  process.exit(1);
});