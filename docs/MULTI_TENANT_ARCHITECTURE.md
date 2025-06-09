# Multi-Tenant Architecture Recommendations for Wakala OS

## Executive Summary

This document provides comprehensive architectural recommendations for implementing Wakala OS as a multi-tenant SaaS platform serving township entrepreneurs in South Africa. Based on extensive research into multi-tenant patterns, security considerations, and South African market requirements, these recommendations balance technical robustness with practical constraints of the township environment.

## 1. Database Isolation Strategy

### Recommended Approach: Hybrid Sharded Model

For Wakala OS, I recommend a **hybrid sharded database model** that combines:

1. **Shared database with separate schemas** for standard tenants (small township businesses)
2. **Dedicated databases** for premium/high-volume tenants (established enterprises)
3. **Cell-based architecture** for geographic distribution

#### Implementation Details:

```sql
-- Base tenant schema structure
CREATE SCHEMA IF NOT EXISTS tenant_{tenant_id};

-- Core tables per tenant schema
CREATE TABLE tenant_{tenant_id}.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(15) UNIQUE NOT NULL,
    whatsapp_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tenant_{tenant_id}.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    image_url TEXT,
    description TEXT
);

-- Shared system tables
CREATE TABLE public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    tier ENUM('basic', 'premium', 'enterprise') DEFAULT 'basic',
    database_shard VARCHAR(50) NOT NULL,
    schema_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Key Benefits:
- **Cost-effective** for township businesses with low transaction volumes
- **Scalable** migration path from shared to dedicated as businesses grow
- **Compliant** with POPIA requirements through schema-level isolation

### Database Technology Stack:
- **Primary Database**: PostgreSQL 15+ with Row-Level Security (RLS)
- **Cache Layer**: Redis with tenant-prefixed keys
- **Search**: Elasticsearch with tenant-specific indices
- **Analytics**: ClickHouse for multi-tenant time-series data

## 2. Tenant Identification and Routing

### Multi-Layer Tenant Resolution

1. **WhatsApp Phone Number Mapping**
   ```javascript
   // Tenant resolution from WhatsApp webhook
   async function resolveTenant(phoneNumber) {
     // Check cache first
     const cached = await redis.get(`tenant:phone:${phoneNumber}`);
     if (cached) return JSON.parse(cached);
     
     // Database lookup with fallback
     const tenant = await db.query(`
       SELECT t.id, t.schema_name, t.database_shard 
       FROM tenants t
       JOIN tenant_phone_mappings tpm ON t.id = tpm.tenant_id
       WHERE tpm.phone_number = $1
     `, [phoneNumber]);
     
     // Cache for 1 hour
     await redis.setex(`tenant:phone:${phoneNumber}`, 3600, JSON.stringify(tenant));
     return tenant;
   }
   ```

2. **API Gateway Routing**
   - Use AWS API Gateway with Lambda authorizers
   - Route based on JWT claims containing tenant context
   - Implement circuit breakers for tenant-specific rate limiting

3. **Database Connection Routing**
   ```javascript
   class TenantAwareDataSource {
     constructor() {
       this.pools = new Map();
     }
     
     async getConnection(tenantId) {
       const tenant = await getTenantConfig(tenantId);
       const poolKey = `${tenant.database_shard}:${tenant.schema_name}`;
       
       if (!this.pools.has(poolKey)) {
         this.pools.set(poolKey, new Pool({
           host: tenant.database_shard,
           database: 'wakala_db',
           schema: tenant.schema_name,
           max: 20,
           idleTimeoutMillis: 30000
         }));
       }
       
       return this.pools.get(poolKey);
     }
   }
   ```

## 3. Security and Isolation Architecture

### Multi-Layer Security Model

1. **Data Isolation**
   - PostgreSQL RLS policies enforcing tenant boundaries
   - Encrypted tenant data at rest using AWS KMS
   - Separate encryption keys per tenant tier

2. **Application Security**
   ```javascript
   // Middleware for tenant context injection
   async function tenantIsolationMiddleware(req, res, next) {
     const tenantId = req.headers['x-tenant-id'];
     
     // Validate tenant access
     if (!await validateTenantAccess(tenantId, req.user)) {
       return res.status(403).json({ error: 'Tenant access denied' });
     }
     
     // Set tenant context for entire request lifecycle
     AsyncLocalStorage.run({ tenantId }, () => {
       // Apply RLS policy
       req.db = req.db.withSchema(`tenant_${tenantId}`);
       next();
     });
   }
   ```

3. **RBAC Implementation**
   ```yaml
   # Tenant-specific roles
   roles:
     vendor:
       permissions:
         - products:create
         - products:update:own
         - orders:view:own
     
     customer:
       permissions:
         - products:view
         - orders:create
         - orders:view:own
     
     driver:
       permissions:
         - deliveries:view:assigned
         - deliveries:update:assigned
     
     admin:
       permissions:
         - '*:*'  # Full tenant access
   ```

### POPIA Compliance Framework

1. **Data Residency**
   - All tenant data stored in South African AWS regions (af-south-1)
   - Backup replication within country borders only

2. **Consent Management**
   ```javascript
   // POPIA consent tracking
   const ConsentSchema = {
     tenant_id: UUID,
     user_id: UUID,
     purpose: String, // 'marketing', 'analytics', 'payments'
     granted_at: Date,
     expires_at: Date,
     ip_address: String,
     consent_text: String
   };
   ```

3. **Data Access Auditing**
   - Log all cross-tenant access attempts
   - Quarterly access reviews per POPIA requirements
   - Automated data retention policies

## 4. Scalability Architecture

### Cell-Based Geographic Distribution

1. **Regional Cells**
   ```yaml
   cells:
     cape_town:
       regions: [mitchells_plain, khayelitsha, gugulethu]
       database: rds-ct-primary
       cache: redis-ct-cluster
       
     johannesburg:
       regions: [soweto, alexandra, tembisa]
       database: rds-jhb-primary
       cache: redis-jhb-cluster
   ```

2. **Auto-Scaling Strategy**
   - **Horizontal Pod Autoscaling** for Kubernetes workloads
   - **Database read replicas** per geographic cell
   - **Tenant-aware load balancing** to prevent noisy neighbors

3. **Resource Allocation**
   ```javascript
   // Fair usage enforcement
   class TenantResourceGovernor {
     async enforceQuota(tenantId, resourceType) {
       const usage = await this.getCurrentUsage(tenantId, resourceType);
       const quota = await this.getTenantQuota(tenantId, resourceType);
       
       if (usage >= quota.soft_limit) {
         await this.notifyTenant(tenantId, 'approaching_limit');
       }
       
       if (usage >= quota.hard_limit) {
         throw new QuotaExceededException();
       }
     }
   }
   ```

## 5. South African Market Optimizations

### Payment Gateway Integration

1. **Multi-Gateway Strategy**
   ```javascript
   class PaymentOrchestrator {
     constructor() {
       this.gateways = {
         paystack: new PaystackGateway(),
         ozow: new OzowGateway()
       };
     }
     
     async processPayment(tenant, amount, method) {
       // Route based on tenant preference and method
       if (method === 'instant_eft') {
         return this.gateways.ozow.process(tenant, amount);
       } else if (method === 'card' || method === 'crypto') {
         return this.gateways.paystack.process(tenant, amount);
       }
       
       // Fallback logic
       return this.selectOptimalGateway(tenant, amount, method);
     }
   }
   ```

2. **Offline Capability Architecture**
   - **Queue-based transaction processing** for intermittent connectivity
   - **Local SQLite cache** on mobile devices
   - **Conflict resolution** using CRDTs (Conflict-free Replicated Data Types)

3. **Mobile-First Optimizations**
   ```javascript
   // USSD fallback for feature phones
   class USSDGateway {
     async handleSession(sessionId, phoneNumber, input) {
       const tenant = await resolveTenant(phoneNumber);
       const context = await this.getSessionContext(sessionId);
       
       // Simplified menu navigation
       if (!context.state) {
         return this.renderMainMenu(tenant);
       }
       
       // State machine for USSD flows
       return this.processState(tenant, context, input);
     }
   }
   ```

### Township-Specific Features

1. **Data Optimization**
   - Compress API responses using Brotli
   - Image optimization with WebP format
   - Progressive data loading for slow connections

2. **Language Support**
   ```javascript
   const SUPPORTED_LANGUAGES = {
     'en': 'English',
     'zu': 'isiZulu',
     'xh': 'isiXhosa',
     'af': 'Afrikaans',
     'st': 'Sesotho'
   };
   
   // Dynamic translation loading
   async function getTranslation(tenantId, languageCode, key) {
     const cacheKey = `trans:${tenantId}:${languageCode}:${key}`;
     return await redis.get(cacheKey) || 
            await loadTranslation(tenantId, languageCode, key);
   }
   ```

## 6. Technology Stack Recommendations

### Core Infrastructure
- **Container Orchestration**: Kubernetes (EKS) with Istio service mesh
- **API Gateway**: Kong or AWS API Gateway
- **Message Queue**: RabbitMQ with tenant-specific vhosts
- **Workflow Engine**: Temporal for long-running tenant processes

### Application Layer
- **Backend Framework**: Node.js with Fastify (performance-optimized)
- **GraphQL Layer**: Apollo Server with DataLoader for N+1 prevention
- **Real-time**: Socket.io with Redis adapter for multi-tenant rooms

### Data Layer
- **Primary Database**: PostgreSQL 15 with Citus extension for sharding
- **Cache**: Redis Cluster with tenant namespacing
- **Search**: Elasticsearch with tenant-specific indices
- **Object Storage**: MinIO for tenant file isolation

### Monitoring and Observability
- **APM**: Datadog with tenant-aware tagging
- **Logging**: ELK stack with tenant field indexing
- **Metrics**: Prometheus with Grafana dashboards per tenant

## 7. Migration and Onboarding Strategy

### Automated Tenant Provisioning
```javascript
class TenantProvisioner {
  async createTenant(tenantConfig) {
    // 1. Create database schema
    await this.createDatabaseSchema(tenantConfig.id);
    
    // 2. Initialize base data
    await this.seedTenantData(tenantConfig);
    
    // 3. Configure payment gateways
    await this.setupPaymentGateways(tenantConfig);
    
    // 4. Create WhatsApp webhook
    await this.registerWhatsAppWebhook(tenantConfig);
    
    // 5. Initialize monitoring
    await this.setupMonitoring(tenantConfig);
    
    return {
      tenantId: tenantConfig.id,
      apiKey: await this.generateApiKey(tenantConfig.id),
      webhookUrl: `https://api.wakala.os/webhooks/${tenantConfig.id}`
    };
  }
}
```

### Progressive Tenant Scaling
1. Start on shared infrastructure (schema isolation)
2. Monitor usage patterns and performance metrics
3. Automatically migrate to dedicated resources at thresholds
4. Zero-downtime migration using blue-green deployments

## 8. Disaster Recovery and Business Continuity

### Multi-Region Failover
- Active-passive setup across Cape Town and Johannesburg
- RPO: 15 minutes, RTO: 1 hour
- Automated failover using Route 53 health checks

### Backup Strategy
- Continuous replication to secondary region
- Daily snapshots retained for 30 days
- Point-in-time recovery for all tenant data

## 9. Cost Optimization

### Tenant Tier Pricing Model
```javascript
const TENANT_TIERS = {
  basic: {
    monthly_fee: 0, // Free tier
    transaction_fee: 0.029, // 2.9%
    api_calls: 10000,
    storage_gb: 1
  },
  premium: {
    monthly_fee: 499, // R499/month
    transaction_fee: 0.019, // 1.9%
    api_calls: 100000,
    storage_gb: 10
  },
  enterprise: {
    monthly_fee: 'custom',
    transaction_fee: 0.009, // 0.9%
    api_calls: 'unlimited',
    storage_gb: 'unlimited'
  }
};
```

### Resource Optimization
- Spot instances for non-critical workloads
- Reserved instances for database tier
- Automatic scaling down during off-peak hours

## 10. Implementation Roadmap

### Phase 1: Foundation (Months 1-3)
- Set up core infrastructure with schema isolation
- Implement basic tenant provisioning
- Integrate Paystack and Ozow gateways
- Deploy to single region (Cape Town)

### Phase 2: Scale (Months 4-6)
- Add cell-based architecture
- Implement automated scaling policies
- Add offline capabilities
- Expand to Johannesburg region

### Phase 3: Optimize (Months 7-9)
- Implement advanced monitoring
- Add USSD support
- Optimize for low-bandwidth scenarios
- Introduce enterprise tier features

### Phase 4: Expand (Months 10-12)
- Multi-language support
- Advanced analytics dashboard
- API marketplace for third-party integrations
- Cross-border payment support

## Conclusion

This architecture provides Wakala OS with a robust foundation for serving township entrepreneurs while maintaining the flexibility to scale with growing businesses. The hybrid approach to multi-tenancy, combined with South African market optimizations, positions the platform to bridge the digital divide effectively while ensuring security, compliance, and performance at scale.