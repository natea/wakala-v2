import { 
  PaymentRequest, 
  PaymentResponse, 
  PaymentStatus,
  SplitPaymentRequest,
  RecurringPaymentRequest,
  Subscription
} from '../interfaces/payment.interfaces';
import { PaymentService } from './payment.service';

export class PaymentOrchestrator {
  private activeSubscriptions: Map<string, Subscription> = new Map();

  constructor(private paymentService: PaymentService) {}

  async processSplitPayment(request: SplitPaymentRequest): Promise<{
    id: string;
    status: PaymentStatus;
    totalAmount: number;
    currency: string;
    splits: Array<{ accountId: string; amount: number; status: string }>;
  }> {
    // Validate split amounts
    const totalSplitAmount = request.splits.reduce((sum, split) => sum + split.amount, 0);
    if (totalSplitAmount !== request.totalAmount) {
      throw new Error('Split amounts do not match total amount');
    }

    // Process main payment
    const paymentRequest: PaymentRequest = {
      amount: request.totalAmount,
      currency: request.currency,
      customerId: request.customerId,
      orderId: request.orderId,
      paymentMethod: 'CARD' as any,
      metadata: {
        type: 'split_payment',
        splits: request.splits
      }
    };

    const payment = await this.paymentService.processPayment(paymentRequest);

    // Return split payment response
    return {
      id: payment.id,
      status: payment.status,
      totalAmount: request.totalAmount,
      currency: request.currency,
      splits: request.splits.map(split => ({
        accountId: split.accountId,
        amount: split.amount,
        status: payment.status === PaymentStatus.SUCCESS ? 'distributed' : 'pending'
      }))
    };
  }

  async createRecurringPayment(request: RecurringPaymentRequest): Promise<Subscription> {
    const subscriptionId = `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const subscription: Subscription = {
      id: subscriptionId,
      customerId: request.customerId,
      amount: request.amount,
      currency: request.currency,
      interval: request.interval,
      status: 'active',
      nextPaymentDate: this.calculateNextPaymentDate(request.startDate, request.interval),
      createdAt: new Date()
    };

    // Store subscription
    this.activeSubscriptions.set(subscriptionId, subscription);

    // Schedule first payment
    this.schedulePayment(subscription);

    return subscription;
  }

  async cancelRecurringPayment(subscriptionId: string): Promise<{ id: string; status: string }> {
    const subscription = this.activeSubscriptions.get(subscriptionId);
    
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    subscription.status = 'cancelled';
    this.activeSubscriptions.set(subscriptionId, subscription);

    return {
      id: subscriptionId,
      status: 'cancelled'
    };
  }

  async processPaymentWithRetry(
    request: PaymentRequest, 
    maxRetries: number = 3
  ): Promise<PaymentResponse> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.paymentService.processPayment(request);
        return response;
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry if it's a validation error
        if (lastError.message.includes('Invalid payment request')) {
          throw lastError;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw new Error(`Payment failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  async processPaymentWithFallback(
    request: PaymentRequest,
    fallbackMethods: string[]
  ): Promise<PaymentResponse> {
    const originalMethod = request.paymentMethod;
    
    try {
      return await this.paymentService.processPayment(request);
    } catch (error) {
      // Try fallback methods
      for (const method of fallbackMethods) {
        try {
          request.paymentMethod = method as any;
          return await this.paymentService.processPayment(request);
        } catch (fallbackError) {
          continue;
        }
      }
      
      // All methods failed
      request.paymentMethod = originalMethod;
      throw error;
    }
  }

  async bulkProcessPayments(
    requests: PaymentRequest[]
  ): Promise<Array<{ request: PaymentRequest; result: PaymentResponse | Error }>> {
    const results = await Promise.allSettled(
      requests.map(request => this.paymentService.processPayment(request))
    );

    return results.map((result, index) => ({
      request: requests[index]!,
      result: result.status === 'fulfilled' ? result.value : result.reason
    }));
  }

  private calculateNextPaymentDate(startDate: Date, interval: string): Date {
    const next = new Date(startDate);
    
    switch (interval) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        break;
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'yearly':
        next.setFullYear(next.getFullYear() + 1);
        break;
    }
    
    return next;
  }

  private schedulePayment(subscription: Subscription): void {
    // In a real implementation, this would use a job scheduler
    // For now, we'll just log the scheduled payment
    console.log(`Payment scheduled for subscription ${subscription.id} on ${subscription.nextPaymentDate}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}