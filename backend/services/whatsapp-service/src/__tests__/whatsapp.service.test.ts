import { WhatsAppService } from '../services/whatsapp.service';
import { WhatsAppClient } from '../clients/whatsapp.client';
import { MessageQueueService } from '../services/message-queue.service';
import { ConversationStateManager } from '../services/conversation-state.manager';
import { MediaService } from '../services/media.service';
import {
  WebhookEvent,
  MessageType,
  MessageStatus,
  TemplateMessage,
  TextMessage,
  MediaMessage,
  InteractiveMessage,
  WebhookVerification,
  ConversationState
} from '../interfaces/whatsapp.interface';
import { Request, Response } from 'express';
import * as crypto from 'crypto';

jest.mock('../clients/whatsapp.client');
jest.mock('../services/message-queue.service');
jest.mock('../services/conversation-state.manager');
jest.mock('../services/media.service');

describe('WhatsAppService', () => {
  let whatsappService: WhatsAppService;
  let mockWhatsAppClient: jest.Mocked<WhatsAppClient>;
  let mockMessageQueue: jest.Mocked<MessageQueueService>;
  let mockConversationManager: jest.Mocked<ConversationStateManager>;
  let mockMediaService: jest.Mocked<MediaService>;

  const mockConfig = {
    phoneNumberId: '123456789',
    accessToken: 'test-access-token',
    verifyToken: 'test-verify-token',
    webhookSecret: 'test-webhook-secret',
    apiVersion: 'v17.0'
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockWhatsAppClient = new WhatsAppClient(mockConfig) as jest.Mocked<WhatsAppClient>;
    mockMessageQueue = new MessageQueueService({} as any) as jest.Mocked<MessageQueueService>;
    mockConversationManager = new ConversationStateManager({} as any) as jest.Mocked<ConversationStateManager>;
    mockMediaService = new MediaService(mockWhatsAppClient) as jest.Mocked<MediaService>;

    whatsappService = new WhatsAppService(
      mockWhatsAppClient,
      mockMessageQueue,
      mockConversationManager,
      mockMediaService,
      mockConfig
    );
  });

  describe('verifyWebhook', () => {
    it('should verify webhook with correct token', async () => {
      // Arrange
      const mockRequest = {
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'test-verify-token',
          'hub.challenge': 'challenge-123'
        }
      } as unknown as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      } as unknown as Response;

      // Act
      await whatsappService.verifyWebhook(mockRequest, mockResponse);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.send).toHaveBeenCalledWith('challenge-123');
    });

    it('should reject webhook with incorrect token', async () => {
      // Arrange
      const mockRequest = {
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong-token',
          'hub.challenge': 'challenge-123'
        }
      } as unknown as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      } as unknown as Response;

      // Act
      await whatsappService.verifyWebhook(mockRequest, mockResponse);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.send).toHaveBeenCalledWith('Verification failed');
    });

    it('should reject invalid webhook mode', async () => {
      // Arrange
      const mockRequest = {
        query: {
          'hub.mode': 'unsubscribe',
          'hub.verify_token': 'test-verify-token',
          'hub.challenge': 'challenge-123'
        }
      } as unknown as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      } as unknown as Response;

      // Act
      await whatsappService.verifyWebhook(mockRequest, mockResponse);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.send).toHaveBeenCalledWith('Invalid mode');
    });
  });

  describe('handleWebhook', () => {
    it('should process incoming message webhook', async () => {
      // Arrange
      const webhookEvent: WebhookEvent = {
        object: 'whatsapp_business_account',
        entry: [{
          id: 'entry-123',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+1234567890',
                phone_number_id: '123456789'
              },
              messages: [{
                id: 'msg-123',
                from: '+9876543210',
                timestamp: '1234567890',
                type: 'text',
                text: { body: 'Hello' }
              }]
            },
            field: 'messages'
          }]
        }]
      };

      const mockRequest = {
        body: webhookEvent,
        headers: {
          'x-hub-signature-256': 'valid-signature'
        }
      } as unknown as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      } as unknown as Response;

      jest.spyOn(whatsappService as any, 'verifySignature').mockReturnValue(true);
      mockMessageQueue.addMessage.mockResolvedValue('job-123');

      // Act
      await whatsappService.handleWebhook(mockRequest, mockResponse);

      // Assert
      expect(mockMessageQueue.addMessage).toHaveBeenCalledWith({
        id: 'msg-123',
        from: '+9876543210',
        timestamp: '1234567890',
        type: 'text',
        text: { body: 'Hello' }
      });
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.send).toHaveBeenCalledWith('EVENT_RECEIVED');
    });

    it('should handle status update webhook', async () => {
      // Arrange
      const webhookEvent: WebhookEvent = {
        object: 'whatsapp_business_account',
        entry: [{
          id: 'entry-123',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+1234567890',
                phone_number_id: '123456789'
              },
              statuses: [{
                id: 'msg-123',
                recipient_id: '+9876543210',
                status: 'delivered',
                timestamp: '1234567890'
              }]
            },
            field: 'messages'
          }]
        }]
      };

      const mockRequest = {
        body: webhookEvent,
        headers: {
          'x-hub-signature-256': 'valid-signature'
        }
      } as unknown as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      } as unknown as Response;

      jest.spyOn(whatsappService as any, 'verifySignature').mockReturnValue(true);

      // Act
      await whatsappService.handleWebhook(mockRequest, mockResponse);

      // Assert
      expect(mockConversationManager.updateMessageStatus).toHaveBeenCalledWith(
        'msg-123',
        'delivered'
      );
      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });

    it('should reject webhook with invalid signature', async () => {
      // Arrange
      const mockRequest = {
        body: { object: 'whatsapp_business_account' },
        headers: {
          'x-hub-signature-256': 'invalid-signature'
        }
      } as unknown as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      } as unknown as Response;

      jest.spyOn(whatsappService as any, 'verifySignature').mockReturnValue(false);

      // Act
      await whatsappService.handleWebhook(mockRequest, mockResponse);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.send).toHaveBeenCalledWith('Unauthorized');
    });
  });

  describe('sendMessage', () => {
    it('should send text message successfully', async () => {
      // Arrange
      const recipient = '+9876543210';
      const message: TextMessage = {
        type: MessageType.TEXT,
        text: { body: 'Hello from Wakala!' }
      };

      const expectedResponse = {
        messaging_product: 'whatsapp',
        contacts: [{ input: recipient, wa_id: recipient.substring(1) }],
        messages: [{ id: 'msg-sent-123' }]
      };

      mockWhatsAppClient.sendMessage.mockResolvedValue(expectedResponse);
      mockConversationManager.addMessage.mockResolvedValue();

      // Act
      const result = await whatsappService.sendMessage(recipient, message);

      // Assert
      expect(mockWhatsAppClient.sendMessage).toHaveBeenCalledWith(recipient, message);
      expect(mockConversationManager.addMessage).toHaveBeenCalledWith(
        recipient,
        expect.objectContaining({
          id: 'msg-sent-123',
          type: MessageType.TEXT,
          direction: 'outbound',
          status: MessageStatus.SENT
        })
      );
      expect(result).toEqual(expectedResponse);
    });

    it('should send template message with parameters', async () => {
      // Arrange
      const recipient = '+9876543210';
      const message: TemplateMessage = {
        type: MessageType.TEMPLATE,
        template: {
          name: 'order_confirmation',
          language: { code: 'en' },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: 'Order #12345' },
              { type: 'text', text: '$50.00' }
            ]
          }]
        }
      };

      const expectedResponse = {
        messaging_product: 'whatsapp',
        contacts: [{ input: recipient, wa_id: recipient.substring(1) }],
        messages: [{ id: 'msg-sent-456' }]
      };

      mockWhatsAppClient.sendMessage.mockResolvedValue(expectedResponse);

      // Act
      const result = await whatsappService.sendMessage(recipient, message);

      // Assert
      expect(mockWhatsAppClient.sendMessage).toHaveBeenCalledWith(recipient, message);
      expect(result).toEqual(expectedResponse);
    });

    it('should send media message with caption', async () => {
      // Arrange
      const recipient = '+9876543210';
      const message: MediaMessage = {
        type: MessageType.IMAGE,
        image: {
          id: 'media-123',
          caption: 'Product image'
        }
      };

      const expectedResponse = {
        messaging_product: 'whatsapp',
        contacts: [{ input: recipient, wa_id: recipient.substring(1) }],
        messages: [{ id: 'msg-sent-789' }]
      };

      mockWhatsAppClient.sendMessage.mockResolvedValue(expectedResponse);

      // Act
      const result = await whatsappService.sendMessage(recipient, message);

      // Assert
      expect(mockWhatsAppClient.sendMessage).toHaveBeenCalledWith(recipient, message);
      expect(result).toEqual(expectedResponse);
    });
  });

  describe('sendInteractiveMessage', () => {
    it('should send button interactive message', async () => {
      // Arrange
      const recipient = '+9876543210';
      const message: InteractiveMessage = {
        type: MessageType.INTERACTIVE,
        interactive: {
          type: 'button',
          body: { text: 'Please select an option:' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'yes', title: 'Yes' } },
              { type: 'reply', reply: { id: 'no', title: 'No' } }
            ]
          }
        }
      };

      const expectedResponse = {
        messaging_product: 'whatsapp',
        contacts: [{ input: recipient, wa_id: recipient.substring(1) }],
        messages: [{ id: 'msg-interactive-123' }]
      };

      mockWhatsAppClient.sendMessage.mockResolvedValue(expectedResponse);

      // Act
      const result = await whatsappService.sendInteractiveMessage(recipient, message.interactive);

      // Assert
      expect(mockWhatsAppClient.sendMessage).toHaveBeenCalledWith(recipient, message);
      expect(result).toEqual(expectedResponse);
    });

    it('should send list interactive message', async () => {
      // Arrange
      const recipient = '+9876543210';
      const interactive = {
        type: 'list' as const,
        header: { type: 'text' as const, text: 'Menu' },
        body: { text: 'Select an item:' },
        action: {
          button: 'View Options',
          sections: [{
            title: 'Products',
            rows: [
              { id: 'prod1', title: 'Product 1', description: 'Description 1' },
              { id: 'prod2', title: 'Product 2', description: 'Description 2' }
            ]
          }]
        }
      };

      const expectedResponse = {
        messaging_product: 'whatsapp',
        contacts: [{ input: recipient, wa_id: recipient.substring(1) }],
        messages: [{ id: 'msg-list-123' }]
      };

      mockWhatsAppClient.sendMessage.mockResolvedValue(expectedResponse);

      // Act
      const result = await whatsappService.sendInteractiveMessage(recipient, interactive);

      // Assert
      expect(mockWhatsAppClient.sendMessage).toHaveBeenCalledWith(recipient, {
        type: MessageType.INTERACTIVE,
        interactive
      });
      expect(result).toEqual(expectedResponse);
    });
  });

  describe('uploadMedia', () => {
    it('should upload media file successfully', async () => {
      // Arrange
      const file = {
        buffer: Buffer.from('test-image'),
        mimetype: 'image/jpeg',
        originalname: 'test.jpg'
      } as Express.Multer.File;

      const expectedMediaId = 'media-upload-123';
      mockMediaService.uploadMedia.mockResolvedValue(expectedMediaId);

      // Act
      const result = await whatsappService.uploadMedia(file);

      // Assert
      expect(mockMediaService.uploadMedia).toHaveBeenCalledWith(file);
      expect(result).toEqual(expectedMediaId);
    });

    it('should handle upload failure', async () => {
      // Arrange
      const file = {
        buffer: Buffer.from('test-image'),
        mimetype: 'image/jpeg',
        originalname: 'test.jpg'
      } as Express.Multer.File;

      mockMediaService.uploadMedia.mockRejectedValue(new Error('Upload failed'));

      // Act & Assert
      await expect(whatsappService.uploadMedia(file))
        .rejects
        .toThrow('Upload failed');
    });
  });

  describe('downloadMedia', () => {
    it('should download media successfully', async () => {
      // Arrange
      const mediaId = 'media-123';
      const expectedMedia = {
        buffer: Buffer.from('media-content'),
        contentType: 'image/jpeg',
        filename: 'image.jpg'
      };

      mockMediaService.downloadMedia.mockResolvedValue(expectedMedia);

      // Act
      const result = await whatsappService.downloadMedia(mediaId);

      // Assert
      expect(mockMediaService.downloadMedia).toHaveBeenCalledWith(mediaId);
      expect(result).toEqual(expectedMedia);
    });
  });

  describe('getConversationState', () => {
    it('should retrieve conversation state', async () => {
      // Arrange
      const phoneNumber = '+9876543210';
      const expectedState: ConversationState = {
        phoneNumber,
        currentStep: 'ORDER_CONFIRMATION',
        context: { orderId: '12345' },
        lastMessageTime: new Date(),
        messages: []
      };

      mockConversationManager.getState.mockResolvedValue(expectedState);

      // Act
      const result = await whatsappService.getConversationState(phoneNumber);

      // Assert
      expect(mockConversationManager.getState).toHaveBeenCalledWith(phoneNumber);
      expect(result).toEqual(expectedState);
    });
  });

  describe('updateConversationState', () => {
    it('should update conversation state', async () => {
      // Arrange
      const phoneNumber = '+9876543210';
      const updates = {
        currentStep: 'PAYMENT_PENDING',
        context: { paymentMethod: 'card' }
      };

      mockConversationManager.updateState.mockResolvedValue();

      // Act
      await whatsappService.updateConversationState(phoneNumber, updates);

      // Assert
      expect(mockConversationManager.updateState).toHaveBeenCalledWith(phoneNumber, updates);
    });
  });

  describe('processMessageQueue', () => {
    it('should start message queue processing', async () => {
      // Arrange
      mockMessageQueue.startProcessing.mockImplementation(() => {});

      // Act
      await whatsappService.processMessageQueue();

      // Assert
      expect(mockMessageQueue.startProcessing).toHaveBeenCalled();
    });
  });

  describe('getTemplates', () => {
    it('should retrieve message templates', async () => {
      // Arrange
      const expectedTemplates = [
        {
          name: 'order_confirmation',
          components: [{ type: 'BODY', text: 'Your order {{1}} has been confirmed' }],
          language: 'en',
          status: 'APPROVED'
        }
      ];

      mockWhatsAppClient.getTemplates.mockResolvedValue(expectedTemplates);

      // Act
      const result = await whatsappService.getTemplates();

      // Assert
      expect(mockWhatsAppClient.getTemplates).toHaveBeenCalled();
      expect(result).toEqual(expectedTemplates);
    });
  });

  describe('createTemplate', () => {
    it('should create new message template', async () => {
      // Arrange
      const template = {
        name: 'new_template',
        components: [{ type: 'BODY' as const, text: 'Hello {{1}}' }],
        language: 'en'
      };

      const expectedResponse = { success: true, id: 'template-123' };
      mockWhatsAppClient.createTemplate.mockResolvedValue(expectedResponse);

      // Act
      const result = await whatsappService.createTemplate(template);

      // Assert
      expect(mockWhatsAppClient.createTemplate).toHaveBeenCalledWith(template);
      expect(result).toEqual(expectedResponse);
    });
  });
});