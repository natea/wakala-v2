export enum EventType {
  // User Events
  USER_SIGNUP = 'USER_SIGNUP',
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  PROFILE_UPDATE = 'PROFILE_UPDATE',
  
  // Order Events
  ORDER_CREATED = 'ORDER_CREATED',
  ORDER_UPDATED = 'ORDER_UPDATED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  ORDER_COMPLETED = 'ORDER_COMPLETED',
  
  // Payment Events
  PAYMENT_INITIATED = 'PAYMENT_INITIATED',
  PAYMENT_SUCCESS = 'PAYMENT_SUCCESS',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PAYMENT_REFUNDED = 'PAYMENT_REFUNDED',
  
  // Delivery Events
  DELIVERY_ASSIGNED = 'DELIVERY_ASSIGNED',
  DELIVERY_STARTED = 'DELIVERY_STARTED',
  DELIVERY_COMPLETED = 'DELIVERY_COMPLETED',
  DELIVERY_FAILED = 'DELIVERY_FAILED',
  
  // Product Events
  PRODUCT_VIEWED = 'PRODUCT_VIEWED',
  PRODUCT_ADDED_TO_CART = 'PRODUCT_ADDED_TO_CART',
  PRODUCT_REMOVED_FROM_CART = 'PRODUCT_REMOVED_FROM_CART',
  
  // System Events
  PAGE_VIEW = 'PAGE_VIEW',
  API_CALL = 'API_CALL',
  ERROR_OCCURRED = 'ERROR_OCCURRED',
  PERFORMANCE_METRIC = 'PERFORMANCE_METRIC'
}

export enum AggregationPeriod {
  MINUTE = 'MINUTE',
  HOURLY = 'HOURLY',
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY'
}

export interface AnalyticsEvent {
  id: string;
  type: EventType;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  timestamp: Date;
  properties: Record<string, any>;
  context?: EventContext;
}

export interface EventContext {
  ip?: string;
  userAgent?: string;
  platform?: string;
  device?: string;
  location?: {
    country?: string;
    city?: string;
    region?: string;
  };
  referrer?: string;
}

export interface Metric {
  name: string;
  value: number;
  unit?: string;
  period?: AggregationPeriod;
  dimensions?: Record<string, string>;
  metadata?: Record<string, any>;
}

export interface TimeSeriesData {
  timestamp: Date;
  value: number;
  dimensions?: Record<string, string>;
}

export interface AggregatedMetrics {
  period: AggregationPeriod;
  startDate: Date;
  endDate: Date;
  totalCount: number;
  uniqueUsers?: number;
  totalRevenue?: number;
  averageOrderValue?: number;
  timeSeries: TimeSeriesData[];
  breakdown?: Record<string, any>;
}

export interface Report {
  id: string;
  name: string;
  type: string;
  tenantId?: string;
  createdAt: Date;
  period: {
    start: Date;
    end: Date;
  };
  data: any;
  metadata?: {
    generatedBy?: string;
    version?: string;
    parameters?: Record<string, any>;
  };
}

export interface ReportTemplate {
  name: string;
  description?: string;
  metrics: string[];
  dimensions?: string[];
  filters?: Record<string, any>;
  visualization?: {
    type: 'table' | 'chart' | 'dashboard';
    config: any;
  };
}

export interface DashboardWidget {
  id: string;
  type: 'metric' | 'chart' | 'table' | 'map';
  title: string;
  metric?: string;
  dimensions?: string[];
  filters?: Record<string, any>;
  refreshInterval?: number;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface Dashboard {
  id: string;
  name: string;
  tenantId?: string;
  widgets: DashboardWidget[];
  layout: 'grid' | 'freeform';
  refreshInterval?: number;
  filters?: Record<string, any>;
}

export interface Anomaly {
  id: string;
  metric: string;
  timestamp: Date;
  expected: number;
  actual: number;
  deviation: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, any>;
  resolved?: boolean;
}

export interface Insight {
  id: string;
  type: string;
  title: string;
  description: string;
  impact?: 'low' | 'medium' | 'high';
  confidence: number;
  recommendations?: string[];
  data?: any;
  createdAt: Date;
}

export interface ExportConfig {
  destination: 'bigquery' | 's3' | 'postgres' | 'elasticsearch';
  schedule: 'realtime' | 'hourly' | 'daily' | 'weekly';
  format?: 'json' | 'csv' | 'parquet';
  compression?: boolean;
  filters?: Record<string, any>;
  credentials?: Record<string, any>;
}

export interface WebhookConfig {
  url: string;
  events: string[];
  secret?: string;
  headers?: Record<string, string>;
  retryPolicy?: {
    maxRetries: number;
    backoffMultiplier: number;
  };
}

export interface CohortDefinition {
  name: string;
  criteria: Array<{
    event: string;
    property?: string;
    operator: '=' | '!=' | '>' | '<' | 'in' | 'not_in';
    value: any;
  }>;
  timeWindow?: string;
}

export interface FunnelStep {
  event: string;
  property?: string;
  value?: any;
}

export interface FunnelAnalysis {
  steps: FunnelStep[];
  conversionRates: number[];
  dropoffRates: number[];
  averageTime: number[];
  totalConversions: number;
  breakdown?: Record<string, any>;
}

export interface UserSegment {
  id: string;
  name: string;
  criteria: Array<{
    property: string;
    operator: string;
    value: any;
  }>;
  userCount: number;
  characteristics: Record<string, any>;
  createdAt: Date;
}

export interface ForecastResult {
  metric: string;
  method: string;
  predictions: Array<{
    timestamp: Date;
    value: number;
  }>;
  confidence: number;
  upperBound: number[];
  lowerBound: number[];
  accuracy?: {
    mae: number;
    rmse: number;
    mape: number;
  };
}