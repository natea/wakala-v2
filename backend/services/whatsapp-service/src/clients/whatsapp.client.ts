import axios, { AxiosInstance } from 'axios';
import {
  WhatsAppConfig,
  Message,
  SendMessageResponse,
  UploadMediaResponse,
  MediaUrlResponse,
  TemplateResponse
} from '../interfaces/whatsapp.interface';

export class WhatsAppClient {
  private axios: AxiosInstance;
  private phoneNumberId: string;

  constructor(private config: WhatsAppConfig) {
    this.phoneNumberId = config.phoneNumberId;
    this.axios = axios.create({
      baseURL: `https://graph.facebook.com/${config.apiVersion}`,
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async sendMessage(to: string, message: Message): Promise<SendMessageResponse> {
    throw new Error('Not implemented');
  }

  async getTemplates(): Promise<TemplateResponse[]> {
    throw new Error('Not implemented');
  }

  async createTemplate(template: any): Promise<any> {
    throw new Error('Not implemented');
  }

  async uploadMedia(formData: FormData): Promise<UploadMediaResponse> {
    throw new Error('Not implemented');
  }

  async getMediaUrl(mediaId: string): Promise<MediaUrlResponse> {
    throw new Error('Not implemented');
  }

  async downloadMedia(url: string): Promise<Buffer> {
    throw new Error('Not implemented');
  }
}