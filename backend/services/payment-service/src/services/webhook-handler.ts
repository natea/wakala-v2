import crypto from 'crypto';
import { WebhookEvent, PaymentStatus } from '../interfaces/payment.interfaces';
import { PaymentService } from './payment.service';

export class WebhookHandler {
  private processedWebhooks: Set<string> = new Set();

  constructor(private paymentService: PaymentService) {}

  async handlePaystackWebhook(
    event: WebhookEvent,
    timeout: number = 5000
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Check for duplicate webhook
      const eventId = `${event.event}-${event.data.reference}`;
      if (this.processedWebhooks.has(eventId)) {
        return { success: false, error: 'Duplicate webhook' };
      }

      // Process with timeout
      const result = await this.processWithTimeout(
        this.processPaystackEvent(event),
        timeout
      );

      // Mark as processed
      this.processedWebhooks.add(eventId);
      
      // Clean up old webhook IDs (keep last 1000)
      if (this.processedWebhooks.size > 1000) {
        const oldestIds = Array.from(this.processedWebhooks).slice(0, 100);
        oldestIds.forEach(id => this.processedWebhooks.delete(id));
      }

      return result;
    } catch (error) {
      if (error.message === 'Timeout') {
        throw new Error('Webhook processing timeout');
      }
      return { success: false, error: error.message };
    }
  }

  async handleYocoWebhook(event: any): Promise<{ success: boolean; error?: string }> {
    try {
      const reference = event.payload?.metadata?.reference;
      if (!reference) {
        return { success: false, error: 'Missing reference in webhook' };
      }

      const payment = await this.paymentService.getPaymentByReference(reference);
      if (!payment) {
        return { success: false, error: 'Payment not found' };
      }

      const status = this.mapYocoStatus(event.type);
      await this.paymentService.updatePaymentStatus(payment.id, status);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  verifySignature(payload: string, signature: string, secret: string): boolean {
    const hash = this.generateSignature(payload, secret);
    return hash === signature;
  }

  generateSignature(payload: string, secret: string): string {
    return crypto
      .createHmac('sha512', secret)
      .update(payload)
      .digest('hex');
  }

  private async processPaystackEvent(
    event: WebhookEvent
  ): Promise<{ success: boolean; error?: string }> {
    const { data } = event;
    
    switch (event.event) {
      case 'charge.success':
        return await this.handleChargeSuccess(data);
      
      case 'charge.failed':
        return await this.handleChargeFailed(data);
      
      case 'transfer.success':
        return await this.handleTransferSuccess(data);
      
      case 'transfer.failed':
        return await this.handleTransferFailed(data);
      
      case 'refund.processed':
        return await this.handleRefundProcessed(data);
      
      default:
        return { success: true }; // Ignore unknown events
    }
  }

  private async handleChargeSuccess(data: any): Promise<{ success: boolean; error?: string }> {
    const reference = data.reference;
    const payment = await this.paymentService.getPaymentByReference(reference);
    
    if (!payment) {
      // Try to find by metadata
      const paymentId = data.metadata?.paymentId;
      if (paymentId) {
        await this.paymentService.updatePaymentStatus(paymentId, PaymentStatus.SUCCESS);
        return { success: true };
      }
      return { success: false, error: 'Payment not found' };
    }

    await this.paymentService.updatePaymentStatus(payment.id, PaymentStatus.SUCCESS);
    return { success: true };
  }

  private async handleChargeFailed(data: any): Promise<{ success: boolean; error?: string }> {
    const reference = data.reference;
    const payment = await this.paymentService.getPaymentByReference(reference);
    
    if (payment) {
      await this.paymentService.updatePaymentStatus(payment.id, PaymentStatus.FAILED);
    }
    
    return { success: true };
  }

  private async handleTransferSuccess(data: any): Promise<{ success: boolean; error?: string }> {
    // Handle split payment transfers
    console.log('Transfer successful:', data);
    return { success: true };
  }

  private async handleTransferFailed(data: any): Promise<{ success: boolean; error?: string }> {
    // Handle failed transfers
    console.log('Transfer failed:', data);
    return { success: true };
  }

  private async handleRefundProcessed(data: any): Promise<{ success: boolean; error?: string }> {
    const reference = data.transaction_reference;
    const payment = await this.paymentService.getPaymentByReference(reference);
    
    if (payment) {
      const isFullRefund = data.amount === payment.amount;
      await this.paymentService.updatePaymentStatus(
        payment.id,
        isFullRefund ? PaymentStatus.REFUNDED : PaymentStatus.PARTIAL_REFUND
      );
    }
    
    return { success: true };
  }

  private mapYocoStatus(eventType: string): PaymentStatus {
    switch (eventType) {
      case 'payment.succeeded':
        return PaymentStatus.SUCCESS;
      case 'payment.failed':
        return PaymentStatus.FAILED;
      case 'payment.cancelled':
        return PaymentStatus.CANCELLED;
      case 'refund.succeeded':
        return PaymentStatus.REFUNDED;
      default:
        return PaymentStatus.PENDING;
    }
  }

  private async processWithTimeout<T>(
    promise: Promise<T>,
    timeout: number
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), timeout)
      )
    ]);
  }
}