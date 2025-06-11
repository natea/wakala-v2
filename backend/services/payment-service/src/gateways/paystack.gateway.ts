import axios from 'axios';
import { 
  PaymentGateway, 
  PaymentRequest, 
  PaymentResponse, 
  Payment,
  RefundResponse,
  PaymentStatus,
  PaymentMethod
} from '../interfaces/payment.interfaces';

export interface PaystackConfig {
  secretKey?: string;
  publicKey?: string;
  baseUrl?: string;
}

export class PaystackGateway implements PaymentGateway {
  public readonly name = 'paystack';
  private secretKey: string;
  private baseUrl: string;

  constructor(config: PaystackConfig) {
    this.secretKey = config.secretKey || process.env['PAYSTACK_SECRET_KEY'] || '';
    this.baseUrl = config.baseUrl || 'https://api.paystack.co';
  }

  async initiatePayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transaction/initialize`,
        {
          amount: request.amount * 100, // Convert to kobo
          email: `${request.customerId}@wakala.com`,
          currency: request.currency,
          reference: this.generateReference(),
          metadata: {
            customerId: request.customerId,
            orderId: request.orderId,
            ...request.metadata
          },
          channels: this.getChannels(request.paymentMethod)
        },
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const { data } = response.data;

      return {
        id: data.reference,
        status: PaymentStatus.PENDING,
        amount: request.amount,
        currency: request.currency,
        reference: data.reference,
        authorizationUrl: data.authorization_url,
        createdAt: new Date()
      };
    } catch (error: any) {
      throw new Error(`Paystack error: ${error.response?.data?.message || error.message || 'Unknown error'}`);
    }
  }

  async initiateMobileMoneyPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/charge`,
        {
          amount: request.amount * 100,
          email: `${request.customerId}@wakala.com`,
          currency: request.currency,
          mobile_money: {
            phone: request.mobileNumber,
            provider: 'mtn' // Auto-detect provider in real implementation
          },
          metadata: {
            customerId: request.customerId,
            orderId: request.orderId
          }
        },
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const { data } = response.data;

      return {
        id: data.reference,
        status: PaymentStatus.PENDING,
        amount: request.amount,
        currency: request.currency,
        reference: data.reference,
        ussdCode: data.display_text,
        createdAt: new Date()
      };
    } catch (error: any) {
      throw new Error(`Mobile money error: ${error.response?.data?.message || error.message || 'Unknown error'}`);
    }
  }

  async verifyPayment(reference: string): Promise<Payment> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`
          }
        }
      );

      const { data } = response.data;

      const payment: Payment = {
        id: data.id,
        amount: data.amount / 100,
        currency: data.currency,
        customerId: data.metadata.customerId,
        orderId: data.metadata.orderId,
        status: this.mapStatus(data.status),
        paymentMethod: PaymentMethod.CARD,
        gateway: 'paystack',
        reference: data.reference,
        authorizationCode: data.authorization?.authorization_code,
        metadata: data.metadata,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.created_at)
      };

      if (data.paid_at) {
        payment.completedAt = new Date(data.paid_at);
      }

      return payment;
    } catch (error: any) {
      throw new Error(`Verification error: ${error.response?.data?.message || error.message || 'Unknown error'}`);
    }
  }

  async refundPayment(reference: string, amount?: number): Promise<RefundResponse> {
    try {
      const payload: any = { transaction: reference };
      
      if (amount) {
        payload.amount = amount * 100; // Convert to kobo
      }

      const response = await axios.post(
        `${this.baseUrl}/refund`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const { data } = response.data;

      return {
        id: data.id,
        paymentId: reference,
        amount: data.amount / 100,
        status: data.status,
        createdAt: new Date(data.created_at)
      };
    } catch (error: any) {
      throw new Error(`Refund error: ${error.response?.data?.message || error.message || 'Unknown error'}`);
    }
  }

  async getTransactions(startDate: Date, endDate: Date): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/transaction`,
        {
          params: {
            from: startDate.toISOString(),
            to: endDate.toISOString(),
            perPage: 100
          },
          headers: {
            Authorization: `Bearer ${this.secretKey}`
          }
        }
      );

      return response.data.data.map((transaction: any) => ({
        reference: transaction.reference,
        amount: transaction.amount / 100,
        status: transaction.status,
        currency: transaction.currency,
        createdAt: transaction.created_at
      }));
    } catch (error: any) {
      throw new Error(`Failed to fetch transactions: ${error.message || 'Unknown error'}`);
    }
  }

  private generateReference(): string {
    return `PSK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private getChannels(paymentMethod: string): string[] {
    switch (paymentMethod) {
      case 'CARD':
        return ['card'];
      case 'BANK_TRANSFER':
        return ['bank_transfer'];
      case 'MOBILE_MONEY':
        return ['mobile_money'];
      case 'USSD':
        return ['ussd'];
      default:
        return ['card', 'bank', 'ussd', 'mobile_money'];
    }
  }

  private mapStatus(paystackStatus: string): PaymentStatus {
    switch (paystackStatus) {
      case 'success':
        return PaymentStatus.SUCCESS;
      case 'failed':
        return PaymentStatus.FAILED;
      case 'pending':
        return PaymentStatus.PENDING;
      case 'reversed':
        return PaymentStatus.REFUNDED;
      default:
        return PaymentStatus.PENDING;
    }
  }
}