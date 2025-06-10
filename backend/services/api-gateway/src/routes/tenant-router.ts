export class TenantRouter {
  private services: Record<string, string>;
  private tenantMappings: Map<string, Record<string, string>>;

  constructor(services: Record<string, string>) {
    this.services = services;
    this.tenantMappings = new Map();
    this.initializeTenantMappings();
  }

  private initializeTenantMappings(): void {
    // Mock tenant-specific service endpoints
    this.tenantMappings.set('tenant-us-east', {
      order: 'http://order-service-us-east:3001',
      payment: 'http://payment-service-us-east:3002',
      delivery: 'http://delivery-service-us-east:3003'
    });

    this.tenantMappings.set('global-tenant', {
      'order-eu-west': 'http://order-service-eu-west:3001',
      'payment-eu-west': 'http://payment-service-eu-west:3002',
      'delivery-eu-west': 'http://delivery-service-eu-west:3003'
    });
  }

  public route(tenantId: string, serviceName: string, region?: string): string {
    // Check for tenant-specific routing
    const tenantServices = this.tenantMappings.get(tenantId);
    
    if (tenantServices) {
      const serviceKey = region ? `${serviceName}-${region}` : serviceName;
      if (tenantServices[serviceKey]) {
        return tenantServices[serviceKey];
      }
    }

    // Default to base service
    return this.services[serviceName] || '';
  }

  public getServiceEndpoint(tenantId: string, serviceName: string): string {
    const tenantServices = this.tenantMappings.get(tenantId);
    
    if (tenantServices && tenantServices[serviceName]) {
      return tenantServices[serviceName].split('://')[1].split(':')[0];
    }

    if (tenantId === 'tenant-us-east') {
      return `${serviceName}-service-us-east`;
    }

    return `${serviceName}-service`;
  }
}