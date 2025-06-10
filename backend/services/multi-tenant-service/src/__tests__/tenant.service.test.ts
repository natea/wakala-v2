import { TenantService } from '../services/tenant.service';
import { DatabaseClient } from '../utils/database.client';
import { TenantRepository } from '../repositories/tenant.repository';
import { Tenant, TenantStatus, TenantPlan } from '../interfaces/tenant.interface';
import { TenantAlreadyExistsError, TenantNotFoundError, ResourceLimitExceededError } from '../errors/tenant.errors';
import { v4 as uuidv4 } from 'uuid';

// Mocks
jest.mock('../utils/database.client');
jest.mock('../repositories/tenant.repository');

describe('TenantService', () => {
  let tenantService: TenantService;
  let mockDatabaseClient: jest.Mocked<DatabaseClient>;
  let mockTenantRepository: jest.Mocked<TenantRepository>;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create mock instances
    mockDatabaseClient = new DatabaseClient() as jest.Mocked<DatabaseClient>;
    mockTenantRepository = new TenantRepository(mockDatabaseClient) as jest.Mocked<TenantRepository>;

    // Initialize service with mocked dependencies
    tenantService = new TenantService(mockTenantRepository);
  });

  describe('createTenant', () => {
    it('should create a new tenant successfully', async () => {
      // Arrange
      const tenantData = {
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@testcompany.com',
        plan: TenantPlan.STARTER
      };

      const expectedTenant: Tenant = {
        id: uuidv4(),
        name: tenantData.name,
        subdomain: tenantData.subdomain,
        adminEmail: tenantData.adminEmail,
        plan: tenantData.plan,
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

      mockTenantRepository.findBySubdomain.mockResolvedValue(null);
      mockTenantRepository.create.mockResolvedValue(expectedTenant);

      // Act
      const result = await tenantService.createTenant(tenantData);

      // Assert
      expect(mockTenantRepository.findBySubdomain).toHaveBeenCalledWith(tenantData.subdomain);
      expect(mockTenantRepository.create).toHaveBeenCalledWith(expect.objectContaining({
        name: tenantData.name,
        subdomain: tenantData.subdomain,
        adminEmail: tenantData.adminEmail,
        plan: tenantData.plan,
        status: TenantStatus.ACTIVE
      }));
      expect(result).toEqual(expectedTenant);
    });

    it('should throw error if tenant with subdomain already exists', async () => {
      // Arrange
      const tenantData = {
        name: 'Test Company',
        subdomain: 'existing-subdomain',
        adminEmail: 'admin@testcompany.com',
        plan: TenantPlan.STARTER
      };

      const existingTenant: Tenant = {
        id: uuidv4(),
        name: 'Existing Company',
        subdomain: 'existing-subdomain',
        adminEmail: 'admin@existing.com',
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

      mockTenantRepository.findBySubdomain.mockResolvedValue(existingTenant);

      // Act & Assert
      await expect(tenantService.createTenant(tenantData))
        .rejects
        .toThrow(TenantAlreadyExistsError);

      expect(mockTenantRepository.findBySubdomain).toHaveBeenCalledWith(tenantData.subdomain);
      expect(mockTenantRepository.create).not.toHaveBeenCalled();
    });

    it('should set correct resource limits based on plan', async () => {
      // Arrange
      const tenantDataPro = {
        name: 'Pro Company',
        subdomain: 'pro-company',
        adminEmail: 'admin@procompany.com',
        plan: TenantPlan.PROFESSIONAL
      };

      mockTenantRepository.findBySubdomain.mockResolvedValue(null);
      mockTenantRepository.create.mockImplementation(async (data) => ({
        ...data,
        id: uuidv4(),
        createdAt: new Date(),
        updatedAt: new Date()
      } as Tenant));

      // Act
      await tenantService.createTenant(tenantDataPro);

      // Assert
      expect(mockTenantRepository.create).toHaveBeenCalledWith(expect.objectContaining({
        resourceLimits: {
          maxUsers: 50,
          maxOrders: 10000,
          maxProducts: 1000,
          storageGB: 50
        }
      }));
    });
  });

  describe('getTenant', () => {
    it('should retrieve tenant by id successfully', async () => {
      // Arrange
      const tenantId = uuidv4();
      const expectedTenant: Tenant = {
        id: tenantId,
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@testcompany.com',
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

      mockTenantRepository.findById.mockResolvedValue(expectedTenant);

      // Act
      const result = await tenantService.getTenant(tenantId);

      // Assert
      expect(mockTenantRepository.findById).toHaveBeenCalledWith(tenantId);
      expect(result).toEqual(expectedTenant);
    });

    it('should throw error if tenant not found', async () => {
      // Arrange
      const tenantId = uuidv4();
      mockTenantRepository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(tenantService.getTenant(tenantId))
        .rejects
        .toThrow(TenantNotFoundError);

      expect(mockTenantRepository.findById).toHaveBeenCalledWith(tenantId);
    });
  });

  describe('updateTenant', () => {
    it('should update tenant successfully', async () => {
      // Arrange
      const tenantId = uuidv4();
      const updateData = {
        name: 'Updated Company Name',
        plan: TenantPlan.PROFESSIONAL
      };

      const existingTenant: Tenant = {
        id: tenantId,
        name: 'Old Company Name',
        subdomain: 'test-company',
        adminEmail: 'admin@testcompany.com',
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

      const updatedTenant: Tenant = {
        ...existingTenant,
        ...updateData,
        resourceLimits: {
          maxUsers: 50,
          maxOrders: 10000,
          maxProducts: 1000,
          storageGB: 50
        },
        updatedAt: new Date()
      };

      mockTenantRepository.findById.mockResolvedValue(existingTenant);
      mockTenantRepository.update.mockResolvedValue(updatedTenant);

      // Act
      const result = await tenantService.updateTenant(tenantId, updateData);

      // Assert
      expect(mockTenantRepository.findById).toHaveBeenCalledWith(tenantId);
      expect(mockTenantRepository.update).toHaveBeenCalledWith(tenantId, expect.objectContaining({
        name: updateData.name,
        plan: updateData.plan,
        resourceLimits: {
          maxUsers: 50,
          maxOrders: 10000,
          maxProducts: 1000,
          storageGB: 50
        }
      }));
      expect(result).toEqual(updatedTenant);
    });

    it('should throw error if tenant not found during update', async () => {
      // Arrange
      const tenantId = uuidv4();
      const updateData = { name: 'Updated Name' };

      mockTenantRepository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(tenantService.updateTenant(tenantId, updateData))
        .rejects
        .toThrow(TenantNotFoundError);

      expect(mockTenantRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('checkResourceLimit', () => {
    it('should allow action when within resource limits', async () => {
      // Arrange
      const tenantId = uuidv4();
      const tenant: Tenant = {
        id: tenantId,
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@testcompany.com',
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

      mockTenantRepository.findById.mockResolvedValue(tenant);
      mockTenantRepository.getResourceUsage.mockResolvedValue({
        users: 5,
        orders: 500,
        products: 50,
        storageGB: 2.5
      });

      // Act
      const result = await tenantService.checkResourceLimit(tenantId, 'users', 1);

      // Assert
      expect(result).toBe(true);
      expect(mockTenantRepository.getResourceUsage).toHaveBeenCalledWith(tenantId);
    });

    it('should throw error when exceeding resource limits', async () => {
      // Arrange
      const tenantId = uuidv4();
      const tenant: Tenant = {
        id: tenantId,
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@testcompany.com',
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

      mockTenantRepository.findById.mockResolvedValue(tenant);
      mockTenantRepository.getResourceUsage.mockResolvedValue({
        users: 9,
        orders: 500,
        products: 50,
        storageGB: 2.5
      });

      // Act & Assert
      await expect(tenantService.checkResourceLimit(tenantId, 'users', 2))
        .rejects
        .toThrow(ResourceLimitExceededError);
    });
  });

  describe('createRLSPolicy', () => {
    it('should create RLS policy for tenant successfully', async () => {
      // Arrange
      const tenantId = uuidv4();
      const tableName = 'orders';

      const tenant: Tenant = {
        id: tenantId,
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@testcompany.com',
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

      mockTenantRepository.findById.mockResolvedValue(tenant);
      mockTenantRepository.createRLSPolicy.mockResolvedValue(true);

      // Act
      const result = await tenantService.createRLSPolicy(tenantId, tableName);

      // Assert
      expect(mockTenantRepository.createRLSPolicy).toHaveBeenCalledWith(tenantId, tableName);
      expect(result).toBe(true);
    });

    it('should throw error if tenant not found when creating RLS policy', async () => {
      // Arrange
      const tenantId = uuidv4();
      const tableName = 'orders';

      mockTenantRepository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(tenantService.createRLSPolicy(tenantId, tableName))
        .rejects
        .toThrow(TenantNotFoundError);

      expect(mockTenantRepository.createRLSPolicy).not.toHaveBeenCalled();
    });
  });

  describe('suspendTenant', () => {
    it('should suspend tenant successfully', async () => {
      // Arrange
      const tenantId = uuidv4();
      const tenant: Tenant = {
        id: tenantId,
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@testcompany.com',
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

      const suspendedTenant = {
        ...tenant,
        status: TenantStatus.SUSPENDED,
        updatedAt: new Date()
      };

      mockTenantRepository.findById.mockResolvedValue(tenant);
      mockTenantRepository.update.mockResolvedValue(suspendedTenant);

      // Act
      const result = await tenantService.suspendTenant(tenantId);

      // Assert
      expect(mockTenantRepository.update).toHaveBeenCalledWith(tenantId, {
        status: TenantStatus.SUSPENDED
      });
      expect(result).toEqual(suspendedTenant);
    });
  });

  describe('provisionTenant', () => {
    it('should provision tenant resources successfully', async () => {
      // Arrange
      const tenantId = uuidv4();
      const tenant: Tenant = {
        id: tenantId,
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@testcompany.com',
        plan: TenantPlan.STARTER,
        status: TenantStatus.PROVISIONING,
        resourceLimits: {
          maxUsers: 10,
          maxOrders: 1000,
          maxProducts: 100,
          storageGB: 5
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockTenantRepository.findById.mockResolvedValue(tenant);
      mockTenantRepository.createSchema.mockResolvedValue(true);
      mockTenantRepository.createRLSPolicy.mockResolvedValue(true);
      mockTenantRepository.update.mockResolvedValue({
        ...tenant,
        status: TenantStatus.ACTIVE
      });

      // Act
      const result = await tenantService.provisionTenant(tenantId);

      // Assert
      expect(mockTenantRepository.createSchema).toHaveBeenCalledWith(tenantId);
      expect(mockTenantRepository.createRLSPolicy).toHaveBeenCalledTimes(5); // For each table
      expect(mockTenantRepository.update).toHaveBeenCalledWith(tenantId, {
        status: TenantStatus.ACTIVE
      });
      expect(result).toBe(true);
    });

    it('should handle provisioning failure and update status', async () => {
      // Arrange
      const tenantId = uuidv4();
      const tenant: Tenant = {
        id: tenantId,
        name: 'Test Company',
        subdomain: 'test-company',
        adminEmail: 'admin@testcompany.com',
        plan: TenantPlan.STARTER,
        status: TenantStatus.PROVISIONING,
        resourceLimits: {
          maxUsers: 10,
          maxOrders: 1000,
          maxProducts: 100,
          storageGB: 5
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockTenantRepository.findById.mockResolvedValue(tenant);
      mockTenantRepository.createSchema.mockRejectedValue(new Error('Schema creation failed'));
      mockTenantRepository.update.mockResolvedValue({
        ...tenant,
        status: TenantStatus.FAILED
      });

      // Act & Assert
      await expect(tenantService.provisionTenant(tenantId))
        .rejects
        .toThrow('Schema creation failed');

      expect(mockTenantRepository.update).toHaveBeenCalledWith(tenantId, {
        status: TenantStatus.FAILED
      });
    });
  });
});