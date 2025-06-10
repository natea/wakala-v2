import { Payment } from '../interfaces/payment.interfaces';

export class PaymentRepository {
  private payments: Map<string, Payment> = new Map();
  private paymentsByReference: Map<string, Payment> = new Map();

  async create(payment: Omit<Payment, 'id'>): Promise<Payment> {
    const id = `pay-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newPayment = { ...payment, id };
    
    this.payments.set(id, newPayment);
    if (payment.reference) {
      this.paymentsByReference.set(payment.reference, newPayment);
    }
    
    return newPayment;
  }

  async findById(id: string): Promise<Payment | null> {
    return this.payments.get(id) || null;
  }

  async findByReference(reference: string): Promise<Payment | null> {
    return this.paymentsByReference.get(reference) || null;
  }

  async update(id: string, updates: Partial<Payment>): Promise<Payment> {
    const payment = this.payments.get(id);
    if (!payment) {
      throw new Error('Payment not found');
    }

    const updated = { ...payment, ...updates, updatedAt: new Date() };
    this.payments.set(id, updated);
    
    if (updated.reference) {
      this.paymentsByReference.set(updated.reference, updated);
    }
    
    return updated;
  }

  async findByDateRange(startDate: Date, endDate: Date): Promise<Payment[]> {
    const payments: Payment[] = [];
    
    for (const payment of this.payments.values()) {
      if (payment.createdAt >= startDate && payment.createdAt <= endDate) {
        payments.push(payment);
      }
    }
    
    return payments;
  }

  async findByCustomerId(customerId: string): Promise<Payment[]> {
    const payments: Payment[] = [];
    
    for (const payment of this.payments.values()) {
      if (payment.customerId === customerId) {
        payments.push(payment);
      }
    }
    
    return payments;
  }

  async findByOrderId(orderId: string): Promise<Payment[]> {
    const payments: Payment[] = [];
    
    for (const payment of this.payments.values()) {
      if (payment.orderId === orderId) {
        payments.push(payment);
      }
    }
    
    return payments;
  }

  async findByStatus(status: string): Promise<Payment[]> {
    const payments: Payment[] = [];
    
    for (const payment of this.payments.values()) {
      if (payment.status === status) {
        payments.push(payment);
      }
    }
    
    return payments;
  }

  async delete(id: string): Promise<void> {
    const payment = this.payments.get(id);
    if (payment) {
      this.payments.delete(id);
      if (payment.reference) {
        this.paymentsByReference.delete(payment.reference);
      }
    }
  }

  async count(): Promise<number> {
    return this.payments.size;
  }

  async clear(): Promise<void> {
    this.payments.clear();
    this.paymentsByReference.clear();
  }
}