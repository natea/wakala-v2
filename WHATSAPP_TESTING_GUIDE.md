# WhatsApp Testing Guide

## Overview

This guide explains how to properly test the WhatsApp integration, including natural language processing capabilities.

## WhatsApp Business API Limitations

1. **24-Hour Window Rule**: You can only send regular messages to users within 24 hours of their last message to you
2. **Template Messages**: Can be sent anytime but must be pre-approved by WhatsApp
3. **Session Messages**: Free-form messages sent within the 24-hour window

## Testing Workflow

### Step 1: Verify Configuration
```bash
./verify-whatsapp-config.sh
```

### Step 2: Send a Template Message (Works Anytime)
```bash
./test-whatsapp-template.sh
```

This will send the pre-approved "hello_world" template to your number.

### Step 3: Initiate Conversation from WhatsApp
1. Open WhatsApp on your phone
2. Send any message to your business number
3. This opens a 24-hour window for the bot to respond

### Step 4: Monitor Incoming Messages
```bash
# Watch for incoming webhooks
docker logs -f wakala-v2-whatsapp-service-1
```

### Step 5: Test Natural Language Queries
```bash
./test-whatsapp-nlp.sh
```

This will send various test queries to demonstrate NLP capabilities.

## Current Implementation Status

### ✅ Implemented
- WhatsApp Business API integration
- Webhook endpoints for receiving messages
- Message sending capabilities
- Template message support
- Conversation state management (basic structure)

### ⏳ Not Yet Implemented
- Natural Language Processing (NLP) engine
- Intent recognition
- Entity extraction
- Conversation flow logic
- Integration with order/delivery services

## Webhook URL Configuration

For production, you'll need to:

1. Configure your webhook URL in the WhatsApp Business Manager
2. Use a public URL (e.g., using ngrok for testing)
3. Example webhook URL: `https://your-domain.com/webhook`

### Testing with ngrok
```bash
# Install ngrok
brew install ngrok

# Expose local webhook
ngrok http 3002

# Use the HTTPS URL provided by ngrok in WhatsApp Business Manager
```

## Debugging Tips

1. **Check Service Logs**
   ```bash
   docker logs -f wakala-v2-whatsapp-service-1
   ```

2. **Verify Token Validity**
   ```bash
   curl -X GET "https://graph.facebook.com/v18.0/me?access_token=${WHATSAPP_ACCESS_TOKEN}"
   ```

3. **Test Webhook Manually**
   ```bash
   curl -X POST http://localhost:3002/webhook \
     -H "Content-Type: application/json" \
     -d '{
       "object": "whatsapp_business_account",
       "entry": [{
         "changes": [{
           "field": "messages",
           "value": {
             "messages": [{
               "from": "1234567890",
               "type": "text",
               "text": {"body": "Hello bot!"}
             }]
           }
         }]
       }]
     }'
   ```

## Next Steps for NLP Implementation

1. **Choose NLP Provider**
   - Option 1: OpenAI GPT for natural language understanding
   - Option 2: Google Dialogflow
   - Option 3: Custom NLP with libraries like compromise or natural

2. **Implement Intent Recognition**
   - Order placement
   - Order status inquiry
   - Restaurant search
   - Menu browsing
   - Help requests

3. **Add Entity Extraction**
   - Food items
   - Restaurant names
   - Locations
   - Order IDs

4. **Create Conversation Flows**
   - Welcome flow
   - Order flow
   - Support flow
   - Feedback flow

## Sample Conversation Flow

```
User: "Hi"
Bot: "Welcome to Wakala! 🍔 How can I help you today?"
     [Quick Reply: Order Food | Track Order | Browse Restaurants]

User: "Order Food"
Bot: "Great! What's your delivery location?"

User: "Lekki Phase 1"
Bot: "Found 15 restaurants delivering to Lekki Phase 1. What type of food are you craving?"
     [Quick Reply: Pizza | Burgers | Chinese | Nigerian | See All]

User: "Pizza"
Bot: "Here are the top pizza places:"
     1. Domino's Pizza (4.5⭐ - 30-40 min)
     2. Pizza Hut (4.3⭐ - 35-45 min)
     3. Debonairs Pizza (4.2⭐ - 25-35 min)
     
     [Quick Reply: View Menu | More Options]
```

## Error Handling

Common errors and solutions:

1. **"Session has expired"**
   - User hasn't messaged in 24 hours
   - Solution: Send a template message or wait for user to message first

2. **"Token has expired"**
   - Access token is invalid
   - Solution: Generate new permanent token (see WHATSAPP_PERMANENT_TOKEN_SETUP.md)

3. **"Phone number not verified"**
   - Number not registered with WhatsApp Business
   - Solution: Verify number in WhatsApp Business Manager