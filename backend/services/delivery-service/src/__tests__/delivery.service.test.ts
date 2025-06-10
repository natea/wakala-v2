import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DeliveryService } from '../services/delivery.service';
import { DriverDispatchService } from '../services/driver-dispatch.service';
import { RouteOptimizationService } from '../services/route-optimization.service';
import { TrackingService } from '../services/tracking.service';
import { NotificationService } from '../services/notification.service';
import { DeliveryRepository } from '../repositories/delivery.repository';
import { DriverRepository } from '../repositories/driver.repository';
import { 
  DeliveryRequest,
  DeliveryStatus,
  Driver,
  DriverStatus,
  Location,
  DeliveryAssignment,
  TrackingUpdate,
  Route
} from '../interfaces/delivery.interfaces';

// Mock dependencies
jest.mock('../repositories/delivery.repository');
jest.mock('../repositories/driver.repository');
jest.mock('../services/notification.service');

describe('Delivery Service', () => {
  let deliveryService: DeliveryService;
  let deliveryRepository: jest.Mocked<DeliveryRepository>;
  let driverRepository: jest.Mocked<DriverRepository>;
  let dispatchService: DriverDispatchService;
  let routeOptimization: RouteOptimizationService;
  let trackingService: TrackingService;
  let notificationService: jest.Mocked<NotificationService>;

  beforeEach(() => {
    deliveryRepository = new DeliveryRepository() as jest.Mocked<DeliveryRepository>;
    driverRepository = new DriverRepository() as jest.Mocked<DriverRepository>;
    notificationService = new NotificationService() as jest.Mocked<NotificationService>;
    
    dispatchService = new DriverDispatchService(driverRepository, deliveryRepository);
    routeOptimization = new RouteOptimizationService();
    trackingService = new TrackingService(deliveryRepository, notificationService);
    
    deliveryService = new DeliveryService(
      deliveryRepository,
      driverRepository,
      dispatchService,
      routeOptimization,
      trackingService,
      notificationService
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Delivery Creation', () => {
    test('should create a new delivery', async () => {
      const deliveryRequest: DeliveryRequest = {
        orderId: 'order-123',
        customerId: 'cust-123',
        pickup: {
          address: '123 Store St',
          coordinates: { lat: -1.2921, lng: 36.8219 },
          contactName: 'Store Manager',
          contactPhone: '+254701234567'
        },
        dropoff: {
          address: '456 Customer Ave',
          coordinates: { lat: -1.2863, lng: 36.8172 },
          contactName: 'John Doe',
          contactPhone: '+254709876543'
        },
        items: [
          { name: 'Package 1', quantity: 1, weight: 2.5 }
        ],
        scheduledTime: new Date('2024-01-10T14:00:00'),
        priority: 'normal'
      };

      const mockDelivery = {
        id: 'del-123',
        ...deliveryRequest,
        status: DeliveryStatus.PENDING,
        estimatedDistance: 5.2,
        estimatedDuration: 15,
        createdAt: new Date()
      };

      deliveryRepository.create.mockResolvedValue(mockDelivery);

      const result = await deliveryService.createDelivery(deliveryRequest);

      expect(result.id).toBe('del-123');
      expect(result.status).toBe(DeliveryStatus.PENDING);
      expect(result.estimatedDistance).toBe(5.2);
      expect(deliveryRepository.create).toHaveBeenCalled();
    });

    test('should validate delivery request', async () => {
      const invalidRequest: DeliveryRequest = {
        orderId: '',
        customerId: '',
        pickup: {} as any,
        dropoff: {} as any,
        items: [],
        scheduledTime: new Date(),
        priority: 'normal'
      };

      await expect(deliveryService.createDelivery(invalidRequest))
        .rejects.toThrow('Invalid delivery request');
    });

    test('should calculate delivery fee', async () => {
      const deliveryRequest: DeliveryRequest = {
        orderId: 'order-456',
        customerId: 'cust-456',
        pickup: {
          address: '123 Store St',
          coordinates: { lat: -1.2921, lng: 36.8219 }
        },
        dropoff: {
          address: '789 Far Away Rd',
          coordinates: { lat: -1.3521, lng: 36.8819 }
        },
        items: [
          { name: 'Heavy Package', quantity: 1, weight: 10 }
        ],
        scheduledTime: new Date(),
        priority: 'express'
      };

      const fee = await deliveryService.calculateDeliveryFee(deliveryRequest);

      expect(fee).toBeGreaterThan(0);
      expect(fee).toContain({ baseRate: expect.any(Number) });
      expect(fee).toContain({ distanceCharge: expect.any(Number) });
      expect(fee).toContain({ weightCharge: expect.any(Number) });
      expect(fee).toContain({ priorityCharge: expect.any(Number) });
    });
  });

  describe('Driver Assignment', () => {
    test('should assign nearest available driver', async () => {
      const delivery = {
        id: 'del-123',
        pickup: { coordinates: { lat: -1.2921, lng: 36.8219 } },
        status: DeliveryStatus.PENDING
      };

      const drivers: Driver[] = [
        {
          id: 'driver-1',
          name: 'Driver One',
          status: DriverStatus.AVAILABLE,
          currentLocation: { lat: -1.2920, lng: 36.8220 },
          vehicleType: 'motorcycle',
          rating: 4.5
        },
        {
          id: 'driver-2',
          name: 'Driver Two',
          status: DriverStatus.AVAILABLE,
          currentLocation: { lat: -1.3000, lng: 36.8300 },
          vehicleType: 'motorcycle',
          rating: 4.2
        }
      ];

      deliveryRepository.findById.mockResolvedValue(delivery);
      driverRepository.findAvailable.mockResolvedValue(drivers);
      driverRepository.update.mockResolvedValue(drivers[0]);

      const assignment = await deliveryService.assignDriver('del-123');

      expect(assignment.driverId).toBe('driver-1');
      expect(assignment.deliveryId).toBe('del-123');
      expect(assignment.estimatedPickupTime).toBeDefined();
    });

    test('should handle no available drivers', async () => {
      deliveryRepository.findById.mockResolvedValue({ id: 'del-123' });
      driverRepository.findAvailable.mockResolvedValue([]);

      await expect(deliveryService.assignDriver('del-123'))
        .rejects.toThrow('No available drivers');
    });

    test('should reassign delivery if driver cancels', async () => {
      const delivery = {
        id: 'del-123',
        driverId: 'driver-1',
        status: DeliveryStatus.ASSIGNED
      };

      const newDriver = {
        id: 'driver-2',
        name: 'Replacement Driver',
        status: DriverStatus.AVAILABLE
      };

      deliveryRepository.findById.mockResolvedValue(delivery);
      driverRepository.findAvailable.mockResolvedValue([newDriver]);

      const reassignment = await deliveryService.reassignDelivery('del-123', 'Driver cancelled');

      expect(reassignment.driverId).toBe('driver-2');
      expect(notificationService.notifyCustomer).toHaveBeenCalled();
    });
  });

  describe('Route Optimization', () => {
    test('should optimize single delivery route', async () => {
      const pickup: Location = { lat: -1.2921, lng: 36.8219 };
      const dropoff: Location = { lat: -1.2863, lng: 36.8172 };
      const driverLocation: Location = { lat: -1.2900, lng: 36.8200 };

      const route = await routeOptimization.optimizeSingleRoute(
        driverLocation,
        pickup,
        dropoff
      );

      expect(route.totalDistance).toBeGreaterThan(0);
      expect(route.totalDuration).toBeGreaterThan(0);
      expect(route.waypoints).toHaveLength(3);
      expect(route.polyline).toBeDefined();
    });

    test('should optimize multiple deliveries', async () => {
      const deliveries = [
        {
          id: 'del-1',
          pickup: { lat: -1.2921, lng: 36.8219 },
          dropoff: { lat: -1.2863, lng: 36.8172 }
        },
        {
          id: 'del-2',
          pickup: { lat: -1.2950, lng: 36.8250 },
          dropoff: { lat: -1.2800, lng: 36.8100 }
        }
      ];

      const optimizedRoute = await routeOptimization.optimizeMultipleDeliveries(
        { lat: -1.2900, lng: 36.8200 },
        deliveries
      );

      expect(optimizedRoute.deliveryOrder).toHaveLength(2);
      expect(optimizedRoute.totalDistance).toBeGreaterThan(0);
      expect(optimizedRoute.estimatedCompletionTime).toBeDefined();
    });

    test('should consider traffic conditions', async () => {
      const route = await routeOptimization.optimizeWithTraffic(
        { lat: -1.2921, lng: 36.8219 },
        { lat: -1.2863, lng: 36.8172 },
        'heavy'
      );

      expect(route.adjustedDuration).toBeGreaterThan(route.baseDuration);
      expect(route.trafficFactor).toBeGreaterThan(1);
    });

    test('should suggest alternative routes', async () => {
      const alternatives = await routeOptimization.getAlternativeRoutes(
        { lat: -1.2921, lng: 36.8219 },
        { lat: -1.2863, lng: 36.8172 }
      );

      expect(alternatives).toHaveLength(3);
      expect(alternatives[0].score).toBeGreaterThanOrEqual(alternatives[1].score);
    });
  });

  describe('Real-time Tracking', () => {
    test('should update driver location', async () => {
      const update: TrackingUpdate = {
        deliveryId: 'del-123',
        driverId: 'driver-1',
        location: { lat: -1.2910, lng: 36.8210 },
        timestamp: new Date(),
        speed: 35,
        heading: 180
      };

      await trackingService.updateLocation(update);

      expect(deliveryRepository.updateLocation).toHaveBeenCalledWith(
        'del-123',
        update.location
      );
    });

    test('should detect arrival at pickup', async () => {
      const delivery = {
        id: 'del-123',
        pickup: { coordinates: { lat: -1.2921, lng: 36.8219 } },
        status: DeliveryStatus.ASSIGNED
      };

      deliveryRepository.findById.mockResolvedValue(delivery);

      const update: TrackingUpdate = {
        deliveryId: 'del-123',
        driverId: 'driver-1',
        location: { lat: -1.2920, lng: 36.8218 }, // Very close to pickup
        timestamp: new Date()
      };

      await trackingService.updateLocation(update);

      expect(deliveryRepository.updateStatus).toHaveBeenCalledWith(
        'del-123',
        DeliveryStatus.ARRIVED_AT_PICKUP
      );
      expect(notificationService.notifyMerchant).toHaveBeenCalled();
    });

    test('should calculate ETA dynamically', async () => {
      const currentLocation: Location = { lat: -1.2900, lng: 36.8200 };
      const destination: Location = { lat: -1.2863, lng: 36.8172 };
      const currentSpeed = 40; // km/h

      const eta = await trackingService.calculateETA(
        currentLocation,
        destination,
        currentSpeed
      );

      expect(eta.minutes).toBeGreaterThan(0);
      expect(eta.arrivalTime).toBeInstanceOf(Date);
    });

    test('should send location updates via WebSocket', async () => {
      const mockWsServer = {
        broadcastToDelivery: jest.fn()
      };

      trackingService.setWebSocketServer(mockWsServer as any);

      const update: TrackingUpdate = {
        deliveryId: 'del-123',
        driverId: 'driver-1',
        location: { lat: -1.2910, lng: 36.8210 },
        timestamp: new Date()
      };

      await trackingService.updateLocation(update);

      expect(mockWsServer.broadcastToDelivery).toHaveBeenCalledWith(
        'del-123',
        expect.objectContaining({
          type: 'location_update',
          data: expect.objectContaining({
            location: update.location
          })
        })
      );
    });
  });

  describe('Delivery Status Updates', () => {
    test('should update delivery status with validation', async () => {
      const delivery = {
        id: 'del-123',
        status: DeliveryStatus.ASSIGNED
      };

      deliveryRepository.findById.mockResolvedValue(delivery);

      await deliveryService.updateDeliveryStatus(
        'del-123',
        DeliveryStatus.PICKED_UP,
        { signature: 'merchant_signature' }
      );

      expect(deliveryRepository.updateStatus).toHaveBeenCalledWith(
        'del-123',
        DeliveryStatus.PICKED_UP
      );
      expect(notificationService.notifyCustomer).toHaveBeenCalled();
    });

    test('should prevent invalid status transitions', async () => {
      const delivery = {
        id: 'del-123',
        status: DeliveryStatus.DELIVERED
      };

      deliveryRepository.findById.mockResolvedValue(delivery);

      await expect(
        deliveryService.updateDeliveryStatus('del-123', DeliveryStatus.PICKED_UP)
      ).rejects.toThrow('Invalid status transition');
    });

    test('should handle proof of delivery', async () => {
      const delivery = {
        id: 'del-123',
        status: DeliveryStatus.IN_TRANSIT
      };

      deliveryRepository.findById.mockResolvedValue(delivery);

      const proofOfDelivery = {
        signature: 'customer_signature_base64',
        photo: 'delivery_photo_base64',
        recipientName: 'John Doe',
        notes: 'Left at reception'
      };

      await deliveryService.completeDelivery('del-123', proofOfDelivery);

      expect(deliveryRepository.saveProofOfDelivery).toHaveBeenCalledWith(
        'del-123',
        proofOfDelivery
      );
      expect(deliveryRepository.updateStatus).toHaveBeenCalledWith(
        'del-123',
        DeliveryStatus.DELIVERED
      );
    });

    test('should handle delivery cancellation', async () => {
      const delivery = {
        id: 'del-123',
        status: DeliveryStatus.PENDING,
        driverId: 'driver-1'
      };

      deliveryRepository.findById.mockResolvedValue(delivery);

      await deliveryService.cancelDelivery('del-123', 'Customer request');

      expect(deliveryRepository.updateStatus).toHaveBeenCalledWith(
        'del-123',
        DeliveryStatus.CANCELLED
      );
      expect(driverRepository.update).toHaveBeenCalledWith(
        'driver-1',
        { status: DriverStatus.AVAILABLE }
      );
    });
  });

  describe('Driver Notifications', () => {
    test('should notify driver of new assignment', async () => {
      const assignment: DeliveryAssignment = {
        id: 'assign-123',
        deliveryId: 'del-123',
        driverId: 'driver-1',
        assignedAt: new Date(),
        estimatedPickupTime: new Date()
      };

      await notificationService.notifyDriverAssignment(assignment);

      expect(notificationService.sendPushNotification).toHaveBeenCalledWith(
        'driver-1',
        expect.objectContaining({
          title: 'New Delivery Assignment',
          type: 'delivery_assignment'
        })
      );
    });

    test('should send batch notifications', async () => {
      const driverIds = ['driver-1', 'driver-2', 'driver-3'];
      const message = {
        title: 'New delivery opportunities',
        body: 'Check the app for available deliveries'
      };

      await notificationService.notifyMultipleDrivers(driverIds, message);

      expect(notificationService.sendBatchNotification).toHaveBeenCalledWith(
        driverIds,
        message
      );
    });

    test('should handle notification delivery failures', async () => {
      notificationService.sendPushNotification.mockRejectedValue(
        new Error('FCM error')
      );

      const result = await notificationService.notifyDriverAssignment({
        driverId: 'driver-1',
        deliveryId: 'del-123'
      } as any);

      expect(result.success).toBe(false);
      expect(result.retryCount).toBe(3);
    });
  });

  describe('Analytics and Reporting', () => {
    test('should track delivery metrics', async () => {
      const metrics = await deliveryService.getDeliveryMetrics(
        new Date('2024-01-01'),
        new Date('2024-01-31')
      );

      expect(metrics).toHaveProperty('totalDeliveries');
      expect(metrics).toHaveProperty('averageDeliveryTime');
      expect(metrics).toHaveProperty('onTimeRate');
      expect(metrics).toHaveProperty('customerSatisfaction');
    });

    test('should generate driver performance report', async () => {
      const driverId = 'driver-1';
      const report = await deliveryService.getDriverPerformance(driverId);

      expect(report).toHaveProperty('completedDeliveries');
      expect(report).toHaveProperty('averageRating');
      expect(report).toHaveProperty('onTimePercentage');
      expect(report).toHaveProperty('totalDistance');
    });

    test('should identify delivery hotspots', async () => {
      const hotspots = await deliveryService.identifyHotspots();

      expect(hotspots).toBeInstanceOf(Array);
      expect(hotspots[0]).toHaveProperty('location');
      expect(hotspots[0]).toHaveProperty('deliveryCount');
      expect(hotspots[0]).toHaveProperty('peakHours');
    });
  });

  describe('Edge Cases', () => {
    test('should handle driver going offline during delivery', async () => {
      const delivery = {
        id: 'del-123',
        driverId: 'driver-1',
        status: DeliveryStatus.IN_TRANSIT
      };

      deliveryRepository.findById.mockResolvedValue(delivery);
      driverRepository.findById.mockResolvedValue({
        id: 'driver-1',
        status: DriverStatus.OFFLINE
      });

      await deliveryService.handleDriverOffline('driver-1');

      expect(notificationService.alertSupport).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'driver_offline_during_delivery',
          deliveryId: 'del-123'
        })
      );
    });

    test('should handle GPS signal loss', async () => {
      const lastKnownLocation = { lat: -1.2900, lng: 36.8200 };
      
      await trackingService.handleGPSLoss('del-123', 'driver-1', lastKnownLocation);

      expect(deliveryRepository.flagForReview).toHaveBeenCalledWith(
        'del-123',
        'GPS_SIGNAL_LOST'
      );
    });

    test('should handle delivery address changes', async () => {
      const delivery = {
        id: 'del-123',
        status: DeliveryStatus.ASSIGNED,
        driverId: 'driver-1'
      };

      deliveryRepository.findById.mockResolvedValue(delivery);

      const newDropoff = {
        address: '789 New Address',
        coordinates: { lat: -1.2950, lng: 36.8250 }
      };

      await deliveryService.updateDeliveryAddress('del-123', newDropoff);

      expect(routeOptimization.recalculateRoute).toHaveBeenCalled();
      expect(notificationService.notifyDriver).toHaveBeenCalledWith(
        'driver-1',
        expect.objectContaining({
          type: 'address_updated'
        })
      );
    });
  });
});

describe('Driver Dispatch Algorithm', () => {
  let dispatchService: DriverDispatchService;
  let driverRepository: jest.Mocked<DriverRepository>;

  beforeEach(() => {
    driverRepository = new DriverRepository() as jest.Mocked<DriverRepository>;
    dispatchService = new DriverDispatchService(driverRepository, null as any);
  });

  test('should score drivers based on multiple factors', () => {
    const driver: Driver = {
      id: 'driver-1',
      name: 'Test Driver',
      status: DriverStatus.AVAILABLE,
      currentLocation: { lat: -1.2900, lng: 36.8200 },
      rating: 4.8,
      completedDeliveries: 150,
      vehicleType: 'motorcycle'
    };

    const delivery = {
      pickup: { coordinates: { lat: -1.2910, lng: 36.8210 } },
      priority: 'express',
      items: [{ weight: 5 }]
    };

    const score = dispatchService.calculateDriverScore(driver, delivery as any);

    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  test('should balance driver workload', async () => {
    const drivers = [
      { id: 'driver-1', activeDeliveries: 3, dailyEarnings: 1500 },
      { id: 'driver-2', activeDeliveries: 1, dailyEarnings: 500 },
      { id: 'driver-3', activeDeliveries: 2, dailyEarnings: 1000 }
    ];

    driverRepository.findAvailable.mockResolvedValue(drivers as any);

    const selected = await dispatchService.selectDriverWithLoadBalancing(
      { id: 'del-123' } as any
    );

    expect(selected.id).toBe('driver-2'); // Least loaded driver
  });

  test('should respect driver preferences', async () => {
    const drivers = [
      {
        id: 'driver-1',
        preferences: { maxDistance: 5, preferredAreas: ['CBD'] },
        currentLocation: { lat: -1.2900, lng: 36.8200 }
      },
      {
        id: 'driver-2',
        preferences: { maxDistance: 20, preferredAreas: ['Westlands'] },
        currentLocation: { lat: -1.2700, lng: 36.8000 }
      }
    ];

    const delivery = {
      pickup: { 
        coordinates: { lat: -1.2680, lng: 36.8100 },
        area: 'Westlands'
      },
      estimatedDistance: 15
    };

    const selected = await dispatchService.selectDriverWithPreferences(
      drivers as any,
      delivery as any
    );

    expect(selected.id).toBe('driver-2');
  });
});

describe('Delivery Service - Full Coverage', () => {
  let deliveryService: DeliveryService;

  beforeEach(() => {
    const deliveryRepository = new DeliveryRepository() as jest.Mocked<DeliveryRepository>;
    const driverRepository = new DriverRepository() as jest.Mocked<DriverRepository>;
    const dispatchService = new DriverDispatchService(driverRepository, deliveryRepository);
    const routeOptimization = new RouteOptimizationService();
    const notificationService = new NotificationService() as jest.Mocked<NotificationService>;
    const trackingService = new TrackingService(deliveryRepository, notificationService);
    
    deliveryService = new DeliveryService(
      deliveryRepository,
      driverRepository,
      dispatchService,
      routeOptimization,
      trackingService,
      notificationService
    );
  });

  test('should handle express delivery surcharge', () => {
    const fee = deliveryService.calculateExpressSurcharge(1000);
    expect(fee).toBe(500); // 50% surcharge for express
  });

  test('should validate driver documents', async () => {
    const documents = {
      license: { number: 'DL123456', expiry: new Date('2025-01-01') },
      insurance: { number: 'INS789', expiry: new Date('2024-12-31') }
    };

    const isValid = await deliveryService.validateDriverDocuments('driver-1', documents);
    expect(isValid).toBe(true);
  });

  test('should handle package dimensions', () => {
    const canFit = deliveryService.checkVehicleCapacity(
      'motorcycle',
      [{ length: 30, width: 20, height: 15, weight: 5 }]
    );
    expect(canFit).toBe(true);

    const cannotFit = deliveryService.checkVehicleCapacity(
      'motorcycle',
      [{ length: 100, width: 80, height: 60, weight: 50 }]
    );
    expect(cannotFit).toBe(false);
  });

  test('should calculate fuel surcharge', () => {
    const surcharge = deliveryService.calculateFuelSurcharge(10, 150); // 10km at 150/L
    expect(surcharge).toBeGreaterThan(0);
  });

  test('should handle batch delivery creation', async () => {
    const requests = [
      { orderId: 'order-1', customerId: 'cust-1' },
      { orderId: 'order-2', customerId: 'cust-1' },
      { orderId: 'order-3', customerId: 'cust-2' }
    ];

    const deliveries = await deliveryService.createBatchDeliveries(requests as any);
    expect(deliveries).toHaveLength(3);
    expect(deliveries[0].batchId).toBe(deliveries[1].batchId);
  });
});