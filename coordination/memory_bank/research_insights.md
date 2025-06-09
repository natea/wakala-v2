# Wakala v2 Research Insights

## Executive Summary

This document compiles comprehensive research findings across domain knowledge, technology stack, and implementation patterns for the Wakala project. These insights will guide our development approach for building a multi-tenant, conversational AI e-commerce platform for South African township entrepreneurs.

## 1. Domain Research Findings

### 1.1 WhatsApp Business API (2025) Best Practices

**Key Microservices Design Principles:**
- **Modular Service Decomposition**:
  - Message handling and delivery service
  - User session management service
  - Media file processing service
  - Notification and alerting service
  - Template and compliance management service

- **Stateless Architecture**: 
  - Use external stores (Redis/PostgreSQL) for session state
  - Enables horizontal scaling and seamless updates
  - Supports high concurrency requirements

- **Compliance and Security**:
  - Strict template categorization enforcement
  - Automated template auditing to prevent policy violations
  - Secure authentication between microservices
  - Quality rating system affects delivery

- **Performance Requirements**:
  - New per-message pricing model (July 2025)
  - Engagement-based marketing limits (March 2025)
  - Marketing Messages Lite API Beta available
  - Webhook latency requirements: <250ms median, <1% >1s

### 1.2 Multi-Tenant SaaS Architecture with PostgreSQL RLS

**Architecture Approach:**
- **Shared Database, Shared Schema Model**:
  - All tenants share tables with `tenant_id` column
  - Row-Level Security (RLS) policies enforce isolation
  - Optimal for 100-1M+ tenants
  - Use session variables for tenant context

**RLS Implementation Example:**
```sql
CREATE POLICY tenant_isolation_policy ON mytable
USING (tenant_id = current_setting('app.current_tenant')::uuid);
```

**Benefits:**
- Centralized security enforcement at database level
- Simplified application logic
- Efficient resource utilization
- Easier maintenance and upgrades

### 1.3 African Conversational Commerce & Township E-commerce

**Market Opportunity:**
- WhatsApp dominates Kenya, South Africa, Nigeria
- Township economy: ~R200 billion annually (updated research)
- 60% of township residents engaged in online commerce
- Youth entrepreneurship increasing by 3.5%
- B2B commerce opportunity: $3.5 trillion by 2025
- SUKHIBA shows 50% revenue increase via WhatsApp

**Key Challenges:**
- Highest global data costs relative to income
- Trust deficit in online transactions
- Infrastructure limitations (limited internet access)
- Delivery challenges: crime, power, addresses
- 60% unemployment rate in townships

**Success Factors:**
- Build WhatsApp-first, not as add-on
- Mobile-first approach essential
- Low data consumption design
- Support for mobile point-of-sale devices (Yoco, Kazang)
- Community-driven support systems

### 1.4 Conversational AI State Machine for WhatsApp Commerce

**Core State Machine Components:**
- Initial states (greeting, intent identification)
- Transitional states (process specific requests)
- Terminal states (resolve queries, human handoff)
- State memory for conversation context

**Key E-commerce Use Cases:**
- Order tracking with real-time updates
- Returns and exchange processing
- Automated FAQ responses
- Personalized promotional engagement

## 2. Technology Stack Insights

### 2.1 Node.js TypeScript Fastify Best Practices

**TypeScript Integration:**
- Native TypeScript support in Node.js (2025)
- Declaration merging for Fastify plugins
- Type safety throughout the stack

**Performance Optimization:**
- JSON Schema validation for requests/responses
- Fast-json-stringify for improved serialization
- Asynchronous design with async/await
- Target: <30,000 requests/second

**API Design:**
- Route organization with shorthand methods
- Automatic Content-Type handling
- Zero overhead abstraction philosophy
- Fastify plugin architecture for microservices

### 2.2 Kubernetes EKS Istio Production Deployment

**Infrastructure Requirements:**
- Infrastructure as Code (Terraform/CloudFormation)
- Multi-AZ deployment for high availability
- Container orchestration with Kubernetes
- Rolling updates for zero downtime

**Scalability Features:**
- Horizontal Pod Autoscaling (HPA)
- Cluster Autoscaler for node management
- Microservices architecture for efficient scaling

**Istio Service Mesh Benefits:**
- Enhanced observability
- Traffic management
- Mutual TLS for service communication

### 2.3 PostgreSQL Citus Sharding for Multi-Tenancy

**Sharding Strategy:**
- Row-based sharding for 100-1M+ tenants
- Distribution by tenant_id column
- Co-location of related data

**Performance Optimizations:**
- High cardinality distribution column
- Parallel query execution
- Time-series partitioning for large tables
- Columnar compression for storage efficiency

### 2.4 Redis Cluster Caching Strategies

**Core Caching Patterns:**
- **Cache-Aside**: Best for read-heavy workloads
- **Write-Through**: Ensures data consistency across tenants
- **Write-Behind**: Optimizes heavy write workloads

**Multi-Tenant Optimizations:**
- TTL-based eviction strategies
- Tenant-based sharding across Redis nodes
- Cache prefetching for predictable patterns
- LRU eviction for memory management
- Redis Pub/Sub for real-time messaging
- Use SCAN not KEYS for production

## 3. Implementation Priorities

### 3.1 TDD London School with TypeScript/Jest

**London School Characteristics:**
- Outside-in testing approach
- Extensive use of mocks and test doubles
- Focus on component interactions

**AAA Pattern Implementation:**
```typescript
it('should throw an error when completing a non-existent task', () => {
  // Arrange
  const taskList = new TaskList();
  
  // Act, Assert
  expect(() => taskList.completeTask(999))
    .toThrow('Task with id 999 not found');
});
```

**Double-Loop TDD:**
- Outer loop: Acceptance/feature tests
- Inner loop: Unit tests
- Progressive refinement from requirements to implementation

### 3.2 WhatsApp Webhook 3-Second SLA Compliance

**Key Strategies:**
- Immediate HTTP 200 OK response
- Asynchronous processing with message queues
- Lightweight webhook endpoint
- Valid SSL/TLS certificates
- Target: Sub-250ms webhook latency

**Implementation Pattern:**
1. Receive webhook
2. Return 200 OK immediately
3. Queue message for processing
4. Process asynchronously
5. Monitor and alert on failures

### 3.3 Payment Gateway Orchestration

**Paystack Integration:**
- Coverage: Nigeria, Ghana, South Africa, Kenya
- 95% success rate for local payments
- Support split payments for marketplace
- Multiple payment methods required

**Ozow Integration Patterns:**
- Single API for multiple providers
- Dynamic routing based on business rules
- Automatic failover between providers
- Unified reconciliation and reporting

### 3.4 POPIA Compliance and Data Residency

**Key Requirements:**
- Explicit opt-in consent required
- Data subject rights API endpoints
- Audit trails for all processing
- Breach notification procedures
- No strict local residency mandate
- Cross-border transfers allowed with safeguards

**Cloud Architecture Compliance:**
- ISO certifications (27001, 27017, 27018)
- Contractual safeguards for data transfers
- Option for South African data centers
- Continuous compliance monitoring

### 3.5 Offline-First Architecture

**Core Principles:**
- Local database as source of truth
- Predictive caching strategies
- Network-aware synchronization
- Progressive enhancement approach

## 4. Strategic Recommendations

### Phased Implementation Approach

1. **Phase 1**: Core WhatsApp + basic commerce
   - WhatsApp Business API integration
   - Basic conversational state machine
   - Product catalog management
   - Order processing workflow

2. **Phase 2**: Multi-tenant + payments
   - PostgreSQL RLS implementation
   - Paystack/Ozow integration
   - Tenant management system
   - Payment orchestration

3. **Phase 3**: Offline capabilities
   - Progressive Web App (PWA)
   - Local data synchronization
   - Offline transaction queuing
   - Conflict resolution

4. **Phase 4**: Scale optimization
   - Citus sharding implementation
   - Redis cluster optimization
   - Performance monitoring
   - Advanced analytics

## 5. Key Success Factors

1. **Performance**: 
   - Sub-250ms webhook latency
   - 99.9% uptime with failover
   - <30,000 requests/second capacity

2. **Compliance**: 
   - POPIA compliance from day one
   - WhatsApp policy adherence
   - Automated compliance monitoring

3. **User Experience**: 
   - Support for intermittent connectivity
   - Mobile-first, low data consumption
   - Trust-building through transparency

4. **Architecture**: 
   - Microservices with clear boundaries
   - Event-driven communication
   - Scalable multi-tenant design

5. **Integration**: 
   - Seamless payment processing
   - Real-time inventory sync
   - Analytics and reporting

These insights provide a solid foundation for building a robust, scalable, and compliant e-commerce platform tailored to the unique needs of South African township entrepreneurs.