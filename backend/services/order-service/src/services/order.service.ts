import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import { OrderRepository } from '../repositories/order.repository';
import { InventoryService, InventoryItem } from './inventory.service';
import { PricingService } from './pricing.service';
import { VendorAssignmentService } from './vendor-assignment.service';
import { NotificationService } from './notification.service';
import { OrderStateMachine } from '../state-machines/order.state-machine';
import {
  Order,
  OrderStatus,
  OrderItem,
  CreateOrderDto,
  UpdateOrderDto,
  OrderEvent,
  OrderEventType,
  OrderFilter,
  OrderSearchResult,
  VendorAssignment,
  InventoryReservation,
  NotificationType,
  StatusHistoryEntry
} from '../interfaces/order.interface';

export class OrderService {
  constructor(
    private orderRepository: OrderRepository,
    private inventoryService: InventoryService,
    private pricingService: PricingService,
    private vendorAssignmentService: VendorAssignmentService,
    private notificationService: NotificationService,
    private orderStateMachine: OrderStateMachine
  ) {}

  /**
   * Create a new order
   */
  async createOrder(dto: CreateOrderDto, tenantId: string): Promise<Order> {
    // Calculate pricing
    const pricing = await this.pricingService.calculateOrderPrice(
      dto.items,
      dto.deliveryType
    );

    // Reserve inventory
    let inventoryReservations: InventoryReservation[] = [];
    try {
      const inventoryItems: InventoryItem[] = dto.items.map(item => ({
        productId: item.productId,
        quantity: item.quantity
      }));
      
      inventoryReservations = await this.inventoryService.reserveItems(inventoryItems);
    } catch (error) {
      throw error;
    }

    try {
      // Assign vendors
      const orderItems: OrderItem[] = dto.items.map(item => ({
        id: uuidv4(),
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.unitPrice.mul(item.quantity),
        status: 'PENDING',
        notes: item.notes
      }));

      const vendorAssignments = await this.vendorAssignmentService.assignVendors(
        orderItems,
        dto.deliveryAddress
      );

      // Generate order number
      const orderNumber = await this.orderRepository.getNextOrderNumber(tenantId);

      // Create order
      const order = await this.orderRepository.create({
        orderNumber,
        customerId: dto.customerId,
        items: orderItems,
        status: this.orderStateMachine.getInitialState(),
        pricing,
        deliveryAddress: dto.deliveryAddress,
        deliveryType: dto.deliveryType,
        paymentMethod: dto.paymentMethod,
        vendorAssignments,
        inventoryReservations,
        notes: dto.notes,
        metadata: dto.metadata,
        tenantId
      });

      // Send notifications
      await this.notificationService.sendNotification({
        type: NotificationType.ORDER_CREATED,
        recipient: dto.customerId,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          total: pricing.total.toString()
        }
      });

      return order;
    } catch (error) {
      // Rollback inventory reservations if order creation fails
      if (inventoryReservations.length > 0) {
        await this.inventoryService.releaseReservations(
          inventoryReservations.map(r => r.reservationId)
        );
      }
      throw error;
    }
  }

  /**
   * Update order status through state machine
   */
  async updateOrderStatus(orderId: string, event: OrderEvent): Promise<Order> {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // Check state transition
    const transition = this.orderStateMachine.transition(order.status, event);

    // Update order status
    const statusHistory: StatusHistoryEntry = {
      from: order.status,
      to: transition.nextState,
      event,
      timestamp: new Date(),
      userId: event.userId
    };

    const updatedOrder = await this.orderRepository.update(orderId, {
      status: transition.nextState,
      statusHistory: [...(order.statusHistory || []), statusHistory]
    });

    // Execute transition actions
    for (const action of transition.actions) {
      await this.executeAction(action, updatedOrder, event);
    }

    return updatedOrder;
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string, reason: string): Promise<Order> {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // Check if order can be cancelled
    if (!this.orderStateMachine.canTransition(order.status, OrderEventType.CANCEL)) {
      throw new Error(`Cannot cancel order in status: ${order.status}`);
    }

    // Release inventory reservations
    if (order.inventoryReservations.length > 0) {
      await this.inventoryService.releaseReservations(
        order.inventoryReservations.map(r => r.reservationId)
      );
    }

    // Update order
    const updatedOrder = await this.orderRepository.update(orderId, {
      status: OrderStatus.CANCELLED,
      cancelledAt: new Date(),
      cancellationReason: reason
    });

    // Send notifications
    await this.notificationService.sendNotification({
      type: NotificationType.ORDER_CANCELLED,
      recipient: order.customerId,
      data: {
        orderId,
        orderNumber: order.orderNumber,
        reason
      }
    });

    // Notify vendors
    for (const assignment of order.vendorAssignments) {
      await this.notificationService.sendNotification({
        type: NotificationType.ORDER_CANCELLED,
        recipient: assignment.vendorId,
        data: {
          orderId,
          orderNumber: order.orderNumber
        }
      });
    }

    return updatedOrder;
  }

  /**
   * Update inventory after order completion
   */
  async updateInventory(orderId: string): Promise<void> {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // Confirm reservations
    await this.inventoryService.confirmReservations(
      order.inventoryReservations.map(r => r.reservationId)
    );

    // Update stock levels
    const stockUpdates = order.items.map(item => ({
      productId: item.productId,
      quantity: -item.quantity
    }));

    await this.inventoryService.updateStock(stockUpdates);
  }

  /**
   * Assign vendor to order items
   */
  async assignVendor(
    orderId: string,
    vendorId: string,
    itemIds: string[]
  ): Promise<Order> {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // Validate vendor can handle items
    await this.vendorAssignmentService.validateVendor(vendorId, itemIds);

    // Get product IDs for the items
    const productIds = order.items
      .filter(item => itemIds.includes(item.id))
      .map(item => item.productId);

    // Update vendor assignments
    const newAssignment: VendorAssignment = {
      vendorId,
      items: productIds,
      assignedAt: new Date()
    };

    const updatedOrder = await this.orderRepository.update(orderId, {
      vendorAssignments: [...order.vendorAssignments, newAssignment]
    });

    // Notify vendor
    await this.notificationService.sendNotification({
      type: NotificationType.VENDOR_ASSIGNED,
      recipient: vendorId,
      data: {
        orderId,
        orderNumber: order.orderNumber,
        items: itemIds
      }
    });

    return updatedOrder;
  }

  /**
   * Get orders by customer
   */
  async getOrdersByCustomer(
    customerId: string,
    filter?: OrderFilter
  ): Promise<OrderSearchResult> {
    return await this.orderRepository.findByCustomer(customerId, filter);
  }

  /**
   * Get orders by vendor
   */
  async getOrdersByVendor(
    vendorId: string,
    filter?: OrderFilter
  ): Promise<OrderSearchResult> {
    return await this.orderRepository.findByVendor(vendorId, filter);
  }

  /**
   * Execute action based on state transition
   */
  private async executeAction(
    action: string,
    order: Order,
    event: OrderEvent
  ): Promise<void> {
    switch (action) {
      case 'notifyCustomer':
        await this.notificationService.sendNotification({
          type: this.mapEventToNotificationType(event.type),
          recipient: order.customerId,
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            status: order.status
          }
        });
        break;

      case 'notifyVendor':
        for (const assignment of order.vendorAssignments) {
          await this.notificationService.sendNotification({
            type: this.mapEventToNotificationType(event.type),
            recipient: assignment.vendorId,
            data: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              status: order.status
            }
          });
        }
        break;

      case 'updateInventory':
        await this.updateInventory(order.id);
        break;

      default:
        console.warn(`Unknown action: ${action}`);
    }
  }

  /**
   * Map order event type to notification type
   */
  private mapEventToNotificationType(eventType: OrderEventType): NotificationType {
    const mapping: Record<OrderEventType, NotificationType> = {
      [OrderEventType.CONFIRM]: NotificationType.ORDER_CONFIRMED,
      [OrderEventType.DELIVER]: NotificationType.ORDER_DELIVERED,
      [OrderEventType.CANCEL]: NotificationType.ORDER_CANCELLED,
      [OrderEventType.REFUND]: NotificationType.REFUND_PROCESSED,
      // Default mappings for other events
      [OrderEventType.START_PROCESSING]: NotificationType.ORDER_CONFIRMED,
      [OrderEventType.MARK_READY]: NotificationType.ORDER_CONFIRMED,
      [OrderEventType.DISPATCH]: NotificationType.ORDER_CONFIRMED,
      [OrderEventType.FAIL]: NotificationType.ORDER_CANCELLED
    };

    return mapping[eventType] || NotificationType.ORDER_CONFIRMED;
  }
}