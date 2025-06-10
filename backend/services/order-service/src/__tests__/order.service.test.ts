import { OrderService } from '../services/order.service';
import { OrderRepository } from '../repositories/order.repository';
import { InventoryService } from '../services/inventory.service';
import { PricingService } from '../services/pricing.service';
import { VendorAssignmentService } from '../services/vendor-assignment.service';
import { NotificationService } from '../services/notification.service';
import { OrderStateMachine } from '../state-machines/order.state-machine';
import {
  Order,
  OrderStatus,
  OrderItem,
  CreateOrderDto,
  UpdateOrderDto,
  OrderEvent,
  OrderEventType,
  VendorAssignment,
  InventoryReservation,
  PriceCalculation,
  NotificationType,
  PaymentMethod,
  DeliveryType
} from '../interfaces/order.interface';
import { v4 as uuidv4 } from 'uuid';
import Decimal from 'decimal.js';

jest.mock('../repositories/order.repository');
jest.mock('../services/inventory.service');
jest.mock('../services/pricing.service');
jest.mock('../services/vendor-assignment.service');
jest.mock('../services/notification.service');
jest.mock('../state-machines/order.state-machine');

describe('OrderService', () => {
  let orderService: OrderService;
  let mockOrderRepository: jest.Mocked<OrderRepository>;
  let mockInventoryService: jest.Mocked<InventoryService>;
  let mockPricingService: jest.Mocked<PricingService>;
  let mockVendorAssignmentService: jest.Mocked<VendorAssignmentService>;
  let mockNotificationService: jest.Mocked<NotificationService>;
  let mockOrderStateMachine: jest.Mocked<OrderStateMachine>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockOrderRepository = new OrderRepository({} as any) as jest.Mocked<OrderRepository>;
    mockInventoryService = new InventoryService({} as any) as jest.Mocked<InventoryService>;
    mockPricingService = new PricingService() as jest.Mocked<PricingService>;
    mockVendorAssignmentService = new VendorAssignmentService({} as any) as jest.Mocked<VendorAssignmentService>;
    mockNotificationService = new NotificationService({} as any) as jest.Mocked<NotificationService>;
    mockOrderStateMachine = new OrderStateMachine() as jest.Mocked<OrderStateMachine>;

    orderService = new OrderService(
      mockOrderRepository,
      mockInventoryService,
      mockPricingService,
      mockVendorAssignmentService,
      mockNotificationService,
      mockOrderStateMachine
    );
  });

  describe('createOrder', () => {
    it('should create order successfully with inventory reservation', async () => {
      // Arrange
      const createOrderDto: CreateOrderDto = {
        customerId: 'cust-123',
        items: [
          { productId: 'prod-1', quantity: 2, unitPrice: new Decimal(10.50) },
          { productId: 'prod-2', quantity: 1, unitPrice: new Decimal(25.00) }
        ],
        deliveryAddress: {
          street: '123 Main St',
          city: 'Test City',
          state: 'TC',
          postalCode: '12345',
          country: 'Test Country'
        },
        deliveryType: DeliveryType.STANDARD,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY
      };

      const priceCalculation: PriceCalculation = {
        subtotal: new Decimal(46.00),
        tax: new Decimal(4.60),
        deliveryFee: new Decimal(5.00),
        total: new Decimal(55.60),
        discounts: []
      };

      const inventoryReservations: InventoryReservation[] = [
        { productId: 'prod-1', quantity: 2, reservationId: 'res-1', expiresAt: new Date() },
        { productId: 'prod-2', quantity: 1, reservationId: 'res-2', expiresAt: new Date() }
      ];

      const vendorAssignments: VendorAssignment[] = [
        { vendorId: 'vendor-1', items: ['prod-1'], assignedAt: new Date() },
        { vendorId: 'vendor-2', items: ['prod-2'], assignedAt: new Date() }
      ];

      const expectedOrder: Order = {
        id: uuidv4(),
        orderNumber: 'ORD-2024-001',
        customerId: createOrderDto.customerId,
        items: createOrderDto.items.map(item => ({
          ...item,
          id: uuidv4(),
          status: 'PENDING'
        })),
        status: OrderStatus.PENDING,
        pricing: priceCalculation,
        deliveryAddress: createOrderDto.deliveryAddress,
        deliveryType: createOrderDto.deliveryType,
        paymentMethod: createOrderDto.paymentMethod,
        vendorAssignments,
        inventoryReservations,
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: 'tenant-123'
      };

      mockPricingService.calculateOrderPrice.mockResolvedValue(priceCalculation);
      mockInventoryService.reserveItems.mockResolvedValue(inventoryReservations);
      mockVendorAssignmentService.assignVendors.mockResolvedValue(vendorAssignments);
      mockOrderRepository.create.mockResolvedValue(expectedOrder);
      mockOrderStateMachine.getInitialState.mockReturnValue(OrderStatus.PENDING);
      mockNotificationService.sendNotification.mockResolvedValue();

      // Act
      const result = await orderService.createOrder(createOrderDto, 'tenant-123');

      // Assert
      expect(mockPricingService.calculateOrderPrice).toHaveBeenCalledWith(
        createOrderDto.items,
        createOrderDto.deliveryType
      );
      expect(mockInventoryService.reserveItems).toHaveBeenCalledWith(
        createOrderDto.items.map(item => ({ productId: item.productId, quantity: item.quantity }))
      );
      expect(mockVendorAssignmentService.assignVendors).toHaveBeenCalledWith(
        createOrderDto.items,
        createOrderDto.deliveryAddress
      );
      expect(mockOrderRepository.create).toHaveBeenCalledWith(expect.objectContaining({
        customerId: createOrderDto.customerId,
        items: expect.any(Array),
        status: OrderStatus.PENDING,
        pricing: priceCalculation,
        vendorAssignments,
        inventoryReservations,
        tenantId: 'tenant-123'
      }));
      expect(mockNotificationService.sendNotification).toHaveBeenCalledWith({
        type: NotificationType.ORDER_CREATED,
        recipient: createOrderDto.customerId,
        data: expect.objectContaining({ orderId: expectedOrder.id })
      });
      expect(result).toEqual(expectedOrder);
    });

    it('should rollback inventory reservation if order creation fails', async () => {
      // Arrange
      const createOrderDto: CreateOrderDto = {
        customerId: 'cust-123',
        items: [{ productId: 'prod-1', quantity: 2, unitPrice: new Decimal(10.50) }],
        deliveryAddress: {
          street: '123 Main St',
          city: 'Test City',
          state: 'TC',
          postalCode: '12345',
          country: 'Test Country'
        },
        deliveryType: DeliveryType.STANDARD,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY
      };

      const inventoryReservations: InventoryReservation[] = [
        { productId: 'prod-1', quantity: 2, reservationId: 'res-1', expiresAt: new Date() }
      ];

      mockPricingService.calculateOrderPrice.mockResolvedValue({
        subtotal: new Decimal(21.00),
        tax: new Decimal(2.10),
        deliveryFee: new Decimal(5.00),
        total: new Decimal(28.10),
        discounts: []
      });
      mockInventoryService.reserveItems.mockResolvedValue(inventoryReservations);
      mockVendorAssignmentService.assignVendors.mockResolvedValue([]);
      mockOrderRepository.create.mockRejectedValue(new Error('Database error'));
      mockInventoryService.releaseReservations.mockResolvedValue();

      // Act & Assert
      await expect(orderService.createOrder(createOrderDto, 'tenant-123'))
        .rejects
        .toThrow('Database error');

      expect(mockInventoryService.releaseReservations).toHaveBeenCalledWith(
        inventoryReservations.map(r => r.reservationId)
      );
    });

    it('should handle insufficient inventory', async () => {
      // Arrange
      const createOrderDto: CreateOrderDto = {
        customerId: 'cust-123',
        items: [{ productId: 'prod-1', quantity: 100, unitPrice: new Decimal(10.50) }],
        deliveryAddress: {
          street: '123 Main St',
          city: 'Test City',
          state: 'TC',
          postalCode: '12345',
          country: 'Test Country'
        },
        deliveryType: DeliveryType.STANDARD,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY
      };

      mockPricingService.calculateOrderPrice.mockResolvedValue({
        subtotal: new Decimal(1050.00),
        tax: new Decimal(105.00),
        deliveryFee: new Decimal(5.00),
        total: new Decimal(1160.00),
        discounts: []
      });
      mockInventoryService.reserveItems.mockRejectedValue(
        new Error('Insufficient inventory for product prod-1')
      );

      // Act & Assert
      await expect(orderService.createOrder(createOrderDto, 'tenant-123'))
        .rejects
        .toThrow('Insufficient inventory for product prod-1');

      expect(mockOrderRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('updateOrderStatus', () => {
    it('should update order status through state machine', async () => {
      // Arrange
      const orderId = uuidv4();
      const existingOrder: Order = {
        id: orderId,
        orderNumber: 'ORD-2024-001',
        customerId: 'cust-123',
        items: [],
        status: OrderStatus.PENDING,
        pricing: {
          subtotal: new Decimal(100),
          tax: new Decimal(10),
          deliveryFee: new Decimal(5),
          total: new Decimal(115),
          discounts: []
        },
        deliveryAddress: {} as any,
        deliveryType: DeliveryType.STANDARD,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        vendorAssignments: [],
        inventoryReservations: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: 'tenant-123'
      };

      const event: OrderEvent = {
        type: OrderEventType.CONFIRM,
        data: { confirmedBy: 'vendor-1' }
      };

      mockOrderRepository.findById.mockResolvedValue(existingOrder);
      mockOrderStateMachine.transition.mockReturnValue({
        nextState: OrderStatus.CONFIRMED,
        actions: ['notifyCustomer', 'notifyVendor']
      });
      mockOrderRepository.update.mockResolvedValue({
        ...existingOrder,
        status: OrderStatus.CONFIRMED
      });
      mockNotificationService.sendNotification.mockResolvedValue();

      // Act
      const result = await orderService.updateOrderStatus(orderId, event);

      // Assert
      expect(mockOrderStateMachine.transition).toHaveBeenCalledWith(
        existingOrder.status,
        event
      );
      expect(mockOrderRepository.update).toHaveBeenCalledWith(orderId, {
        status: OrderStatus.CONFIRMED,
        statusHistory: expect.arrayContaining([
          expect.objectContaining({
            from: OrderStatus.PENDING,
            to: OrderStatus.CONFIRMED,
            event,
            timestamp: expect.any(Date)
          })
        ])
      });
      expect(mockNotificationService.sendNotification).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(OrderStatus.CONFIRMED);
    });

    it('should reject invalid state transition', async () => {
      // Arrange
      const orderId = uuidv4();
      const existingOrder: Order = {
        id: orderId,
        orderNumber: 'ORD-2024-001',
        customerId: 'cust-123',
        items: [],
        status: OrderStatus.DELIVERED,
        pricing: {} as any,
        deliveryAddress: {} as any,
        deliveryType: DeliveryType.STANDARD,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        vendorAssignments: [],
        inventoryReservations: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: 'tenant-123'
      };

      const event: OrderEvent = {
        type: OrderEventType.CONFIRM,
        data: {}
      };

      mockOrderRepository.findById.mockResolvedValue(existingOrder);
      mockOrderStateMachine.transition.mockImplementation(() => {
        throw new Error('Invalid transition from DELIVERED with event CONFIRM');
      });

      // Act & Assert
      await expect(orderService.updateOrderStatus(orderId, event))
        .rejects
        .toThrow('Invalid transition from DELIVERED with event CONFIRM');

      expect(mockOrderRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('cancelOrder', () => {
    it('should cancel order and release inventory', async () => {
      // Arrange
      const orderId = uuidv4();
      const existingOrder: Order = {
        id: orderId,
        orderNumber: 'ORD-2024-001',
        customerId: 'cust-123',
        items: [
          { id: 'item-1', productId: 'prod-1', quantity: 2, unitPrice: new Decimal(10), status: 'PENDING' }
        ],
        status: OrderStatus.CONFIRMED,
        pricing: {} as any,
        deliveryAddress: {} as any,
        deliveryType: DeliveryType.STANDARD,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        vendorAssignments: [
          { vendorId: 'vendor-1', items: ['prod-1'], assignedAt: new Date() }
        ],
        inventoryReservations: [
          { productId: 'prod-1', quantity: 2, reservationId: 'res-1', expiresAt: new Date() }
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: 'tenant-123'
      };

      mockOrderRepository.findById.mockResolvedValue(existingOrder);
      mockOrderStateMachine.canTransition.mockReturnValue(true);
      mockInventoryService.releaseReservations.mockResolvedValue();
      mockOrderRepository.update.mockResolvedValue({
        ...existingOrder,
        status: OrderStatus.CANCELLED
      });
      mockNotificationService.sendNotification.mockResolvedValue();

      // Act
      const result = await orderService.cancelOrder(orderId, 'Customer request');

      // Assert
      expect(mockInventoryService.releaseReservations).toHaveBeenCalledWith(['res-1']);
      expect(mockOrderRepository.update).toHaveBeenCalledWith(orderId, {
        status: OrderStatus.CANCELLED,
        cancelledAt: expect.any(Date),
        cancellationReason: 'Customer request'
      });
      expect(mockNotificationService.sendNotification).toHaveBeenCalledWith({
        type: NotificationType.ORDER_CANCELLED,
        recipient: 'cust-123',
        data: expect.objectContaining({
          orderId,
          reason: 'Customer request'
        })
      });
      expect(result.status).toBe(OrderStatus.CANCELLED);
    });

    it('should not cancel already delivered order', async () => {
      // Arrange
      const orderId = uuidv4();
      const existingOrder: Order = {
        id: orderId,
        orderNumber: 'ORD-2024-001',
        customerId: 'cust-123',
        items: [],
        status: OrderStatus.DELIVERED,
        pricing: {} as any,
        deliveryAddress: {} as any,
        deliveryType: DeliveryType.STANDARD,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        vendorAssignments: [],
        inventoryReservations: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: 'tenant-123'
      };

      mockOrderRepository.findById.mockResolvedValue(existingOrder);
      mockOrderStateMachine.canTransition.mockReturnValue(false);

      // Act & Assert
      await expect(orderService.cancelOrder(orderId, 'Too late'))
        .rejects
        .toThrow('Cannot cancel order in status: DELIVERED');

      expect(mockInventoryService.releaseReservations).not.toHaveBeenCalled();
    });
  });

  describe('updateInventory', () => {
    it('should update inventory levels after order completion', async () => {
      // Arrange
      const orderId = uuidv4();
      const order: Order = {
        id: orderId,
        orderNumber: 'ORD-2024-001',
        customerId: 'cust-123',
        items: [
          { id: 'item-1', productId: 'prod-1', quantity: 2, unitPrice: new Decimal(10), status: 'PENDING' },
          { id: 'item-2', productId: 'prod-2', quantity: 1, unitPrice: new Decimal(20), status: 'PENDING' }
        ],
        status: OrderStatus.DELIVERED,
        pricing: {} as any,
        deliveryAddress: {} as any,
        deliveryType: DeliveryType.STANDARD,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        vendorAssignments: [],
        inventoryReservations: [
          { productId: 'prod-1', quantity: 2, reservationId: 'res-1', expiresAt: new Date() },
          { productId: 'prod-2', quantity: 1, reservationId: 'res-2', expiresAt: new Date() }
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: 'tenant-123'
      };

      mockOrderRepository.findById.mockResolvedValue(order);
      mockInventoryService.confirmReservations.mockResolvedValue();
      mockInventoryService.updateStock.mockResolvedValue();

      // Act
      await orderService.updateInventory(orderId);

      // Assert
      expect(mockInventoryService.confirmReservations).toHaveBeenCalledWith(['res-1', 'res-2']);
      expect(mockInventoryService.updateStock).toHaveBeenCalledWith([
        { productId: 'prod-1', quantity: -2 },
        { productId: 'prod-2', quantity: -1 }
      ]);
    });
  });

  describe('assignVendor', () => {
    it('should assign vendor to order items', async () => {
      // Arrange
      const orderId = uuidv4();
      const vendorId = 'vendor-123';
      const itemIds = ['item-1', 'item-2'];

      const order: Order = {
        id: orderId,
        orderNumber: 'ORD-2024-001',
        customerId: 'cust-123',
        items: [
          { id: 'item-1', productId: 'prod-1', quantity: 2, unitPrice: new Decimal(10), status: 'PENDING' },
          { id: 'item-2', productId: 'prod-2', quantity: 1, unitPrice: new Decimal(20), status: 'PENDING' }
        ],
        status: OrderStatus.CONFIRMED,
        pricing: {} as any,
        deliveryAddress: {} as any,
        deliveryType: DeliveryType.STANDARD,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        vendorAssignments: [],
        inventoryReservations: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: 'tenant-123'
      };

      mockOrderRepository.findById.mockResolvedValue(order);
      mockVendorAssignmentService.validateVendor.mockResolvedValue(true);
      mockOrderRepository.update.mockResolvedValue({
        ...order,
        vendorAssignments: [
          { vendorId, items: ['prod-1', 'prod-2'], assignedAt: new Date() }
        ]
      });
      mockNotificationService.sendNotification.mockResolvedValue();

      // Act
      const result = await orderService.assignVendor(orderId, vendorId, itemIds);

      // Assert
      expect(mockVendorAssignmentService.validateVendor).toHaveBeenCalledWith(vendorId, itemIds);
      expect(mockOrderRepository.update).toHaveBeenCalledWith(orderId, {
        vendorAssignments: expect.arrayContaining([
          expect.objectContaining({
            vendorId,
            items: ['prod-1', 'prod-2']
          })
        ])
      });
      expect(mockNotificationService.sendNotification).toHaveBeenCalledWith({
        type: NotificationType.VENDOR_ASSIGNED,
        recipient: vendorId,
        data: expect.objectContaining({ orderId, items: itemIds })
      });
      expect(result.vendorAssignments).toHaveLength(1);
    });
  });

  describe('getOrdersByCustomer', () => {
    it('should retrieve customer orders with pagination', async () => {
      // Arrange
      const customerId = 'cust-123';
      const filters = {
        status: [OrderStatus.PENDING, OrderStatus.CONFIRMED],
        limit: 10,
        offset: 0
      };

      const expectedOrders: Order[] = [
        {
          id: uuidv4(),
          orderNumber: 'ORD-2024-001',
          customerId,
          items: [],
          status: OrderStatus.PENDING,
          pricing: {} as any,
          deliveryAddress: {} as any,
          deliveryType: DeliveryType.STANDARD,
          paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
          vendorAssignments: [],
          inventoryReservations: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          tenantId: 'tenant-123'
        }
      ];

      mockOrderRepository.findByCustomer.mockResolvedValue({
        orders: expectedOrders,
        total: 1
      });

      // Act
      const result = await orderService.getOrdersByCustomer(customerId, filters);

      // Assert
      expect(mockOrderRepository.findByCustomer).toHaveBeenCalledWith(customerId, filters);
      expect(result).toEqual({
        orders: expectedOrders,
        total: 1
      });
    });
  });
});