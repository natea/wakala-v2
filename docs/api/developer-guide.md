# Wakala Platform Developer Guide

## Getting Started

Welcome to the Wakala Mobile Money Platform API! This guide will help you integrate with our platform and build amazing financial services applications.

## Quick Start

### 1. Get Your API Credentials

1. Sign up for a developer account at [https://developers.wakala.platform](https://developers.wakala.platform)
2. Create a new application
3. Obtain your API credentials:
   - Client ID
   - Client Secret
   - Webhook Secret (if using webhooks)

### 2. Choose Your Environment

| Environment | Base URL | Purpose |
|-------------|----------|---------|
| Sandbox | `https://sandbox-api.wakala.platform/v1` | Testing and development |
| Production | `https://api.wakala.platform/v1` | Live transactions |

### 3. Install SDK (Optional)

We provide official SDKs for popular languages:

#### JavaScript/TypeScript
```bash
npm install @wakala/sdk
```

```javascript
import { WakalaClient } from '@wakala/sdk';

const client = new WakalaClient({
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
  environment: 'sandbox' // or 'production'
});
```

#### Python
```bash
pip install wakala-sdk
```

```python
from wakala import WakalaClient

client = WakalaClient(
    client_id='YOUR_CLIENT_ID',
    client_secret='YOUR_CLIENT_SECRET',
    environment='sandbox'  # or 'production'
)
```

#### PHP
```bash
composer require wakala/sdk
```

```php
use Wakala\WakalaClient;

$client = new WakalaClient([
    'client_id' => 'YOUR_CLIENT_ID',
    'client_secret' => 'YOUR_CLIENT_SECRET',
    'environment' => 'sandbox' // or 'production'
]);
```

## Authentication

### OAuth 2.0 Flow

The Wakala API uses OAuth 2.0 for authentication. Here's how to authenticate:

#### 1. Register a User

```bash
curl -X POST https://sandbox-api.wakala.platform/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "+254712345678",
    "country_code": "KE",
    "pin": "1234",
    "device_id": "unique-device-id"
  }'
```

Response:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "user": {
    "id": "usr_123456789",
    "phone_number": "+254712345678",
    "kyc_status": "unverified"
  }
}
```

#### 2. Use the Access Token

Include the access token in the Authorization header for all API requests:

```bash
curl -X GET https://sandbox-api.wakala.platform/v1/wallets/balance \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

#### 3. Refresh Tokens

When the access token expires, use the refresh token to get a new one:

```bash
curl -X POST https://sandbox-api.wakala.platform/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
  }'
```

## Core Operations

### 1. Check Wallet Balance

```javascript
// Using SDK
const balance = await client.wallets.getBalance();
console.log(`Balance: ${balance.currency} ${balance.balance}`);

// Using API
const response = await fetch('https://sandbox-api.wakala.platform/v1/wallets/balance', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
const balance = await response.json();
```

### 2. Send Money

```javascript
// Using SDK
const transfer = await client.transactions.transfer({
  receiver_phone: '+254712345679',
  amount: 1000,
  pin: '1234',
  description: 'Lunch money'
});

console.log(`Transaction ID: ${transfer.transaction_id}`);
console.log(`Status: ${transfer.status}`);

// Using API
const response = await fetch('https://sandbox-api.wakala.platform/v1/transactions/transfer', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    receiver_phone: '+254712345679',
    amount: 1000,
    pin: '1234',
    description: 'Lunch money'
  })
});
```

### 3. Check Transaction Status

```javascript
// Using SDK
const transaction = await client.transactions.get(transactionId);
console.log(`Status: ${transaction.status}`);

// Using API
const response = await fetch(`https://sandbox-api.wakala.platform/v1/transactions/${transactionId}`, {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
const transaction = await response.json();
```

### 4. Transaction History

```javascript
// Using SDK
const history = await client.wallets.getTransactions({
  page: 1,
  limit: 20,
  from_date: '2024-01-01',
  to_date: '2024-01-31'
});

// Using API
const response = await fetch('https://sandbox-api.wakala.platform/v1/wallets/transactions?page=1&limit=20', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
const history = await response.json();
```

## Merchant Integration

### 1. Register as Merchant

```javascript
const merchant = await client.merchants.register({
  business_name: 'ABC Store',
  business_type: 'retail',
  tax_id: 'TAX123456',
  business_email: 'info@abcstore.com'
});

console.log(`Merchant Code: ${merchant.merchant_code}`);
```

### 2. Create Payment Request

```javascript
const paymentRequest = await client.merchants.createPaymentRequest({
  amount: 500,
  customer_phone: '+254712345678',
  description: 'Coffee purchase',
  reference: 'ORDER-001'
});

console.log(`Payment Request ID: ${paymentRequest.request_id}`);
// Send request_id to customer for approval
```

### 3. Generate QR Code

```javascript
const qrCode = await client.merchants.generateQRCode({
  amount: 500,
  reference: 'TABLE-5'
});

// Display QR code for customer to scan
console.log(`QR Code: ${qrCode.qr_code}`); // Base64 encoded image
```

## Bulk Operations

### Bulk Disbursements

Perfect for salary payments, rewards, or refunds:

```javascript
const disbursement = await client.disbursements.createBulk({
  disbursements: [
    {
      phone_number: '+254712345678',
      amount: 5000,
      reference: 'SALARY-001',
      description: 'January salary'
    },
    {
      phone_number: '+254712345679',
      amount: 4500,
      reference: 'SALARY-002',
      description: 'January salary'
    }
  ]
});

console.log(`Batch ID: ${disbursement.batch_id}`);

// Check status
const status = await client.disbursements.getBatchStatus(disbursement.batch_id);
console.log(`Completed: ${status.successful_count}/${status.total_count}`);
```

## Webhooks

### Setting Up Webhooks

```javascript
const webhook = await client.webhooks.create({
  url: 'https://your-app.com/webhooks/wakala',
  events: [
    'transaction.completed',
    'transaction.failed',
    'payment.received'
  ],
  secret: 'your-webhook-secret'
});
```

### Handling Webhooks

```javascript
// Express.js example
app.post('/webhooks/wakala', (req, res) => {
  const signature = req.headers['x-wakala-signature'];
  const payload = JSON.stringify(req.body);
  
  // Verify signature
  if (!verifyWebhookSignature(payload, signature, WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Process event
  const event = req.body;
  
  switch (event.event) {
    case 'transaction.completed':
      handleTransactionCompleted(event.data);
      break;
    case 'payment.received':
      handlePaymentReceived(event.data);
      break;
    // ... handle other events
  }
  
  res.json({ status: 'ok' });
});
```

## Error Handling

### Error Response Format

All errors follow this format:

```json
{
  "code": "INSUFFICIENT_FUNDS",
  "message": "Insufficient balance to complete transaction",
  "details": {
    "available_balance": 500.00,
    "required_amount": 1000.00
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_PIN` | 401 | Incorrect PIN provided |
| `INSUFFICIENT_FUNDS` | 402 | Not enough balance |
| `INVALID_PHONE_NUMBER` | 400 | Phone number format invalid |
| `USER_NOT_FOUND` | 404 | Recipient doesn't exist |
| `LIMIT_EXCEEDED` | 400 | Transaction limit exceeded |
| `DUPLICATE_TRANSACTION` | 409 | Duplicate transaction detected |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |

### Error Handling Example

```javascript
try {
  const transfer = await client.transactions.transfer({
    receiver_phone: '+254712345679',
    amount: 1000,
    pin: '1234'
  });
} catch (error) {
  if (error.code === 'INSUFFICIENT_FUNDS') {
    console.log(`Need ${error.details.required_amount} but only have ${error.details.available_balance}`);
  } else if (error.code === 'INVALID_PIN') {
    console.log('Please check your PIN and try again');
  } else {
    console.log(`Error: ${error.message}`);
  }
}
```

## Best Practices

### 1. Idempotency

Use idempotency keys to prevent duplicate transactions:

```javascript
const transfer = await client.transactions.transfer({
  receiver_phone: '+254712345679',
  amount: 1000,
  pin: '1234',
  idempotency_key: 'unique-request-id-123'
});
```

### 2. Pagination

Always paginate when fetching lists:

```javascript
let page = 1;
let hasMore = true;

while (hasMore) {
  const transactions = await client.wallets.getTransactions({
    page: page,
    limit: 100
  });
  
  // Process transactions
  processTransactions(transactions.transactions);
  
  hasMore = page < transactions.pagination.total_pages;
  page++;
}
```

### 3. Rate Limiting

Respect rate limits to avoid throttling:

```javascript
// Check rate limit headers
const remaining = response.headers.get('X-RateLimit-Remaining');
const reset = response.headers.get('X-RateLimit-Reset');

if (remaining === '0') {
  const resetTime = new Date(reset * 1000);
  console.log(`Rate limited. Try again at ${resetTime}`);
}
```

### 4. Secure PIN Handling

Never store PINs. Always collect them at transaction time:

```javascript
// Bad - Don't do this
const userPin = '1234'; // Never store PINs

// Good - Collect PIN when needed
const pin = await promptUserForPin();
const transfer = await client.transactions.transfer({
  receiver_phone: '+254712345679',
  amount: 1000,
  pin: pin
});
```

## Testing in Sandbox

### Test Phone Numbers

Use these test numbers in sandbox:

| Phone Number | PIN | Description |
|--------------|-----|-------------|
| +254700000001 | 1234 | Always succeeds |
| +254700000002 | 1234 | Always fails (insufficient funds) |
| +254700000003 | 1234 | Always fails (invalid recipient) |
| +254700000004 | 1234 | Random failures (for testing retry) |

### Test Scenarios

1. **Successful Transfer**
   ```javascript
   await client.transactions.transfer({
     receiver_phone: '+254700000001',
     amount: 100,
     pin: '1234'
   });
   ```

2. **Insufficient Funds**
   ```javascript
   await client.transactions.transfer({
     receiver_phone: '+254700000002',
     amount: 1000000,
     pin: '1234'
   });
   ```

3. **Network Timeout**
   ```javascript
   // Use special amount to trigger timeout
   await client.transactions.transfer({
     receiver_phone: '+254700000001',
     amount: 99999,
     pin: '1234'
   });
   ```

## Migration to Production

### Checklist

- [ ] Update API endpoint to production URL
- [ ] Replace sandbox credentials with production credentials
- [ ] Implement proper error handling and logging
- [ ] Set up webhook endpoints with SSL
- [ ] Configure monitoring and alerts
- [ ] Review and enforce transaction limits
- [ ] Implement fraud detection rules
- [ ] Set up customer support integration
- [ ] Complete security assessment
- [ ] Load test your integration

### Security Considerations

1. **API Credentials**: Store securely using environment variables or secret management service
2. **HTTPS Only**: Always use HTTPS in production
3. **PIN Security**: Never log or store user PINs
4. **Webhook Validation**: Always verify webhook signatures
5. **Rate Limiting**: Implement client-side rate limiting
6. **Error Messages**: Don't expose sensitive information in errors

## Support

### Resources

- API Reference: [https://docs.wakala.platform/api](https://docs.wakala.platform/api)
- Status Page: [https://status.wakala.platform](https://status.wakala.platform)
- Developer Forum: [https://forum.wakala.platform](https://forum.wakala.platform)

### Contact

- Technical Support: developers@wakala.platform
- Sales: sales@wakala.platform
- Security: security@wakala.platform

### SDK Repositories

- JavaScript/TypeScript: [github.com/wakala/sdk-js](https://github.com/wakala/sdk-js)
- Python: [github.com/wakala/sdk-python](https://github.com/wakala/sdk-python)
- PHP: [github.com/wakala/sdk-php](https://github.com/wakala/sdk-php)
- Java: [github.com/wakala/sdk-java](https://github.com/wakala/sdk-java)
- Go: [github.com/wakala/sdk-go](https://github.com/wakala/sdk-go)

Happy coding! 🚀