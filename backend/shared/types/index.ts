// Common types and interfaces used across services

export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  status: 'active' | 'suspended' | 'deleted';
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  tenantId: string;
  phoneNumber: string;
  name?: string;
  role: 'customer' | 'vendor' | 'admin';
  status: 'active' | 'inactive' | 'banned';
  createdAt: Date;
  updatedAt: Date;
}

export interface Product {
  id: string;
  tenantId: string;
  vendorId: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  quantity: number;
  category: string;
  images: string[];
  status: 'available' | 'out_of_stock' | 'discontinued';
  createdAt: Date;
  updatedAt: Date;
}

export interface Order {
  id: string;
  tenantId: string;
  customerId: string;
  vendorId: string;
  items: OrderItem[];
  totalAmount: number;
  currency: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  deliveryStatus: DeliveryStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export type OrderStatus = 
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'ready'
  | 'completed'
  | 'cancelled';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'refunded';

export type DeliveryStatus =
  | 'pending'
  | 'assigned'
  | 'picked_up'
  | 'in_transit'
  | 'delivered'
  | 'failed';

export interface WhatsAppMessage {
  from: string;
  to: string;
  type: 'text' | 'image' | 'document' | 'location' | 'interactive';
  content: any;
  timestamp: Date;
}