import { Request, Response, NextFunction } from 'express';
import { TenantMiddleware } from '../middleware/tenant.middleware';
import { TenantService } from '../services/tenant.service';
import { Tenant, TenantStatus, TenantPlan } from '../interfaces/tenant.interface';
import { TenantNotFoundError, InvalidTenantOperationError } from '../errors/tenant.errors';

jest.mock('../services/tenant.service');

describe('TenantMiddleware', () => {
  let tenantMiddleware: TenantMiddleware;
  let mockTenantService: jest.Mocked<TenantService>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTenantService = new TenantService(null as any) as jest.Mocked<TenantService>;
    tenantMiddleware = new TenantMiddleware(mockTenantService);

    mockRequest = {
      headers: {},
      subdomains: [],
      hostname: '',
      get: jest.fn()
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    mockNext = jest.fn();
  });

  describe('extractTenant', () => {
    it('should extract tenant from subdomain successfully', async () => {
      // Arrange
      const tenant: Tenant = {
        id: 'tenant-123',
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@test.com',
        plan: TenantPlan.STARTER,
        status: TenantStatus.ACTIVE,
        resourceLimits: {
          maxUsers: 10,
          maxOrders: 1000,
          maxProducts: 100,
          storageGB: 5
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockRequest.subdomains = ['test-company'];
      mockTenantService.getTenantBySubdomain = jest.fn().mockResolvedValue(tenant);

      // Act
      await tenantMiddleware.extractTenant(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockTenantService.getTenantBySubdomain).toHaveBeenCalledWith('test-company');
      expect((mockRequest as any).tenant).toEqual(tenant);
      expect((mockRequest as any).tenantId).toEqual(tenant.id);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should extract tenant from X-Tenant-ID header', async () => {
      // Arrange
      const tenantId = 'tenant-123';
      const tenant: Tenant = {
        id: tenantId,
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@test.com',
        plan: TenantPlan.STARTER,
        status: TenantStatus.ACTIVE,
        resourceLimits: {
          maxUsers: 10,
          maxOrders: 1000,
          maxProducts: 100,
          storageGB: 5
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockRequest.headers = { 'x-tenant-id': tenantId };
      mockRequest.subdomains = [];
      mockTenantService.getTenant.mockResolvedValue(tenant);

      // Act
      await tenantMiddleware.extractTenant(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockTenantService.getTenant).toHaveBeenCalledWith(tenantId);
      expect((mockRequest as any).tenant).toEqual(tenant);
      expect((mockRequest as any).tenantId).toEqual(tenant.id);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 400 if no tenant identifier provided', async () => {
      // Arrange
      mockRequest.subdomains = [];
      mockRequest.headers = {};

      // Act
      await tenantMiddleware.extractTenant(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Tenant identification required',
        code: 'TENANT_REQUIRED'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 404 if tenant not found', async () => {
      // Arrange
      mockRequest.subdomains = ['unknown-tenant'];
      mockTenantService.getTenantBySubdomain = jest.fn()
        .mockRejectedValue(new TenantNotFoundError('unknown-tenant'));

      // Act
      await tenantMiddleware.extractTenant(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Tenant not found: unknown-tenant',
        code: 'TENANT_NOT_FOUND'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('requireActiveTenant', () => {
    it('should allow access for active tenant', async () => {
      // Arrange
      const tenant: Tenant = {
        id: 'tenant-123',
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@test.com',
        plan: TenantPlan.STARTER,
        status: TenantStatus.ACTIVE,
        resourceLimits: {
          maxUsers: 10,
          maxOrders: 1000,
          maxProducts: 100,
          storageGB: 5
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (mockRequest as any).tenant = tenant;

      // Act
      await tenantMiddleware.requireActiveTenant(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should deny access for suspended tenant', async () => {
      // Arrange
      const tenant: Tenant = {
        id: 'tenant-123',
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@test.com',
        plan: TenantPlan.STARTER,
        status: TenantStatus.SUSPENDED,
        resourceLimits: {
          maxUsers: 10,
          maxOrders: 1000,
          maxProducts: 100,
          storageGB: 5
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (mockRequest as any).tenant = tenant;

      // Act
      await tenantMiddleware.requireActiveTenant(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Tenant is not active',
        code: 'TENANT_NOT_ACTIVE',
        status: TenantStatus.SUSPENDED
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 if no tenant in request', async () => {
      // Arrange
      (mockRequest as any).tenant = undefined;

      // Act
      await tenantMiddleware.requireActiveTenant(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Tenant context not found',
        code: 'NO_TENANT_CONTEXT'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('injectTenantContext', () => {
    it('should inject tenant context into async local storage', async () => {
      // Arrange
      const tenant: Tenant = {
        id: 'tenant-123',
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@test.com',
        plan: TenantPlan.STARTER,
        status: TenantStatus.ACTIVE,
        resourceLimits: {
          maxUsers: 10,
          maxOrders: 1000,
          maxProducts: 100,
          storageGB: 5
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (mockRequest as any).tenant = tenant;

      // Act
      await tenantMiddleware.injectTenantContext(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockNext).toHaveBeenCalled();
      // Note: Testing AsyncLocalStorage requires additional setup
      // This test verifies the middleware calls next()
    });
  });

  describe('validateTenantResource', () => {
    it('should allow resource creation within limits', async () => {
      // Arrange
      const tenant: Tenant = {
        id: 'tenant-123',
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@test.com',
        plan: TenantPlan.STARTER,
        status: TenantStatus.ACTIVE,
        resourceLimits: {
          maxUsers: 10,
          maxOrders: 1000,
          maxProducts: 100,
          storageGB: 5
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (mockRequest as any).tenant = tenant;
      mockTenantService.checkResourceLimit.mockResolvedValue(true);

      const middleware = tenantMiddleware.validateTenantResource('users');

      // Act
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockTenantService.checkResourceLimit).toHaveBeenCalledWith(
        tenant.id,
        'users',
        1
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should deny resource creation when limit exceeded', async () => {
      // Arrange
      const tenant: Tenant = {
        id: 'tenant-123',
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@test.com',
        plan: TenantPlan.STARTER,
        status: TenantStatus.ACTIVE,
        resourceLimits: {
          maxUsers: 10,
          maxOrders: 1000,
          maxProducts: 100,
          storageGB: 5
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (mockRequest as any).tenant = tenant;
      mockTenantService.checkResourceLimit.mockRejectedValue(
        new ResourceLimitExceededError('users', 10, 11)
      );

      const middleware = tenantMiddleware.validateTenantResource('users');

      // Act
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Resource limit exceeded for users. Limit: 10, Requested: 11',
        code: 'RESOURCE_LIMIT_EXCEEDED',
        resource: 'users',
        limit: 10,
        requested: 11
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});