export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  DOCUMENT = 'document',
  AUDIO = 'audio',
  VIDEO = 'video',
  STICKER = 'sticker',
  LOCATION = 'location',
  CONTACTS = 'contacts',
  INTERACTIVE = 'interactive',
  TEMPLATE = 'template',
  REACTION = 'reaction'
}

export enum MessageStatus {
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  FAILED = 'failed'
}

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  webhookSecret: string;
  apiVersion: string;
  businessAccountId?: string;
}

// Webhook Types
export interface WebhookVerification {
  'hub.mode': string;
  'hub.verify_token': string;
  'hub.challenge': string;
}

export interface WebhookEvent {
  object: string;
  entry: WebhookEntry[];
}

export interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

export interface WebhookChange {
  value: WebhookValue;
  field: string;
}

export interface WebhookValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: Contact[];
  messages?: IncomingMessage[];
  statuses?: StatusUpdate[];
  errors?: ErrorMessage[];
}

export interface Contact {
  profile: {
    name: string;
  };
  wa_id: string;
}

export interface IncomingMessage {
  id: string;
  from: string;
  timestamp: string;
  type: MessageType;
  text?: { body: string };
  image?: MediaObject;
  document?: MediaObject;
  audio?: MediaObject;
  video?: MediaObject;
  sticker?: MediaObject;
  location?: LocationObject;
  contacts?: ContactObject[];
  interactive?: InteractiveReply;
  button?: ButtonReply;
  context?: MessageContext;
}

export interface MediaObject {
  id: string;
  mime_type: string;
  sha256?: string;
  caption?: string;
}

export interface LocationObject {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ContactObject {
  name: {
    formatted_name: string;
    first_name?: string;
    last_name?: string;
    middle_name?: string;
  };
  phones?: Array<{
    phone: string;
    type: string;
  }>;
  emails?: Array<{
    email: string;
    type: string;
  }>;
}

export interface InteractiveReply {
  type: 'list_reply' | 'button_reply';
  list_reply?: {
    id: string;
    title: string;
  };
  button_reply?: {
    id: string;
    title: string;
  };
}

export interface ButtonReply {
  text: string;
  payload: string;
}

export interface MessageContext {
  message_id: string;
  from?: string;
}

export interface StatusUpdate {
  id: string;
  recipient_id: string;
  status: MessageStatus;
  timestamp: string;
  conversation?: {
    id: string;
    expiry_timestamp?: string;
    origin?: {
      type: string;
    };
  };
  pricing?: {
    billable: boolean;
    pricing_model: string;
    category: string;
  };
}

export interface ErrorMessage {
  code: number;
  title: string;
  message?: string;
  error_data?: {
    details: string;
  };
}

// Outgoing Message Types
export interface TextMessage {
  type: MessageType.TEXT;
  text: {
    body: string;
    preview_url?: boolean;
  };
}

export interface MediaMessage {
  type: MessageType.IMAGE | MessageType.DOCUMENT | MessageType.AUDIO | MessageType.VIDEO | MessageType.STICKER;
  image?: MediaContent;
  document?: MediaContent;
  audio?: MediaContent;
  video?: MediaContent;
  sticker?: MediaContent;
}

export interface MediaContent {
  id?: string;
  link?: string;
  caption?: string;
  filename?: string;
}

export interface LocationMessage {
  type: MessageType.LOCATION;
  location: {
    longitude: number;
    latitude: number;
    name?: string;
    address?: string;
  };
}

export interface ContactMessage {
  type: MessageType.CONTACTS;
  contacts: ContactObject[];
}

export interface InteractiveMessage {
  type: MessageType.INTERACTIVE;
  interactive: InteractiveObject;
}

export interface InteractiveObject {
  type: 'list' | 'button' | 'product' | 'product_list';
  header?: {
    type: 'text' | 'video' | 'image' | 'document';
    text?: string;
    video?: MediaContent;
    image?: MediaContent;
    document?: MediaContent;
  };
  body: {
    text: string;
  };
  footer?: {
    text: string;
  };
  action: ButtonAction | ListAction | ProductAction;
}

export interface ButtonAction {
  buttons: Array<{
    type: 'reply';
    reply: {
      id: string;
      title: string;
    };
  }>;
}

export interface ListAction {
  button: string;
  sections: Array<{
    title?: string;
    rows: Array<{
      id: string;
      title: string;
      description?: string;
    }>;
  }>;
}

export interface ProductAction {
  catalog_id: string;
  product_retailer_id?: string;
  sections?: Array<{
    title?: string;
    product_items: Array<{
      product_retailer_id: string;
    }>;
  }>;
}

export interface TemplateMessage {
  type: MessageType.TEMPLATE;
  template: {
    name: string;
    language: {
      code: string;
    };
    components?: TemplateComponent[];
  };
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'quick_reply' | 'url';
  index?: number;
  parameters?: TemplateParameter[];
}

export interface TemplateParameter {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video';
  text?: string;
  currency?: {
    fallback_value: string;
    code: string;
    amount_1000: number;
  };
  date_time?: {
    fallback_value: string;
    day_of_week?: number;
    day_of_month?: number;
    year?: number;
    month?: number;
    hour?: number;
    minute?: number;
  };
  image?: MediaContent;
  document?: MediaContent;
  video?: MediaContent;
}

export interface ReactionMessage {
  type: MessageType.REACTION;
  reaction: {
    message_id: string;
    emoji: string;
  };
}

export type Message = 
  | TextMessage 
  | MediaMessage 
  | LocationMessage 
  | ContactMessage 
  | InteractiveMessage 
  | TemplateMessage 
  | ReactionMessage;

// API Response Types
export interface SendMessageResponse {
  messaging_product: string;
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
  }>;
}

export interface UploadMediaResponse {
  id: string;
}

export interface MediaUrlResponse {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
  messaging_product: string;
}

export interface TemplateResponse {
  name: string;
  components: Array<{
    type: string;
    format?: string;
    text?: string;
    example?: {
      header_text?: string[];
      body_text?: string[][];
      header_handle?: string[];
    };
  }>;
  language: string;
  status: string;
  category: string;
  id: string;
}

// Conversation State
export interface ConversationState {
  phoneNumber: string;
  currentStep: string;
  context: Record<string, any>;
  lastMessageTime: Date;
  messages: ConversationMessage[];
}

export interface ConversationMessage {
  id: string;
  type: MessageType;
  content: any;
  direction: 'inbound' | 'outbound';
  timestamp: Date;
  status?: MessageStatus;
}

// Media Types
export interface MediaDownload {
  buffer: Buffer;
  contentType: string;
  filename?: string;
}