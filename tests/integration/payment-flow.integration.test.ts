import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { PaymentService } from '../../backend/services/payment-service/src/services/payment.service';
import { PaymentOrchestrator } from '../../backend/services/payment-service/src/services/payment-orchestrator';
import { ReconciliationService } from '../../backend/services/payment-service/src/services/reconciliation.service';
import { WebhookHandler } from '../../backend/services/payment-service/src/services/webhook-handler';
import { PaystackGateway } from '../../backend/services/payment-service/src/gateways/paystack.gateway';
import { YocoGateway } from '../../backend/services/payment-service/src/gateways/yoco.gateway';
import { OrderService } from '../../backend/services/order-service/src/services/order.service';

describe('Payment Flow Integration Tests', () => {
  let paymentService: PaymentService;
  let paymentOrchestrator: PaymentOrchestrator;
  let reconciliationService: ReconciliationService;
  let webhookHandler: WebhookHandler;
  let orderService: OrderService;

  const tenantId = 'uncle-charles-kitchen';
  const southAfricaTenantId = 'sa-vendor-test';

  beforeAll(async () => {
    paymentService = new PaymentService();
    paymentOrchestrator = new PaymentOrchestrator();
    reconciliationService = new ReconciliationService();
    webhookHandler = new WebhookHandler();
    orderService = new OrderService();

    await Promise.all([
      paymentService.initialize(),
      orderService.initialize()
    ]);

    // Setup test tenant configurations
    await setupTenantPaymentConfigs();
  });

  afterAll(async () => {
    await Promise.all([
      paymentService.shutdown(),
      orderService.shutdown()
    ]);
  });

  async function setupTenantPaymentConfigs() {
    // Zimbabwe tenant - uses EcoCash and OneMoney
    await paymentService.configureTenant(tenantId, {
      supportedMethods: ['ecocash', 'onemoney', 'cash'],
      defaultCurrency: 'USD',
      acceptedCurrencies: ['USD', 'ZWL'],
      paymentGateways: {
        ecocash: {
          merchantId: 'ECO-TEST-001',
          apiKey: process.env.ECOCASH_TEST_KEY
        },
        onemoney: {
          merchantId: 'ONE-TEST-001',
          apiKey: process.env.ONEMONEY_TEST_KEY
        }
      },
      settlementAccount: {
        bankName: 'Standard Chartered Zimbabwe',
        accountNumber: '1234567890',
        accountName: 'Uncle Charles Kitchen'
      }
    });

    // South Africa tenant - uses Paystack and Yoco
    await paymentService.configureTenant(southAfricaTenantId, {
      supportedMethods: ['card', 'eft', 'cash'],
      defaultCurrency: 'ZAR',
      acceptedCurrencies: ['ZAR'],
      paymentGateways: {
        card: {
          provider: 'paystack',
          publicKey: process.env.PAYSTACK_PUBLIC_KEY,
          secretKey: process.env.PAYSTACK_SECRET_KEY
        },
        eft: {
          provider: 'yoco',
          apiKey: process.env.YOCO_API_KEY
        }
      },
      settlementAccount: {
        bankName: 'First National Bank',
        accountNumber: '62234567890',
        accountName: 'SA Test Vendor'
      }
    });
  }

  describe('Multi-Gateway Payment Processing', () => {
    it('should process EcoCash payment for Zimbabwe tenant', async () => {
      // Create test order
      const order = await orderService.createOrder({
        tenantId,
        customerId: 'zim-customer-001',
        items: [{ productId: 'test-001', quantity: 1, price: 10.00 }],
        totalAmount: 10.00
      });

      // Initiate payment
      const payment = await paymentService.initiatePayment({
        orderId: order.orderId,
        tenantId,
        amount: 10.00,
        currency: 'USD',
        method: 'ecocash',
        customerPhone: '263776543210',
        customerEmail: 'customer@test.com'
      });

      expect(payment).toBeDefined();
      expect(payment.paymentId).toBeDefined();
      expect(payment.status).toBe('PENDING');
      expect(payment.method).toBe('ecocash');
      expect(payment.paymentUrl).toContain('ecocash');

      // Simulate EcoCash webhook
      const webhookPayload = {
        reference: payment.reference,
        status: 'SUCCESS',
        amount: 10.00,
        currency: 'USD',
        phoneNumber: '263776543210',
        transactionId: 'ECO-TXN-123456',
        timestamp: new Date().toISOString()
      };

      const webhookResult = await webhookHandler.handleEcoCashWebhook(webhookPayload, tenantId);

      expect(webhookResult.success).toBe(true);

      // Verify payment status
      const updatedPayment = await paymentService.getPayment(payment.paymentId, tenantId);
      expect(updatedPayment.status).toBe('COMPLETED');
      expect(updatedPayment.gatewayTransactionId).toBe('ECO-TXN-123456');

      // Verify order was updated
      const updatedOrder = await orderService.getOrder(order.orderId, tenantId);
      expect(updatedOrder.paymentStatus).toBe('PAID');
      expect(updatedOrder.status).toBe('CONFIRMED');
    });

    it('should process card payment via Paystack for SA tenant', async () => {
      const order = await orderService.createOrder({
        tenantId: southAfricaTenantId,
        customerId: 'sa-customer-001',
        items: [{ productId: 'test-002', quantity: 2, price: 150.00 }],
        totalAmount: 300.00
      });

      const payment = await paymentService.initiatePayment({
        orderId: order.orderId,
        tenantId: southAfricaTenantId,
        amount: 300.00,
        currency: 'ZAR',
        method: 'card',
        customerEmail: 'sa-customer@test.com'
      });

      expect(payment.method).toBe('card');
      expect(payment.gateway).toBe('paystack');
      expect(payment.paymentUrl).toContain('paystack.com');

      // Simulate Paystack webhook
      const paystackWebhook = {
        event: 'charge.success',
        data: {
          reference: payment.reference,
          amount: 30000, // Paystack uses minor units (kobo)
          currency: 'ZAR',
          status: 'success',
          customer: {
            email: 'sa-customer@test.com'
          },
          authorization: {
            authorization_code: 'AUTH_code123',
            card_type: 'visa',
            last4: '4081',
            exp_month: '12',
            exp_year: '2025'
          }
        }
      };

      const webhookResult = await webhookHandler.handlePaystackWebhook(paystackWebhook, southAfricaTenantId);

      expect(webhookResult.success).toBe(true);

      const updatedPayment = await paymentService.getPayment(payment.paymentId, southAfricaTenantId);
      expect(updatedPayment.status).toBe('COMPLETED');
      expect(updatedPayment.cardDetails).toBeDefined();
      expect(updatedPayment.cardDetails.last4).toBe('4081');
    });

    it('should handle split payments between multiple vendors', async () => {
      // Order with items from multiple vendors
      const multiVendorOrder = await orderService.createOrder({
        tenantId,
        customerId: 'split-payment-customer',
        items: [
          { productId: 'vendor1-item', vendorId: 'vendor-001', quantity: 1, price: 20.00 },
          { productId: 'vendor2-item', vendorId: 'vendor-002', quantity: 2, price: 15.00 }
        ],
        totalAmount: 50.00
      });

      const payment = await paymentService.initiatePayment({
        orderId: multiVendorOrder.orderId,
        tenantId,
        amount: 50.00,
        currency: 'USD',
        method: 'ecocash',
        splits: [
          { vendorId: 'vendor-001', amount: 20.00, percentage: 40 },
          { vendorId: 'vendor-002', amount: 30.00, percentage: 60 }
        ]
      });

      expect(payment.splits).toHaveLength(2);

      // Process payment
      await webhookHandler.handleEcoCashWebhook({
        reference: payment.reference,
        status: 'SUCCESS',
        amount: 50.00,
        transactionId: 'ECO-SPLIT-123'
      }, tenantId);

      // Verify splits were processed
      const splits = await paymentService.getPaymentSplits(payment.paymentId);
      expect(splits).toHaveLength(2);
      expect(splits[0].status).toBe('SETTLED');
      expect(splits[1].status).toBe('SETTLED');

      // Verify vendor balances
      const vendor1Balance = await paymentService.getVendorBalance('vendor-001', tenantId);
      const vendor2Balance = await paymentService.getVendorBalance('vendor-002', tenantId);

      expect(vendor1Balance.available).toBe(20.00);
      expect(vendor2Balance.available).toBe(30.00);
    });

    it('should handle currency conversion for multi-currency payments', async () => {
      // Customer pays in ZWL but vendor receives USD
      const order = await orderService.createOrder({
        tenantId,
        customerId: 'currency-convert-customer',
        items: [{ productId: 'test-003', quantity: 1, price: 10.00 }], // Price in USD
        totalAmount: 10.00,
        currency: 'USD'
      });

      // Customer initiates payment in ZWL
      const payment = await paymentService.initiatePayment({
        orderId: order.orderId,
        tenantId,
        amount: 8500.00, // ZWL amount (assuming 1 USD = 850 ZWL)
        currency: 'ZWL',
        targetCurrency: 'USD',
        method: 'ecocash',
        customerPhone: '263776543210'
      });

      expect(payment.currency).toBe('ZWL');
      expect(payment.targetCurrency).toBe('USD');
      expect(payment.exchangeRate).toBeDefined();
      expect(payment.targetAmount).toBeCloseTo(10.00, 2);

      // Process payment
      await webhookHandler.handleEcoCashWebhook({
        reference: payment.reference,
        status: 'SUCCESS',
        amount: 8500.00,
        currency: 'ZWL',
        transactionId: 'ECO-ZWL-123'
      }, tenantId);

      // Verify settlement in USD
      const settlement = await paymentService.getSettlement(payment.paymentId);
      expect(settlement.currency).toBe('USD');
      expect(settlement.amount).toBeCloseTo(10.00, 2);
    });
  });

  describe('Payment Failure Scenarios', () => {
    it('should handle insufficient funds gracefully', async () => {
      const order = await orderService.createOrder({
        tenantId,
        customerId: 'insufficient-funds-customer',
        items: [{ productId: 'test-004', quantity: 1, price: 100.00 }],
        totalAmount: 100.00
      });

      const payment = await paymentService.initiatePayment({
        orderId: order.orderId,
        tenantId,
        amount: 100.00,
        currency: 'USD',
        method: 'ecocash',
        customerPhone: '263776543210'
      });

      // Simulate insufficient funds webhook
      await webhookHandler.handleEcoCashWebhook({
        reference: payment.reference,
        status: 'FAILED',
        reason: 'INSUFFICIENT_FUNDS',
        amount: 100.00
      }, tenantId);

      const failedPayment = await paymentService.getPayment(payment.paymentId, tenantId);
      expect(failedPayment.status).toBe('FAILED');
      expect(failedPayment.failureReason).toBe('INSUFFICIENT_FUNDS');

      // Verify order was not confirmed
      const failedOrder = await orderService.getOrder(order.orderId, tenantId);
      expect(failedOrder.status).toBe('PAYMENT_FAILED');
    });

    it('should retry failed payments with exponential backoff', async () => {
      const order = await orderService.createOrder({
        tenantId,
        customerId: 'retry-payment-customer',
        items: [{ productId: 'test-005', quantity: 1, price: 50.00 }],
        totalAmount: 50.00
      });

      const payment = await paymentService.initiatePayment({
        orderId: order.orderId,
        tenantId,
        amount: 50.00,
        currency: 'USD',
        method: 'ecocash',
        enableAutoRetry: true,
        maxRetries: 3
      });

      // Simulate timeout
      await webhookHandler.handleEcoCashWebhook({
        reference: payment.reference,
        status: 'TIMEOUT',
        reason: 'GATEWAY_TIMEOUT'
      }, tenantId);

      // Wait for retry
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check retry attempt
      const paymentWithRetry = await paymentService.getPayment(payment.paymentId, tenantId);
      expect(paymentWithRetry.retryCount).toBe(1);
      expect(paymentWithRetry.status).toBe('RETRYING');

      // Simulate success on retry
      await webhookHandler.handleEcoCashWebhook({
        reference: payment.reference,
        status: 'SUCCESS',
        amount: 50.00,
        transactionId: 'ECO-RETRY-SUCCESS'
      }, tenantId);

      const successPayment = await paymentService.getPayment(payment.paymentId, tenantId);
      expect(successPayment.status).toBe('COMPLETED');
      expect(successPayment.retryCount).toBe(1);
    });

    it('should handle webhook signature validation', async () => {
      const invalidWebhook = {
        reference: 'fake-reference',
        status: 'SUCCESS',
        amount: 1000.00
      };

      // Missing or invalid signature
      const result = await webhookHandler.handleEcoCashWebhook(
        invalidWebhook,
        tenantId,
        { signature: 'invalid-signature' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid webhook signature');

      // Verify no payment was processed
      const payments = await paymentService.getPaymentByReference('fake-reference', tenantId);
      expect(payments).toBeNull();
    });

    it('should handle duplicate webhook deliveries', async () => {
      const order = await orderService.createOrder({
        tenantId,
        customerId: 'duplicate-webhook-customer',
        items: [{ productId: 'test-006', quantity: 1, price: 25.00 }],
        totalAmount: 25.00
      });

      const payment = await paymentService.initiatePayment({
        orderId: order.orderId,
        tenantId,
        amount: 25.00,
        currency: 'USD',
        method: 'ecocash'
      });

      const webhookPayload = {
        reference: payment.reference,
        status: 'SUCCESS',
        amount: 25.00,
        transactionId: 'ECO-DUP-123'
      };

      // Send webhook multiple times
      const result1 = await webhookHandler.handleEcoCashWebhook(webhookPayload, tenantId);
      const result2 = await webhookHandler.handleEcoCashWebhook(webhookPayload, tenantId);
      const result3 = await webhookHandler.handleEcoCashWebhook(webhookPayload, tenantId);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result2.duplicate).toBe(true);
      expect(result3.success).toBe(true);
      expect(result3.duplicate).toBe(true);

      // Verify payment was only processed once
      const finalPayment = await paymentService.getPayment(payment.paymentId, tenantId);
      expect(finalPayment.status).toBe('COMPLETED');
      expect(finalPayment.webhookCount).toBe(1);
    });
  });

  describe('Refunds and Reversals', () => {
    it('should process full refund', async () => {
      // Create and complete a payment
      const order = await orderService.createOrder({
        tenantId,
        customerId: 'refund-customer',
        items: [{ productId: 'test-007', quantity: 1, price: 75.00 }],
        totalAmount: 75.00
      });

      const payment = await paymentService.initiatePayment({
        orderId: order.orderId,
        tenantId,
        amount: 75.00,
        currency: 'USD',
        method: 'ecocash'
      });

      await webhookHandler.handleEcoCashWebhook({
        reference: payment.reference,
        status: 'SUCCESS',
        amount: 75.00,
        transactionId: 'ECO-REFUND-ORIG'
      }, tenantId);

      // Process refund
      const refund = await paymentService.processRefund({
        paymentId: payment.paymentId,
        tenantId,
        amount: 75.00,
        reason: 'Customer requested cancellation'
      });

      expect(refund.refundId).toBeDefined();
      expect(refund.status).toBe('PENDING');
      expect(refund.amount).toBe(75.00);

      // Simulate refund webhook
      await webhookHandler.handleEcoCashWebhook({
        reference: refund.reference,
        type: 'REFUND',
        status: 'SUCCESS',
        originalReference: payment.reference,
        amount: 75.00,
        transactionId: 'ECO-REFUND-123'
      }, tenantId);

      const completedRefund = await paymentService.getRefund(refund.refundId, tenantId);
      expect(completedRefund.status).toBe('COMPLETED');

      // Verify original payment shows refund
      const refundedPayment = await paymentService.getPayment(payment.paymentId, tenantId);
      expect(refundedPayment.refundedAmount).toBe(75.00);
      expect(refundedPayment.isFullyRefunded).toBe(true);
    });

    it('should process partial refund for specific items', async () => {
      const order = await orderService.createOrder({
        tenantId,
        customerId: 'partial-refund-customer',
        items: [
          { productId: 'item-1', quantity: 2, price: 20.00 },
          { productId: 'item-2', quantity: 1, price: 30.00 }
        ],
        totalAmount: 70.00
      });

      const payment = await paymentService.initiatePayment({
        orderId: order.orderId,
        tenantId,
        amount: 70.00,
        currency: 'USD',
        method: 'ecocash'
      });

      await webhookHandler.handleEcoCashWebhook({
        reference: payment.reference,
        status: 'SUCCESS',
        amount: 70.00
      }, tenantId);

      // Refund one item
      const partialRefund = await paymentService.processPartialRefund({
        paymentId: payment.paymentId,
        tenantId,
        refundItems: [
          { productId: 'item-1', quantity: 1, amount: 20.00 }
        ],
        reason: 'Item was damaged'
      });

      expect(partialRefund.amount).toBe(20.00);

      // Process refund
      await webhookHandler.handleEcoCashWebhook({
        reference: partialRefund.reference,
        type: 'REFUND',
        status: 'SUCCESS',
        amount: 20.00
      }, tenantId);

      const payment2 = await paymentService.getPayment(payment.paymentId, tenantId);
      expect(payment2.refundedAmount).toBe(20.00);
      expect(payment2.isFullyRefunded).toBe(false);
      expect(payment2.netAmount).toBe(50.00); // 70 - 20
    });

    it('should handle refund failures and reversals', async () => {
      const order = await orderService.createOrder({
        tenantId,
        customerId: 'refund-fail-customer',
        items: [{ productId: 'test-008', quantity: 1, price: 100.00 }],
        totalAmount: 100.00
      });

      const payment = await paymentService.initiatePayment({
        orderId: order.orderId,
        tenantId,
        amount: 100.00,
        currency: 'USD',
        method: 'ecocash'
      });

      await webhookHandler.handleEcoCashWebhook({
        reference: payment.reference,
        status: 'SUCCESS',
        amount: 100.00
      }, tenantId);

      const refund = await paymentService.processRefund({
        paymentId: payment.paymentId,
        tenantId,
        amount: 100.00,
        reason: 'Order cancelled'
      });

      // Simulate refund failure
      await webhookHandler.handleEcoCashWebhook({
        reference: refund.reference,
        type: 'REFUND',
        status: 'FAILED',
        reason: 'ACCOUNT_CLOSED'
      }, tenantId);

      const failedRefund = await paymentService.getRefund(refund.refundId, tenantId);
      expect(failedRefund.status).toBe('FAILED');
      expect(failedRefund.failureReason).toBe('ACCOUNT_CLOSED');

      // Verify payment is still marked as completed
      const payment2 = await paymentService.getPayment(payment.paymentId, tenantId);
      expect(payment2.status).toBe('COMPLETED');
      expect(payment2.refundedAmount).toBe(0);
    });
  });

  describe('Reconciliation and Settlement', () => {
    it('should reconcile daily transactions', async () => {
      // Create multiple payments for reconciliation
      const payments = [];
      for (let i = 0; i < 5; i++) {
        const order = await orderService.createOrder({
          tenantId,
          customerId: `recon-customer-${i}`,
          items: [{ productId: `test-${i}`, quantity: 1, price: 20.00 }],
          totalAmount: 20.00
        });

        const payment = await paymentService.initiatePayment({
          orderId: order.orderId,
          tenantId,
          amount: 20.00,
          currency: 'USD',
          method: 'ecocash'
        });

        await webhookHandler.handleEcoCashWebhook({
          reference: payment.reference,
          status: 'SUCCESS',
          amount: 20.00,
          transactionId: `ECO-RECON-${i}`
        }, tenantId);

        payments.push(payment);
      }

      // Run reconciliation
      const reconResult = await reconciliationService.runDailyReconciliation(tenantId, new Date());

      expect(reconResult.totalTransactions).toBe(5);
      expect(reconResult.totalAmount).toBe(100.00);
      expect(reconResult.reconciledCount).toBe(5);
      expect(reconResult.discrepancies).toHaveLength(0);
    });

    it('should detect reconciliation discrepancies', async () => {
      // Create payment
      const order = await orderService.createOrder({
        tenantId,
        customerId: 'discrepancy-customer',
        items: [{ productId: 'test-disc', quantity: 1, price: 50.00 }],
        totalAmount: 50.00
      });

      const payment = await paymentService.initiatePayment({
        orderId: order.orderId,
        tenantId,
        amount: 50.00,
        currency: 'USD',
        method: 'ecocash'
      });

      // Record payment as success in our system
      await paymentService.updatePaymentStatus(payment.paymentId, 'COMPLETED', {
        gatewayTransactionId: 'ECO-DISC-123',
        processedAmount: 50.00
      });

      // Simulate gateway reporting different amount
      jest.spyOn(reconciliationService['ecoCashClient'], 'getTransactionDetails')
        .mockResolvedValue({
          transactionId: 'ECO-DISC-123',
          amount: 45.00, // Discrepancy!
          status: 'SUCCESS'
        });

      const reconResult = await reconciliationService.reconcileTransaction(payment.paymentId, tenantId);

      expect(reconResult.hasDiscrepancy).toBe(true);
      expect(reconResult.discrepancyType).toBe('AMOUNT_MISMATCH');
      expect(reconResult.expectedAmount).toBe(50.00);
      expect(reconResult.actualAmount).toBe(45.00);

      // Verify alert was created
      const alerts = await reconciliationService.getReconciliationAlerts(tenantId);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('HIGH');
    });

    it('should process vendor settlements', async () => {
      // Create payments for settlement
      const vendorId = 'settlement-vendor';
      const orders = [];

      for (let i = 0; i < 3; i++) {
        const order = await orderService.createOrder({
          tenantId,
          customerId: `settlement-customer-${i}`,
          vendorId,
          items: [{ productId: `test-${i}`, quantity: 1, price: 100.00 }],
          totalAmount: 100.00
        });

        const payment = await paymentService.initiatePayment({
          orderId: order.orderId,
          tenantId,
          amount: 100.00,
          currency: 'USD',
          method: 'ecocash'
        });

        await webhookHandler.handleEcoCashWebhook({
          reference: payment.reference,
          status: 'SUCCESS',
          amount: 100.00
        }, tenantId);

        orders.push(order);
      }

      // Process settlement
      const settlement = await paymentService.processVendorSettlement({
        vendorId,
        tenantId,
        settlementPeriod: 'DAILY'
      });

      expect(settlement.settlementId).toBeDefined();
      expect(settlement.totalAmount).toBe(300.00);
      expect(settlement.transactionCount).toBe(3);
      expect(settlement.fees).toBeDefined();
      expect(settlement.netAmount).toBeLessThan(300.00); // After fees

      // Initiate bank transfer
      const transfer = await paymentService.initiateBankTransfer({
        settlementId: settlement.settlementId,
        tenantId,
        vendorId
      });

      expect(transfer.status).toBe('PENDING');
      expect(transfer.bankReference).toBeDefined();
    });
  });

  describe('Compliance and Reporting', () => {
    it('should generate transaction reports', async () => {
      const report = await paymentService.generateTransactionReport({
        tenantId,
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        endDate: new Date(),
        includeRefunds: true,
        groupBy: 'payment_method'
      });

      expect(report).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.summary.totalTransactions).toBeGreaterThan(0);
      expect(report.summary.totalAmount).toBeGreaterThan(0);
      expect(report.methodBreakdown).toBeDefined();
      expect(report.methodBreakdown.ecocash).toBeDefined();
    });

    it('should track and report suspicious transactions', async () => {
      // Create suspicious pattern
      const customerId = 'suspicious-customer';
      
      // Multiple high-value transactions in short time
      for (let i = 0; i < 5; i++) {
        const order = await orderService.createOrder({
          tenantId,
          customerId,
          items: [{ productId: 'high-value', quantity: 1, price: 1000.00 }],
          totalAmount: 1000.00
        });

        const payment = await paymentService.initiatePayment({
          orderId: order.orderId,
          tenantId,
          amount: 1000.00,
          currency: 'USD',
          method: 'ecocash'
        });

        await webhookHandler.handleEcoCashWebhook({
          reference: payment.reference,
          status: 'SUCCESS',
          amount: 1000.00
        }, tenantId);
      }

      // Check fraud detection
      const fraudAlerts = await paymentService.getFraudAlerts(tenantId);
      const customerAlert = fraudAlerts.find(a => a.customerId === customerId);

      expect(customerAlert).toBeDefined();
      expect(customerAlert.alertType).toBe('HIGH_FREQUENCY_HIGH_VALUE');
      expect(customerAlert.riskScore).toBeGreaterThan(0.7);
    });

    it('should maintain audit trail for all payment operations', async () => {
      const order = await orderService.createOrder({
        tenantId,
        customerId: 'audit-customer',
        items: [{ productId: 'audit-test', quantity: 1, price: 50.00 }],
        totalAmount: 50.00
      });

      const payment = await paymentService.initiatePayment({
        orderId: order.orderId,
        tenantId,
        amount: 50.00,
        currency: 'USD',
        method: 'ecocash'
      });

      // Get audit trail
      const auditTrail = await paymentService.getAuditTrail(payment.paymentId);

      expect(auditTrail).toBeDefined();
      expect(auditTrail.events).toContainEqual(
        expect.objectContaining({
          action: 'PAYMENT_INITIATED',
          timestamp: expect.any(Date),
          userId: expect.any(String),
          details: expect.objectContaining({
            amount: 50.00,
            method: 'ecocash'
          })
        })
      );
    });
  });
});