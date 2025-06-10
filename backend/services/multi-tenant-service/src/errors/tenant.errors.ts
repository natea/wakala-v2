export class TenantError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class TenantAlreadyExistsError extends TenantError {
  constructor(subdomain: string) {
    super(`Tenant with subdomain '${subdomain}' already exists`, 'TENANT_EXISTS');
  }
}

export class TenantNotFoundError extends TenantError {
  constructor(identifier: string) {
    super(`Tenant not found: ${identifier}`, 'TENANT_NOT_FOUND');
  }
}

export class ResourceLimitExceededError extends TenantError {
  constructor(resource: string, limit: number, requested: number) {
    super(
      `Resource limit exceeded for ${resource}. Limit: ${limit}, Requested: ${requested}`,
      'RESOURCE_LIMIT_EXCEEDED'
    );
  }
}

export class TenantProvisioningError extends TenantError {
  constructor(tenantId: string, reason: string) {
    super(`Failed to provision tenant ${tenantId}: ${reason}`, 'PROVISIONING_FAILED');
  }
}

export class InvalidTenantOperationError extends TenantError {
  constructor(operation: string, status: string) {
    super(`Cannot perform ${operation} on tenant with status ${status}`, 'INVALID_OPERATION');
  }
}