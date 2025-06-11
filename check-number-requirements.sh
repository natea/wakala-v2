#!/bin/bash

echo "Checking WhatsApp Phone Number Requirements"
echo "=========================================="
echo ""

# Check if the number is already registered/active
echo "1. Checking phone number status..."
curl -X GET "https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type,throughput,status,name_status" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" 2>/dev/null | jq .

echo ""
echo "2. Checking business verification status..."
curl -X GET "https://graph.facebook.com/v18.0/${WHATSAPP_BUSINESS_ID}?fields=id,name,vertical,verification_status,primary_page" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" 2>/dev/null | jq .

echo ""
echo "3. Testing if number can send messages..."
curl -X POST "https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "15083040360",
    "type": "template",
    "template": {
      "name": "hello_world",
      "language": {
        "code": "en_US"
      }
    }
  }' 2>/dev/null | jq .