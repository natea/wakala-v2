import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import { TenantService } from '../services/tenant.service';
import { Tenant, TenantStatus, ResourceType } from '../interfaces/tenant.interface';
import { 
  TenantError, 
  TenantNotFoundError, 
  ResourceLimitExceededError 
} from '../errors/tenant.errors';

// Extend Express Request type to include tenant
declare global {
  namespace Express {
    interface Request {
      tenant?: Tenant;
      tenantId?: string;
    }
  }
}

interface TenantContext {
  tenant: Tenant;
  tenantId: string;
}

export class TenantMiddleware {
  private static tenantContext = new AsyncLocalStorage<TenantContext>();

  constructor(private tenantService: TenantService) {}

  /**
   * Extract tenant from request (subdomain or header)
   */
  async extractTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let tenant: Tenant | null = null;

      // Try to extract from subdomain first
      if (req.subdomains.length > 0) {
        const subdomain = req.subdomains[0];
        tenant = await this.tenantService.getTenantBySubdomain(subdomain);
      }
      // Fallback to header
      else if (req.headers['x-tenant-id']) {
        const tenantId = req.headers['x-tenant-id'] as string;
        tenant = await this.tenantService.getTenant(tenantId);
      }

      if (!tenant) {
        return res.status(400).json({
          error: 'Tenant identification required',
          code: 'TENANT_REQUIRED'
        });
      }

      // Attach tenant to request
      req.tenant = tenant;
      req.tenantId = tenant.id;

      next();
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        return res.status(404).json({
          error: error.message,
          code: error.code
        });
      }

      return res.status(500).json({
        error: 'Failed to extract tenant',
        code: 'TENANT_EXTRACTION_FAILED'
      });
    }
  }

  /**
   * Ensure tenant is active before allowing access
   */
  async requireActiveTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!req.tenant) {
      return res.status(401).json({
        error: 'Tenant context not found',
        code: 'NO_TENANT_CONTEXT'
      });
    }

    if (req.tenant.status !== TenantStatus.ACTIVE) {
      return res.status(403).json({
        error: 'Tenant is not active',
        code: 'TENANT_NOT_ACTIVE',
        status: req.tenant.status
      });
    }

    next();
  }

  /**
   * Inject tenant context into async local storage
   */
  async injectTenantContext(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!req.tenant) {
      return next();
    }

    const context: TenantContext = {
      tenant: req.tenant,
      tenantId: req.tenant.id
    };

    TenantMiddleware.tenantContext.run(context, () => {
      next();
    });
  }

  /**
   * Validate resource limits before allowing resource creation
   */
  validateTenantResource(resourceType: ResourceType, amount: number = 1) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      if (!req.tenant) {
        return res.status(401).json({
          error: 'Tenant context not found',
          code: 'NO_TENANT_CONTEXT'
        });
      }

      try {
        await this.tenantService.checkResourceLimit(req.tenant.id, resourceType, amount);
        next();
      } catch (error) {
        if (error instanceof ResourceLimitExceededError) {
          const match = error.message.match(/Limit: (\d+), Requested: (\d+)/);
          const limit = match ? parseInt(match[1]) : 0;
          const requested = match ? parseInt(match[2]) : 0;

          return res.status(403).json({
            error: error.message,
            code: error.code,
            resource: resourceType,
            limit,
            requested
          });
        }

        return res.status(500).json({
          error: 'Failed to validate resource limit',
          code: 'RESOURCE_VALIDATION_FAILED'
        });
      }
    };
  }

  /**
   * Get current tenant context from async local storage
   */
  static getCurrentTenant(): TenantContext | undefined {
    return this.tenantContext.getStore();
  }

  /**
   * Get current tenant ID from context
   */
  static getCurrentTenantId(): string | undefined {
    return this.tenantContext.getStore()?.tenantId;
  }
}