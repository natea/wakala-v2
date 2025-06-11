# WhatsApp Natural Language Testing Guide

## Current Status

The WhatsApp service is running but needs:
1. **Fresh Access Token**: The current token has expired (as of June 10, 2025)
2. **NLP Implementation**: Natural language processing is not yet implemented

## Setup Requirements

### 1. Refresh WhatsApp Access Token

The current access token has expired. You need to:

1. Go to [Facebook Developer Console](https://developers.facebook.com)
2. Navigate to your WhatsApp Business App
3. Generate a new access token
4. Update the `.env` file with the new token:
   ```
   WHATSAPP_ACCESS_TOKEN=your_new_token_here
   ```
5. Restart the WhatsApp service:
   ```bash
   docker-compose -f docker-compose.dev.yml restart whatsapp-service
   ```

### 2. Current Service Capabilities

The WhatsApp service currently supports:
- ✅ Sending text messages
- ✅ Receiving webhook notifications
- ✅ Message status updates
- ✅ Template messages
- ❌ Natural language understanding (not implemented)
- ❌ Conversation state management (not implemented)

## Testing Natural Language Queries

### Available Test Scripts

1. **Basic Message Test**: `./test-whatsapp.sh`
   - Sends a simple test message

2. **NLP Query Test**: `./test-whatsapp-nlp.sh`
   - Sends various natural language queries
   - Examples: greetings, product inquiries, order placement

3. **Webhook Monitor**: `./monitor-whatsapp-webhook.sh`
   - Monitors incoming messages from users

### How to Test

1. **Start monitoring webhooks** (in one terminal):
   ```bash
   ./monitor-whatsapp-webhook.sh
   ```

2. **Send test messages** (in another terminal):
   ```bash
   ./test-whatsapp-nlp.sh
   ```

3. **Check service logs**:
   ```bash
   docker logs -f wakala-v2-whatsapp-service-1
   ```

### Example Natural Language Queries to Test

```bash
# Product Discovery
"What restaurants are available?"
"Show me pizza places near me"
"I'm looking for Chinese food"

# Menu Browsing
"What's on the menu at Pizza Hut?"
"Show me vegetarian options"
"Do you have gluten-free meals?"

# Order Placement
"I want to order a large pepperoni pizza"
"Add chicken wings to my order"
"That's all, please confirm my order"

# Order Management
"Where is my order?"
"How long until delivery?"
"I need to change my delivery address"

# Support
"Help"
"I have a complaint"
"How do I cancel my order?"

# Location-based
"Deliver to Victoria Island"
"What restaurants deliver to Lekki?"
"Find food near my location"
```

## Implementation Needed

To enable natural language processing, implement:

1. **Intent Recognition**
   - Classify user messages into intents (order, query, support, etc.)
   
2. **Entity Extraction**
   - Extract entities like food items, quantities, locations
   
3. **Conversation Flow**
   - Implement state machine for multi-turn conversations
   
4. **Response Generation**
   - Generate appropriate responses based on intent and context

### Suggested NLP Approach

1. **Use OpenAI/Claude API** for intent classification and entity extraction
2. **Implement conversation state** in Redis
3. **Create response templates** for common scenarios
4. **Add fallback handlers** for unrecognized inputs

## Testing Without NLP

Currently, you can test:
1. **Message delivery**: Verify messages are sent successfully
2. **Webhook reception**: Confirm incoming messages are received
3. **Status updates**: Check message delivery status
4. **Template messages**: Test pre-approved message templates

## Next Steps

1. Refresh the WhatsApp access token
2. Implement basic intent recognition
3. Add conversation state management
4. Create response handlers for common queries
5. Test with real phone numbers