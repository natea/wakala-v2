import { Decimal } from 'decimal.js';

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PROCESSING = 'PROCESSING',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  FAILED = 'FAILED'
}

export enum OrderEventType {
  CONFIRM = 'CONFIRM',
  START_PROCESSING = 'START_PROCESSING',
  MARK_READY = 'MARK_READY',
  DISPATCH = 'DISPATCH',
  DELIVER = 'DELIVER',
  CANCEL = 'CANCEL',
  REFUND = 'REFUND',
  FAIL = 'FAIL'
}

export enum PaymentMethod {
  CASH_ON_DELIVERY = 'CASH_ON_DELIVERY',
  CARD = 'CARD',
  MOBILE_MONEY = 'MOBILE_MONEY',
  BANK_TRANSFER = 'BANK_TRANSFER'
}

export enum DeliveryType {
  STANDARD = 'STANDARD',
  EXPRESS = 'EXPRESS',
  PICKUP = 'PICKUP'
}

export enum NotificationType {
  ORDER_CREATED = 'ORDER_CREATED',
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
  VENDOR_ASSIGNED = 'VENDOR_ASSIGNED',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  REFUND_PROCESSED = 'REFUND_PROCESSED'
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  items: OrderItem[];
  status: OrderStatus;
  pricing: PriceCalculation;
  deliveryAddress: Address;
  deliveryType: DeliveryType;
  paymentMethod: PaymentMethod;
  paymentStatus?: PaymentStatus;
  vendorAssignments: VendorAssignment[];
  inventoryReservations: InventoryReservation[];
  statusHistory?: StatusHistoryEntry[];
  notes?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  tenantId: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName?: string;
  quantity: number;
  unitPrice: Decimal;
  totalPrice?: Decimal;
  status: string;
  vendorId?: string;
  notes?: string;
  metadata?: Record<string, any>;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface PriceCalculation {
  subtotal: Decimal;
  tax: Decimal;
  deliveryFee: Decimal;
  total: Decimal;
  discounts: Discount[];
}

export interface Discount {
  code: string;
  amount: Decimal;
  type: 'PERCENTAGE' | 'FIXED';
  description?: string;
}

export interface VendorAssignment {
  vendorId: string;
  items: string[]; // Product IDs
  assignedAt: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
}

export interface InventoryReservation {
  productId: string;
  quantity: number;
  reservationId: string;
  expiresAt: Date;
  confirmed?: boolean;
}

export interface PaymentStatus {
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
  transactionId?: string;
  amount: Decimal;
  paidAt?: Date;
  failureReason?: string;
}

export interface StatusHistoryEntry {
  from: OrderStatus;
  to: OrderStatus;
  event: OrderEvent;
  timestamp: Date;
  userId?: string;
  notes?: string;
}

export interface OrderEvent {
  type: OrderEventType;
  data?: any;
  userId?: string;
  timestamp?: Date;
}

// DTOs
export interface CreateOrderDto {
  customerId: string;
  items: CreateOrderItemDto[];
  deliveryAddress: Address;
  deliveryType: DeliveryType;
  paymentMethod: PaymentMethod;
  notes?: string;
  metadata?: Record<string, any>;
}

export interface CreateOrderItemDto {
  productId: string;
  quantity: number;
  unitPrice: Decimal;
  notes?: string;
}

export interface UpdateOrderDto {
  items?: UpdateOrderItemDto[];
  deliveryAddress?: Address;
  deliveryType?: DeliveryType;
  notes?: string;
  metadata?: Record<string, any>;
}

export interface UpdateOrderItemDto {
  id: string;
  quantity?: number;
  notes?: string;
}

export interface OrderFilter {
  status?: OrderStatus[];
  customerId?: string;
  vendorId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt' | 'total';
  orderDirection?: 'ASC' | 'DESC';
}

export interface OrderSearchResult {
  orders: Order[];
  total: number;
  page?: number;
  pageSize?: number;
}

// Notification interfaces
export interface Notification {
  type: NotificationType;
  recipient: string;
  data: any;
  channel?: 'WHATSAPP' | 'EMAIL' | 'SMS';
}

// State machine interfaces
export interface OrderTransition {
  nextState: OrderStatus;
  actions: string[];
}

export interface StateTransitionResult {
  success: boolean;
  newState?: OrderStatus;
  error?: string;
}