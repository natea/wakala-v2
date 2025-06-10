import axios from 'axios';
import { 
  PaymentGateway, 
  PaymentRequest, 
  PaymentResponse, 
  Payment,
  RefundResponse,
  PaymentStatus 
} from '../interfaces/payment.interfaces';

export interface YocoConfig {
  secretKey?: string;
  publicKey?: string;
  baseUrl?: string;
}

export class YocoGateway implements PaymentGateway {
  public readonly name = 'yoco';
  private secretKey: string;
  private publicKey: string;
  private baseUrl: string;

  constructor(config: YocoConfig) {
    this.secretKey = config.secretKey || process.env.YOCO_SECRET_KEY || '';
    this.publicKey = config.publicKey || process.env.YOCO_PUBLIC_KEY || '';
    this.baseUrl = config.baseUrl || 'https://api.yoco.com/v1';
  }

  async initiatePayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/checkouts`,
        {
          amount: request.amount * 100, // Convert to cents
          currency: request.currency,
          metadata: {
            customerId: request.customerId,
            orderId: request.orderId,
            reference: this.generateReference(),
            ...request.metadata
          },
          successUrl: `${process.env.FRONTEND_URL}/payment/success`,
          cancelUrl: `${process.env.FRONTEND_URL}/payment/cancel`,
          failureUrl: `${process.env.FRONTEND_URL}/payment/failure`
        },
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const { data } = response;

      return {
        id: data.id,
        status: PaymentStatus.PENDING,
        amount: request.amount,
        currency: request.currency,
        reference: data.metadata.reference,
        authorizationUrl: data.redirectUrl,
        createdAt: new Date()
      };
    } catch (error) {
      throw new Error(`Yoco error: ${error.response?.data?.message || error.message}`);
    }
  }

  async verifyPayment(reference: string): Promise<Payment> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/checkouts/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`
          }
        }
      );

      const { data } = response;

      return {
        id: data.id,
        amount: data.amount / 100,
        currency: data.currency,
        customerId: data.metadata.customerId,
        orderId: data.metadata.orderId,
        status: this.mapStatus(data.status),
        paymentMethod: 'CARD' as any,
        gateway: 'yoco',
        reference: data.metadata.reference,
        metadata: data.metadata,
        createdAt: new Date(data.createdDate),
        updatedAt: new Date(data.updatedDate),
        completedAt: data.status === 'successful' ? new Date(data.updatedDate) : undefined
      };
    } catch (error) {
      throw new Error(`Verification error: ${error.response?.data?.message || error.message}`);
    }
  }

  async refundPayment(reference: string, amount?: number): Promise<RefundResponse> {
    try {
      // First, get the payment to find the charge ID
      const payment = await this.verifyPayment(reference);
      
      const payload: any = {};
      if (amount) {
        payload.amount = amount * 100; // Convert to cents
      }

      const response = await axios.post(
        `${this.baseUrl}/refunds`,
        {
          paymentId: payment.id,
          ...payload
        },
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const { data } = response;

      return {
        id: data.id,
        paymentId: payment.id,
        amount: data.amount / 100,
        status: data.status,
        createdAt: new Date(data.createdDate)
      };
    } catch (error) {
      throw new Error(`Refund error: ${error.response?.data?.message || error.message}`);
    }
  }

  async getTransactions(startDate: Date, endDate: Date): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/payments`,
        {
          params: {
            from: startDate.toISOString(),
            to: endDate.toISOString(),
            limit: 100
          },
          headers: {
            Authorization: `Bearer ${this.secretKey}`
          }
        }
      );

      return response.data.payments.map((payment: any) => ({
        reference: payment.metadata?.reference || payment.id,
        amount: payment.amount / 100,
        status: payment.status,
        currency: payment.currency,
        createdAt: payment.createdDate
      }));
    } catch (error) {
      throw new Error(`Failed to fetch transactions: ${error.message}`);
    }
  }

  private generateReference(): string {
    return `YCO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private mapStatus(yocoStatus: string): PaymentStatus {
    switch (yocoStatus) {
      case 'successful':
      case 'succeeded':
        return PaymentStatus.SUCCESS;
      case 'failed':
        return PaymentStatus.FAILED;
      case 'pending':
        return PaymentStatus.PENDING;
      case 'processing':
        return PaymentStatus.PROCESSING;
      case 'cancelled':
        return PaymentStatus.CANCELLED;
      case 'refunded':
        return PaymentStatus.REFUNDED;
      default:
        return PaymentStatus.PENDING;
    }
  }
}