# Wakala v2 Comprehensive Specifications

## Executive Summary

Wakala OS is a multi-tenant WhatsApp-based commerce platform designed to empower township entrepreneurs in South Africa. The platform enables vendors to easily list products, customers to purchase through conversational interfaces, and drivers to manage deliveries—all through WhatsApp.

## 1. Functional Requirements

### 1.1 Vendor Management

#### User Story: Vendor Onboarding
**As** Uncle Charles (non-tech-savvy vendor)  
**I want** to list products by sending photos and answering simple questions  
**So that** I can sell online without technical complexity

**Acceptance Criteria:**
- Complete product listing in < 10 minutes
- AI-powered image optimization
- Natural language product descriptions
- Multi-language support (11 SA languages)

#### Conversational Flow Requirements:
1. **Product Listing Flow**
   - Trigger: "I want to sell something"
   - Image upload with automatic optimization
   - Guided Q&A for product details
   - AI-enhanced descriptions
   - Confirmation before publishing

2. **Inventory Management**
   - Update stock levels via WhatsApp
   - Receive low stock alerts
   - Pause/unpause listings
   - Bulk operations support

### 1.2 Customer Experience

#### User Story: Product Discovery
**As** Brenda (local buyer)  
**I want** to search for products using natural language  
**So that** I can easily find what I need from local sellers

**Acceptance Criteria:**
- Natural language search processing
- Location-based results
- Rich media product cards
- Price and availability display

#### User Story: Purchase Flow
**As** Brenda  
**I want** to complete purchases within WhatsApp  
**So that** I don't need to learn new apps

**Acceptance Criteria:**
- Persistent cart (24-hour expiry)
- Multiple payment methods
- Order confirmation
- Real-time tracking

### 1.3 Delivery Management

#### User Story: Driver Dispatch
**As** David (delivery driver)  
**I want** to receive job notifications and accept with one tap  
**So that** I can quickly start earning

**Acceptance Criteria:**
- Push notifications for new jobs
- One-tap acceptance
- Route optimization
- Earnings tracking

#### User Story: KYC Verification
**As** David  
**I want** to complete identity verification quickly  
**So that** I can start working immediately

**Acceptance Criteria:**
- < 30 second verification
- WhatsApp-based document upload
- Automated approval
- One-time process

### 1.4 API Integration Requirements

#### Kasipulse.store API
- `POST /products` - Create/update listings
- `GET /products` - Search products
- `POST /orders` - Create orders
- `PUT /orders/{id}` - Update order status

#### Kasipulse.run API
- `GET /drivers/available` - Find available drivers
- `POST /deliveries` - Create delivery jobs
- `PUT /deliveries/{id}` - Update delivery status
- `GET /deliveries/earnings` - Driver earnings

#### Payment Gateway (Paystack)
- Generate payment links
- Process transactions
- Handle webhooks
- Split payments support

#### KYC Provider (Smile Identity)
- Document verification
- Biometric matching
- Compliance reporting
- Webhook notifications

## 2. Non-Functional Requirements

### 2.1 Performance Requirements

| Metric | Target | Measurement |
|--------|--------|-------------|
| WhatsApp webhook latency | < 250ms median | 95th percentile |
| API response time | < 500ms | 95th percentile |
| Message throughput | 1M+ msgs/day | Daily average |
| Concurrent conversations | 100,000+ | Peak capacity |
| Database query time | < 100ms | 95th percentile |
| Page load time | < 3 seconds | Mobile 3G |

### 2.2 Security Requirements

#### Data Protection
- AES-256 encryption at rest
- TLS 1.3 for data in transit
- End-to-end encryption for messages
- Secure key management (AWS KMS)

#### Authentication & Authorization
- JWT with 15-minute expiry
- Refresh token rotation
- Tenant-scoped permissions
- API key management

#### Compliance
- POPIA compliance mandatory
- Data residency in South Africa
- Right to erasure implementation
- Audit trail for all operations

### 2.3 Scalability Requirements

#### Infrastructure Scaling
- Horizontal scaling to 100+ nodes
- 32-shard database architecture
- Cell-based geographic distribution
- Auto-scaling based on load

#### Tenant Scaling
- Support 10,000+ tenants
- Seamless tier upgrades
- Resource isolation
- Performance guarantees per tier

### 2.4 Availability Requirements

| Component | Target | Strategy |
|-----------|--------|----------|
| Overall platform | 99.9% | Active-passive failover |
| WhatsApp integration | 99.95% | Multi-region deployment |
| Payment processing | 99.99% | Multiple gateway fallback |
| Database | 99.95% | Master-slave replication |

#### Disaster Recovery
- RTO: < 1 hour
- RPO: < 15 minutes
- Automated backups every 6 hours
- Cross-region replication

### 2.5 Quality Standards

#### Code Quality
- Maximum 500 lines per file
- Maximum 50 lines per function
- Cyclomatic complexity < 10
- Test coverage > 80% (100% critical paths)

#### Documentation
- API documentation (OpenAPI 3.0)
- Inline code documentation
- Architecture decision records
- Runbooks for operations

## 3. Technical Constraints

### 3.1 Technology Stack Constraints

#### Backend
- **Language**: Node.js 20+ with TypeScript
- **Framework**: Fastify 4.x
- **Database**: PostgreSQL 15+ with RLS
- **Cache**: Redis 7+ Cluster
- **Queue**: RabbitMQ 3.12+

#### Infrastructure
- **Container**: Docker with multi-stage builds
- **Orchestration**: Kubernetes 1.28+
- **Service Mesh**: Istio (optional)
- **Cloud**: AWS (primary), Azure (DR)

### 3.2 WhatsApp Platform Constraints

#### API Limitations
- 3-second webhook response SLA
- 24-hour conversation windows
- Template pre-approval required
- Rate limits per phone number

#### Message Pricing
- Utility: $0.005 per message
- Authentication: $0.03 per message
- Marketing: $0.09 per message

### 3.3 South African Market Constraints

#### Connectivity
- Design for 2G/3G networks
- Offline-first architecture
- Progressive data loading
- Payload optimization

#### Language Support
- 11 official languages required
- RTL support for Arabic
- Unicode compliance
- Translation management system

#### Payment Methods
- Card payments (Visa, MasterCard)
- Instant EFT (Ozow)
- Mobile money (MTN, Vodacom)
- Cash on delivery

### 3.4 Integration Constraints

#### WhatsApp Cloud API
- Migration deadline: October 2025
- Webhook verification required
- Media size limits (16MB)
- Template approval SLA (24 hours)

#### Paystack Limitations
- Rate limit: 100 requests/second
- Settlement: T+1 business days
- Transaction fees: 1.5% local
- Minimum transaction: R10

### 3.5 Timeline Constraints

#### Phase 1 (Months 1-3)
- Core WhatsApp integration
- Basic vendor onboarding
- Payment integration
- MVP deployment

#### Phase 2 (Months 4-6)
- Multi-tenant architecture
- Advanced commerce features
- Driver management
- Regional expansion

#### Phase 3 (Months 7-9)
- Offline capabilities
- Performance optimization
- Advanced analytics
- B2B features

#### Phase 4 (Months 10-12)
- Full language support
- API marketplace
- White-label options
- International expansion

## 4. Success Metrics

### 4.1 Business Metrics

| Metric | Target | Timeline |
|--------|--------|----------|
| Vendor onboarding | 1,000+ vendors | 6 months |
| Transaction volume | R10M+ GMV | 12 months |
| Active users | 50,000+ MAU | 12 months |
| Driver network | 500+ drivers | 6 months |

### 4.2 Technical Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Uptime | 99.9% | Monthly |
| Response time | < 500ms | P95 |
| Error rate | < 0.1% | Daily |
| Test coverage | > 80% | Per release |

### 4.3 User Experience Metrics

| Metric | Target | Method |
|--------|--------|--------|
| Onboarding completion | > 80% | Funnel analysis |
| Purchase conversion | > 30% | Cart analysis |
| Driver acceptance rate | > 70% | Job metrics |
| Customer satisfaction | > 4.5/5 | NPS surveys |

## 5. Architectural Decisions

### 5.1 Multi-Tenant Strategy
- **Decision**: Shared database with schema isolation
- **Rationale**: Balance between cost and isolation
- **Migration Path**: Support move to dedicated DB

### 5.2 Message Processing
- **Decision**: Event-driven with RabbitMQ
- **Rationale**: Handle burst traffic, ensure delivery
- **Fallback**: Redis Pub/Sub for real-time

### 5.3 Data Architecture
- **Decision**: PostgreSQL with RLS + Redis cache
- **Rationale**: ACID compliance + performance
- **Sharding**: Hash-based on tenant_id

## 6. Deployment Architecture

### 6.1 Infrastructure
```yaml
Production:
  - 3 Kubernetes clusters (JHB, CPT, DBN)
  - PostgreSQL cluster with read replicas
  - Redis Cluster (6 nodes minimum)
  - RabbitMQ cluster (3 nodes)
  
Staging:
  - 1 Kubernetes cluster
  - Single PostgreSQL instance
  - Redis standalone
  - RabbitMQ single node
```

### 6.2 Monitoring & Observability
- **Metrics**: Prometheus + Grafana
- **Logs**: ELK Stack
- **Tracing**: Jaeger
- **Alerts**: PagerDuty integration

### 6.3 CI/CD Pipeline
- **Source**: GitHub
- **CI**: GitHub Actions
- **CD**: ArgoCD
- **Registry**: Amazon ECR
- **Secrets**: AWS Secrets Manager

## Appendices

### A. Glossary
- **GMV**: Gross Merchandise Value
- **KYC**: Know Your Customer
- **RLS**: Row Level Security
- **MAU**: Monthly Active Users
- **NPS**: Net Promoter Score

### B. References
- WhatsApp Business API Documentation
- POPIA Compliance Guidelines
- Paystack API Reference
- PostgreSQL RLS Documentation