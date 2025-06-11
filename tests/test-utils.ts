import { Payment, PaymentStatus, PaymentMethod } from '../backend/services/payment-service/src/interfaces/payment.interfaces';
import { Order, OrderStatus, PaymentMethod as OrderPaymentMethod, DeliveryType } from '../backend/services/order-service/src/interfaces/order.interface';
import { Decimal } from 'decimal.js';

export function createMockPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-123',
    amount: 10000,
    currency: 'NGN',
    customerId: 'cust-123',
    orderId: 'order-123',
    status: PaymentStatus.SUCCESS,
    paymentMethod: PaymentMethod.CARD,
    gateway: 'paystack',
    reference: 'ref-123',
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

export function createMockOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-123',
    orderNumber: 'ORD-123',
    customerId: 'cust-123',
    items: [],
    status: OrderStatus.PENDING,
    pricing: {
      subtotal: new Decimal(10000),
      tax: new Decimal(0),
      deliveryFee: new Decimal(500),
      total: new Decimal(10500),
      discounts: []
    },
    deliveryAddress: {
      street: '123 Test St',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
      postalCode: '100001',
      coordinates: { latitude: 6.5244, longitude: 3.3792 }
    },
    deliveryType: DeliveryType.EXPRESS,
    paymentMethod: OrderPaymentMethod.CARD,
    paymentStatus: {
      status: 'PENDING',
      amount: new Decimal(10500)
    },
    vendorAssignments: [],
    inventoryReservations: [],
    tenantId: 'tenant-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}