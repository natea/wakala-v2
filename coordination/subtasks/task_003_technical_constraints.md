# Wakala OS Technical Constraints Specification
## Version 1.0 - Phase 1 Specification

### 1. Technology Stack Constraints

#### 1.1 Backend Technology
- **TC-B001**: Node.js version 20+ (LTS) required
- **TC-B002**: TypeScript 5.0+ with strict mode enabled
- **TC-B003**: Fastify framework for HTTP server
- **TC-B004**: Express.js prohibited (performance reasons)
- **TC-B005**: CommonJS modules not allowed (ESM only)

#### 1.2 Database Constraints
- **TC-DB001**: PostgreSQL 15+ required (RLS support)
- **TC-DB002**: Citus extension mandatory for sharding
- **TC-DB003**: NoSQL databases prohibited for transactional data
- **TC-DB004**: Maximum 32 database shards
- **TC-DB005**: Connection pooling mandatory (pgBouncer)

#### 1.3 Infrastructure Constraints
- **TC-I001**: Kubernetes deployment only (no VMs)
- **TC-I002**: AWS EKS for Kubernetes hosting
- **TC-I003**: Istio service mesh required
- **TC-I004**: Docker containers with Alpine Linux
- **TC-I005**: Maximum container size 500MB

### 2. Integration Constraints

#### 2.1 WhatsApp Business API
- **TC-W001**: WhatsApp Cloud API only (On-Premise deprecated)
- **TC-W002**: Webhook response time < 3 seconds (hard limit)
- **TC-W003**: Message template pre-approval required
- **TC-W004**: 1,000 messages/second rate limit
- **TC-W005**: 24-hour session window for conversations

#### 2.2 Payment Gateway Constraints
- **TC-PG001**: Paystack API v2 required
- **TC-PG002**: Ozow API integration mandatory
- **TC-PG003**: PCI DSS compliance required
- **TC-PG004**: No credit card data storage allowed
- **TC-PG005**: Payment tokenization mandatory

#### 2.3 Third-Party Services
- **TC-TP001**: Smile Identity for KYC only
- **TC-TP002**: AWS services only (no multi-cloud)
- **TC-TP003**: Redis for caching (no Memcached)
- **TC-TP004**: RabbitMQ for message queuing
- **TC-TP005**: Elasticsearch for search (no Solr)

### 3. Security Constraints

#### 3.1 Encryption Requirements
- **TC-SEC001**: TLS 1.3 minimum for all connections
- **TC-SEC002**: AES-256-GCM for data at rest
- **TC-SEC003**: No custom cryptography implementations
- **TC-SEC004**: Hardware security modules for keys
- **TC-SEC005**: Certificate pinning for mobile clients

#### 3.2 Authentication Constraints
- **TC-AUTH001**: JWT tokens only (no sessions)
- **TC-AUTH002**: 15-minute token expiry maximum
- **TC-AUTH003**: Refresh tokens prohibited
- **TC-AUTH004**: OAuth 2.0 for API access
- **TC-AUTH005**: No basic authentication allowed

### 4. Deployment Constraints

#### 4.1 Geographic Constraints
- **TC-GEO001**: Primary deployment in af-south-1 (Cape Town)
- **TC-GEO002**: Secondary deployment in af-south-1b
- **TC-GEO003**: Data residency in South Africa only
- **TC-GEO004**: No cross-border data transfer
- **TC-GEO005**: CDN presence in South Africa required

#### 4.2 Environment Constraints
- **TC-ENV001**: Minimum 3 environments (dev, staging, prod)
- **TC-ENV002**: Production parity required
- **TC-ENV003**: Blue-green deployment mandatory
- **TC-ENV004**: Canary releases for critical updates
- **TC-ENV005**: Rollback capability < 5 minutes

### 5. Performance Constraints

#### 5.1 Latency Constraints
- **TC-PERF001**: API latency < 500ms (95th percentile)
- **TC-PERF002**: Database query < 100ms
- **TC-PERF003**: Cache hit ratio > 80%
- **TC-PERF004**: Message queue latency < 100ms
- **TC-PERF005**: Search results < 1 second

#### 5.2 Capacity Constraints
- **TC-CAP001**: 1M messages/day minimum capacity
- **TC-CAP002**: 100K concurrent users support
- **TC-CAP003**: 10TB storage scaling capability
- **TC-CAP004**: 1000 RPS webhook processing
- **TC-CAP005**: 50GB/day data ingestion

### 6. Development Constraints

#### 6.1 Code Quality Constraints
- **TC-DEV001**: TypeScript strict mode mandatory
- **TC-DEV002**: ESLint with airbnb-typescript config
- **TC-DEV003**: Prettier formatting required
- **TC-DEV004**: Git commit conventions (conventional commits)
- **TC-DEV005**: Pre-commit hooks mandatory

#### 6.2 Testing Constraints
- **TC-TEST001**: Minimum 80% test coverage
- **TC-TEST002**: TDD London School approach
- **TC-TEST003**: Jest testing framework only
- **TC-TEST004**: E2E tests required for critical paths
- **TC-TEST005**: Performance tests for all APIs

### 7. Architectural Constraints

#### 7.1 Microservices Constraints
- **TC-ARCH001**: Service size < 10K lines of code
- **TC-ARCH002**: Single responsibility per service
- **TC-ARCH003**: Synchronous calls prohibited between services
- **TC-ARCH004**: Event-driven communication only
- **TC-ARCH005**: Service mesh for all inter-service communication

#### 7.2 Data Architecture Constraints
- **TC-DATA001**: CQRS pattern for read-heavy operations
- **TC-DATA002**: Event sourcing for audit trails
- **TC-DATA003**: No shared databases between services
- **TC-DATA004**: Schema versioning required
- **TC-DATA005**: Database migrations automated

### 8. Compliance Constraints

#### 8.1 POPIA Compliance
- **TC-POPIA001**: Personal data encryption mandatory
- **TC-POPIA002**: Consent tracking required
- **TC-POPIA003**: Data retention limits enforced
- **TC-POPIA004**: Right to erasure implementation
- **TC-POPIA005**: Data breach notification < 72 hours

#### 8.2 Financial Regulations
- **TC-FIN001**: FSB compliance required
- **TC-FIN002**: Transaction records 7-year retention
- **TC-FIN003**: AML checks mandatory
- **TC-FIN004**: Daily reconciliation required
- **TC-FIN005**: Audit trail immutability

### 9. Operational Constraints

#### 9.1 Monitoring Constraints
- **TC-MON001**: Datadog APM required
- **TC-MON002**: Prometheus metrics mandatory
- **TC-MON003**: Centralized logging (ELK stack)
- **TC-MON004**: Distributed tracing (Jaeger)
- **TC-MON005**: Real-time alerting < 1 minute

#### 9.2 Maintenance Constraints
- **TC-MAINT001**: Zero-downtime deployments only
- **TC-MAINT002**: Automated rollback capability
- **TC-MAINT003**: Database migrations reversible
- **TC-MAINT004**: Feature flags for all new features
- **TC-MAINT005**: Gradual rollout capability

### 10. Budget & Resource Constraints

#### 10.1 Infrastructure Budget
- **TC-BUDGET001**: Monthly AWS spend < $10,000
- **TC-BUDGET002**: Cost per transaction < $0.01
- **TC-BUDGET003**: Storage cost optimization required
- **TC-BUDGET004**: Reserved instances for predictable workloads
- **TC-BUDGET005**: Auto-scaling for cost efficiency

#### 10.2 Team Constraints
- **TC-TEAM001**: Maximum 10 developers initially
- **TC-TEAM002**: 24/7 on-call rotation required
- **TC-TEAM003**: DevOps expertise mandatory
- **TC-TEAM004**: Security specialist required
- **TC-TEAM005**: POPIA compliance officer needed

### 11. Timeline Constraints

#### 11.1 Development Timeline
- **TC-TIME001**: MVP delivery in 3 months
- **TC-TIME002**: Phase 1 complete in 6 months
- **TC-TIME003**: Full platform in 12 months
- **TC-TIME004**: Weekly release cycles
- **TC-TIME005**: Hotfix deployment < 4 hours

#### 11.2 Migration Constraints
- **TC-MIG001**: WhatsApp On-Premise migration by Oct 2025
- **TC-MIG002**: Zero data loss during migration
- **TC-MIG003**: Gradual user migration required
- **TC-MIG004**: Rollback capability mandatory
- **TC-MIG005**: Parallel run period of 1 month

### 12. Vendor Lock-in Mitigation

#### 12.1 Abstraction Requirements
- **TC-VENDOR001**: Payment gateway abstraction layer
- **TC-VENDOR002**: Cloud provider abstraction
- **TC-VENDOR003**: Container runtime agnostic
- **TC-VENDOR004**: Database abstraction layer
- **TC-VENDOR005**: Message queue abstraction

### Risk Mitigation Matrix

| Constraint Category | Risk Level | Mitigation Strategy |
|-------------------|------------|-------------------|
| WhatsApp API Limits | High | Queue management, rate limiting |
| Database Sharding | Medium | Careful shard key selection |
| POPIA Compliance | High | Regular audits, encryption |
| Performance SLAs | Medium | Caching, optimization |
| Budget Constraints | Medium | Auto-scaling, cost monitoring |

### Dependency Matrix

| External Service | Version | Critical | Fallback Strategy |
|-----------------|---------|----------|------------------|
| WhatsApp Cloud API | v17.0+ | Yes | SMS notifications |
| Paystack API | v2 | Yes | Ozow gateway |
| PostgreSQL | 15+ | Yes | Read replicas |
| Redis | 7.0+ | No | Database caching |
| Elasticsearch | 8.0+ | No | PostgreSQL FTS |

### Constraint Priority

1. **Non-negotiable**: Security, POPIA compliance, WhatsApp SLA
2. **High Priority**: Performance targets, availability SLA
3. **Medium Priority**: Technology choices, team size
4. **Flexible**: Budget allocation, timeline adjustments