export enum DeliveryStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  ARRIVED_AT_PICKUP = 'ARRIVED_AT_PICKUP',
  PICKED_UP = 'PICKED_UP',
  IN_TRANSIT = 'IN_TRANSIT',
  ARRIVED_AT_DROPOFF = 'ARRIVED_AT_DROPOFF',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED'
}

export enum DriverStatus {
  AVAILABLE = 'AVAILABLE',
  BUSY = 'BUSY',
  OFFLINE = 'OFFLINE',
  ON_BREAK = 'ON_BREAK'
}

export interface Location {
  lat: number;
  lng: number;
}

export interface Address {
  address: string;
  coordinates: Location;
  area?: string;
  contactName?: string;
  contactPhone?: string;
  instructions?: string;
}

export interface DeliveryItem {
  name: string;
  quantity: number;
  weight: number;
  length?: number;
  width?: number;
  height?: number;
}

export interface DeliveryRequest {
  orderId: string;
  customerId: string;
  pickup: Address;
  dropoff: Address;
  items: DeliveryItem[];
  scheduledTime: Date;
  priority: 'normal' | 'express';
  paymentMethod?: 'prepaid' | 'cash_on_delivery';
  notes?: string;
}

export interface Delivery extends DeliveryRequest {
  id: string;
  status: DeliveryStatus;
  driverId?: string;
  estimatedDistance: number;
  estimatedDuration: number;
  actualDistance?: number;
  actualDuration?: number;
  fee: number;
  createdAt: Date;
  updatedAt: Date;
  assignedAt?: Date;
  pickedUpAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: DriverStatus;
  currentLocation: Location;
  vehicleType: 'motorcycle' | 'car' | 'van' | 'truck';
  vehicleNumber: string;
  rating: number;
  completedDeliveries: number;
  joinedAt: Date;
  documents?: DriverDocuments;
  preferences?: DriverPreferences;
  activeDeliveries?: number;
  dailyEarnings?: number;
}

export interface DriverDocuments {
  license: {
    number: string;
    expiry: Date;
    verified: boolean;
  };
  insurance: {
    number: string;
    expiry: Date;
    verified: boolean;
  };
  vehicleRegistration?: {
    number: string;
    expiry: Date;
    verified: boolean;
  };
}

export interface DriverPreferences {
  maxDistance: number;
  preferredAreas: string[];
  vehicleCapacity: {
    maxWeight: number;
    maxVolume: number;
  };
}

export interface DeliveryAssignment {
  id: string;
  deliveryId: string;
  driverId: string;
  assignedAt: Date;
  estimatedPickupTime: Date;
  estimatedDeliveryTime: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
}

export interface TrackingUpdate {
  deliveryId: string;
  driverId: string;
  location: Location;
  timestamp: Date;
  speed?: number;
  heading?: number;
  accuracy?: number;
}

export interface Route {
  waypoints: Location[];
  totalDistance: number;
  totalDuration: number;
  polyline: string;
  steps?: RouteStep[];
  trafficConditions?: 'light' | 'moderate' | 'heavy';
}

export interface RouteStep {
  instruction: string;
  distance: number;
  duration: number;
  startLocation: Location;
  endLocation: Location;
}

export interface ProofOfDelivery {
  signature?: string;
  photo?: string;
  recipientName: string;
  notes?: string;
  timestamp: Date;
}

export interface DeliveryFee {
  baseRate: number;
  distanceCharge: number;
  weightCharge: number;
  priorityCharge: number;
  fuelSurcharge: number;
  total: number;
  breakdown: string;
}

export interface DeliveryMetrics {
  totalDeliveries: number;
  completedDeliveries: number;
  cancelledDeliveries: number;
  averageDeliveryTime: number;
  onTimeRate: number;
  customerSatisfaction: number;
  totalRevenue: number;
  averageDeliveryFee: number;
}

export interface DriverPerformance {
  driverId: string;
  completedDeliveries: number;
  cancelledDeliveries: number;
  averageRating: number;
  onTimePercentage: number;
  acceptanceRate: number;
  totalDistance: number;
  totalEarnings: number;
  averageDeliveryTime: number;
}

export interface DeliveryHotspot {
  location: Location;
  area: string;
  deliveryCount: number;
  peakHours: number[];
  averageDeliveryTime: number;
  topMerchants: string[];
}

export interface NotificationMessage {
  title: string;
  body: string;
  type: 'delivery_assignment' | 'status_update' | 'payment' | 'alert';
  data?: Record<string, any>;
}

export interface WebSocketMessage {
  type: 'location_update' | 'status_update' | 'eta_update' | 'driver_assigned';
  deliveryId: string;
  data: any;
  timestamp: Date;
}