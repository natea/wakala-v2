import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

export interface RateLimiterConfig {
  redis: string;
  defaultLimits: {
    windowMs: number;
    max: number;
  };
}

export interface RateLimit {
  windowMs: number;
  max: number;
}

export class RateLimiter {
  private redis: Redis;
  private config: RateLimiterConfig;
  private limits: RateLimit;

  constructor(config: RateLimiterConfig) {
    this.config = config;
    this.redis = new Redis(config.redis);
    this.limits = config.defaultLimits;
  }

  public middleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const key = req.headers['x-api-key'] as string || req.ip;
      const tenantId = req.headers['x-tenant-id'] as string;

      // Get tenant-specific limits
      const limits = await this.getTenantLimits(tenantId);
      
      const allowed = await this.checkLimit(key, limits);
      
      if (!allowed) {
        res.setHeader('X-RateLimit-Limit', limits.max.toString());
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', new Date(Date.now() + limits.windowMs).toISOString());
        
        return res.status(429).json({ error: 'Rate limit exceeded' });
      }

      // Set rate limit headers
      const count = await this.getCount(key);
      res.setHeader('X-RateLimit-Limit', limits.max.toString());
      res.setHeader('X-RateLimit-Remaining', Math.max(0, limits.max - count).toString());
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + limits.windowMs).toISOString());

      next();
    };
  }

  public async checkLimit(key: string, customLimits?: RateLimit): Promise<boolean> {
    const limits = customLimits || this.limits;
    const redisKey = `rate_limit:${key}`;
    
    const current = await this.redis.incr(redisKey);
    
    if (current === 1) {
      await this.redis.expire(redisKey, Math.ceil(limits.windowMs / 1000));
    }

    return current <= limits.max;
  }

  public async getCount(key: string): Promise<number> {
    const redisKey = `rate_limit:${key}`;
    const count = await this.redis.get(redisKey);
    return parseInt(count || '0', 10);
  }

  public withLimits(limits: RateLimit): RateLimiter {
    const newLimiter = Object.create(this);
    newLimiter.limits = limits;
    return newLimiter;
  }

  private async getTenantLimits(tenantId: string): Promise<RateLimit> {
    // Premium tenants get higher limits
    if (tenantId === 'premium-tenant') {
      return {
        windowMs: 60000,
        max: 1000
      };
    }

    // Default limits
    return this.limits;
  }
}