export enum TenantStatus {
  PROVISIONING = 'PROVISIONING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  INACTIVE = 'INACTIVE',
  FAILED = 'FAILED'
}

export enum TenantPlan {
  STARTER = 'STARTER',
  PROFESSIONAL = 'PROFESSIONAL',
  ENTERPRISE = 'ENTERPRISE'
}

export interface ResourceLimits {
  maxUsers: number;
  maxOrders: number;
  maxProducts: number;
  storageGB: number;
}

export interface ResourceUsage {
  users: number;
  orders: number;
  products: number;
  storageGB: number;
}

export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  adminEmail: string;
  plan: TenantPlan;
  status: TenantStatus;
  resourceLimits: ResourceLimits;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

export interface CreateTenantDto {
  name: string;
  subdomain: string;
  adminEmail: string;
  plan: TenantPlan;
}

export interface UpdateTenantDto {
  name?: string;
  plan?: TenantPlan;
  adminEmail?: string;
  metadata?: Record<string, any>;
}

export type ResourceType = keyof ResourceUsage;