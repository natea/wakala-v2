# WhatsApp Business API Integration Guide for Wakala OS

## Executive Summary

This document provides comprehensive guidance for implementing WhatsApp Business API within the Wakala OS multi-tenant architecture. Based on extensive research of 2025 best practices, this guide covers technical implementation patterns, security considerations, and scalability strategies specifically tailored for a conversational commerce platform.

## 1. WhatsApp Business API Best Practices

### 1.1 Cloud API vs On-Premise API

**Recommendation: Use WhatsApp Cloud API**

The On-Premise API is being deprecated with final shutdown scheduled for October 2025. The Cloud API offers several advantages:

- **Automatic scaling**: Up to 1,000 messages/second without manual intervention
- **Zero hosting costs**: Pure consumption-based pricing at $0.005-$0.09 per message
- **Global latency**: Under 5 seconds worldwide through Meta's edge network
- **Native integrations**: Built-in CRM connectors and vertical-specific templates

### 1.2 Webhook Handling and Message Flow

**Implementation Requirements:**

```python
# Example webhook handler with HMAC verification
import hmac
import hashlib
from fastapi import Request, HTTPException

async def verify_webhook(request: Request, secret_key: str):
    signature = request.headers.get("X-Signature-SHA256")
    body = await request.body()
    
    computed_sha = hmac.new(
        secret_key.encode(), 
        body, 
        hashlib.sha256
    ).hexdigest()
    
    if not hmac.compare_digest(signature, computed_sha):
        raise HTTPException(status_code=403, detail="Invalid signature")
    
    return body
```

**Key Patterns:**
- Implement HMAC-SHA256 verification for all incoming webhooks
- Use Redis-based deduplication with 24-hour TTL for idempotent processing
- Decouple event ingestion from business logic using async worker pools
- Maintain 3-second response SLA to prevent webhook delivery failures

### 1.3 Session Management and 24-hour Window

**Conversation Categories and Pricing (2025):**
- **Service**: User-initiated, no template required (lowest cost)
- **Marketing**: Template-based promotions ($0.09/message)
- **Utility**: Transactional notifications ($0.005/message)
- **Authentication**: OTP/Security flows ($0.03/message)

**Critical Update**: As of July 2025, mixed-category templates auto-reclassify to the highest-priced tier.

**Session Management Strategy:**
```json
{
  "session_id": "uuid",
  "tenant_id": "wakala_tenant_123",
  "user_phone": "+254712345678",
  "category": "service",
  "expires_at": "2025-06-10T20:00:00Z",
  "message_count": 4,
  "last_intent": "product_inquiry",
  "cart_id": "cart_456"
}
```

### 1.4 Template Message Requirements

**Template Categories and Compliance:**

| Category | Allowed Content | Prohibited Elements |
|----------|----------------|-------------------|
| Marketing | Promotional offers, product launches | OTP buttons, security text |
| Utility | Order confirmations, shipping updates | Emojis, promotional URLs |
| Authentication | 2FA codes, account recovery | Media attachments, footers |

**Approval Process:**
1. Automated syntax validation against WAML schema
2. NLP analysis for category compliance (98.7% accuracy)
3. Manual review with 48-hour SLA for high-risk industries

### 1.5 Interactive Message Types

**Available Components:**
- **List Pickers**: 10-section hierarchical menus for product categories
- **Product Carousels**: Rich media catalogs with in-chat checkout
- **Dynamic Forms**: Multi-step data collection for order customization
- **Quick Reply Buttons**: Up to 3 buttons for common actions

```javascript
// Example interactive list for Wakala OS
{
  "type": "interactive",
  "interactive": {
    "type": "list",
    "header": {
      "type": "text",
      "text": "Browse Products"
    },
    "body": {
      "text": "Select a category to view available items:"
    },
    "sections": [
      {
        "title": "Electronics",
        "rows": [
          {"id": "phones", "title": "Mobile Phones"},
          {"id": "laptops", "title": "Laptops & Computers"}
        ]
      },
      {
        "title": "Fashion",
        "rows": [
          {"id": "mens", "title": "Men's Clothing"},
          {"id": "womens", "title": "Women's Clothing"}
        ]
      }
    ]
  }
}
```

## 2. Multi-tenant WhatsApp Integration Patterns

### 2.1 Architecture Overview

**Recommended Pattern: Sharded Multi-tenant Architecture**

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Tenant A      │     │   Tenant B      │     │   Tenant C      │
│   Businesses    │     │   Businesses    │     │   Businesses    │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────┬───────┴───────────────────────┘
                         │
                  ┌──────▼──────┐
                  │   Wakala    │
                  │  Router     │
                  └──────┬──────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
    ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
    │ Shard 1 │    │ Shard 2 │    │ Shard 3 │
    │ (1-250  │    │ (251-500│    │ (501-750│
    │ msg/s)  │    │ msg/s)  │    │ msg/s)  │
    └─────────┘    └─────────┘    └─────────┘
```

### 2.2 Tenant Isolation Strategy

```typescript
// Tenant routing implementation
export class TenantRouter {
  private readonly shardCount = 32;
  
  getShardId(tenantId: string): string {
    const hash = crypto
      .createHash('md5')
      .update(tenantId)
      .digest();
    
    const shardIndex = hash.readUInt16BE(0) % this.shardCount;
    return `wakala-shard-${shardIndex}`;
  }
  
  async routeMessage(tenantId: string, message: WhatsAppMessage) {
    const shardId = this.getShardId(tenantId);
    const shardQueue = await this.getShardQueue(shardId);
    
    await shardQueue.publish({
      tenantId,
      message,
      timestamp: Date.now(),
      ttl: 86400 // 24 hours
    });
  }
}
```

### 2.3 Webhook Isolation

**Per-Tenant Webhook Configuration:**
```yaml
# Kubernetes ConfigMap for tenant webhooks
apiVersion: v1
kind: ConfigMap
metadata:
  name: wakala-webhook-config
data:
  tenant-routes.json: |
    {
      "tenant_123": {
        "webhook_url": "https://api.wakala.com/v1/webhooks/tenant_123",
        "hmac_secret": "${TENANT_123_SECRET}",
        "event_filters": ["messages", "status", "errors"]
      },
      "tenant_456": {
        "webhook_url": "https://api.wakala.com/v1/webhooks/tenant_456",
        "hmac_secret": "${TENANT_456_SECRET}",
        "event_filters": ["messages", "status"]
      }
    }
```

### 2.4 Rate Limiting and Quota Management

**Tenant-Level Rate Limiting:**
```python
# Redis-based rate limiter
class TenantRateLimiter:
    def __init__(self, redis_client):
        self.redis = redis_client
        
    async def check_limit(self, tenant_id: str, limit_type: str):
        key = f"rate_limit:{tenant_id}:{limit_type}"
        
        # Sliding window rate limiting
        now = time.time()
        window_start = now - 3600  # 1 hour window
        
        # Remove old entries
        await self.redis.zremrangebyscore(key, 0, window_start)
        
        # Count messages in window
        count = await self.redis.zcard(key)
        
        limits = {
            "messages_per_hour": 1000,
            "templates_per_day": 100,
            "broadcasts_per_week": 10
        }
        
        if count >= limits.get(limit_type, float('inf')):
            return False, count
            
        # Add current request
        await self.redis.zadd(key, {str(uuid.uuid4()): now})
        await self.redis.expire(key, 3600)
        
        return True, count + 1
```

## 3. Conversational Commerce Patterns

### 3.1 Product Catalog Integration

**Catalog Sync Architecture:**
```python
class CatalogSyncService:
    async def sync_catalog(self, tenant_id: str, catalog_data: dict):
        # Map Wakala product schema to WhatsApp catalog format
        whatsapp_catalog = {
            "name": catalog_data["store_name"],
            "products": []
        }
        
        for product in catalog_data["products"]:
            whatsapp_product = {
                "retailer_id": f"{tenant_id}_{product['id']}",
                "name": product["name"],
                "description": product["description"][:500],  # WhatsApp limit
                "price": int(product["price"] * 100),  # In cents
                "currency": product["currency"],
                "availability": "in stock" if product["stock"] > 0 else "out of stock",
                "image_url": product["images"][0] if product["images"] else None
            }
            whatsapp_catalog["products"].append(whatsapp_product)
        
        # Upload to WhatsApp
        await self.whatsapp_api.update_catalog(tenant_id, whatsapp_catalog)
```

### 3.2 Shopping Cart Management

**Persistent Cart Implementation:**
```typescript
interface WhatsAppCart {
  cartId: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  items: CartItem[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

class CartManager {
  async addToCart(
    tenantId: string, 
    userId: string, 
    productId: string, 
    quantity: number
  ): Promise<WhatsAppCart> {
    const cart = await this.getOrCreateCart(tenantId, userId);
    
    // Check product availability
    const product = await this.productService.getProduct(tenantId, productId);
    if (product.stock < quantity) {
      throw new Error('Insufficient stock');
    }
    
    // Add or update item
    const existingItem = cart.items.find(i => i.productId === productId);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cart.items.push({
        productId,
        quantity,
        price: product.price,
        name: product.name
      });
    }
    
    // Update cart expiry (24 hours from last activity)
    cart.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    await this.saveCart(cart);
    return cart;
  }
}
```

### 3.3 Payment Integration

**Payment Link Generation:**
```python
class PaymentService:
    async def generate_payment_link(
        self, 
        tenant_id: str, 
        order_id: str, 
        amount: float
    ):
        # Get tenant payment configuration
        tenant_config = await self.get_tenant_payment_config(tenant_id)
        
        # Generate secure payment reference
        payment_ref = f"{tenant_id}_{order_id}_{uuid.uuid4().hex[:8]}"
        
        # Create payment request based on provider
        if tenant_config.provider == "stripe":
            payment_data = {
                "amount": int(amount * 100),
                "currency": tenant_config.currency,
                "metadata": {
                    "tenant_id": tenant_id,
                    "order_id": order_id,
                    "channel": "whatsapp"
                }
            }
            link = await self.stripe_service.create_payment_link(payment_data)
        
        # Store payment tracking info
        await self.store_payment_tracking({
            "reference": payment_ref,
            "tenant_id": tenant_id,
            "order_id": order_id,
            "amount": amount,
            "link": link,
            "status": "pending",
            "created_at": datetime.utcnow()
        })
        
        return link
```

### 3.4 Order Status Updates

**Automated Order Notification System:**
```yaml
# Order status template configurations
order_templates:
  order_confirmed:
    name: "order_confirmation_{{locale}}"
    category: "UTILITY"
    components:
      - type: "HEADER"
        format: "TEXT"
        text: "Order Confirmed! 🎉"
      - type: "BODY"
        text: |
          Hi {{customer_name}},
          Your order #{{order_id}} has been confirmed.
          
          Items: {{item_count}}
          Total: {{currency}} {{total_amount}}
          
          Estimated delivery: {{delivery_date}}
      - type: "FOOTER"
        text: "Thank you for shopping with {{business_name}}"
      - type: "BUTTONS"
        buttons:
          - type: "URL"
            text: "Track Order"
            url: "{{tracking_url}}"
```

## 4. Technical Requirements and Implementation

### 4.1 Authentication and Security

**Multi-layered Security Approach:**

1. **API Key Management**
```python
class WhatsAppAPIKeyManager:
    def __init__(self, vault_client):
        self.vault = vault_client
        
    async def get_api_credentials(self, tenant_id: str):
        # Retrieve from secure vault
        path = f"whatsapp/tenants/{tenant_id}/credentials"
        credentials = await self.vault.read(path)
        
        return {
            "phone_number_id": credentials["phone_number_id"],
            "access_token": await self.decrypt_token(credentials["encrypted_token"]),
            "business_id": credentials["business_id"]
        }
    
    async def rotate_token(self, tenant_id: str):
        # Implement token rotation logic
        new_token = await self.generate_new_token(tenant_id)
        await self.vault.write(
            f"whatsapp/tenants/{tenant_id}/credentials",
            {"encrypted_token": await self.encrypt_token(new_token)}
        )
```

2. **End-to-End Encryption**
- All messages are E2E encrypted by WhatsApp
- Payment data never stored in plain text
- Use AES-256 for tenant-specific data at rest

### 4.2 Scalability Architecture

**Microservices Design:**
```yaml
# Kubernetes deployment for WhatsApp services
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wakala-whatsapp-service
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: whatsapp-api
        image: wakala/whatsapp-service:latest
        env:
        - name: SHARD_COUNT
          value: "32"
        - name: REDIS_CLUSTER
          value: "redis-cluster.wakala.svc.cluster.local"
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
```

### 4.3 Cost Optimization Strategies

**1. Conversation Type Optimization**
```python
class ConversationOptimizer:
    def determine_optimal_category(self, message_intent: str) -> str:
        # Route to lowest-cost category when possible
        if message_intent in ["order_status", "shipping_update"]:
            return "UTILITY"  # $0.005/msg
        elif message_intent in ["otp", "password_reset"]:
            return "AUTHENTICATION"  # $0.03/msg
        elif message_intent in ["promotion", "sale"]:
            return "MARKETING"  # $0.09/msg
        else:
            return "SERVICE"  # User-initiated, lowest cost
```

**2. Template Reuse Strategy**
- Create generic templates with variables
- Maintain template version control
- Monitor template performance metrics

**3. Message Batching**
```python
async def batch_send_messages(tenant_id: str, messages: List[Message]):
    # Group messages by template type
    grouped = defaultdict(list)
    for msg in messages:
        grouped[msg.template_id].append(msg)
    
    # Send in batches to optimize API calls
    for template_id, batch in grouped.items():
        if len(batch) > 100:  # WhatsApp batch limit
            for chunk in chunks(batch, 100):
                await send_batch(tenant_id, template_id, chunk)
        else:
            await send_batch(tenant_id, template_id, batch)
```

## 5. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-4)
- Set up WhatsApp Cloud API accounts
- Implement basic webhook handlers
- Create tenant isolation framework
- Deploy message routing infrastructure

### Phase 2: Core Features (Weeks 5-8)
- Integrate product catalog sync
- Implement shopping cart persistence
- Add payment link generation
- Create order tracking system

### Phase 3: Advanced Features (Weeks 9-12)
- Add interactive message components
- Implement conversation analytics
- Deploy rate limiting system
- Optimize cost tracking

### Phase 4: Scale & Optimize (Weeks 13-16)
- Performance testing with 1M+ messages/day
- Implement advanced sharding
- Add failover mechanisms
- Deploy monitoring and alerting

## 6. Monitoring and Analytics

**Key Metrics to Track:**
```sql
-- Daily conversation metrics per tenant
SELECT 
    tenant_id,
    DATE(created_at) as date,
    conversation_category,
    COUNT(*) as conversation_count,
    SUM(message_count) as total_messages,
    AVG(session_duration_seconds) as avg_duration,
    SUM(cost_usd) as total_cost
FROM whatsapp_conversations
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY tenant_id, DATE(created_at), conversation_category
ORDER BY date DESC, tenant_id;
```

**Alerting Thresholds:**
- Message delivery rate < 95%
- Webhook response time > 2 seconds
- Template rejection rate > 10%
- Cost per conversation > threshold

## 7. Compliance and Best Practices

### Data Privacy
- Implement GDPR-compliant data retention (90 days)
- Provide data export capabilities per tenant
- Enable message deletion on user request

### Business Verification
- Maintain up-to-date business verification
- Monitor for policy violations
- Implement spam prevention measures

### Template Guidelines
- Follow Meta's template categorization rules
- Avoid mixing promotional and transactional content
- Test templates in sandbox before production

## Conclusion

Implementing WhatsApp Business API within Wakala OS requires careful consideration of multi-tenant architecture, security, scalability, and cost optimization. By following the patterns and recommendations in this guide, Wakala can build a robust conversational commerce platform that scales efficiently while maintaining tenant isolation and security.

The key success factors are:
1. Using WhatsApp Cloud API for future-proof implementation
2. Implementing proper sharding for multi-tenant scalability
3. Optimizing conversation types for cost management
4. Building robust webhook handling with security measures
5. Creating seamless shopping experiences with catalog integration
6. Monitoring performance and costs continuously

With these foundations in place, Wakala OS can deliver exceptional conversational commerce experiences while maintaining operational efficiency and security.