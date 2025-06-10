import { Notification, NotificationType } from '../interfaces/order.interface';

export class NotificationService {
  constructor(private messagingClient: any) {}

  async sendNotification(notification: Notification): Promise<void> {
    throw new Error('Not implemented');
  }

  async sendBulkNotifications(notifications: Notification[]): Promise<void> {
    throw new Error('Not implemented');
  }

  async sendOrderStatusUpdate(
    orderId: string,
    customerId: string,
    status: string,
    details?: any
  ): Promise<void> {
    throw new Error('Not implemented');
  }

  async sendVendorNotification(
    vendorId: string,
    type: NotificationType,
    data: any
  ): Promise<void> {
    throw new Error('Not implemented');
  }
}