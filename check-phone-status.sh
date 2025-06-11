#!/bin/bash

# Check phone number status via API

echo "Checking WhatsApp Phone Number Status"
echo "====================================="
echo ""

# Get phone number details
curl -X GET "https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,quality_rating,status" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" | jq .

echo ""
echo "Checking business account phone numbers..."
echo ""

# List all phone numbers for the business account
curl -X GET "https://graph.facebook.com/v18.0/${WHATSAPP_BUSINESS_ID}/phone_numbers" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" | jq .