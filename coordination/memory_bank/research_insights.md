# Wakala v2 Research Insights

## Domain Research Findings

### WhatsApp Business API (2025)
- New per-message pricing model (July 2025)
- Engagement-based marketing limits (March 2025)
- Marketing Messages Lite API Beta available
- Webhook latency requirements: <250ms median, <1% >1s
- Quality rating system affects delivery

### African Conversational Commerce
- WhatsApp dominates Kenya, South Africa, Nigeria
- SUKHIBA shows 50% revenue increase via WhatsApp
- B2B commerce opportunity: $3.5 trillion by 2025
- Build WhatsApp-first, not as add-on

### Township E-commerce Challenges
- Highest global data costs
- Trust deficit in online transactions
- Township economy: ~R100 billion annually
- Delivery challenges: crime, power, addresses

## Technology Stack Insights

### Architecture Patterns
- PostgreSQL RLS for multi-tenancy
- Shared database, shared schema for startups
- Use session variables for tenant context
- Fastify plugin architecture for microservices
- Redis Pub/Sub for real-time messaging

### Performance Targets
- Fastify: <30,000 requests/second
- WhatsApp webhooks: 3-second response SLA
- Redis: Use SCAN not KEYS
- Kubernetes: Rolling updates for zero downtime

## Implementation Priorities

### Payment Integration (Paystack)
- Coverage: Nigeria, Ghana, South Africa, Kenya
- 95% success rate for local payments
- Support split payments for marketplace
- Multiple payment methods required

### Compliance (POPIA)
- Explicit opt-in consent required
- Data subject rights API endpoints
- Audit trails for all processing
- Breach notification procedures

### Offline-First Architecture
- Local database as source of truth
- Predictive caching strategies
- Network-aware synchronization
- Progressive enhancement approach

## Strategic Recommendations

1. **Phase 1**: Core WhatsApp + basic commerce
2. **Phase 2**: Multi-tenant + payments
3. **Phase 3**: Offline capabilities
4. **Phase 4**: Scale optimization

## Key Success Factors
- Sub-250ms webhook latency
- 99.9% uptime with failover
- POPIA compliance from day one
- Support for intermittent connectivity
- Trust-building through transparency