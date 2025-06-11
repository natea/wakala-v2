import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { PaymentService } from '../services/payment.service';
import { PaymentOrchestrator } from '../services/payment-orchestrator';
import { ReconciliationService } from '../services/reconciliation.service';
import { WebhookHandler } from '../services/webhook-handler';
import { PaystackGateway } from '../gateways/paystack.gateway';
import { YocoGateway } from '../gateways/yoco.gateway';
import { PaymentRepository } from '../repositories/payment.repository';
import { 
  PaymentMethod, 
  PaymentStatus, 
  PaymentRequest,
  PaymentResponse,
  WebhookEvent,
  ReconciliationStatus
} from '../interfaces/payment.interfaces';
import { createMockPayment } from '../../../../../tests/test-utils';

// Mock dependencies
jest.mock('../gateways/paystack.gateway');
jest.mock('../gateways/yoco.gateway');
jest.mock('../repositories/payment.repository');

describe('Payment Service', () => {
  let paymentService: PaymentService;
  let paymentRepository: jest.Mocked<PaymentRepository>;
  let paystackGateway: jest.Mocked<PaystackGateway>;
  let yocoGateway: jest.Mocked<YocoGateway>;

  beforeEach(() => {
    paymentRepository = new PaymentRepository() as jest.Mocked<PaymentRepository>;
    paystackGateway = new PaystackGateway({}) as jest.Mocked<PaystackGateway>;
    yocoGateway = new YocoGateway({}) as jest.Mocked<YocoGateway>;
    
    paymentService = new PaymentService(
      paymentRepository,
      paystackGateway,
      yocoGateway
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Payment Processing', () => {
    test('should process payment with Paystack', async () => {
      const paymentRequest: PaymentRequest = {
        amount: 10000,
        currency: 'NGN',
        customerId: 'cust-123',
        orderId: 'order-123',
        paymentMethod: PaymentMethod.CARD,
        metadata: {
          tenantId: 'tenant-123',
          description: 'Order payment'
        }
      };

      const mockResponse: PaymentResponse = {
        id: 'pay-123',
        status: PaymentStatus.PENDING,
        amount: 10000,
        currency: 'NGN',
        reference: 'ref-123',
        authorizationUrl: 'https://paystack.com/pay/ref-123',
        createdAt: new Date()
      };

      paystackGateway.initiatePayment.mockResolvedValue(mockResponse);
      paymentRepository.create.mockResolvedValue({
        id: 'pay-123',
        ...paymentRequest,
        status: PaymentStatus.PENDING,
        gateway: 'paystack',
        reference: 'ref-123',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const result = await paymentService.processPayment(paymentRequest);

      expect(result).toEqual(mockResponse);
      expect(paystackGateway.initiatePayment).toHaveBeenCalledWith(paymentRequest);
      expect(paymentRepository.create).toHaveBeenCalled();
    });

    test('should process payment with Yoco for ZAR currency', async () => {
      const paymentRequest: PaymentRequest = {
        amount: 5000,
        currency: 'ZAR',
        customerId: 'cust-456',
        orderId: 'order-456',
        paymentMethod: PaymentMethod.CARD,
        metadata: {
          tenantId: 'tenant-456'
        }
      };

      const mockResponse: PaymentResponse = {
        id: 'pay-456',
        status: PaymentStatus.PENDING,
        amount: 5000,
        currency: 'ZAR',
        reference: 'ref-456',
        authorizationUrl: 'https://yoco.com/pay/ref-456',
        createdAt: new Date()
      };

      yocoGateway.initiatePayment.mockResolvedValue(mockResponse);
      paymentRepository.create.mockResolvedValue({
        id: 'pay-456',
        ...paymentRequest,
        status: PaymentStatus.PENDING,
        gateway: 'yoco',
        reference: 'ref-456',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const result = await paymentService.processPayment(paymentRequest);

      expect(result).toEqual(mockResponse);
      expect(yocoGateway.initiatePayment).toHaveBeenCalledWith(paymentRequest);
      expect(paymentRepository.create).toHaveBeenCalled();
    });

    test('should handle mobile money payments', async () => {
      const paymentRequest: PaymentRequest = {
        amount: 20000,
        currency: 'NGN',
        customerId: 'cust-789',
        orderId: 'order-789',
        paymentMethod: PaymentMethod.MOBILE_MONEY,
        mobileNumber: '+2348012345678',
        metadata: {
          tenantId: 'tenant-789'
        }
      };

      const mockResponse: PaymentResponse = {
        id: 'pay-789',
        status: PaymentStatus.PENDING,
        amount: 20000,
        currency: 'NGN',
        reference: 'ref-789',
        ussdCode: '*737*1*ref-789#',
        createdAt: new Date()
      };

      // Mock the name property getter
      Object.defineProperty(paystackGateway, 'name', {
        value: 'paystack',
        writable: false
      });
      paystackGateway.initiateMobileMoneyPayment.mockResolvedValue(mockResponse);

      const result = await paymentService.processMobileMoneyPayment(paymentRequest);

      expect(result).toEqual(mockResponse);
      expect(paystackGateway.initiateMobileMoneyPayment).toHaveBeenCalledWith(paymentRequest);
    });

    test('should validate payment request', async () => {
      const invalidRequest: PaymentRequest = {
        amount: -100,
        currency: 'INVALID',
        customerId: '',
        orderId: '',
        paymentMethod: 'INVALID' as PaymentMethod,
        metadata: {}
      };

      await expect(paymentService.processPayment(invalidRequest))
        .rejects.toThrow('Invalid payment request');
    });

    test('should handle payment gateway errors', async () => {
      const paymentRequest: PaymentRequest = {
        amount: 10000,
        currency: 'NGN',
        customerId: 'cust-123',
        orderId: 'order-123',
        paymentMethod: PaymentMethod.CARD,
        metadata: {}
      };

      const mockPayment = createMockPayment({
        id: 'pay-error',
        status: PaymentStatus.PENDING
      });

      paymentRepository.create.mockResolvedValue(mockPayment);
      paystackGateway.initiatePayment.mockRejectedValue(
        new Error('Gateway error: Service unavailable')
      );

      await expect(paymentService.processPayment(paymentRequest))
        .rejects.toThrow('Gateway error: Service unavailable');
      
      // Verify that payment was marked as failed
      expect(paymentRepository.update).toHaveBeenCalledWith('pay-error', {
        status: PaymentStatus.FAILED,
        failureReason: 'Gateway error: Service unavailable'
      });
    });
  });

  describe('Payment Status', () => {
    test('should get payment status', async () => {
      const mockPayment = createMockPayment({
        id: 'pay-123',
        status: PaymentStatus.SUCCESS,
        amount: 10000,
        currency: 'NGN',
        reference: 'ref-123',
        gateway: 'paystack'
      });

      paymentRepository.findById.mockResolvedValue(mockPayment);

      const status = await paymentService.getPaymentStatus('pay-123');

      expect(status).toEqual({
        id: 'pay-123',
        status: PaymentStatus.SUCCESS,
        amount: 10000,
        currency: 'NGN',
        reference: 'ref-123'
      });
    });

    test('should update payment status', async () => {
      const mockPayment = createMockPayment({
        id: 'pay-123',
        status: PaymentStatus.PENDING,
        gateway: 'paystack',
        reference: 'ref-123'
      });

      paymentRepository.findById.mockResolvedValue(mockPayment);
      paymentRepository.update.mockResolvedValue(createMockPayment({
        ...mockPayment,
        status: PaymentStatus.SUCCESS
      }));

      const updated = await paymentService.updatePaymentStatus(
        'pay-123',
        PaymentStatus.SUCCESS
      );

      expect(updated.status).toBe(PaymentStatus.SUCCESS);
      expect(paymentRepository.update).toHaveBeenCalledWith('pay-123', 
        expect.objectContaining({
          status: PaymentStatus.SUCCESS,
          updatedAt: expect.any(Date),
          completedAt: expect.any(Date)
        })
      );
    });

    test('should handle payment not found', async () => {
      paymentRepository.findById.mockResolvedValue(null);

      await expect(paymentService.getPaymentStatus('invalid-id'))
        .rejects.toThrow('Payment not found');
    });
  });

  describe('Refunds', () => {
    test('should process full refund', async () => {
      const mockPayment = createMockPayment({
        id: 'pay-123',
        amount: 10000,
        currency: 'NGN',
        status: PaymentStatus.SUCCESS,
        gateway: 'paystack',
        reference: 'ref-123'
      });

      paymentRepository.findById.mockResolvedValue(mockPayment);
      paystackGateway.refundPayment.mockResolvedValue({
        id: 'refund-123',
        paymentId: 'pay-123',
        amount: 10000,
        status: 'success',
        createdAt: new Date()
      });

      const refund = await paymentService.refundPayment('pay-123');

      expect(refund.amount).toBe(10000);
      expect(paystackGateway.refundPayment).toHaveBeenCalledWith('ref-123', 10000);
    });

    test('should process partial refund', async () => {
      const mockPayment = createMockPayment({
        id: 'pay-456',
        amount: 20000,
        currency: 'ZAR',
        status: PaymentStatus.SUCCESS,
        gateway: 'yoco',
        reference: 'ref-456'
      });

      paymentRepository.findById.mockResolvedValue(mockPayment);
      yocoGateway.refundPayment.mockResolvedValue({
        id: 'refund-456',
        paymentId: 'pay-456',
        amount: 5000,
        status: 'success',
        createdAt: new Date()
      });

      const refund = await paymentService.refundPayment('pay-456', 5000);

      expect(refund.amount).toBe(5000);
      expect(yocoGateway.refundPayment).toHaveBeenCalledWith('ref-456', 5000);
    });

    test('should reject refund for failed payment', async () => {
      const mockPayment = createMockPayment({
        id: 'pay-789',
        status: PaymentStatus.FAILED,
        gateway: 'paystack'
      });

      paymentRepository.findById.mockResolvedValue(mockPayment);

      await expect(paymentService.refundPayment('pay-789'))
        .rejects.toThrow('Cannot refund failed payment');
    });

    test('should reject refund amount exceeding original', async () => {
      const mockPayment = createMockPayment({
        id: 'pay-999',
        amount: 10000,
        status: PaymentStatus.SUCCESS,
        gateway: 'paystack'
      });

      paymentRepository.findById.mockResolvedValue(mockPayment);

      await expect(paymentService.refundPayment('pay-999', 20000))
        .rejects.toThrow('Refund amount exceeds original payment');
    });
  });
});

describe('Payment Orchestrator', () => {
  let orchestrator: PaymentOrchestrator;
  let paymentService: jest.Mocked<PaymentService>;

  beforeEach(() => {
    paymentService = {
      processPayment: jest.fn(),
      getPaymentStatus: jest.fn(),
      updatePaymentStatus: jest.fn(),
      refundPayment: jest.fn()
    } as any;

    orchestrator = new PaymentOrchestrator(paymentService);
  });

  test('should orchestrate split payments', async () => {
    const splitPaymentRequest = {
      totalAmount: 30000,
      currency: 'NGN',
      customerId: 'cust-123',
      orderId: 'order-123',
      splits: [
        { accountId: 'acc-1', amount: 20000 },
        { accountId: 'acc-2', amount: 10000 }
      ]
    };

    paymentService.processPayment.mockResolvedValue({
      id: 'pay-split-123',
      status: PaymentStatus.SUCCESS,
      amount: 30000,
      currency: 'NGN',
      reference: 'ref-split-123',
      createdAt: new Date()
    });

    const result = await orchestrator.processSplitPayment(splitPaymentRequest);

    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.splits).toHaveLength(2);
  });

  test('should handle recurring payments', async () => {
    const recurringRequest = {
      amount: 5000,
      currency: 'NGN',
      customerId: 'cust-456',
      interval: 'monthly' as const,
      startDate: new Date()
    };

    const subscription = await orchestrator.createRecurringPayment(recurringRequest);

    expect(subscription).toHaveProperty('id');
    expect(subscription.status).toBe('active');
    expect(subscription.interval).toBe('monthly');
  });

  test('should cancel recurring payment', async () => {
    // First create a subscription
    const recurringRequest = {
      amount: 5000,
      currency: 'NGN',
      customerId: 'cust-cancel',
      interval: 'monthly' as const,
      startDate: new Date()
    };

    const subscription = await orchestrator.createRecurringPayment(recurringRequest);
    
    // Then cancel it
    const result = await orchestrator.cancelRecurringPayment(subscription.id);

    expect(result.status).toBe('cancelled');
  });

  test('should handle payment with retry logic', async () => {
    const paymentRequest: PaymentRequest = {
      amount: 10000,
      currency: 'NGN',
      customerId: 'cust-789',
      orderId: 'order-789',
      paymentMethod: PaymentMethod.CARD,
      metadata: {}
    };

    // First attempt fails, second succeeds
    paymentService.processPayment
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValueOnce({
        id: 'pay-retry-123',
        status: PaymentStatus.SUCCESS,
        amount: 10000,
        currency: 'NGN',
        reference: 'ref-retry-123',
        createdAt: new Date()
      });

    const result = await orchestrator.processPaymentWithRetry(paymentRequest);

    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(paymentService.processPayment).toHaveBeenCalledTimes(2);
  });

  test('should fail after max retries', async () => {
    const paymentRequest: PaymentRequest = {
      amount: 10000,
      currency: 'NGN',
      customerId: 'cust-999',
      orderId: 'order-999',
      paymentMethod: PaymentMethod.CARD,
      metadata: {}
    };

    paymentService.processPayment.mockRejectedValue(new Error('Persistent failure'));

    await expect(orchestrator.processPaymentWithRetry(paymentRequest, 3))
      .rejects.toThrow('Payment failed after 3 attempts');

    expect(paymentService.processPayment).toHaveBeenCalledTimes(3);
  }, 10000);
});

describe('Reconciliation Service', () => {
  let reconciliationService: ReconciliationService;
  let paymentRepository: jest.Mocked<PaymentRepository>;
  let paystackGateway: jest.Mocked<PaystackGateway>;
  let yocoGateway: jest.Mocked<YocoGateway>;

  beforeEach(() => {
    paymentRepository = new PaymentRepository() as jest.Mocked<PaymentRepository>;
    paystackGateway = new PaystackGateway({}) as jest.Mocked<PaystackGateway>;
    yocoGateway = new YocoGateway({}) as jest.Mocked<YocoGateway>;

    reconciliationService = new ReconciliationService(
      paymentRepository,
      { paystack: paystackGateway, yoco: yocoGateway }
    );
  });

  test('should reconcile payments successfully', async () => {
    const startDate = new Date('2024-01-01');
    const endDate = new Date('2024-01-31');

    const dbPayments = [
      createMockPayment({ id: 'pay-1', reference: 'ref-1', amount: 10000, gateway: 'paystack', status: PaymentStatus.SUCCESS }),
      createMockPayment({ id: 'pay-2', reference: 'ref-2', amount: 20000, gateway: 'paystack', status: PaymentStatus.SUCCESS })
    ];

    const gatewayTransactions = [
      { reference: 'ref-1', amount: 10000, status: 'success' },
      { reference: 'ref-2', amount: 20000, status: 'success' }
    ];

    paymentRepository.findByDateRange.mockResolvedValue(dbPayments);
    paystackGateway.getTransactions.mockResolvedValue(gatewayTransactions);
    yocoGateway.getTransactions.mockResolvedValue([]); // No Yoco transactions

    const result = await reconciliationService.reconcilePayments(startDate, endDate);

    expect(result.status).toBe(ReconciliationStatus.COMPLETED);
    expect(result.matched).toBe(2);
    expect(result.mismatched).toBe(0);
    expect(result.missing).toBe(0);
  });

  test('should detect mismatched amounts', async () => {
    const dbPayments = [
      createMockPayment({ id: 'pay-1', reference: 'ref-1', amount: 10000, gateway: 'paystack', status: PaymentStatus.SUCCESS })
    ];

    const gatewayTransactions = [
      { reference: 'ref-1', amount: 15000, status: 'success' } // Different amount
    ];

    paymentRepository.findByDateRange.mockResolvedValue(dbPayments);
    paystackGateway.getTransactions.mockResolvedValue(gatewayTransactions);
    yocoGateway.getTransactions.mockResolvedValue([]); // No Yoco transactions

    const result = await reconciliationService.reconcilePayments(new Date(), new Date());

    expect(result.mismatched).toBe(1);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]?.type).toBe('amount_mismatch');
  });

  test('should detect missing transactions', async () => {
    const dbPayments = [
      createMockPayment({ id: 'pay-1', reference: 'ref-1', amount: 10000, gateway: 'paystack', status: PaymentStatus.SUCCESS }),
      createMockPayment({ id: 'pay-2', reference: 'ref-2', amount: 20000, gateway: 'paystack', status: PaymentStatus.SUCCESS })
    ];

    const gatewayTransactions = [
      { reference: 'ref-1', amount: 10000, status: 'success' }
      // ref-2 is missing from gateway
    ];

    paymentRepository.findByDateRange.mockResolvedValue(dbPayments);
    paystackGateway.getTransactions.mockResolvedValue(gatewayTransactions);
    yocoGateway.getTransactions.mockResolvedValue([]); // No Yoco transactions

    const result = await reconciliationService.reconcilePayments(new Date(), new Date());

    expect(result.missing).toBe(1);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]?.type).toBe('missing_in_gateway');
  });

  test('should generate reconciliation report', async () => {
    const reconciliationResult = {
      id: 'recon-123',
      status: ReconciliationStatus.COMPLETED,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-31'),
      matched: 95,
      mismatched: 3,
      missing: 2,
      totalProcessed: 100,
      discrepancies: []
    };

    // Mock some payments for the report
    const mockPayments = [
      createMockPayment({ amount: 1000, paymentMethod: PaymentMethod.CARD, status: PaymentStatus.SUCCESS }),
      createMockPayment({ amount: 2000, paymentMethod: PaymentMethod.CARD, status: PaymentStatus.SUCCESS }),
      createMockPayment({ amount: 1500, paymentMethod: PaymentMethod.BANK_TRANSFER, status: PaymentStatus.FAILED })
    ];

    paymentRepository.findByDateRange.mockResolvedValue(mockPayments);

    const report = await reconciliationService.generateReport(reconciliationResult);

    expect(report).toHaveProperty('summary');
    expect(report).toHaveProperty('details');
    expect(report.summary.successRate).toBe(95);
  });
});

describe('Webhook Handler', () => {
  let webhookHandler: WebhookHandler;
  let paymentService: jest.Mocked<PaymentService>;

  beforeEach(() => {
    paymentService = {
      updatePaymentStatus: jest.fn(),
      getPaymentByReference: jest.fn()
    } as any;

    webhookHandler = new WebhookHandler(paymentService);
  });

  test('should handle Paystack webhook', async () => {
    const webhookEvent: WebhookEvent = {
      event: 'charge.success',
      data: {
        reference: 'ref-123',
        amount: 10000,
        status: 'success',
        metadata: { paymentId: 'pay-123' }
      }
    };

    paymentService.getPaymentByReference.mockResolvedValue(createMockPayment({
      id: 'pay-123',
      reference: 'ref-123',
      status: PaymentStatus.PENDING
    }));

    paymentService.updatePaymentStatus.mockResolvedValue(createMockPayment({
      id: 'pay-123',
      status: PaymentStatus.SUCCESS
    }));

    const result = await webhookHandler.handlePaystackWebhook(webhookEvent);

    expect(result.success).toBe(true);
    expect(paymentService.updatePaymentStatus).toHaveBeenCalledWith(
      'pay-123',
      PaymentStatus.SUCCESS
    );
  });

  test('should handle Yoco webhook', async () => {
    const webhookEvent = {
      type: 'payment.succeeded',
      payload: {
        metadata: { reference: 'ref-456' },
        amount: 5000,
        status: 'succeeded'
      }
    };

    paymentService.getPaymentByReference.mockResolvedValue(createMockPayment({
      id: 'pay-456',
      reference: 'ref-456',
      status: PaymentStatus.PENDING
    }));

    const result = await webhookHandler.handleYocoWebhook(webhookEvent);

    expect(result.success).toBe(true);
    expect(paymentService.updatePaymentStatus).toHaveBeenCalledWith(
      'pay-456',
      PaymentStatus.SUCCESS
    );
  });

  test('should verify webhook signature', () => {
    const payload = JSON.stringify({ event: 'charge.success' });
    const secret = 'webhook-secret';
    const signature = webhookHandler.generateSignature(payload, secret);

    const isValid = webhookHandler.verifySignature(payload, signature, secret);

    expect(isValid).toBe(true);
  });

  test('should reject invalid signature', () => {
    const payload = JSON.stringify({ event: 'charge.success' });
    const secret = 'webhook-secret';
    const invalidSignature = 'invalid-signature';

    const isValid = webhookHandler.verifySignature(payload, invalidSignature, secret);

    expect(isValid).toBe(false);
  });

  test('should handle duplicate webhooks', async () => {
    const webhookEvent: WebhookEvent = {
      event: 'charge.success',
      data: {
        reference: 'ref-789',
        amount: 15000,
        status: 'success'
      }
    };

    // First call
    await webhookHandler.handlePaystackWebhook(webhookEvent);

    // Second call (duplicate)
    const result = await webhookHandler.handlePaystackWebhook(webhookEvent);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Duplicate webhook');
  });

  test('should handle webhook timeout', async () => {
    const webhookEvent: WebhookEvent = {
      event: 'charge.success',
      data: {
        reference: 'ref-timeout',
        amount: 10000,
        status: 'success'
      }
    };

    paymentService.getPaymentByReference.mockImplementation(() => 
      new Promise((resolve) => setTimeout(() => resolve(createMockPayment()), 6000))
    );

    await expect(webhookHandler.handlePaystackWebhook(webhookEvent, 5000))
      .rejects.toThrow('Webhook processing timeout');
  }, 10000);
});

describe('Payment Service - Full Coverage', () => {
  let paymentService: PaymentService;
  let paymentRepository: jest.Mocked<PaymentRepository>;

  beforeEach(() => {
    paymentRepository = new PaymentRepository() as jest.Mocked<PaymentRepository>;
    const paystackGateway = new PaystackGateway({}) as jest.Mocked<PaystackGateway>;
    const yocoGateway = new YocoGateway({}) as jest.Mocked<YocoGateway>;
    
    // Mock repository methods
    paymentRepository.create = jest.fn();
    paymentRepository.findById = jest.fn();
    paymentRepository.update = jest.fn();
    
    paymentService = new PaymentService(
      paymentRepository,
      paystackGateway,
      yocoGateway
    );
  });

  test('should handle bank transfer payments', async () => {
    const paymentRequest: PaymentRequest = {
      amount: 50000,
      currency: 'NGN',
      customerId: 'cust-bank',
      orderId: 'order-bank',
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      metadata: {}
    };

    const mockPayment = createMockPayment({
      id: 'pay-bank',
      status: PaymentStatus.PENDING,
      paymentMethod: PaymentMethod.BANK_TRANSFER
    });

    paymentRepository.create.mockResolvedValue(mockPayment);

    const result = await paymentService.processBankTransfer(paymentRequest);

    expect(result).toHaveProperty('bankAccount');
    expect(result).toHaveProperty('reference');
    expect(result.status).toBe(PaymentStatus.PENDING);
  });

  test('should validate supported currencies', () => {
    expect(paymentService.isCurrencySupported('NGN')).toBe(true);
    expect(paymentService.isCurrencySupported('ZAR')).toBe(true);
    expect(paymentService.isCurrencySupported('USD')).toBe(false);
  });

  test('should calculate payment fees', () => {
    const cardFee = paymentService.calculateFee(10000, PaymentMethod.CARD);
    expect(cardFee).toBe(150); // 1.5% for card

    const bankTransferFee = paymentService.calculateFee(10000, PaymentMethod.BANK_TRANSFER);
    expect(bankTransferFee).toBe(100); // Flat 100 for bank transfer
  });

  test('should format amount for gateway', () => {
    const formatted = paymentService.formatAmountForGateway(100.50);
    expect(formatted).toBe(10050); // Convert to kobo
  });

  test('should handle payment timeout', async () => {
    const paymentId = 'pay-timeout';
    
    const mockPayment = createMockPayment({
      id: paymentId,
      status: PaymentStatus.PENDING
    });

    paymentRepository.findById.mockResolvedValue(mockPayment);
    paymentRepository.update.mockResolvedValue(createMockPayment({
      ...mockPayment,
      status: PaymentStatus.TIMEOUT
    }));
    
    await paymentService.handlePaymentTimeout(paymentId);
    
    // Verify update was called with timeout status
    expect(paymentRepository.update).toHaveBeenCalledWith(paymentId, 
      expect.objectContaining({
        status: PaymentStatus.TIMEOUT
      })
    );
  });
});