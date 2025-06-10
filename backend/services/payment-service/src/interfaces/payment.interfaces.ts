export enum PaymentMethod {
  CARD = 'CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  MOBILE_MONEY = 'MOBILE_MONEY',
  USSD = 'USSD'
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  PARTIAL_REFUND = 'PARTIAL_REFUND',
  TIMEOUT = 'TIMEOUT'
}

export enum ReconciliationStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export interface PaymentRequest {
  amount: number;
  currency: string;
  customerId: string;
  orderId: string;
  paymentMethod: PaymentMethod;
  cardNumber?: string;
  cardCvv?: string;
  cardExpiry?: string;
  mobileNumber?: string;
  bankCode?: string;
  accountNumber?: string;
  metadata: Record<string, any>;
}

export interface PaymentResponse {
  id: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  reference: string;
  authorizationUrl?: string;
  ussdCode?: string;
  bankAccount?: BankAccount;
  createdAt: Date;
}

export interface BankAccount {
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode: string;
}

export interface Payment {
  id: string;
  amount: number;
  currency: string;
  customerId: string;
  orderId: string;
  status: PaymentStatus;
  paymentMethod: PaymentMethod;
  gateway: string;
  reference: string;
  authorizationCode?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  failureReason?: string;
}

export interface RefundRequest {
  paymentId: string;
  amount?: number;
  reason: string;
  metadata?: Record<string, any>;
}

export interface RefundResponse {
  id: string;
  paymentId: string;
  amount: number;
  status: string;
  createdAt: Date;
}

export interface WebhookEvent {
  event: string;
  data: any;
}

export interface ReconciliationResult {
  id: string;
  status: ReconciliationStatus;
  startDate: Date;
  endDate: Date;
  matched: number;
  mismatched: number;
  missing: number;
  totalProcessed: number;
  discrepancies: Discrepancy[];
}

export interface Discrepancy {
  type: 'amount_mismatch' | 'status_mismatch' | 'missing_in_gateway' | 'missing_in_db';
  reference: string;
  dbRecord?: any;
  gatewayRecord?: any;
  difference?: number;
}

export interface PaymentGateway {
  name: string;
  initiatePayment(request: PaymentRequest): Promise<PaymentResponse>;
  verifyPayment(reference: string): Promise<Payment>;
  refundPayment(reference: string, amount?: number): Promise<RefundResponse>;
  getTransactions(startDate: Date, endDate: Date): Promise<any[]>;
}

export interface SplitPaymentRequest {
  totalAmount: number;
  currency: string;
  customerId: string;
  orderId: string;
  splits: PaymentSplit[];
}

export interface PaymentSplit {
  accountId: string;
  amount: number;
  feeBearer?: 'account' | 'customer';
}

export interface RecurringPaymentRequest {
  amount: number;
  currency: string;
  customerId: string;
  interval: 'daily' | 'weekly' | 'monthly' | 'yearly';
  startDate: Date;
  endDate?: Date;
}

export interface Subscription {
  id: string;
  customerId: string;
  amount: number;
  currency: string;
  interval: string;
  status: 'active' | 'paused' | 'cancelled';
  nextPaymentDate: Date;
  createdAt: Date;
}

export interface PaymentReport {
  summary: {
    totalTransactions: number;
    totalAmount: number;
    successRate: number;
    averageAmount: number;
    topPaymentMethod: string;
  };
  details: {
    byStatus: Record<string, number>;
    byMethod: Record<string, number>;
    byGateway: Record<string, number>;
    byCurrency: Record<string, number>;
  };
}