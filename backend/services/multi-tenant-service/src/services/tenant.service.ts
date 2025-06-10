import { v4 as uuidv4 } from 'uuid';
import { TenantRepository } from '../repositories/tenant.repository';
import {
  Tenant,
  TenantStatus,
  TenantPlan,
  CreateTenantDto,
  UpdateTenantDto,
  ResourceLimits,
  ResourceType
} from '../interfaces/tenant.interface';
import {
  TenantAlreadyExistsError,
  TenantNotFoundError,
  ResourceLimitExceededError,
  TenantProvisioningError
} from '../errors/tenant.errors';

export class TenantService {
  private readonly resourceLimitsByPlan: Record<TenantPlan, ResourceLimits> = {
    [TenantPlan.STARTER]: {
      maxUsers: 10,
      maxOrders: 1000,
      maxProducts: 100,
      storageGB: 5
    },
    [TenantPlan.PROFESSIONAL]: {
      maxUsers: 50,
      maxOrders: 10000,
      maxProducts: 1000,
      storageGB: 50
    },
    [TenantPlan.ENTERPRISE]: {
      maxUsers: -1, // unlimited
      maxOrders: -1,
      maxProducts: -1,
      storageGB: 500
    }
  };

  private readonly coreTables = [
    'users',
    'orders',
    'products',
    'vendors',
    'conversations'
  ];

  constructor(private tenantRepository: TenantRepository) {}

  async createTenant(data: CreateTenantDto): Promise<Tenant> {
    // Check if subdomain is already taken
    const existing = await this.tenantRepository.findBySubdomain(data.subdomain);
    if (existing) {
      throw new TenantAlreadyExistsError(data.subdomain);
    }

    // Create tenant with appropriate resource limits
    const resourceLimits = this.resourceLimitsByPlan[data.plan];
    
    const tenant: Partial<Tenant> = {
      id: uuidv4(),
      ...data,
      status: TenantStatus.ACTIVE,
      resourceLimits,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return await this.tenantRepository.create(tenant);
  }

  async getTenant(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findById(id);
    if (!tenant) {
      throw new TenantNotFoundError(id);
    }
    return tenant;
  }

  async updateTenant(id: string, data: UpdateTenantDto): Promise<Tenant> {
    const tenant = await this.tenantRepository.findById(id);
    if (!tenant) {
      throw new TenantNotFoundError(id);
    }

    const updateData: Partial<Tenant> = {
      ...data,
      updatedAt: new Date()
    };

    // If plan is updated, update resource limits
    if (data.plan && data.plan !== tenant.plan) {
      updateData.resourceLimits = this.resourceLimitsByPlan[data.plan];
    }

    return await this.tenantRepository.update(id, updateData);
  }

  async checkResourceLimit(
    tenantId: string,
    resource: ResourceType,
    requestedAmount: number
  ): Promise<boolean> {
    const tenant = await this.getTenant(tenantId);
    const usage = await this.tenantRepository.getResourceUsage(tenantId);
    
    const limit = tenant.resourceLimits[resource as keyof ResourceLimits];
    if (limit === -1) return true; // Unlimited

    const currentUsage = usage[resource];
    const totalAfterRequest = currentUsage + requestedAmount;

    if (totalAfterRequest > limit) {
      throw new ResourceLimitExceededError(resource, limit, totalAfterRequest);
    }

    return true;
  }

  async createRLSPolicy(tenantId: string, tableName: string): Promise<boolean> {
    await this.getTenant(tenantId); // Verify tenant exists
    return await this.tenantRepository.createRLSPolicy(tenantId, tableName);
  }

  async suspendTenant(tenantId: string): Promise<Tenant> {
    const tenant = await this.getTenant(tenantId);
    return await this.tenantRepository.update(tenantId, {
      status: TenantStatus.SUSPENDED
    });
  }

  async provisionTenant(tenantId: string): Promise<boolean> {
    try {
      const tenant = await this.getTenant(tenantId);
      
      // Create schema for tenant
      await this.tenantRepository.createSchema(tenantId);
      
      // Create RLS policies for all core tables
      for (const table of this.coreTables) {
        await this.tenantRepository.createRLSPolicy(tenantId, table);
      }

      // Update tenant status to active
      await this.tenantRepository.update(tenantId, {
        status: TenantStatus.ACTIVE
      });

      return true;
    } catch (error) {
      // Update status to failed
      await this.tenantRepository.update(tenantId, {
        status: TenantStatus.FAILED
      });
      throw error;
    }
  }

  async getTenantBySubdomain(subdomain: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findBySubdomain(subdomain);
    if (!tenant) {
      throw new TenantNotFoundError(subdomain);
    }
    return tenant;
  }
}