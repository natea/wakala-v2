import Redis from 'ioredis';
import { randomBytes } from 'crypto';

export interface ApiKeyConfig {
  redis: string;
}

export interface CreateKeyOptions {
  tenantId: string;
  name: string;
  scopes: string[];
  expiresIn?: number;
}

export interface ApiKeyResponse {
  id: string;
  key: string;
  name: string;
  tenantId: string;
  scopes: string[];
  createdAt: Date;
  expiresAt?: Date;
}

export interface RotateKeyResponse {
  newKey: string;
  oldKeyExpiresAt: Date;
}

export class ApiKeyManager {
  private redis: Redis;

  constructor(config: ApiKeyConfig) {
    this.redis = new Redis(config.redis);
  }

  public async createKey(options: CreateKeyOptions): Promise<ApiKeyResponse> {
    const key = this.generateApiKey();
    const id = `key-${Date.now()}-${randomBytes(4).toString('hex')}`;
    
    const keyData = {
      id,
      key,
      name: options.name,
      tenantId: options.tenantId,
      scopes: options.scopes,
      createdAt: new Date(),
      expiresAt: options.expiresIn ? new Date(Date.now() + options.expiresIn) : undefined
    };

    // Store in Redis
    await this.redis.setex(
      `api_key:${key}`,
      options.expiresIn || 86400 * 365, // 1 year default
      JSON.stringify(keyData)
    );

    // Store reverse lookup
    await this.redis.setex(
      `api_key_id:${id}`,
      options.expiresIn || 86400 * 365,
      key
    );

    return keyData;
  }

  public async rotateKey(keyId: string): Promise<RotateKeyResponse> {
    // Get old key
    const oldKey = await this.redis.get(`api_key_id:${keyId}`);
    if (!oldKey) {
      throw new Error('API key not found');
    }

    const oldKeyData = await this.redis.get(`api_key:${oldKey}`);
    if (!oldKeyData) {
      throw new Error('API key data not found');
    }

    const data = JSON.parse(oldKeyData);
    
    // Create new key
    const newKey = await this.createKey({
      tenantId: data.tenantId,
      name: data.name,
      scopes: data.scopes
    });

    // Set expiration on old key (24 hours grace period)
    const gracePeriod = 24 * 60 * 60; // 24 hours
    await this.redis.expire(`api_key:${oldKey}`, gracePeriod);

    return {
      newKey: newKey.key,
      oldKeyExpiresAt: new Date(Date.now() + gracePeriod * 1000)
    };
  }

  public async revokeKey(keyId: string): Promise<void> {
    const key = await this.redis.get(`api_key_id:${keyId}`);
    if (!key) {
      throw new Error('API key not found');
    }

    // Delete both entries
    await this.redis.del(`api_key:${key}`);
    await this.redis.del(`api_key_id:${keyId}`);
  }

  public async getKeyInfo(key: string): Promise<ApiKeyResponse | null> {
    const data = await this.redis.get(`api_key:${key}`);
    if (!data) return null;

    return JSON.parse(data);
  }

  public async validateScopes(key: string, requiredScopes: string[]): Promise<boolean> {
    const keyInfo = await this.getKeyInfo(key);
    if (!keyInfo) return false;

    return requiredScopes.every(scope => keyInfo.scopes.includes(scope));
  }

  private generateApiKey(): string {
    const prefix = 'wk';
    const randomPart = randomBytes(32).toString('hex');
    return `${prefix}_${randomPart}`;
  }
}