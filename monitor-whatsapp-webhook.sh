#!/bin/bash

# Monitor WhatsApp webhook messages
# This script shows incoming messages from the WhatsApp webhook

echo "=== WhatsApp Webhook Monitor ==="
echo "Monitoring incoming messages..."
echo ""
echo "Watching container logs for webhook activity..."
echo "Press Ctrl+C to stop"
echo ""

# Function to format webhook logs
format_logs() {
    grep -E "(Received webhook:|Received message:|Status update:)" | \
    sed 's/^.*Received webhook:/📥 WEBHOOK:/' | \
    sed 's/^.*Received message:/💬 MESSAGE:/' | \
    sed 's/^.*Status update:/✅ STATUS:/'
}

# Monitor the WhatsApp service logs
docker logs -f wakala-v2-whatsapp-service-1 2>&1 | format_logs