import { 
  PaymentRequest, 
  PaymentResponse, 
  PaymentStatus, 
  PaymentMethod,
  Payment,
  RefundResponse
} from '../interfaces/payment.interfaces';
import { PaymentRepository } from '../repositories/payment.repository';
import { PaystackGateway } from '../gateways/paystack.gateway';
import { YocoGateway } from '../gateways/yoco.gateway';

export class PaymentService {
  constructor(
    private paymentRepository: PaymentRepository,
    private paystackGateway: PaystackGateway,
    private yocoGateway: YocoGateway
  ) {}

  async processPayment(request: PaymentRequest): Promise<PaymentResponse> {
    // Validate request
    this.validatePaymentRequest(request);

    // Select gateway based on currency
    const gateway = this.selectGateway(request.currency);

    // Create payment record
    const payment = await this.paymentRepository.create({
      amount: request.amount,
      currency: request.currency,
      customerId: request.customerId,
      orderId: request.orderId,
      status: PaymentStatus.PENDING,
      paymentMethod: request.paymentMethod,
      gateway: gateway.name,
      reference: this.generateReference(),
      metadata: request.metadata,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    try {
      // Process payment with gateway
      const response = await gateway.initiatePayment(request);
      
      // Update payment record
      await this.paymentRepository.update(payment.id, {
        reference: response.reference,
        status: response.status
      });

      return response;
    } catch (error) {
      // Update payment as failed
      await this.paymentRepository.update(payment.id, {
        status: PaymentStatus.FAILED,
        failureReason: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw error;
    }
  }

  async processMobileMoneyPayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (!request.mobileNumber) {
      throw new Error('Mobile number required for mobile money payment');
    }

    const gateway = this.selectGateway(request.currency);
    
    if (gateway.name === 'paystack') {
      return await this.paystackGateway.initiateMobileMoneyPayment(request);
    }
    
    throw new Error('Mobile money not supported for this currency');
  }

  async processBankTransfer(request: PaymentRequest): Promise<PaymentResponse> {
    const reference = this.generateReference();
    
    // Create virtual account for payment
    const bankAccount = {
      accountNumber: this.generateAccountNumber(),
      accountName: `Wakala - ${request.orderId}`,
      bankName: 'Wakala Virtual Bank',
      bankCode: 'WVB'
    };

    const payment = await this.paymentRepository.create({
      amount: request.amount,
      currency: request.currency,
      customerId: request.customerId,
      orderId: request.orderId,
      status: PaymentStatus.PENDING,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      gateway: 'paystack',
      reference,
      metadata: {
        ...request.metadata,
        bankAccount
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return {
      id: payment.id,
      status: PaymentStatus.PENDING,
      amount: request.amount,
      currency: request.currency,
      reference,
      bankAccount,
      createdAt: new Date()
    };
  }

  async getPaymentStatus(paymentId: string): Promise<{
    id: string;
    status: PaymentStatus;
    amount: number;
    currency: string;
    reference: string;
  }> {
    const payment = await this.paymentRepository.findById(paymentId);
    
    if (!payment) {
      throw new Error('Payment not found');
    }

    return {
      id: payment.id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      reference: payment.reference
    };
  }

  async updatePaymentStatus(paymentId: string, status: PaymentStatus): Promise<Payment> {
    const payment = await this.paymentRepository.findById(paymentId);
    
    if (!payment) {
      throw new Error('Payment not found');
    }

    const updateData: Partial<Payment> = {
      status,
      updatedAt: new Date()
    };

    if (status === PaymentStatus.SUCCESS) {
      updateData.completedAt = new Date();
    }

    const updated = await this.paymentRepository.update(paymentId, updateData);

    return updated;
  }

  async refundPayment(paymentId: string, amount?: number): Promise<RefundResponse> {
    const payment = await this.paymentRepository.findById(paymentId);
    
    if (!payment) {
      throw new Error('Payment not found');
    }

    if (payment.status !== PaymentStatus.SUCCESS) {
      throw new Error('Cannot refund failed payment');
    }

    const refundAmount = amount || payment.amount;
    
    if (refundAmount > payment.amount) {
      throw new Error('Refund amount exceeds original payment');
    }

    const gateway = payment.gateway === 'paystack' ? this.paystackGateway : this.yocoGateway;
    const refund = await gateway.refundPayment(payment.reference, refundAmount);

    // Update payment status
    await this.paymentRepository.update(paymentId, {
      status: refundAmount === payment.amount ? PaymentStatus.REFUNDED : PaymentStatus.PARTIAL_REFUND
    });

    return refund;
  }

  async getPaymentByReference(reference: string): Promise<Payment | null> {
    return await this.paymentRepository.findByReference(reference);
  }

  async handlePaymentTimeout(paymentId: string): Promise<void> {
    await this.updatePaymentStatus(paymentId, PaymentStatus.TIMEOUT);
  }

  isCurrencySupported(currency: string): boolean {
    return ['NGN', 'ZAR'].includes(currency);
  }

  calculateFee(amount: number, paymentMethod: PaymentMethod): number {
    switch (paymentMethod) {
      case PaymentMethod.CARD:
        return Math.round(amount * 0.015); // 1.5%
      case PaymentMethod.BANK_TRANSFER:
        return 100; // Flat fee
      case PaymentMethod.MOBILE_MONEY:
        return Math.round(amount * 0.01); // 1%
      default:
        return 0;
    }
  }

  formatAmountForGateway(amount: number): number {
    // Convert to smallest currency unit (kobo for NGN, cents for ZAR)
    return Math.round(amount * 100);
  }

  private validatePaymentRequest(request: PaymentRequest): void {
    if (request.amount <= 0) {
      throw new Error('Invalid payment request: Amount must be positive');
    }

    if (!this.isCurrencySupported(request.currency)) {
      throw new Error('Invalid payment request: Unsupported currency');
    }

    if (!request.customerId || !request.orderId) {
      throw new Error('Invalid payment request: Customer ID and Order ID required');
    }

    if (!Object.values(PaymentMethod).includes(request.paymentMethod)) {
      throw new Error('Invalid payment request: Invalid payment method');
    }
  }

  private selectGateway(currency: string): any {
    switch (currency) {
      case 'NGN':
        return this.paystackGateway;
      case 'ZAR':
        return this.yocoGateway;
      default:
        throw new Error('Unsupported currency');
    }
  }

  private generateReference(): string {
    return `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateAccountNumber(): string {
    return `9${Math.floor(Math.random() * 900000000 + 100000000)}`;
  }
}