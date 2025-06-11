# WhatsApp Business API - Permanent Access Token Setup

This guide will help you create a permanent access token using a System User, which doesn't expire like user access tokens.

## Prerequisites

1. A verified Facebook Business Account
2. A WhatsApp Business Account
3. Admin access to your Facebook App

## Step-by-Step Setup

### 1. Create a System User

1. Go to [Business Settings](https://business.facebook.com/settings)
2. Navigate to **Users** → **System Users**
3. Click **Add** to create a new System User
4. Fill in:
   - **Name**: `wakala-whatsapp-system-user` (or your preferred name)
   - **Role**: Select **Admin**
5. Click **Create System User**

### 2. Add System User to Your App

1. In Business Settings, go to **Apps**
2. Find your WhatsApp Business App
3. Click **Add People**
4. Search for your System User
5. Grant **Full Control** permissions
6. Click **Add**

### 3. Generate System User Access Token

1. Go back to **System Users** in Business Settings
2. Click on your System User
3. Click **Generate New Token**
4. Select your WhatsApp Business App
5. Select the following permissions:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
   - `business_management` (if needed)
6. Click **Generate Token**
7. **IMPORTANT**: Copy and save this token immediately!

### 4. Add Assets to System User

1. While viewing your System User, click **Add Assets**
2. Navigate to **WhatsApp Accounts**
3. Select your WhatsApp Business Account
4. Grant **Full Control**
5. Click **Save Changes**

### 5. Update Your Environment

Update your `.env` file with the permanent token:

```bash
# Replace with your permanent system user token
WHATSAPP_ACCESS_TOKEN=your_permanent_system_user_token_here
```

### 6. Verify Token Permissions

Test your token with this curl command:

```bash
curl -X GET "https://graph.facebook.com/v18.0/me?access_token=YOUR_TOKEN_HERE"
```

You should see information about your system user.

### 7. Test WhatsApp API Access

```bash
# Get WhatsApp Business Account details
curl -X GET "https://graph.facebook.com/v18.0/${WHATSAPP_BUSINESS_ID}?access_token=${WHATSAPP_ACCESS_TOKEN}"

# Get Phone Number details
curl -X GET "https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}?access_token=${WHATSAPP_ACCESS_TOKEN}"
```

## Token Management Best Practices

1. **Never commit tokens** to version control
2. **Use environment variables** for all tokens
3. **Monitor token usage** in Facebook Business Manager
4. **Set up alerts** for unusual API activity
5. **Rotate tokens** periodically for security

## Troubleshooting

### "Token has expired" error
- System user tokens don't expire, so this usually means:
  - The token was revoked
  - Permissions were changed
  - The app or system user was deleted

### "Insufficient permissions" error
- Check that your system user has:
  - Access to the WhatsApp Business Account
  - Required permissions on the app
  - Full control of WhatsApp assets

### "Invalid token" error
- Verify the token is correctly copied
- Ensure no extra spaces or characters
- Check if the token was accidentally truncated

## Environment Variable Setup

After obtaining your permanent token, update these files:

1. **`.env`** (for local development):
```env
WHATSAPP_API_URL=https://graph.facebook.com/v18.0
WHATSAPP_BUSINESS_ID=your_business_id
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_permanent_system_user_token
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_webhook_verify_token
WHATSAPP_WEBHOOK_SECRET=your_webhook_secret
```

2. **Restart services**:
```bash
docker-compose -f docker-compose.dev.yml restart whatsapp-service
```

## Security Considerations

1. **Limit token scope** to only required permissions
2. **Use separate tokens** for development and production
3. **Monitor API usage** through Facebook Analytics
4. **Enable two-factor authentication** on your Facebook Business account
5. **Regular security audits** of system user permissions

## Next Steps

Once you have your permanent token:

1. Update the `.env` file
2. Restart the WhatsApp service
3. Run the test script: `./test-whatsapp-nlp.sh`
4. Monitor webhooks: `./monitor-whatsapp-webhook.sh`

The permanent token will allow continuous testing without expiration issues!