import express from 'express';
import { createServer } from 'http';
import { NLPService } from './services/nlp.service';

const app = express();
const port = process.env['PORT'] || 3002;
const nlpService = new NLPService();

// Parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-service' });
});

// WhatsApp webhook verification endpoint
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('Webhook verification request:', { mode, token, challenge });

  // Check if mode and token are correct
  if (mode && token) {
    if (mode === 'subscribe' && token === process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN']) {
      console.log('Webhook verified successfully');
      res.status(200).send(challenge);
    } else {
      console.log('Webhook verification failed');
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// WhatsApp webhook endpoint for receiving messages
app.post('/webhook', (req, res) => {
  console.log('Received webhook:', JSON.stringify(req.body, null, 2));

  // WhatsApp expects a 200 OK response quickly
  res.sendStatus(200);

  // Process the webhook payload
  if (req.body.object === 'whatsapp_business_account') {
    req.body.entry?.forEach((entry: any) => {
      entry.changes?.forEach((change: any) => {
        if (change.field === 'messages') {
          const value = change.value;
          
          // Handle incoming messages
          if (value.messages) {
            value.messages.forEach(async (message: any) => {
              console.log('Received message:', {
                from: message.from,
                type: message.type,
                text: message.text?.body
              });

              // Process with NLP
              try {
                const nlpResponse = await nlpService.processMessage(message);
                console.log('NLP Response:', nlpResponse);

                // Send automated response
                const responsePayload: any = {
                  messaging_product: 'whatsapp',
                  to: message.from,
                  type: 'text',
                  text: { body: nlpResponse.suggestedResponse }
                };

                // Add quick replies if available
                if (nlpResponse.quickReplies && nlpResponse.quickReplies.length > 0) {
                  responsePayload.type = 'interactive';
                  responsePayload.interactive = {
                    type: 'button',
                    body: {
                      text: nlpResponse.suggestedResponse
                    },
                    action: {
                      buttons: nlpResponse.quickReplies.slice(0, 3).map((reply, index) => ({
                        type: 'reply',
                        reply: {
                          id: `quick_reply_${index}`,
                          title: reply
                        }
                      }))
                    }
                  };
                  delete responsePayload.text;
                }

                const response = await fetch(
                  `${process.env['WHATSAPP_API_URL']}/${process.env['WHATSAPP_PHONE_NUMBER_ID']}/messages`,
                  {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${process.env['WHATSAPP_ACCESS_TOKEN']}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(responsePayload)
                  }
                );

                const data = await response.json();
                console.log('Response sent:', data);
              } catch (error) {
                console.error('Error processing message with NLP:', error);
              }
            });
          }

          // Handle status updates
          if (value.statuses) {
            value.statuses.forEach((status: any) => {
              console.log('Status update:', {
                id: status.id,
                status: status.status,
                timestamp: status.timestamp
              });
            });
          }
        }
      });
    });
  }
});

// Test endpoint to send a message
app.post('/send-message', async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'Missing required fields: to, message' });
  }

  try {
    const response = await fetch(
      `${process.env['WHATSAPP_API_URL']}/${process.env['WHATSAPP_PHONE_NUMBER_ID']}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env['WHATSAPP_ACCESS_TOKEN']}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to,
          type: 'text',
          text: { body: message }
        })
      }
    );

    const data = await response.json();
    
    if (!response.ok) {
      console.error('WhatsApp API error:', data);
      return res.status(response.status).json(data);
    }

    return res.json(data);
  } catch (error) {
    console.error('Error sending message:', error);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

// Test endpoint to send a template message
app.post('/send-template', async (req, res) => {
  const { to, template_name = 'hello_world', language_code = 'en_US' } = req.body;

  if (!to) {
    return res.status(400).json({ error: 'Missing required field: to' });
  }

  try {
    const response = await fetch(
      `${process.env['WHATSAPP_API_URL']}/${process.env['WHATSAPP_PHONE_NUMBER_ID']}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env['WHATSAPP_ACCESS_TOKEN']}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to,
          type: 'template',
          template: {
            name: template_name,
            language: {
              code: language_code
            }
          }
        })
      }
    );

    const data = await response.json();
    
    if (!response.ok) {
      console.error('WhatsApp API error:', data);
      return res.status(response.status).json(data);
    }

    return res.json(data);
  } catch (error) {
    console.error('Error sending template:', error);
    return res.status(500).json({ error: 'Failed to send template' });
  }
});

// Register/verify a phone number
app.post('/register-phone', async (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ error: 'Missing required field: pin' });
  }

  try {
    const response = await fetch(
      `${process.env['WHATSAPP_API_URL']}/${process.env['WHATSAPP_PHONE_NUMBER_ID']}/register`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env['WHATSAPP_ACCESS_TOKEN']}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          pin: pin
        })
      }
    );

    const data = await response.json();
    
    if (!response.ok) {
      console.error('WhatsApp registration error:', data);
      return res.status(response.status).json(data);
    }

    return res.json(data);
  } catch (error) {
    console.error('Error registering phone:', error);
    return res.status(500).json({ error: 'Failed to register phone' });
  }
});

// Request verification code for a phone number
app.post('/request-code', async (req, res) => {
  const { code_method = 'SMS', language = 'en_US' } = req.body;

  try {
    const response = await fetch(
      `${process.env['WHATSAPP_API_URL']}/${process.env['WHATSAPP_PHONE_NUMBER_ID']}/request_code`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env['WHATSAPP_ACCESS_TOKEN']}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code_method: code_method,
          language: language
        })
      }
    );

    const data = await response.json();
    
    if (!response.ok) {
      console.error('WhatsApp request code error:', data);
      return res.status(response.status).json(data);
    }

    return res.json(data);
  } catch (error) {
    console.error('Error requesting code:', error);
    return res.status(500).json({ error: 'Failed to request code' });
  }
});

const server = createServer(app);

server.listen(port, () => {
  console.log(`WhatsApp service listening on port ${port}`);
  console.log('Webhook URL: http://localhost:3002/webhook');
  console.log('Send message URL: POST http://localhost:3002/send-message');
  console.log('Send template URL: POST http://localhost:3002/send-template');
});