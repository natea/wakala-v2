import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { WhatsAppService } from '../../backend/services/whatsapp-service/src/services/whatsapp.service';
import { OrchestrationEngine } from '../../backend/services/orchestration-engine/src/engines/workflow.engine';
import { OrderService } from '../../backend/services/order-service/src/services/order.service';
import { PaymentService } from '../../backend/services/payment-service/src/services/payment.service';
import { DeliveryService } from '../../backend/services/delivery-service/src/services/delivery.service';
import { ConversationStateManager } from '../../backend/services/whatsapp-service/src/services/conversation-state.manager';

describe('WhatsApp End-to-End Flow Integration', () => {
  let whatsappService: WhatsAppService;
  let orchestrationEngine: OrchestrationEngine;
  let orderService: OrderService;
  let paymentService: PaymentService;
  let deliveryService: DeliveryService;
  let conversationManager: ConversationStateManager;

  beforeAll(async () => {
    // Initialize all services
    whatsappService = new WhatsAppService();
    orchestrationEngine = new OrchestrationEngine();
    orderService = new OrderService();
    paymentService = new PaymentService();
    deliveryService = new DeliveryService();
    conversationManager = new ConversationStateManager();

    await Promise.all([
      whatsappService.initialize(),
      orchestrationEngine.initialize(),
      orderService.initialize(),
      paymentService.initialize(),
      deliveryService.initialize()
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      whatsappService.shutdown(),
      orchestrationEngine.shutdown(),
      orderService.shutdown(),
      paymentService.shutdown(),
      deliveryService.shutdown()
    ]);
  });

  describe('Customer Order Flow via WhatsApp', () => {
    const customerId = 'brenda-whatsapp-263776543210';
    const tenantId = 'uncle-charles-kitchen';

    it('should handle initial greeting and menu request', async () => {
      const webhookPayload = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: '263776543210',
                id: 'msg-001',
                timestamp: Date.now(),
                type: 'text',
                text: { body: 'Hi, I want to see the menu' }
              }]
            }
          }]
        }]
      };

      const response = await whatsappService.handleWebhook(webhookPayload);
      
      expect(response.status).toBe('processed');
      expect(response.messagesSent).toBeGreaterThan(0);

      // Verify conversation state was created
      const state = await conversationManager.getState(customerId);
      expect(state).toBeDefined();
      expect(state.currentStep).toBe('VIEWING_MENU');
    });

    it('should process menu selection and build order', async () => {
      // Customer selects items
      const selectionPayload = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: '263776543210',
                id: 'msg-002',
                timestamp: Date.now(),
                type: 'interactive',
                interactive: {
                  type: 'list_reply',
                  list_reply: {
                    id: 'sadza-chicken-combo',
                    title: 'Sadza & Chicken Combo'
                  }
                }
              }]
            }
          }]
        }]
      };

      const response = await whatsappService.handleWebhook(selectionPayload);
      
      expect(response.status).toBe('processed');
      
      // Verify order was created in draft state
      const state = await conversationManager.getState(customerId);
      expect(state.draftOrder).toBeDefined();
      expect(state.draftOrder.items).toHaveLength(1);
      expect(state.currentStep).toBe('BUILDING_ORDER');
    });

    it('should confirm order and request delivery details', async () => {
      const confirmPayload = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: '263776543210',
                id: 'msg-003',
                timestamp: Date.now(),
                type: 'interactive',
                interactive: {
                  type: 'button_reply',
                  button_reply: {
                    id: 'confirm_order',
                    title: 'Confirm Order'
                  }
                }
              }]
            }
          }]
        }]
      };

      const response = await whatsappService.handleWebhook(confirmPayload);
      
      expect(response.status).toBe('processed');
      
      const state = await conversationManager.getState(customerId);
      expect(state.currentStep).toBe('COLLECTING_DELIVERY_INFO');
    });

    it('should collect delivery address via location sharing', async () => {
      const locationPayload = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: '263776543210',
                id: 'msg-004',
                timestamp: Date.now(),
                type: 'location',
                location: {
                  latitude: -17.8292,
                  longitude: 31.0522,
                  name: 'Baines Avenue Shopping Center',
                  address: '15 Baines Avenue, Harare'
                }
              }]
            }
          }]
        }]
      };

      const response = await whatsappService.handleWebhook(locationPayload);
      
      expect(response.status).toBe('processed');
      
      const state = await conversationManager.getState(customerId);
      expect(state.draftOrder.deliveryAddress).toBeDefined();
      expect(state.currentStep).toBe('SELECTING_PAYMENT_METHOD');
    });

    it('should process payment method selection', async () => {
      const paymentPayload = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: '263776543210',
                id: 'msg-005',
                timestamp: Date.now(),
                type: 'interactive',
                interactive: {
                  type: 'button_reply',
                  button_reply: {
                    id: 'payment_ecocash',
                    title: 'EcoCash'
                  }
                }
              }]
            }
          }]
        }]
      };

      const response = await whatsappService.handleWebhook(paymentPayload);
      
      expect(response.status).toBe('processed');
      
      const state = await conversationManager.getState(customerId);
      expect(state.draftOrder.paymentMethod).toBe('ecocash');
      expect(state.currentStep).toBe('AWAITING_PAYMENT');
    });

    it('should create order through orchestration engine', async () => {
      const state = await conversationManager.getState(customerId);
      
      // Trigger order creation saga
      const sagaResult = await orchestrationEngine.executeSaga('CREATE_ORDER', {
        tenantId,
        customerId,
        order: state.draftOrder
      });

      expect(sagaResult.status).toBe('completed');
      expect(sagaResult.orderId).toBeDefined();
      expect(sagaResult.paymentId).toBeDefined();

      // Verify order was created
      const order = await orderService.getOrder(sagaResult.orderId, tenantId);
      expect(order).toBeDefined();
      expect(order.status).toBe('PAYMENT_PENDING');
    });

    it('should handle payment confirmation webhook', async () => {
      const state = await conversationManager.getState(customerId);
      
      // Simulate payment webhook from EcoCash
      const paymentWebhook = {
        reference: state.paymentReference,
        status: 'SUCCESS',
        amount: 15.50,
        currency: 'USD',
        phoneNumber: '263776543210'
      };

      const paymentResult = await paymentService.handleWebhook(paymentWebhook);
      
      expect(paymentResult.status).toBe('processed');

      // Verify order status was updated
      const order = await orderService.getOrder(state.orderId, tenantId);
      expect(order.status).toBe('CONFIRMED');

      // Verify customer received WhatsApp notification
      const notifications = await whatsappService.getSentMessages(customerId);
      const confirmationMsg = notifications.find(m => 
        m.text?.includes('payment received') && m.text?.includes('order confirmed')
      );
      expect(confirmationMsg).toBeDefined();
    });

    it('should assign delivery and track updates', async () => {
      const state = await conversationManager.getState(customerId);
      
      // Trigger delivery assignment
      const deliveryResult = await deliveryService.assignDelivery({
        orderId: state.orderId,
        tenantId,
        pickupLocation: { lat: -17.8319, lng: 31.0456 },
        dropoffLocation: { lat: -17.8292, lng: 31.0522 }
      });

      expect(deliveryResult.deliveryId).toBeDefined();
      expect(deliveryResult.driverId).toBeDefined();
      expect(deliveryResult.estimatedTime).toBeDefined();

      // Verify customer received delivery assignment notification
      const notifications = await whatsappService.getSentMessages(customerId);
      const deliveryMsg = notifications.find(m => 
        m.text?.includes('driver assigned') && m.text?.includes(deliveryResult.driverName)
      );
      expect(deliveryMsg).toBeDefined();
    });

    it('should handle delivery status updates', async () => {
      const state = await conversationManager.getState(customerId);
      
      // Simulate driver status updates
      const statusUpdates = [
        { status: 'PICKED_UP', location: { lat: -17.8319, lng: 31.0456 } },
        { status: 'EN_ROUTE', location: { lat: -17.8305, lng: 31.0489 } },
        { status: 'ARRIVED', location: { lat: -17.8292, lng: 31.0522 } }
      ];

      for (const update of statusUpdates) {
        await deliveryService.updateDeliveryStatus({
          deliveryId: state.deliveryId,
          ...update
        });

        // Small delay to allow notifications to be sent
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Verify customer received all status updates
      const notifications = await whatsappService.getSentMessages(customerId);
      expect(notifications.some(m => m.text?.includes('picked up your order'))).toBe(true);
      expect(notifications.some(m => m.text?.includes('on the way'))).toBe(true);
      expect(notifications.some(m => m.text?.includes('arrived'))).toBe(true);
    });

    it('should complete order and request feedback', async () => {
      const state = await conversationManager.getState(customerId);
      
      // Mark delivery as completed
      await deliveryService.completeDelivery({
        deliveryId: state.deliveryId,
        proofOfDelivery: 'CUSTOMER_SIGNATURE'
      });

      // Verify order status
      const order = await orderService.getOrder(state.orderId, tenantId);
      expect(order.status).toBe('DELIVERED');

      // Verify feedback request was sent
      const notifications = await whatsappService.getSentMessages(customerId);
      const feedbackMsg = notifications.find(m => 
        m.text?.includes('rate your experience') || m.interactive?.type === 'button'
      );
      expect(feedbackMsg).toBeDefined();
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle payment failure gracefully', async () => {
      const failedPaymentWebhook = {
        reference: 'test-payment-ref',
        status: 'FAILED',
        reason: 'Insufficient funds',
        phoneNumber: '263776543210'
      };

      const result = await paymentService.handleWebhook(failedPaymentWebhook);
      
      // Verify customer was notified
      const notifications = await whatsappService.getSentMessages('263776543210');
      const failureMsg = notifications.find(m => 
        m.text?.includes('payment failed') && m.text?.includes('Insufficient funds')
      );
      expect(failureMsg).toBeDefined();

      // Verify order was cancelled
      const state = await conversationManager.getState('263776543210');
      const order = await orderService.getOrder(state.orderId, state.tenantId);
      expect(order.status).toBe('CANCELLED');
    });

    it('should handle message timeout and resume conversation', async () => {
      const customerId = 'timeout-test-263776543210';
      
      // Start conversation
      await conversationManager.createState(customerId, {
        currentStep: 'BUILDING_ORDER',
        draftOrder: { items: [{ id: 'item-1', quantity: 1 }] },
        lastActivity: Date.now() - (30 * 60 * 1000) // 30 minutes ago
      });

      // Customer sends message after timeout
      const resumePayload = {
        entry: [{
          id: 'test-tenant',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: '263776543210',
                id: 'msg-resume',
                timestamp: Date.now(),
                type: 'text',
                text: { body: 'Hi, I want to continue my order' }
              }]
            }
          }]
        }]
      };

      const response = await whatsappService.handleWebhook(resumePayload);
      
      expect(response.status).toBe('processed');
      
      // Verify conversation was resumed
      const state = await conversationManager.getState(customerId);
      expect(state.currentStep).toBe('BUILDING_ORDER');
      expect(state.draftOrder.items).toHaveLength(1);
    });

    it('should handle invalid input gracefully', async () => {
      const invalidPayload = {
        entry: [{
          id: 'test-tenant',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: '263776543210',
                id: 'msg-invalid',
                timestamp: Date.now(),
                type: 'text',
                text: { body: 'xyz123!@#' }
              }]
            }
          }]
        }]
      };

      const response = await whatsappService.handleWebhook(invalidPayload);
      
      expect(response.status).toBe('processed');
      
      // Verify helpful response was sent
      const notifications = await whatsappService.getSentMessages('263776543210');
      const helpMsg = notifications.find(m => 
        m.text?.includes("I didn't understand") || m.text?.includes('help')
      );
      expect(helpMsg).toBeDefined();
    });
  });

  describe('Multi-language Support', () => {
    it('should handle conversation in Shona', async () => {
      const shonaPayload = {
        entry: [{
          id: 'uncle-charles-kitchen',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: '263776543210',
                id: 'msg-shona',
                timestamp: Date.now(),
                type: 'text',
                text: { body: 'Ndoda kuona menu' } // "I want to see the menu" in Shona
              }]
            }
          }]
        }]
      };

      const response = await whatsappService.handleWebhook(shonaPayload);
      
      expect(response.status).toBe('processed');
      
      // Verify response is in Shona
      const notifications = await whatsappService.getSentMessages('263776543210');
      const shonaResponse = notifications.find(m => 
        m.text?.includes('Hesi') || m.text?.includes('menu yedu') // Shona response
      );
      expect(shonaResponse).toBeDefined();
    });
  });

  describe('Media Handling', () => {
    it('should handle image-based menu browsing', async () => {
      const imageRequestPayload = {
        entry: [{
          id: 'test-tenant',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: '263776543210',
                id: 'msg-image-req',
                timestamp: Date.now(),
                type: 'text',
                text: { body: 'Show me pictures of the food' }
              }]
            }
          }]
        }]
      };

      const response = await whatsappService.handleWebhook(imageRequestPayload);
      
      expect(response.status).toBe('processed');
      
      // Verify image messages were sent
      const notifications = await whatsappService.getSentMessages('263776543210');
      const imageMessages = notifications.filter(m => m.type === 'image');
      expect(imageMessages.length).toBeGreaterThan(0);
      expect(imageMessages[0]).toHaveProperty('image.link');
    });

    it('should handle voice message orders', async () => {
      const voicePayload = {
        entry: [{
          id: 'test-tenant',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: '263776543210',
                id: 'msg-voice',
                timestamp: Date.now(),
                type: 'audio',
                audio: {
                  id: 'audio-123',
                  mime_type: 'audio/ogg'
                }
              }]
            }
          }]
        }]
      };

      // Mock audio transcription
      jest.spyOn(whatsappService['mediaService'], 'transcribeAudio')
        .mockResolvedValue('I want to order 2 sadza and chicken');

      const response = await whatsappService.handleWebhook(voicePayload);
      
      expect(response.status).toBe('processed');
      
      // Verify order was understood from voice
      const state = await conversationManager.getState('263776543210');
      expect(state.draftOrder).toBeDefined();
      expect(state.draftOrder.items.some(i => i.name?.includes('sadza'))).toBe(true);
    });
  });
});