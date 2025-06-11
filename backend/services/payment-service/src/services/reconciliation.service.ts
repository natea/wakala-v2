import { 
  ReconciliationResult, 
  ReconciliationStatus,
  Discrepancy,
  PaymentReport
} from '../interfaces/payment.interfaces';
import { PaymentRepository } from '../repositories/payment.repository';
import { PaymentGateway } from '../interfaces/payment.interfaces';

export class ReconciliationService {
  constructor(
    private paymentRepository: PaymentRepository,
    private gateways: Record<string, PaymentGateway>
  ) {}

  async reconcilePayments(
    startDate: Date, 
    endDate: Date
  ): Promise<ReconciliationResult> {
    const reconciliationId = `recon-${Date.now()}`;
    const discrepancies: Discrepancy[] = [];
    let matched = 0;
    let mismatched = 0;
    let missing = 0;

    try {
      // Get payments from database
      const dbPayments = await this.paymentRepository.findByDateRange(startDate, endDate);
      const dbPaymentMap = new Map(dbPayments.map(p => [p.reference, p]));

      // Get transactions from each gateway
      for (const [, gateway] of Object.entries(this.gateways)) {
        const gatewayTransactions = await gateway.getTransactions(startDate, endDate);
        
        // Check each gateway transaction
        for (const transaction of gatewayTransactions) {
          const dbPayment = dbPaymentMap.get(transaction.reference);
          
          if (!dbPayment) {
            // Transaction exists in gateway but not in database
            missing++;
            discrepancies.push({
              type: 'missing_in_db',
              reference: transaction.reference,
              gatewayRecord: transaction
            });
            continue;
          }

          // Compare amounts
          if (dbPayment.amount !== transaction.amount) {
            mismatched++;
            discrepancies.push({
              type: 'amount_mismatch',
              reference: transaction.reference,
              dbRecord: dbPayment,
              gatewayRecord: transaction,
              difference: Math.abs(dbPayment.amount - transaction.amount)
            });
            dbPaymentMap.delete(transaction.reference); // Remove from map even if mismatched
            continue;
          }

          // Compare status
          const gatewayStatus = this.mapGatewayStatus(transaction.status);
          if (dbPayment.status !== gatewayStatus) {
            mismatched++;
            discrepancies.push({
              type: 'status_mismatch',
              reference: transaction.reference,
              dbRecord: dbPayment,
              gatewayRecord: transaction
            });
            dbPaymentMap.delete(transaction.reference); // Remove from map even if mismatched
            continue;
          }

          // Payment matches
          matched++;
          dbPaymentMap.delete(transaction.reference);
        }
      }

      // Check for payments in DB but not in gateway
      for (const [reference, payment] of dbPaymentMap) {
        if (payment.status === 'SUCCESS') {
          missing++;
          discrepancies.push({
            type: 'missing_in_gateway',
            reference,
            dbRecord: payment
          });
        }
      }

      const totalProcessed = matched + mismatched + missing;

      return {
        id: reconciliationId,
        status: ReconciliationStatus.COMPLETED,
        startDate,
        endDate,
        matched,
        mismatched,
        missing,
        totalProcessed,
        discrepancies
      };
    } catch (error) {
      return {
        id: reconciliationId,
        status: ReconciliationStatus.FAILED,
        startDate,
        endDate,
        matched: 0,
        mismatched: 0,
        missing: 0,
        totalProcessed: 0,
        discrepancies: []
      };
    }
  }

  async generateReport(result: ReconciliationResult): Promise<PaymentReport> {
    const successRate = result.totalProcessed > 0 
      ? (result.matched / result.totalProcessed) * 100 
      : 0;

    // Get additional statistics
    const payments = await this.paymentRepository.findByDateRange(
      result.startDate,
      result.endDate
    );

    const summary = {
      totalTransactions: payments.length,
      totalAmount: payments.reduce((sum, p) => sum + p.amount, 0),
      successRate,
      averageAmount: payments.length > 0 
        ? payments.reduce((sum, p) => sum + p.amount, 0) / payments.length 
        : 0,
      topPaymentMethod: this.getMostFrequent(payments.map(p => p.paymentMethod))
    };

    const details = {
      byStatus: this.groupBy(payments, 'status'),
      byMethod: this.groupBy(payments, 'paymentMethod'),
      byGateway: this.groupBy(payments, 'gateway'),
      byCurrency: this.groupBy(payments, 'currency')
    };

    return { summary, details };
  }

  async autoReconcile(schedule: 'daily' | 'weekly' | 'monthly'): Promise<void> {
    // In a real implementation, this would be scheduled
    const endDate = new Date();
    const startDate = new Date();

    switch (schedule) {
      case 'daily':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'weekly':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'monthly':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
    }

    const result = await this.reconcilePayments(startDate, endDate);
    
    // Send notifications if discrepancies found
    if (result.discrepancies.length > 0) {
      await this.notifyDiscrepancies(result);
    }
  }

  private mapGatewayStatus(gatewayStatus: string): string {
    const statusMap: Record<string, string> = {
      'success': 'SUCCESS',
      'succeeded': 'SUCCESS',
      'failed': 'FAILED',
      'pending': 'PENDING',
      'processing': 'PROCESSING'
    };

    return statusMap[gatewayStatus.toLowerCase()] || 'UNKNOWN';
  }

  private groupBy(items: any[], key: string): Record<string, number> {
    return items.reduce((acc, item) => {
      const value = item[key];
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
  }

  private getMostFrequent(items: string[]): string {
    const frequency: Record<string, number> = {};
    let maxCount = 0;
    let mostFrequent = '';

    for (const item of items) {
      frequency[item] = (frequency[item] || 0) + 1;
      if (frequency[item] > maxCount) {
        maxCount = frequency[item];
        mostFrequent = item;
      }
    }

    return mostFrequent;
  }

  private async notifyDiscrepancies(result: ReconciliationResult): Promise<void> {
    // In a real implementation, this would send emails/SMS/Slack notifications
    console.log(`Reconciliation completed with ${result.discrepancies.length} discrepancies`);
  }
}