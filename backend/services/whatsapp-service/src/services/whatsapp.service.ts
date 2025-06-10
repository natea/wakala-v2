import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { WhatsAppClient } from '../clients/whatsapp.client';
import { MessageQueueService } from './message-queue.service';
import { ConversationStateManager } from './conversation-state.manager';
import { MediaService } from './media.service';
import {
  WhatsAppConfig,
  WebhookEvent,
  Message,
  SendMessageResponse,
  InteractiveObject,
  MessageType,
  InteractiveMessage,
  ConversationState,
  TemplateResponse,
  IncomingMessage,
  MessageStatus,
  ConversationMessage,
  MediaDownload
} from '../interfaces/whatsapp.interface';

export class WhatsAppService {
  constructor(
    private whatsappClient: WhatsAppClient,
    private messageQueue: MessageQueueService,
    private conversationManager: ConversationStateManager,
    private mediaService: MediaService,
    private config: WhatsAppConfig
  ) {}

  /**
   * Verify webhook endpoint for WhatsApp
   */
  async verifyWebhook(req: Request, res: Response): Promise<void> {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode !== 'subscribe') {
      res.status(403).send('Invalid mode');
      return;
    }

    if (token !== this.config.verifyToken) {
      res.status(403).send('Verification failed');
      return;
    }

    res.status(200).send(challenge);
  }

  /**
   * Handle incoming webhook events from WhatsApp
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    const signature = req.headers['x-hub-signature-256'] as string;
    
    if (!this.verifySignature(req.body, signature)) {
      res.status(401).send('Unauthorized');
      return;
    }

    const event: WebhookEvent = req.body;

    try {
      if (event.object === 'whatsapp_business_account') {
        for (const entry of event.entry) {
          for (const change of entry.changes) {
            if (change.field === 'messages') {
              await this.processMessagesWebhook(change.value);
            }
          }
        }
      }

      res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      console.error('Error processing webhook:', error);
      res.status(500).send('Processing error');
    }
  }

  /**
   * Send a message to a WhatsApp user
   */
  async sendMessage(to: string, message: Message): Promise<SendMessageResponse> {
    const response = await this.whatsappClient.sendMessage(to, message);

    // Track outbound message in conversation state
    if (response.messages && response.messages.length > 0) {
      const conversationMessage: ConversationMessage = {
        id: response.messages[0].id,
        type: message.type,
        content: message,
        direction: 'outbound',
        timestamp: new Date(),
        status: MessageStatus.SENT
      };

      await this.conversationManager.addMessage(to, conversationMessage);
    }

    return response;
  }

  /**
   * Send an interactive message
   */
  async sendInteractiveMessage(
    to: string,
    interactive: InteractiveObject
  ): Promise<SendMessageResponse> {
    const message: InteractiveMessage = {
      type: MessageType.INTERACTIVE,
      interactive
    };

    return this.sendMessage(to, message);
  }

  /**
   * Upload media file to WhatsApp
   */
  async uploadMedia(file: Express.Multer.File): Promise<string> {
    return await this.mediaService.uploadMedia(file);
  }

  /**
   * Download media from WhatsApp
   */
  async downloadMedia(mediaId: string): Promise<MediaDownload> {
    return await this.mediaService.downloadMedia(mediaId);
  }

  /**
   * Get conversation state for a phone number
   */
  async getConversationState(phoneNumber: string): Promise<ConversationState | null> {
    return await this.conversationManager.getState(phoneNumber);
  }

  /**
   * Update conversation state
   */
  async updateConversationState(
    phoneNumber: string,
    updates: Partial<ConversationState>
  ): Promise<void> {
    await this.conversationManager.updateState(phoneNumber, updates);
  }

  /**
   * Start processing message queue
   */
  async processMessageQueue(): Promise<void> {
    this.messageQueue.startProcessing(async (job) => {
      const message = job.data;
      // Process message logic would go here
      console.log('Processing message:', message);
    });
  }

  /**
   * Get available message templates
   */
  async getTemplates(): Promise<TemplateResponse[]> {
    return await this.whatsappClient.getTemplates();
  }

  /**
   * Create a new message template
   */
  async createTemplate(template: any): Promise<any> {
    return await this.whatsappClient.createTemplate(template);
  }

  /**
   * Process incoming messages from webhook
   */
  private async processMessagesWebhook(value: any): Promise<void> {
    // Handle incoming messages
    if (value.messages) {
      for (const message of value.messages) {
        await this.messageQueue.addMessage(message);
      }
    }

    // Handle status updates
    if (value.statuses) {
      for (const status of value.statuses) {
        await this.conversationManager.updateMessageStatus(status.id, status.status);
      }
    }
  }

  /**
   * Verify webhook signature
   */
  private verifySignature(payload: any, signature: string): boolean {
    if (!signature || !this.config.webhookSecret) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return `sha256=${expectedSignature}` === signature;
  }
}