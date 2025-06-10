import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { WhatsAppService } from '../../backend/services/whatsapp-service/src/services/whatsapp.service';
import { OrderService } from '../../backend/services/order-service/src/services/order.service';
import { PaymentService } from '../../backend/services/payment-service/src/services/payment.service';
import { DeliveryService } from '../../backend/services/delivery-service/src/services/delivery.service';
import { ConversationStateManager } from '../../backend/services/whatsapp-service/src/services/conversation-state.manager';

describe('E2E: Brenda Customer Purchase Flow', () => {
  let whatsappService: WhatsAppService;
  let orderService: OrderService;
  let paymentService: PaymentService;
  let deliveryService: DeliveryService;
  let conversationManager: ConversationStateManager;

  const brendaPhone = '+263776543210';
  const tenantId = 'uncle-charles-kitchen';
  const brendaProfile = {
    name: 'Brenda Moyo',
    phone: brendaPhone,
    preferredLanguage: 'en',
    deliveryAddress: {
      street: '15 Baines Avenue',
      area: 'Avondale',
      city: 'Harare',
      coordinates: { lat: -17.7945, lng: 31.0488 }
    },
    paymentPreference: 'ecocash'
  };

  beforeAll(async () => {
    whatsappService = new WhatsAppService();
    orderService = new OrderService();
    paymentService = new PaymentService();
    deliveryService = new DeliveryService();
    conversationManager = new ConversationStateManager();

    await Promise.all([
      whatsappService.initialize(),
      orderService.initialize(),
      paymentService.initialize(),
      deliveryService.initialize()
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      whatsappService.shutdown(),
      orderService.shutdown(),
      paymentService.shutdown(),
      deliveryService.shutdown()
    ]);
  });

  describe('First-Time Customer Journey', () => {
    it('should initiate conversation with greeting', async () => {
      // Brenda sends first message
      const initialMessage = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '263771234567',
                phone_number_id: 'uncle-charles-wa-id'
              },
              messages: [{
                from: brendaPhone,
                id: 'msg-001',
                timestamp: Date.now(),
                type: 'text',
                text: { body: 'Hi' }
              }],
              contacts: [{
                profile: { name: 'Brenda Moyo' },
                wa_id: brendaPhone.replace('+', '')
              }]
            }
          }]
        }]
      };

      const response = await whatsappService.handleWebhook(initialMessage);
      expect(response.status).toBe('processed');

      // Verify welcome message was sent
      const sentMessages = await whatsappService.getSentMessages(brendaPhone);
      const welcomeMsg = sentMessages.find(m => m.text?.includes('Welcome to Uncle Charles Kitchen'));
      
      expect(welcomeMsg).toBeDefined();
      expect(welcomeMsg.text).toContain("Zimbabwe's favorite traditional cuisine");
      expect(welcomeMsg.interactive).toBeDefined();
      expect(welcomeMsg.interactive.type).toBe('button');
      expect(welcomeMsg.interactive.body.text).toContain('How can we help you today?');
    });

    it('should display menu when requested', async () => {
      // Brenda clicks "View Menu" button
      const menuRequest = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: brendaPhone,
                id: 'msg-002',
                timestamp: Date.now(),
                type: 'interactive',
                interactive: {
                  type: 'button_reply',
                  button_reply: {
                    id: 'view_menu',
                    title: 'View Menu'
                  }
                }
              }]
            }
          }]
        }]
      };

      await whatsappService.handleWebhook(menuRequest);

      // Verify menu categories were sent
      const messages = await whatsappService.getSentMessages(brendaPhone);
      const menuMsg = messages.find(m => m.interactive?.type === 'list');
      
      expect(menuMsg).toBeDefined();
      expect(menuMsg.interactive.header.text).toBe('Our Menu Categories');
      expect(menuMsg.interactive.sections).toBeDefined();
      
      const categories = menuMsg.interactive.sections[0].rows;
      expect(categories).toContainEqual(
        expect.objectContaining({ id: 'sadza_meals', title: 'Sadza Meals' })
      );
      expect(categories).toContainEqual(
        expect.objectContaining({ id: 'grilled_meats', title: 'Grilled Meats' })
      );
    });

    it('should show items in selected category', async () => {
      // Brenda selects "Sadza Meals" category
      const categorySelection = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: brendaPhone,
                id: 'msg-003',
                timestamp: Date.now(),
                type: 'interactive',
                interactive: {
                  type: 'list_reply',
                  list_reply: {
                    id: 'sadza_meals',
                    title: 'Sadza Meals'
                  }
                }
              }]
            }
          }]
        }]
      };

      await whatsappService.handleWebhook(categorySelection);

      // Verify items with images were sent
      const messages = await whatsappService.getSentMessages(brendaPhone);
      const itemMessages = messages.filter(m => m.type === 'image');
      
      expect(itemMessages.length).toBeGreaterThan(0);
      
      // Check first item
      const firstItem = itemMessages[0];
      expect(firstItem.image.link).toContain('sadza-beef-stew');
      expect(firstItem.image.caption).toContain('Sadza & Beef Stew');
      expect(firstItem.image.caption).toContain('$8.00');
      expect(firstItem.image.caption).toContain('Traditional white maize meal');
    });

    it('should add items to cart', async () => {
      // Brenda orders Sadza & Beef Stew
      const addToCart1 = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: brendaPhone,
                id: 'msg-004',
                timestamp: Date.now(),
                type: 'interactive',
                interactive: {
                  type: 'button_reply',
                  button_reply: {
                    id: 'add_sadza_beef_stew',
                    title: 'Add to Cart'
                  }
                }
              }]
            }
          }]
        }]
      };

      await whatsappService.handleWebhook(addToCart1);

      // Verify item added confirmation
      const messages = await whatsappService.getSentMessages(brendaPhone);
      const confirmMsg = messages.find(m => 
        m.text?.includes('✅ Added to cart: Sadza & Beef Stew')
      );
      expect(confirmMsg).toBeDefined();

      // Add another item - Grilled Chicken
      const addToCart2 = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: brendaPhone,
                id: 'msg-005',
                timestamp: Date.now(),
                type: 'text',
                text: { body: 'Add grilled chicken' }
              }]
            }
          }]
        }]
      };

      await whatsappService.handleWebhook(addToCart2);

      // Verify cart summary
      const cartSummary = messages.find(m => m.text?.includes('Your Cart'));
      expect(cartSummary).toBeDefined();
      expect(cartSummary.text).toContain('2 items');
      expect(cartSummary.text).toContain('Total: $15.50');
    });

    it('should collect delivery details', async () => {
      // Brenda proceeds to checkout
      const checkout = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: brendaPhone,
                id: 'msg-006',
                timestamp: Date.now(),
                type: 'interactive',
                interactive: {
                  type: 'button_reply',
                  button_reply: {
                    id: 'proceed_checkout',
                    title: 'Proceed to Checkout'
                  }
                }
              }]
            }
          }]
        }]
      };

      await whatsappService.handleWebhook(checkout);

      // Verify delivery options presented
      const messages = await whatsappService.getSentMessages(brendaPhone);
      const deliveryMsg = messages.find(m => 
        m.interactive?.header?.text === 'Delivery Options'
      );
      
      expect(deliveryMsg).toBeDefined();
      expect(deliveryMsg.interactive.sections[0].rows).toContainEqual(
        expect.objectContaining({ 
          id: 'share_location',
          title: 'Share Current Location' 
        })
      );

      // Brenda shares location
      const locationShare = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: brendaPhone,
                id: 'msg-007',
                timestamp: Date.now(),
                type: 'location',
                location: {
                  latitude: brendaProfile.deliveryAddress.coordinates.lat,
                  longitude: brendaProfile.deliveryAddress.coordinates.lng,
                  name: 'Baines Avenue Shopping Center',
                  address: brendaProfile.deliveryAddress.street
                }
              }]
            }
          }]
        }]
      };

      await whatsappService.handleWebhook(locationShare);

      // Verify location confirmation
      const locationConfirm = messages.find(m => 
        m.text?.includes('📍 Delivery to: Baines Avenue Shopping Center')
      );
      expect(locationConfirm).toBeDefined();
      expect(locationConfirm.text).toContain('Delivery fee: $2.00');
      expect(locationConfirm.text).toContain('Estimated time: 30-40 minutes');
    });

    it('should process payment', async () => {
      // Present payment options
      const messages = await whatsappService.getSentMessages(brendaPhone);
      const paymentMsg = messages.find(m => 
        m.interactive?.header?.text === 'Payment Method'
      );
      
      expect(paymentMsg).toBeDefined();
      expect(paymentMsg.interactive.sections[0].rows).toContainEqual(
        expect.objectContaining({ 
          id: 'pay_ecocash',
          title: 'EcoCash',
          description: 'Pay with EcoCash mobile money'
        })
      );

      // Brenda selects EcoCash
      const paymentSelection = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: brendaPhone,
                id: 'msg-008',
                timestamp: Date.now(),
                type: 'interactive',
                interactive: {
                  type: 'list_reply',
                  list_reply: {
                    id: 'pay_ecocash',
                    title: 'EcoCash'
                  }
                }
              }]
            }
          }]
        }]
      };

      await whatsappService.handleWebhook(paymentSelection);

      // Verify payment instructions sent
      const paymentInstructions = messages.find(m => 
        m.text?.includes('EcoCash Payment Instructions')
      );
      expect(paymentInstructions).toBeDefined();
      expect(paymentInstructions.text).toContain('Amount: $17.50'); // Including delivery
      expect(paymentInstructions.text).toContain('Merchant Code: 12345');
      expect(paymentInstructions.text).toContain('Reference:');

      // Get order details from conversation state
      const state = await conversationManager.getState(`whatsapp-${brendaPhone}`);
      expect(state.orderId).toBeDefined();
      expect(state.paymentReference).toBeDefined();

      // Simulate EcoCash payment webhook
      await paymentService.handleWebhook({
        reference: state.paymentReference,
        status: 'SUCCESS',
        amount: 17.50,
        currency: 'USD',
        phoneNumber: brendaPhone,
        transactionId: 'ECO-123456789'
      });

      // Verify payment confirmation sent
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for notification
      
      const updatedMessages = await whatsappService.getSentMessages(brendaPhone);
      const paymentConfirm = updatedMessages.find(m => 
        m.text?.includes('✅ Payment Received!')
      );
      
      expect(paymentConfirm).toBeDefined();
      expect(paymentConfirm.text).toContain('Order #');
      expect(paymentConfirm.text).toContain('Your order has been confirmed');
    });

    it('should track order preparation', async () => {
      const state = await conversationManager.getState(`whatsapp-${brendaPhone}`);
      const order = await orderService.getOrder(state.orderId, tenantId);

      // Vendor accepts order
      await orderService.vendorAcceptOrder(order.orderId, order.vendorId);

      // Wait for notification
      await new Promise(resolve => setTimeout(resolve, 500));

      const messages = await whatsappService.getSentMessages(brendaPhone);
      const acceptMsg = messages.find(m => 
        m.text?.includes('🍳 Your order is being prepared!')
      );
      
      expect(acceptMsg).toBeDefined();
      expect(acceptMsg.text).toContain('Estimated ready time: 20-25 minutes');

      // Simulate preparation updates
      const prepStages = [
        { stage: 'COOKING_STARTED', message: '👨‍🍳 Chef has started preparing your order' },
        { stage: 'COOKING_50_PERCENT', message: '⏳ Your order is 50% ready' },
        { stage: 'COOKING_COMPLETED', message: '✅ Your food is ready and being packed!' }
      ];

      for (const stage of prepStages) {
        await orderService.updatePreparationStatus(order.orderId, order.vendorId, {
          stage: stage.stage,
          estimatedMinutes: 5
        });

        await new Promise(resolve => setTimeout(resolve, 500));

        const stageMsg = messages.find(m => m.text?.includes(stage.message));
        expect(stageMsg).toBeDefined();
      }
    });

    it('should track delivery in real-time', async () => {
      const state = await conversationManager.getState(`whatsapp-${brendaPhone}`);
      const order = await orderService.getOrder(state.orderId, tenantId);

      // Mark order ready for pickup
      await orderService.markReadyForPickup(order.orderId, order.vendorId);

      // Assign delivery
      const delivery = await deliveryService.createDelivery({
        orderId: order.orderId,
        tenantId,
        pickupLocation: {
          name: "Uncle Charles Kitchen",
          coordinates: { lat: -17.8319, lng: 31.0456 }
        },
        dropoffLocation: {
          name: brendaProfile.deliveryAddress.street,
          coordinates: brendaProfile.deliveryAddress.coordinates
        },
        customerPhone: brendaPhone
      });

      // Wait for driver assignment notification
      await new Promise(resolve => setTimeout(resolve, 500));

      const messages = await whatsappService.getSentMessages(brendaPhone);
      const driverMsg = messages.find(m => 
        m.text?.includes('🚴 Driver assigned to your order!')
      );
      
      expect(driverMsg).toBeDefined();
      expect(driverMsg.text).toContain('Driver: David');
      expect(driverMsg.text).toContain('Vehicle: Motorcycle');
      expect(driverMsg.interactive).toBeDefined();
      expect(driverMsg.interactive.sections[0].rows).toContainEqual(
        expect.objectContaining({ 
          id: 'track_driver',
          title: 'Track Driver Location'
        })
      );

      // Simulate driver updates
      const driverUpdates = [
        { status: 'PICKED_UP', message: '📦 Driver has picked up your order' },
        { status: 'EN_ROUTE', message: '🚴 Driver is on the way to you' },
        { status: 'NEARBY', message: '📍 Driver is nearby! Please be ready' }
      ];

      for (const update of driverUpdates) {
        await deliveryService.updateDeliveryStatus(
          delivery.deliveryId, 
          delivery.driverId,
          update.status
        );

        await new Promise(resolve => setTimeout(resolve, 500));

        const updateMsg = messages.find(m => m.text?.includes(update.message));
        expect(updateMsg).toBeDefined();
      }
    });

    it('should complete delivery and request feedback', async () => {
      const state = await conversationManager.getState(`whatsapp-${brendaPhone}`);
      const order = await orderService.getOrder(state.orderId, tenantId);
      const delivery = await deliveryService.getDeliveryByOrderId(order.orderId);

      // Complete delivery
      await deliveryService.completeDelivery({
        deliveryId: delivery.deliveryId,
        driverId: delivery.driverId,
        proofOfDelivery: {
          type: 'CUSTOMER_SIGNATURE',
          recipientName: 'Brenda',
          notes: 'Delivered to customer at gate'
        }
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      const messages = await whatsappService.getSentMessages(brendaPhone);
      const deliveredMsg = messages.find(m => 
        m.text?.includes('🎉 Your order has been delivered!')
      );
      
      expect(deliveredMsg).toBeDefined();
      expect(deliveredMsg.text).toContain('Thank you for ordering from Uncle Charles Kitchen');

      // Check for feedback request
      const feedbackMsg = messages.find(m => 
        m.interactive?.header?.text === 'Rate Your Experience'
      );
      
      expect(feedbackMsg).toBeDefined();
      expect(feedbackMsg.interactive.type).toBe('button');
      
      // Brenda provides feedback
      const feedbackResponse = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: brendaPhone,
                id: 'msg-feedback',
                timestamp: Date.now(),
                type: 'interactive',
                interactive: {
                  type: 'button_reply',
                  button_reply: {
                    id: 'rate_5_stars',
                    title: '⭐⭐⭐⭐⭐ Excellent!'
                  }
                }
              }]
            }
          }]
        }]
      };

      await whatsappService.handleWebhook(feedbackResponse);

      // Verify thank you message
      const thankYouMsg = messages.find(m => 
        m.text?.includes('Thank you for your feedback!')
      );
      expect(thankYouMsg).toBeDefined();
      expect(thankYouMsg.text).toContain('5-star rating');
    });
  });

  describe('Repeat Customer Experience', () => {
    it('should recognize returning customer', async () => {
      // Brenda messages again after some time
      const returnMessage = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: brendaPhone,
                id: 'msg-return-001',
                timestamp: Date.now() + 86400000, // Next day
                type: 'text',
                text: { body: 'Hi, I want to order again' }
              }]
            }
          }]
        }]
      };

      await whatsappService.handleWebhook(returnMessage);

      const messages = await whatsappService.getSentMessages(brendaPhone);
      const welcomeBack = messages.find(m => 
        m.text?.includes('Welcome back, Brenda!')
      );
      
      expect(welcomeBack).toBeDefined();
      expect(welcomeBack.interactive.sections[0].rows).toContainEqual(
        expect.objectContaining({ 
          id: 'reorder_last',
          title: 'Reorder Last Order',
          description: 'Sadza & Beef Stew, Grilled Chicken'
        })
      );
    });

    it('should handle quick reorder', async () => {
      // Brenda selects quick reorder
      const reorder = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: brendaPhone,
                id: 'msg-reorder',
                timestamp: Date.now(),
                type: 'interactive',
                interactive: {
                  type: 'list_reply',
                  list_reply: {
                    id: 'reorder_last',
                    title: 'Reorder Last Order'
                  }
                }
              }]
            }
          }]
        }]
      };

      await whatsappService.handleWebhook(reorder);

      const messages = await whatsappService.getSentMessages(brendaPhone);
      const confirmReorder = messages.find(m => 
        m.text?.includes('Your previous order:')
      );
      
      expect(confirmReorder).toBeDefined();
      expect(confirmReorder.text).toContain('Sadza & Beef Stew x1');
      expect(confirmReorder.text).toContain('Grilled Chicken x1');
      expect(confirmReorder.text).toContain('Total: $17.50');
      expect(confirmReorder.text).toContain('Same delivery address?');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle payment failure gracefully', async () => {
      // Create new order
      const orderData = {
        tenantId,
        customerId: `whatsapp-${brendaPhone}`,
        items: [{ productId: 'test-item', quantity: 1, price: 20.00 }],
        totalAmount: 20.00
      };

      const order = await orderService.createOrder(orderData);
      const payment = await paymentService.initiatePayment({
        orderId: order.orderId,
        tenantId,
        amount: 20.00,
        currency: 'USD',
        method: 'ecocash'
      });

      // Simulate payment failure
      await paymentService.handleWebhook({
        reference: payment.reference,
        status: 'FAILED',
        reason: 'Insufficient funds',
        phoneNumber: brendaPhone
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      const messages = await whatsappService.getSentMessages(brendaPhone);
      const failureMsg = messages.find(m => 
        m.text?.includes('❌ Payment Failed')
      );
      
      expect(failureMsg).toBeDefined();
      expect(failureMsg.text).toContain('Insufficient funds');
      expect(failureMsg.interactive).toBeDefined();
      expect(failureMsg.interactive.sections[0].rows).toContainEqual(
        expect.objectContaining({ 
          id: 'retry_payment',
          title: 'Try Again'
        })
      );
    });

    it('should handle conversation timeout', async () => {
      // Create stale conversation state
      await conversationManager.createState(`whatsapp-${brendaPhone}`, {
        currentStep: 'PAYMENT_PENDING',
        lastActivity: Date.now() - 3600000, // 1 hour ago
        draftOrder: {
          items: [{ productId: 'test', quantity: 1, price: 10.00 }]
        }
      });

      // Brenda sends message after timeout
      const timeoutMessage = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: brendaPhone,
                id: 'msg-timeout',
                timestamp: Date.now(),
                type: 'text',
                text: { body: 'Hello?' }
              }]
            }
          }]
        }]
      };

      await whatsappService.handleWebhook(timeoutMessage);

      const messages = await whatsappService.getSentMessages(brendaPhone);
      const timeoutMsg = messages.find(m => 
        m.text?.includes('Your previous session has expired')
      );
      
      expect(timeoutMsg).toBeDefined();
      expect(timeoutMsg.interactive.sections[0].rows).toContainEqual(
        expect.objectContaining({ 
          id: 'continue_order',
          title: 'Continue Previous Order'
        })
      );
    });

    it('should handle multi-language support', async () => {
      // Brenda switches to Shona
      const shonaMessage = {
        entry: [{
          id: tenantId,
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              messages: [{
                from: brendaPhone,
                id: 'msg-shona',
                timestamp: Date.now(),
                type: 'text',
                text: { body: 'Ndoda menu muShona' } // "I want menu in Shona"
              }]
            }
          }]
        }]
      };

      await whatsappService.handleWebhook(shonaMessage);

      const messages = await whatsappService.getSentMessages(brendaPhone);
      const shonaResponse = messages.find(m => 
        m.text?.includes('Makadini') || m.text?.includes('Menu yedu')
      );
      
      expect(shonaResponse).toBeDefined();
      
      // Verify language preference is saved
      const state = await conversationManager.getState(`whatsapp-${brendaPhone}`);
      expect(state.language).toBe('sn');
    });
  });
});