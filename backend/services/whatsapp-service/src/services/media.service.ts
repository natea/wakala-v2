import { WhatsAppClient } from '../clients/whatsapp.client';
import { MediaDownload } from '../interfaces/whatsapp.interface';
import FormData from 'form-data';

export class MediaService {
  constructor(private whatsappClient: WhatsAppClient) {}

  async uploadMedia(file: Express.Multer.File): Promise<string> {
    throw new Error('Not implemented');
  }

  async downloadMedia(mediaId: string): Promise<MediaDownload> {
    throw new Error('Not implemented');
  }

  async getMediaUrl(mediaId: string): Promise<string> {
    throw new Error('Not implemented');
  }

  private getMimeType(filename: string): string {
    throw new Error('Not implemented');
  }
}