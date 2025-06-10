import { Request, Response, NextFunction } from 'express';
import Ajv from 'ajv';
import DOMPurify from 'isomorphic-dompurify';

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export class RequestValidator {
  private ajv: Ajv;

  constructor() {
    this.ajv = new Ajv({ allErrors: true });
  }

  public middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Validate required headers
      const headerValidation = this.validateHeaders(req.headers, ['x-tenant-id']);
      if (!headerValidation.valid) {
        return res.status(400).json({ error: headerValidation.errors![0] });
      }

      // Validate query parameters
      if (req.query.limit && isNaN(Number(req.query.limit))) {
        return res.status(400).json({ error: 'Invalid query parameter: limit must be a number' });
      }

      // Validate request body for POST/PUT requests
      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
        const bodyValidation = this.validateRequestBody(req);
        if (!bodyValidation.valid) {
          return res.status(400).json({ error: `Invalid request body: ${bodyValidation.errors![0]}` });
        }

        // Sanitize inputs
        req.body = this.sanitizeObject(req.body);
      }

      // Check for tenant isolation
      if (req.path.includes('/tenants/') && !this.checkTenantAccess(req)) {
        return res.status(403).json({ error: 'Access denied to tenant resources' });
      }

      next();
    };
  }

  public validateHeaders(headers: any, required: string[]): ValidationResult {
    const errors: string[] = [];

    for (const header of required) {
      if (!headers[header]) {
        errors.push(`Missing required header: ${header}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  public validateBody(data: any, schema: any): ValidationResult {
    const validate = this.ajv.compile(schema);
    const valid = validate(data);

    if (!valid) {
      const errors = validate.errors?.map(err => 
        `${err.instancePath} ${err.message}`
      ) || [];

      return {
        valid: false,
        errors
      };
    }

    return { valid: true };
  }

  public sanitize(input: string): string {
    return DOMPurify.sanitize(input, { ALLOWED_TAGS: [] });
  }

  private sanitizeObject(obj: any): any {
    if (typeof obj === 'string') {
      return this.sanitize(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = this.sanitizeObject(value);
      }
      return sanitized;
    }

    return obj;
  }

  private validateRequestBody(req: Request): ValidationResult {
    // Route-specific validation schemas
    const schemas: Record<string, any> = {
      '/api/v1/orders': {
        type: 'object',
        properties: {
          customerId: { type: 'string' },
          items: { 
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string' },
                quantity: { type: 'number' }
              },
              required: ['sku', 'quantity']
            }
          }
        },
        required: ['customerId', 'items']
      },
      '/api/v1/payments': {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          currency: { type: 'string' }
        },
        required: ['amount']
      }
    };

    const schema = schemas[req.path];
    if (!schema) {
      return { valid: true }; // No schema defined, pass through
    }

    return this.validateBody(req.body, schema);
  }

  private checkTenantAccess(req: Request): boolean {
    const tenantId = req.headers['x-tenant-id'] as string;
    const pathMatch = req.path.match(/\/tenants\/([^\/]+)/);
    
    if (pathMatch) {
      const pathTenantId = pathMatch[1];
      return pathTenantId === tenantId;
    }

    return true;
  }
}