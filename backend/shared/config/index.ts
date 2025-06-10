import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Environment schema
const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  
  // Database
  DB_HOST: z.string(),
  DB_PORT: z.string().transform(Number),
  DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  
  // Redis
  REDIS_URL: z.string(),
  
  // RabbitMQ
  RABBITMQ_URL: z.string(),
  
  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRY: z.string().default('30d'),
  
  // WhatsApp
  WHATSAPP_API_URL: z.string().url(),
  WHATSAPP_BUSINESS_ID: z.string(),
  WHATSAPP_PHONE_NUMBER_ID: z.string(),
  WHATSAPP_ACCESS_TOKEN: z.string(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string(),
  
  // API
  API_PREFIX: z.string().default('/api/v1'),
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),
  
  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

// Parse and validate environment variables
export const config = EnvironmentSchema.parse(process.env);

// Export specific configurations
export const databaseConfig = {
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
};

export const redisConfig = {
  url: config.REDIS_URL,
};

export const rabbitMQConfig = {
  url: config.RABBITMQ_URL,
};

export const jwtConfig = {
  secret: config.JWT_SECRET,
  expiry: config.JWT_EXPIRY,
  refreshSecret: config.JWT_REFRESH_SECRET,
  refreshExpiry: config.JWT_REFRESH_EXPIRY,
};

export const whatsappConfig = {
  apiUrl: config.WHATSAPP_API_URL,
  businessId: config.WHATSAPP_BUSINESS_ID,
  phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
  accessToken: config.WHATSAPP_ACCESS_TOKEN,
  webhookVerifyToken: config.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
};