# Wakala Platform Webhook Events Documentation

## Overview

Webhooks allow you to receive real-time notifications when events occur in the Wakala platform. All webhook payloads are signed using HMAC-SHA256 to ensure authenticity.

## Webhook Security

### Signature Verification

All webhook requests include a signature in the `X-Wakala-Signature` header. To verify the webhook:

```python
import hmac
import hashlib

def verify_webhook_signature(payload, signature, secret):
    """Verify webhook signature"""
    expected_signature = hmac.new(
        secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(signature, expected_signature)

# Example usage
@app.route('/webhook', methods=['POST'])
def handle_webhook():
    signature = request.headers.get('X-Wakala-Signature')
    payload = request.get_data(as_text=True)
    
    if not verify_webhook_signature(payload, signature, WEBHOOK_SECRET):
        return jsonify({'error': 'Invalid signature'}), 401
    
    # Process webhook
    event = json.loads(payload)
    process_event(event)
    
    return jsonify({'status': 'ok'}), 200
```

### Retry Policy

- Failed webhooks (non-2xx response) are retried with exponential backoff
- Maximum 5 retry attempts
- Retry intervals: 1m, 5m, 30m, 2h, 24h
- Webhooks are considered failed after all retries exhausted

### Headers

All webhook requests include these headers:

| Header | Description |
|--------|-------------|
| `X-Wakala-Signature` | HMAC-SHA256 signature of the payload |
| `X-Wakala-Event` | Event type (e.g., `transaction.completed`) |
| `X-Wakala-Delivery-ID` | Unique ID for this delivery attempt |
| `X-Wakala-Timestamp` | Unix timestamp of the event |

## Event Types

### Transaction Events

#### transaction.completed

Fired when a transaction is successfully completed.

```json
{
  "event": "transaction.completed",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "transaction_id": "txn_123456789",
    "type": "transfer",
    "amount": 1000.00,
    "currency": "KES",
    "sender": {
      "phone_number": "+254712345678",
      "name": "John Doe",
      "wallet_id": "wal_abc123"
    },
    "receiver": {
      "phone_number": "+254712345679",
      "name": "Jane Smith",
      "wallet_id": "wal_def456"
    },
    "fees": 10.00,
    "reference": "TXN123456",
    "description": "Payment for services",
    "metadata": {
      "source": "mobile_app",
      "ip_address": "192.168.1.1"
    }
  }
}
```

#### transaction.failed

Fired when a transaction fails.

```json
{
  "event": "transaction.failed",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "transaction_id": "txn_123456789",
    "type": "transfer",
    "amount": 1000.00,
    "currency": "KES",
    "sender": {
      "phone_number": "+254712345678",
      "wallet_id": "wal_abc123"
    },
    "error": {
      "code": "INSUFFICIENT_FUNDS",
      "message": "Insufficient balance to complete transaction",
      "details": {
        "available_balance": 500.00,
        "required_amount": 1010.00
      }
    }
  }
}
```

#### transaction.reversed

Fired when a transaction is reversed.

```json
{
  "event": "transaction.reversed",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "original_transaction_id": "txn_123456789",
    "reversal_transaction_id": "txn_987654321",
    "amount": 1000.00,
    "currency": "KES",
    "reason": "Customer dispute",
    "initiated_by": "system"
  }
}
```

### Payment Events

#### payment.received

Fired when a payment is received.

```json
{
  "event": "payment.received",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "payment_id": "pay_123456789",
    "transaction_id": "txn_123456789",
    "amount": 500.00,
    "currency": "KES",
    "from": {
      "phone_number": "+254712345678",
      "name": "John Doe"
    },
    "to": {
      "merchant_id": "mer_abc123",
      "business_name": "ABC Store",
      "till_number": "123456"
    },
    "reference": "INV-2024-001",
    "payment_method": "wallet"
  }
}
```

#### payment.sent

Fired when a payment is sent.

```json
{
  "event": "payment.sent",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "payment_id": "pay_123456789",
    "transaction_id": "txn_123456789",
    "amount": 500.00,
    "currency": "KES",
    "to": {
      "phone_number": "+254712345679",
      "name": "Jane Smith"
    },
    "reference": "SALARY-JAN-2024",
    "description": "January salary"
  }
}
```

### Disbursement Events

#### disbursement.completed

Fired when a bulk disbursement is completed.

```json
{
  "event": "disbursement.completed",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "batch_id": "batch_123456789",
    "total_count": 100,
    "successful_count": 98,
    "failed_count": 2,
    "total_amount": 100000.00,
    "disbursed_amount": 98000.00,
    "currency": "KES",
    "summary": {
      "processing_time_seconds": 45,
      "average_amount": 1000.00
    }
  }
}
```

#### disbursement.failed

Fired when a disbursement fails.

```json
{
  "event": "disbursement.failed",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "batch_id": "batch_123456789",
    "transaction_id": "txn_123456789",
    "phone_number": "+254712345678",
    "amount": 1000.00,
    "currency": "KES",
    "error": {
      "code": "INVALID_RECIPIENT",
      "message": "Recipient not registered"
    }
  }
}
```

### KYC Events

#### kyc.verified

Fired when KYC verification is approved.

```json
{
  "event": "kyc.verified",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "user_id": "usr_123456789",
    "phone_number": "+254712345678",
    "verification_id": "ver_123456789",
    "kyc_level": 2,
    "document_type": "national_id",
    "new_limits": {
      "daily_limit": 300000.00,
      "monthly_limit": 1000000.00,
      "per_transaction_limit": 150000.00
    }
  }
}
```

#### kyc.rejected

Fired when KYC verification is rejected.

```json
{
  "event": "kyc.rejected",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "user_id": "usr_123456789",
    "phone_number": "+254712345678",
    "verification_id": "ver_123456789",
    "reason": "Document not readable",
    "can_retry": true,
    "retry_after": "2024-01-16T10:30:00Z"
  }
}
```

### Account Events

#### account.suspended

Fired when an account is suspended.

```json
{
  "event": "account.suspended",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "user_id": "usr_123456789",
    "phone_number": "+254712345678",
    "reason": "Suspicious activity detected",
    "suspended_until": "2024-01-22T10:30:00Z",
    "can_appeal": true
  }
}
```

#### account.activated

Fired when an account is activated or reactivated.

```json
{
  "event": "account.activated",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "user_id": "usr_123456789",
    "phone_number": "+254712345678",
    "activation_type": "reactivation",
    "previous_status": "suspended"
  }
}
```

### Fraud Events

#### fraud.detected

Fired when potential fraud is detected.

```json
{
  "event": "fraud.detected",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "alert_id": "alert_123456789",
    "user_id": "usr_123456789",
    "transaction_id": "txn_123456789",
    "risk_score": 85,
    "risk_factors": [
      "unusual_amount",
      "new_device",
      "location_mismatch"
    ],
    "action_taken": "transaction_blocked",
    "requires_review": true
  }
}
```

### Settlement Events

#### settlement.completed

Fired when merchant settlement is completed.

```json
{
  "event": "settlement.completed",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "settlement_id": "set_123456789",
    "merchant_id": "mer_123456789",
    "period": {
      "from": "2024-01-14T00:00:00Z",
      "to": "2024-01-14T23:59:59Z"
    },
    "transaction_count": 150,
    "gross_amount": 75000.00,
    "fees": 1500.00,
    "net_amount": 73500.00,
    "currency": "KES",
    "bank_reference": "FT24015123456"
  }
}
```

## Webhook Payload Examples

### Successful Delivery Response

Your endpoint should return a 2xx status code to acknowledge receipt:

```json
{
  "status": "ok",
  "message": "Webhook processed successfully"
}
```

### Error Response

If you need to indicate an error, return appropriate status code:

```json
{
  "error": "Invalid event type",
  "code": "INVALID_EVENT"
}
```

## Best Practices

1. **Idempotency**: Store the `X-Wakala-Delivery-ID` to handle duplicate deliveries
2. **Async Processing**: Acknowledge webhooks quickly and process asynchronously
3. **Error Handling**: Implement proper error handling and logging
4. **Security**: Always verify webhook signatures
5. **Monitoring**: Monitor webhook processing for failures

## Testing Webhooks

Use our webhook testing tool to simulate events:

```bash
curl -X POST https://api.wakala.platform/v1/webhooks/test \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "transaction.completed",
    "url": "https://your-webhook-url.com/webhook"
  }'
```

## Webhook Configuration

Configure webhooks via API:

```bash
curl -X POST https://api.wakala.platform/v1/webhooks \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-webhook-url.com/webhook",
    "events": [
      "transaction.completed",
      "transaction.failed",
      "payment.received"
    ],
    "secret": "your-webhook-secret"
  }'
```

## Rate Limits

- Maximum 100 webhooks per second per endpoint
- Automatic backoff if endpoint is consistently slow
- Webhooks may be delivered out of order

## Support

For webhook issues or questions:
- Email: webhooks@wakala.platform
- Documentation: https://docs.wakala.platform/webhooks
- Status: https://status.wakala.platform