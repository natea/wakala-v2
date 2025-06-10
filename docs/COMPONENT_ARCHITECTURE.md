# Component Architecture Design

## Executive Summary

This document provides detailed architectural designs for each microservice in the Wakala OS platform. Each component is designed following Domain-Driven Design (DDD) principles with clear boundaries, layered architecture, and well-defined interfaces.

## 1. API Gateway Architecture

### 1.1 Overview
The API Gateway serves as the single entry point for all client requests, handling routing, authentication, rate limiting, and protocol translation.

### 1.2 Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│                   Client Layer                       │
│          (Mobile, Web, WhatsApp, USSD)              │
└─────────────────────────┬───────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────┐
│                  Kong Gateway                        │
├─────────────────────────────────────────────────────┤
│  Request Pipeline                                    │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │
│  │  CORS  │→│  Auth  │→│  Rate  │→│Transform│      │
│  │        │ │ (JWT)  │ │ Limit  │ │         │      │
│  └────────┘ └────────┘ └────────┘ └────────┘      │
├─────────────────────────────────────────────────────┤
│  Routing Layer                                       │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────┐  │
│  │   Service   │ │   Load      │ │   Circuit    │  │
│  │  Discovery  │ │  Balancer   │ │   Breaker    │  │
│  └─────────────┘ └─────────────┘ └──────────────┘  │
├─────────────────────────────────────────────────────┤
│  Response Pipeline                                   │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │
│  │ Cache  │←│Compress│←│Transform│←│ Logging│      │
│  │        │ │        │ │         │ │         │      │
│  └────────┘ └────────┘ └────────┘ └────────┘      │
└─────────────────────────────────────────────────────┘
```

### 1.3 Core Components

#### 1.3.1 Authentication Module
```typescript
class AuthenticationModule {
  private jwtVerifier: JWTVerifier;
  private tenantResolver: TenantResolver;
  
  async authenticate(request: Request): Promise<AuthContext> {
    // Extract token from header
    const token = this.extractToken(request);
    
    // Verify JWT signature and claims
    const claims = await this.jwtVerifier.verify(token);
    
    // Resolve tenant context
    const tenant = await this.tenantResolver.resolve(claims.tenant_id);
    
    // Build auth context
    return {
      user_id: claims.sub,
      tenant_id: claims.tenant_id,
      roles: claims.roles,
      permissions: claims.permissions,
      tenant_tier: tenant.tier
    };
  }
  
  private extractToken(request: Request): string {
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    return authHeader.substring(7);
  }
}
```

#### 1.3.2 Rate Limiting Module
```typescript
class RateLimitingModule {
  private redis: RedisClient;
  
  async checkLimit(tenantId: string, endpoint: string): Promise<RateLimitResult> {
    const key = `rate_limit:${tenantId}:${endpoint}`;
    const window = this.getWindow();
    
    // Sliding window rate limiting
    const pipeline = this.redis.pipeline();
    pipeline.zadd(key, window, uuid());
    pipeline.zremrangebyscore(key, 0, window - 60000); // 1 minute window
    pipeline.zcard(key);
    pipeline.expire(key, 120);
    
    const results = await pipeline.exec();
    const count = results[2][1];
    
    const limit = this.getLimit(tenantId, endpoint);
    
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      reset: window + 60000
    };
  }
  
  private getLimit(tenantId: string, endpoint: string): number {
    // Tier-based limits
    const tier = this.getTenantTier(tenantId);
    const limits = {
      basic: { default: 100, webhook: 1000 },
      premium: { default: 1000, webhook: 10000 },
      enterprise: { default: 10000, webhook: 100000 }
    };
    
    return limits[tier][endpoint] || limits[tier].default;
  }
}
```

#### 1.3.3 Request Router
```typescript
class RequestRouter {
  private serviceRegistry: ServiceRegistry;
  private loadBalancer: LoadBalancer;
  
  async route(request: Request): Promise<ServiceEndpoint> {
    // Parse request path
    const { service, resource, method } = this.parseRequest(request);
    
    // Get available instances
    const instances = await this.serviceRegistry.getHealthyInstances(service);
    
    if (instances.length === 0) {
      throw new ServiceUnavailableException(`No healthy instances of ${service}`);
    }
    
    // Select instance using load balancing
    const instance = this.loadBalancer.select(instances, {
      method: 'least_connections',
      sticky_session: request.headers['x-session-id']
    });
    
    return {
      host: instance.host,
      port: instance.port,
      path: `/${resource}`,
      method: method
    };
  }
}
```

### 1.4 Configuration

```yaml
kong:
  database: postgres
  pg_host: ${KONG_PG_HOST}
  pg_database: kong
  
  plugins:
    - name: jwt
      config:
        key_claim_name: kid
        secret_is_base64: true
        claims_to_verify: ["exp", "tenant_id"]
    
    - name: rate-limiting-advanced
      config:
        limit: 100
        window_size: 60
        strategy: sliding
        sync_rate: 0.1
    
    - name: correlation-id
      config:
        header_name: X-Correlation-ID
        generator: uuid
        echo_downstream: true
    
    - name: prometheus
      config:
        per_consumer: true
        status_code_metrics: true
        latency_metrics: true
        upstream_health_metrics: true
```

## 2. WhatsApp Service Architecture

### 2.1 Overview
Handles all WhatsApp Business API interactions, message processing, and webhook management with real-time message handling capabilities.

### 2.2 Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│              Webhook Handler Layer                   │
│         (HMAC Verification, Rate Limiting)          │
└─────────────────────────┬───────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────┐
│             Message Processing Layer                 │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Message    │  │   Message    │  │  Message │  │
│  │   Parser     │  │  Validator   │  │  Router  │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────┤
│           Conversation Management Layer              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Session    │  │    State     │  │  Context │  │
│  │   Manager    │  │   Machine    │  │  Store   │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────┤
│              Integration Layer                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │  WhatsApp    │  │   Message    │  │  Event   │  │
│  │  Cloud API   │  │    Queue     │  │Publisher │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────┘
```

### 2.3 Core Components

#### 2.3.1 Webhook Handler
```typescript
class WebhookHandler {
  private hmacValidator: HMACValidator;
  private messageQueue: MessageQueue;
  private deduplicator: MessageDeduplicator;
  
  async handleWebhook(request: WebhookRequest): Promise<void> {
    // Verify webhook signature
    const signature = request.headers['x-hub-signature-256'];
    if (!this.hmacValidator.verify(request.body, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    
    // Parse webhook payload
    const webhook = JSON.parse(request.body);
    
    // Process each entry
    for (const entry of webhook.entry) {
      for (const change of entry.changes) {
        if (change.field === 'messages') {
          await this.processMessages(change.value);
        }
      }
    }
    
    // Return immediately (3-second SLA)
    return;
  }
  
  private async processMessages(value: any): Promise<void> {
    const messages = value.messages || [];
    
    for (const message of messages) {
      // Check for duplicates
      if (await this.deduplicator.isDuplicate(message.id)) {
        continue;
      }
      
      // Queue for async processing
      await this.messageQueue.publish('whatsapp.inbound', {
        message: message,
        metadata: value.metadata,
        timestamp: Date.now()
      });
      
      // Mark as processed
      await this.deduplicator.markProcessed(message.id);
    }
  }
}
```

#### 2.3.2 Message Processor
```typescript
class MessageProcessor {
  private nlpService: NLPService;
  private sessionManager: SessionManager;
  private stateEngine: ConversationStateEngine;
  
  async processMessage(event: MessageEvent): Promise<void> {
    const { message, metadata } = event;
    
    // Get or create session
    const session = await this.sessionManager.getOrCreate(message.from);
    
    // Extract tenant context
    const tenant = await this.resolveTenant(message.from);
    
    // Process based on message type
    let processedMessage: ProcessedMessage;
    
    switch (message.type) {
      case 'text':
        processedMessage = await this.processTextMessage(message, tenant);
        break;
      case 'interactive':
        processedMessage = await this.processInteractiveMessage(message, tenant);
        break;
      case 'image':
        processedMessage = await this.processImageMessage(message, tenant);
        break;
      case 'location':
        processedMessage = await this.processLocationMessage(message, tenant);
        break;
      default:
        throw new UnsupportedMessageTypeException(message.type);
    }
    
    // Update conversation state
    const newState = await this.stateEngine.transition(
      session.currentState,
      processedMessage,
      session.context
    );
    
    // Update session
    await this.sessionManager.update(session.id, {
      currentState: newState,
      lastMessageAt: Date.now(),
      context: processedMessage.context
    });
    
    // Generate response
    const response = await this.generateResponse(newState, processedMessage);
    
    // Send response
    await this.sendMessage(message.from, response);
  }
  
  private async processTextMessage(
    message: any,
    tenant: Tenant
  ): Promise<ProcessedMessage> {
    // NLP processing
    const nlpResult = await this.nlpService.analyze(message.text.body, {
      language: tenant.default_language,
      context: 'commerce'
    });
    
    return {
      type: 'text',
      content: message.text.body,
      intent: nlpResult.intent,
      entities: nlpResult.entities,
      sentiment: nlpResult.sentiment,
      context: {
        tenant_id: tenant.id,
        user_phone: message.from
      }
    };
  }
}
```

#### 2.3.3 Conversation State Engine
```typescript
class ConversationStateEngine {
  private states: Map<string, StateHandler>;
  private transitions: Map<string, Transition[]>;
  
  async transition(
    currentState: string,
    message: ProcessedMessage,
    context: ConversationContext
  ): Promise<string> {
    // Get valid transitions from current state
    const possibleTransitions = this.transitions.get(currentState) || [];
    
    // Evaluate transition conditions
    for (const transition of possibleTransitions) {
      if (await transition.condition(message, context)) {
        // Execute transition actions
        await transition.action(message, context);
        
        // Return new state
        return transition.targetState;
      }
    }
    
    // No valid transition, stay in current state
    return currentState;
  }
  
  registerState(name: string, handler: StateHandler): void {
    this.states.set(name, handler);
  }
  
  registerTransition(
    fromState: string,
    toState: string,
    condition: TransitionCondition,
    action?: TransitionAction
  ): void {
    const transition = {
      targetState: toState,
      condition: condition,
      action: action || (() => Promise.resolve())
    };
    
    const transitions = this.transitions.get(fromState) || [];
    transitions.push(transition);
    this.transitions.set(fromState, transitions);
  }
}
```

### 2.4 Message Templates

```yaml
message_templates:
  greeting:
    - language: en
      text: "Welcome to {{business_name}}! How can I help you today?"
      buttons:
        - id: browse_products
          title: "Browse Products"
        - id: track_order
          title: "Track Order"
        - id: contact_support
          title: "Support"
    
    - language: zu
      text: "Siyakwamukela ku-{{business_name}}! Ngingakusiza kanjani namuhla?"
      buttons:
        - id: browse_products
          title: "Bheka Imikhiqizo"
        - id: track_order
          title: "Landelela I-oda"
        - id: contact_support
          title: "Ukwesekwa"
  
  product_list:
    type: list
    header: "Available Products"
    body: "Select a product to view details"
    sections:
      - title: "{{category_name}}"
        rows:
          - id: "{{product_id}}"
            title: "{{product_name}}"
            description: "R{{product_price}} - {{product_description}}"
```

## 3. Orchestration Engine Architecture

### 3.1 Overview
Manages complex business workflows, coordinates multi-service operations, and implements saga patterns for distributed transactions.

### 3.2 Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│              Workflow Definition Layer               │
│            (BPMN, State Machines, DSL)              │
└─────────────────────────┬───────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────┐
│             Workflow Execution Layer                 │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Workflow   │  │    Task      │  │  Timer   │  │
│  │   Engine     │  │  Executor    │  │  Service │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────┤
│               Saga Management Layer                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │     Saga     │  │ Compensation │  │  State   │  │
│  │ Coordinator  │  │   Manager    │  │  Store   │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────┤
│              Integration Layer                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Service    │  │    Event     │  │  Metrics │  │
│  │   Invoker    │  │   Publisher  │  │Collector │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────┘
```

### 3.3 Core Components

#### 3.3.1 Workflow Engine
```typescript
class WorkflowEngine {
  private workflowRepository: WorkflowRepository;
  private taskExecutor: TaskExecutor;
  private stateManager: WorkflowStateManager;
  
  async startWorkflow(
    workflowId: string,
    input: any,
    context: WorkflowContext
  ): Promise<WorkflowInstance> {
    // Load workflow definition
    const definition = await this.workflowRepository.getDefinition(workflowId);
    
    // Create workflow instance
    const instance = {
      id: uuid(),
      workflow_id: workflowId,
      state: 'started',
      context: {
        ...context,
        input: input,
        variables: {}
      },
      created_at: Date.now()
    };
    
    // Save initial state
    await this.stateManager.saveState(instance);
    
    // Start execution
    this.executeWorkflow(instance, definition);
    
    return instance;
  }
  
  private async executeWorkflow(
    instance: WorkflowInstance,
    definition: WorkflowDefinition
  ): Promise<void> {
    let currentNode = definition.startNode;
    
    while (currentNode && currentNode.type !== 'end') {
      try {
        // Execute current node
        const result = await this.executeNode(currentNode, instance);
        
        // Update instance state
        instance.context.variables = {
          ...instance.context.variables,
          ...result.outputs
        };
        
        // Determine next node
        currentNode = this.determineNextNode(currentNode, result, definition);
        
        // Save checkpoint
        await this.stateManager.saveCheckpoint(instance, currentNode.id);
        
      } catch (error) {
        // Handle failure
        await this.handleNodeFailure(instance, currentNode, error);
        break;
      }
    }
    
    // Complete workflow
    await this.completeWorkflow(instance);
  }
  
  private async executeNode(
    node: WorkflowNode,
    instance: WorkflowInstance
  ): Promise<NodeExecutionResult> {
    switch (node.type) {
      case 'service':
        return await this.taskExecutor.executeServiceTask(node, instance);
      
      case 'script':
        return await this.taskExecutor.executeScriptTask(node, instance);
      
      case 'human':
        return await this.taskExecutor.executeHumanTask(node, instance);
      
      case 'gateway':
        return await this.evaluateGateway(node, instance);
      
      default:
        throw new UnsupportedNodeTypeException(node.type);
    }
  }
}
```

#### 3.3.2 Saga Coordinator
```typescript
class SagaCoordinator {
  private sagaDefinitions: Map<string, SagaDefinition>;
  private sagaLog: SagaLog;
  private compensationManager: CompensationManager;
  
  async executeSaga(
    sagaType: string,
    input: any,
    context: SagaContext
  ): Promise<SagaResult> {
    const definition = this.sagaDefinitions.get(sagaType);
    if (!definition) {
      throw new SagaNotFoundException(sagaType);
    }
    
    const sagaId = uuid();
    const saga = {
      id: sagaId,
      type: sagaType,
      state: 'running',
      steps: [],
      context: context
    };
    
    // Execute saga steps
    for (const step of definition.steps) {
      try {
        // Log step start
        await this.sagaLog.logStepStart(sagaId, step.name);
        
        // Execute step
        const result = await this.executeStep(step, input, context);
        
        // Log step completion
        await this.sagaLog.logStepComplete(sagaId, step.name, result);
        
        // Update saga state
        saga.steps.push({
          name: step.name,
          status: 'completed',
          result: result
        });
        
        // Use step output as next step input
        input = result;
        
      } catch (error) {
        // Log step failure
        await this.sagaLog.logStepFailed(sagaId, step.name, error);
        
        // Start compensation
        await this.compensate(saga, step, error);
        
        return {
          success: false,
          saga_id: sagaId,
          error: error.message,
          compensated: true
        };
      }
    }
    
    // Saga completed successfully
    saga.state = 'completed';
    await this.sagaLog.logSagaComplete(sagaId);
    
    return {
      success: true,
      saga_id: sagaId,
      result: input
    };
  }
  
  private async compensate(
    saga: Saga,
    failedStep: SagaStep,
    error: Error
  ): Promise<void> {
    // Get completed steps in reverse order
    const stepsToCompensate = saga.steps
      .filter(s => s.status === 'completed')
      .reverse();
    
    for (const step of stepsToCompensate) {
      const stepDefinition = this.findStepDefinition(saga.type, step.name);
      
      if (stepDefinition.compensation) {
        try {
          await this.compensationManager.compensate(
            stepDefinition.compensation,
            step.result,
            saga.context
          );
          
          await this.sagaLog.logCompensation(saga.id, step.name, 'success');
        } catch (compensationError) {
          await this.sagaLog.logCompensation(
            saga.id,
            step.name,
            'failed',
            compensationError
          );
          
          // Continue with other compensations
        }
      }
    }
  }
}
```

### 3.4 Workflow Definitions

```yaml
workflows:
  order_processing:
    name: "Order Processing Workflow"
    version: "1.0"
    
    nodes:
      - id: start
        type: start
        
      - id: validate_order
        type: service
        service: order-service
        operation: validateOrder
        
      - id: check_inventory
        type: service
        service: inventory-service
        operation: checkAvailability
        
      - id: inventory_decision
        type: gateway
        gateway_type: exclusive
        
      - id: reserve_inventory
        type: service
        service: inventory-service
        operation: reserveItems
        
      - id: process_payment
        type: service
        service: payment-service
        operation: processPayment
        timeout: 30s
        
      - id: payment_decision
        type: gateway
        gateway_type: exclusive
        
      - id: confirm_order
        type: service
        service: order-service
        operation: confirmOrder
        
      - id: schedule_delivery
        type: service
        service: delivery-service
        operation: scheduleDelivery
        
      - id: notify_customer
        type: service
        service: notification-service
        operation: sendOrderConfirmation
        
      - id: cancel_order
        type: service
        service: order-service
        operation: cancelOrder
        
      - id: end_success
        type: end
        
      - id: end_cancelled
        type: end
    
    edges:
      - from: start
        to: validate_order
      - from: validate_order
        to: check_inventory
      - from: check_inventory
        to: inventory_decision
      - from: inventory_decision
        to: reserve_inventory
        condition: "${inventory.available == true}"
      - from: inventory_decision
        to: cancel_order
        condition: "${inventory.available == false}"
      - from: reserve_inventory
        to: process_payment
      - from: process_payment
        to: payment_decision
      - from: payment_decision
        to: confirm_order
        condition: "${payment.success == true}"
      - from: payment_decision
        to: cancel_order
        condition: "${payment.success == false}"
      - from: confirm_order
        to: schedule_delivery
      - from: schedule_delivery
        to: notify_customer
      - from: notify_customer
        to: end_success
      - from: cancel_order
        to: end_cancelled
```

## 4. Multi-tenant Service Architecture

### 4.1 Overview
Manages tenant isolation, provisioning, and configuration with support for multiple isolation levels and dynamic scaling.

### 4.2 Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│              Tenant API Layer                        │
│        (REST API, GraphQL, Admin Portal)            │
└─────────────────────────┬───────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────┐
│           Tenant Management Layer                    │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Tenant     │  │  Provisioning│  │  Billing │  │
│  │  Registry    │  │   Engine     │  │  Manager │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────┤
│            Isolation Layer                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Schema     │  │   Resource   │  │  Access  │  │
│  │   Manager    │  │   Governor   │  │  Control │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────┤
│           Data Layer                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Sharding   │  │     RLS      │  │  Cache   │  │
│  │   Manager    │  │   Policies   │  │ Isolation│  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────┘
```

### 4.3 Core Components

#### 4.3.1 Tenant Registry
```typescript
class TenantRegistry {
  private cache: TenantCache;
  private database: Database;
  private eventBus: EventBus;
  
  async createTenant(request: CreateTenantRequest): Promise<Tenant> {
    // Validate tenant data
    this.validateTenantData(request);
    
    // Check for duplicates
    const existing = await this.findByDomain(request.domain);
    if (existing) {
      throw new TenantAlreadyExistsException(request.domain);
    }
    
    // Generate tenant ID
    const tenantId = this.generateTenantId(request.name);
    
    // Determine shard
    const shardId = this.calculateShard(tenantId);
    
    // Create tenant record
    const tenant: Tenant = {
      id: tenantId,
      name: request.name,
      domain: request.domain,
      tier: request.tier || 'basic',
      shard_id: shardId,
      schema_name: `tenant_${tenantId}`,
      status: 'provisioning',
      created_at: Date.now(),
      settings: {
        timezone: request.timezone || 'Africa/Johannesburg',
        currency: request.currency || 'ZAR',
        language: request.language || 'en'
      }
    };
    
    // Save to database
    await this.database.insert('tenants', tenant);
    
    // Cache tenant
    await this.cache.set(tenantId, tenant);
    
    // Emit creation event
    await this.eventBus.emit('tenant.created', {
      tenant_id: tenantId,
      tenant: tenant
    });
    
    return tenant;
  }
  
  async getTenant(tenantId: string): Promise<Tenant> {
    // Check cache first
    let tenant = await this.cache.get(tenantId);
    
    if (!tenant) {
      // Load from database
      tenant = await this.database.findOne('tenants', { id: tenantId });
      
      if (!tenant) {
        throw new TenantNotFoundException(tenantId);
      }
      
      // Update cache
      await this.cache.set(tenantId, tenant);
    }
    
    // Check if tenant is active
    if (tenant.status !== 'active') {
      throw new TenantNotActiveException(tenantId);
    }
    
    return tenant;
  }
  
  private calculateShard(tenantId: string): number {
    // Consistent hashing for shard assignment
    const hash = crypto.createHash('md5').update(tenantId).digest();
    const shardCount = parseInt(process.env.SHARD_COUNT || '32');
    return hash.readUInt32BE(0) % shardCount;
  }
}
```

#### 4.3.2 Provisioning Engine
```typescript
class ProvisioningEngine {
  private schemaManager: SchemaManager;
  private resourceManager: ResourceManager;
  private configManager: ConfigurationManager;
  
  async provisionTenant(tenant: Tenant): Promise<void> {
    const steps = [
      this.createDatabaseSchema.bind(this),
      this.applyMigrations.bind(this),
      this.setupRLSPolicies.bind(this),
      this.createDefaultData.bind(this),
      this.allocateResources.bind(this),
      this.configureServices.bind(this),
      this.setupMonitoring.bind(this)
    ];
    
    for (const step of steps) {
      try {
        await step(tenant);
      } catch (error) {
        // Rollback on failure
        await this.rollbackProvisioning(tenant, steps.indexOf(step));
        throw error;
      }
    }
    
    // Update tenant status
    await this.updateTenantStatus(tenant.id, 'active');
  }
  
  private async createDatabaseSchema(tenant: Tenant): Promise<void> {
    const connection = await this.getShardConnection(tenant.shard_id);
    
    // Create schema
    await connection.query(`CREATE SCHEMA IF NOT EXISTS ${tenant.schema_name}`);
    
    // Grant permissions
    await connection.query(`
      GRANT ALL ON SCHEMA ${tenant.schema_name} TO tenant_user;
      ALTER DEFAULT PRIVILEGES IN SCHEMA ${tenant.schema_name}
      GRANT ALL ON TABLES TO tenant_user;
    `);
  }
  
  private async setupRLSPolicies(tenant: Tenant): Promise<void> {
    const connection = await this.getShardConnection(tenant.shard_id);
    
    // Enable RLS on all tables
    const tables = await this.schemaManager.getTables(tenant.schema_name);
    
    for (const table of tables) {
      await connection.query(`
        ALTER TABLE ${tenant.schema_name}.${table} ENABLE ROW LEVEL SECURITY;
        
        CREATE POLICY tenant_isolation ON ${tenant.schema_name}.${table}
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant')::uuid);
      `);
    }
  }
  
  private async allocateResources(tenant: Tenant): Promise<void> {
    const tier = this.getTierConfig(tenant.tier);
    
    // Allocate compute resources
    await this.resourceManager.allocate({
      tenant_id: tenant.id,
      cpu_shares: tier.cpu_shares,
      memory_limit: tier.memory_limit,
      storage_quota: tier.storage_quota,
      api_rate_limit: tier.api_rate_limit
    });
    
    // Create Kubernetes namespace
    await this.createKubernetesNamespace(tenant);
    
    // Apply resource quotas
    await this.applyResourceQuotas(tenant, tier);
  }
}
```

#### 4.3.3 Resource Governor
```typescript
class ResourceGovernor {
  private metrics: MetricsCollector;
  private limiter: RateLimiter;
  
  async enforceQuotas(tenantId: string, resourceType: string): Promise<void> {
    const usage = await this.getCurrentUsage(tenantId, resourceType);
    const quota = await this.getQuota(tenantId, resourceType);
    
    // Check soft limit
    if (usage >= quota.soft_limit) {
      await this.notifyApproachingLimit(tenantId, resourceType, usage, quota);
    }
    
    // Enforce hard limit
    if (usage >= quota.hard_limit) {
      throw new QuotaExceededException(
        `${resourceType} quota exceeded for tenant ${tenantId}`
      );
    }
    
    // Update metrics
    await this.metrics.record({
      tenant_id: tenantId,
      resource_type: resourceType,
      usage: usage,
      quota: quota.hard_limit,
      utilization: usage / quota.hard_limit
    });
  }
  
  async trackUsage(
    tenantId: string,
    resourceType: string,
    amount: number
  ): Promise<void> {
    const key = `usage:${tenantId}:${resourceType}`;
    const window = this.getWindow();
    
    // Sliding window tracking
    await this.redis.zadd(key, window, `${window}:${amount}`);
    await this.redis.zremrangebyscore(key, 0, window - 3600000); // 1 hour window
    await this.redis.expire(key, 7200); // 2 hour expiry
  }
  
  private async getCurrentUsage(
    tenantId: string,
    resourceType: string
  ): Promise<number> {
    const key = `usage:${tenantId}:${resourceType}`;
    const window = this.getWindow();
    const hourAgo = window - 3600000;
    
    const entries = await this.redis.zrangebyscore(key, hourAgo, window);
    
    return entries.reduce((total, entry) => {
      const [, amount] = entry.split(':');
      return total + parseFloat(amount);
    }, 0);
  }
}
```

### 4.4 Tenant Configuration

```yaml
tenant_tiers:
  basic:
    monthly_cost: 0
    limits:
      api_calls_per_hour: 1000
      storage_gb: 5
      concurrent_users: 10
      products: 100
      orders_per_month: 500
    features:
      - basic_analytics
      - email_support
    
  premium:
    monthly_cost: 499
    limits:
      api_calls_per_hour: 10000
      storage_gb: 50
      concurrent_users: 100
      products: 1000
      orders_per_month: 5000
    features:
      - advanced_analytics
      - priority_support
      - custom_branding
      - api_access
    
  enterprise:
    monthly_cost: custom
    limits:
      api_calls_per_hour: unlimited
      storage_gb: unlimited
      concurrent_users: unlimited
      products: unlimited
      orders_per_month: unlimited
    features:
      - all_features
      - dedicated_support
      - custom_integrations
      - sla_guarantee
      - dedicated_infrastructure
```

## 5. Order Service Architecture

### 5.1 Overview
Manages the complete order lifecycle from creation through fulfillment, coordinating with inventory, payment, and delivery services.

### 5.2 Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│               Order API Layer                        │
│          (REST, GraphQL, WebSocket)                 │
└─────────────────────────┬───────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────┐
│            Order Management Layer                    │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │    Order     │  │  Validation  │  │  Pricing │  │
│  │   Creation   │  │   Engine     │  │  Engine  │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────┤
│             Order Processing Layer                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Workflow   │  │   Inventory  │  │  Payment │  │
│  │   Manager    │  │ Coordinator  │  │Processor │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────┤
│            Fulfillment Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Vendor     │  │   Delivery   │  │  Status  │  │
│  │  Assignment  │  │  Scheduling  │  │ Tracking │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────┘
```

### 5.3 Core Components

#### 5.3.1 Order Creation Engine
```typescript
class OrderCreationEngine {
  private validator: OrderValidator;
  private pricingEngine: PricingEngine;
  private inventoryService: InventoryService;
  private eventBus: EventBus;
  
  async createOrder(request: CreateOrderRequest): Promise<Order> {
    // Validate order request
    const validation = await this.validator.validate(request);
    if (!validation.isValid) {
      throw new OrderValidationException(validation.errors);
    }
    
    // Check inventory availability
    const availability = await this.checkInventoryAvailability(request.items);
    if (!availability.allAvailable) {
      throw new InsufficientInventoryException(availability.unavailableItems);
    }
    
    // Calculate pricing
    const pricing = await this.pricingEngine.calculate({
      items: request.items,
      customer: request.customer,
      delivery_address: request.delivery_address,
      promo_codes: request.promo_codes
    });
    
    // Create order
    const order: Order = {
      id: uuid(),
      tenant_id: request.tenant_id,
      customer_id: request.customer_id,
      status: 'pending',
      items: request.items.map(item => ({
        ...item,
        unit_price: pricing.itemPrices[item.product_id],
        total_price: pricing.itemPrices[item.product_id] * item.quantity
      })),
      subtotal: pricing.subtotal,
      tax: pricing.tax,
      delivery_fee: pricing.delivery_fee,
      discount: pricing.discount,
      total: pricing.total,
      delivery_address: request.delivery_address,
      payment_method: request.payment_method,
      created_at: Date.now(),
      metadata: {
        source: request.source || 'whatsapp',
        device_id: request.device_id,
        location: request.location
      }
    };
    
    // Reserve inventory
    const reservations = await this.inventoryService.reserve(
      order.items.map(item => ({
        product_id: item.product_id,
        quantity: item.quantity,
        order_id: order.id
      }))
    );
    
    order.inventory_reservations = reservations;
    
    // Save order
    await this.saveOrder(order);
    
    // Emit order created event
    await this.eventBus.emit('order.created', {
      order_id: order.id,
      tenant_id: order.tenant_id,
      customer_id: order.customer_id,
      total: order.total,
      items: order.items.length
    });
    
    return order;
  }
  
  private async checkInventoryAvailability(
    items: OrderItem[]
  ): Promise<InventoryAvailability> {
    const availabilityChecks = await Promise.all(
      items.map(async item => {
        const available = await this.inventoryService.checkAvailability(
          item.product_id,
          item.quantity
        );
        
        return {
          product_id: item.product_id,
          requested: item.quantity,
          available: available.quantity,
          isAvailable: available.quantity >= item.quantity
        };
      })
    );
    
    return {
      allAvailable: availabilityChecks.every(check => check.isAvailable),
      unavailableItems: availabilityChecks
        .filter(check => !check.isAvailable)
        .map(check => ({
          product_id: check.product_id,
          requested: check.requested,
          available: check.available
        }))
    };
  }
}
```

#### 5.3.2 Order State Machine
```typescript
class OrderStateMachine {
  private states: Map<OrderStatus, StateHandler>;
  private transitions: Map<string, TransitionHandler>;
  
  constructor() {
    this.initializeStates();
    this.initializeTransitions();
  }
  
  async transition(
    order: Order,
    event: OrderEvent
  ): Promise<Order> {
    const currentState = order.status;
    const transitionKey = `${currentState}:${event.type}`;
    
    const transition = this.transitions.get(transitionKey);
    if (!transition) {
      throw new InvalidOrderTransitionException(
        `Cannot transition from ${currentState} with event ${event.type}`
      );
    }
    
    // Validate transition
    if (!await transition.canTransition(order, event)) {
      throw new OrderTransitionNotAllowedException(
        transition.reason || 'Transition conditions not met'
      );
    }
    
    // Execute transition
    const updatedOrder = await transition.execute(order, event);
    
    // Update order status
    updatedOrder.status = transition.targetState;
    updatedOrder.updated_at = Date.now();
    
    // Add to status history
    updatedOrder.status_history = [
      ...(order.status_history || []),
      {
        from: currentState,
        to: transition.targetState,
        event: event.type,
        timestamp: Date.now(),
        actor: event.actor
      }
    ];
    
    return updatedOrder;
  }
  
  private initializeTransitions(): void {
    // Pending -> Confirmed
    this.registerTransition('pending', 'order.confirm', 'confirmed', {
      canTransition: async (order) => {
        return order.payment_status === 'authorized' ||
               order.payment_method === 'cash';
      },
      execute: async (order, event) => {
        // Confirm inventory reservation
        await this.inventoryService.confirmReservation(
          order.inventory_reservations
        );
        
        // Assign to vendor
        const vendor = await this.vendorAssignment.assign(order);
        order.vendor_id = vendor.id;
        
        return order;
      }
    });
    
    // Confirmed -> Processing
    this.registerTransition('confirmed', 'order.start_processing', 'processing', {
      canTransition: async (order) => {
        return !!order.vendor_id;
      },
      execute: async (order, event) => {
        // Notify vendor
        await this.notificationService.notifyVendor(
          order.vendor_id,
          'order.start_preparation',
          order
        );
        
        return order;
      }
    });
    
    // Processing -> Ready
    this.registerTransition('processing', 'order.ready', 'ready_for_pickup', {
      canTransition: async (order) => true,
      execute: async (order, event) => {
        // Schedule delivery
        const delivery = await this.deliveryService.schedule(order);
        order.delivery_id = delivery.id;
        
        return order;
      }
    });
    
    // Ready -> Delivering
    this.registerTransition('ready_for_pickup', 'order.picked_up', 'delivering', {
      canTransition: async (order) => {
        return !!order.delivery_id;
      },
      execute: async (order, event) => {
        // Update delivery status
        await this.deliveryService.updateStatus(
          order.delivery_id,
          'in_transit'
        );
        
        // Capture payment if COD
        if (order.payment_method !== 'cash') {
          await this.paymentService.capture(order.payment_id);
        }
        
        return order;
      }
    });
    
    // Delivering -> Completed
    this.registerTransition('delivering', 'order.delivered', 'completed', {
      canTransition: async (order) => true,
      execute: async (order, event) => {
        // Complete delivery
        await this.deliveryService.complete(order.delivery_id, {
          signature: event.data.signature,
          photo: event.data.photo,
          notes: event.data.notes
        });
        
        // Process COD payment
        if (order.payment_method === 'cash') {
          await this.paymentService.processCOD(order);
        }
        
        // Update inventory
        await this.inventoryService.commitSale(order.items);
        
        return order;
      }
    });
    
    // Any -> Cancelled
    this.registerTransition('*', 'order.cancel', 'cancelled', {
      canTransition: async (order) => {
        return ['pending', 'confirmed', 'processing'].includes(order.status);
      },
      execute: async (order, event) => {
        // Release inventory
        if (order.inventory_reservations) {
          await this.inventoryService.releaseReservation(
            order.inventory_reservations
          );
        }
        
        // Refund payment
        if (order.payment_status === 'captured') {
          await this.paymentService.refund(order.payment_id, {
            reason: event.data.reason,
            amount: order.total
          });
        }
        
        // Cancel delivery
        if (order.delivery_id) {
          await this.deliveryService.cancel(order.delivery_id);
        }
        
        order.cancellation = {
          reason: event.data.reason,
          cancelled_by: event.actor,
          cancelled_at: Date.now()
        };
        
        return order;
      }
    });
  }
}
```

### 5.4 Order Aggregation

```typescript
class OrderAggregator {
  private cache: RedisCache;
  private database: Database;
  
  async getOrderSummary(
    tenantId: string,
    period: TimePeriod
  ): Promise<OrderSummary> {
    const cacheKey = `order_summary:${tenantId}:${period.start}:${period.end}`;
    
    // Check cache
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Aggregate from database
    const summary = await this.database.query(`
      SELECT
        COUNT(*) as total_orders,
        COUNT(DISTINCT customer_id) as unique_customers,
        SUM(total) as total_revenue,
        AVG(total) as average_order_value,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_orders,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
        AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_fulfillment_time
      FROM orders
      WHERE tenant_id = $1
        AND created_at BETWEEN $2 AND $3
    `, [tenantId, period.start, period.end]);
    
    // Get top products
    const topProducts = await this.database.query(`
      SELECT
        oi.product_id,
        p.name,
        COUNT(*) as order_count,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.total_price) as total_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE o.tenant_id = $1
        AND o.created_at BETWEEN $2 AND $3
      GROUP BY oi.product_id, p.name
      ORDER BY total_revenue DESC
      LIMIT 10
    `, [tenantId, period.start, period.end]);
    
    const result = {
      period: period,
      metrics: {
        total_orders: summary.total_orders,
        unique_customers: summary.unique_customers,
        total_revenue: summary.total_revenue,
        average_order_value: summary.average_order_value,
        completed_orders: summary.completed_orders,
        cancelled_orders: summary.cancelled_orders,
        completion_rate: summary.completed_orders / summary.total_orders,
        average_fulfillment_time: summary.avg_fulfillment_time
      },
      top_products: topProducts,
      generated_at: Date.now()
    };
    
    // Cache for 5 minutes
    await this.cache.setex(cacheKey, 300, JSON.stringify(result));
    
    return result;
  }
}
```

## 6. Payment Service Architecture

### 6.1 Overview
Handles payment processing across multiple gateways with support for various payment methods, automatic failover, and reconciliation.

### 6.2 Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│              Payment API Layer                       │
│         (REST API, Webhook Handlers)                │
└─────────────────────────┬───────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────┐
│          Payment Orchestration Layer                 │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Gateway    │  │   Method     │  │  Retry   │  │
│  │   Router     │  │   Selector   │  │ Manager  │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────┤
│           Gateway Integration Layer                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Paystack   │  │     Ozow     │  │  M-Pesa  │  │
│  │   Adapter    │  │   Adapter    │  │ Adapter  │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────┤
│          Transaction Management Layer                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │ Idempotency  │  │ Transaction  │  │Reconcile │  │
│  │   Manager    │  │    Logger    │  │  Engine  │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────┘
```

### 6.3 Core Components

#### 6.3.1 Payment Orchestrator
```typescript
class PaymentOrchestrator {
  private gateways: Map<string, PaymentGateway>;
  private methodRouter: PaymentMethodRouter;
  private idempotencyManager: IdempotencyManager;
  private circuitBreaker: CircuitBreakerManager;
  
  async processPayment(
    request: PaymentRequest
  ): Promise<PaymentResult> {
    // Check idempotency
    const idempotencyKey = this.generateIdempotencyKey(request);
    const existingResult = await this.idempotencyManager.get(idempotencyKey);
    
    if (existingResult) {
      return existingResult;
    }
    
    // Select payment gateway
    const gateway = await this.selectGateway(request);
    
    // Check circuit breaker
    if (this.circuitBreaker.isOpen(gateway.name)) {
      // Try fallback gateway
      const fallback = await this.getFallbackGateway(request);
      if (!fallback) {
        throw new NoAvailableGatewayException();
      }
      gateway = fallback;
    }
    
    try {
      // Prepare gateway-specific request
      const gatewayRequest = await this.prepareGatewayRequest(gateway, request);
      
      // Process payment
      const result = await this.executePayment(gateway, gatewayRequest);
      
      // Store result for idempotency
      await this.idempotencyManager.store(idempotencyKey, result, 86400); // 24 hours
      
      // Record success
      this.circuitBreaker.recordSuccess(gateway.name);
      
      // Emit success event
      await this.eventBus.emit('payment.processed', {
        payment_id: result.payment_id,
        order_id: request.order_id,
        amount: request.amount,
        gateway: gateway.name,
        method: request.method
      });
      
      return result;
      
    } catch (error) {
      // Record failure
      this.circuitBreaker.recordFailure(gateway.name);
      
      // Check if retriable
      if (this.isRetriable(error) && request.retry_count < 3) {
        return this.retryPayment(request, error);
      }
      
      // Emit failure event
      await this.eventBus.emit('payment.failed', {
        order_id: request.order_id,
        error: error.message,
        gateway: gateway.name
      });
      
      throw error;
    }
  }
  
  private async selectGateway(
    request: PaymentRequest
  ): Promise<PaymentGateway> {
    // Get gateways supporting the payment method
    const eligibleGateways = this.getGatewaysForMethod(request.method);
    
    // Score gateways
    const scores = await Promise.all(
      eligibleGateways.map(async gateway => {
        const health = await this.getGatewayHealth(gateway.name);
        const cost = this.calculateGatewayCost(gateway, request.amount);
        const performance = await this.getGatewayPerformance(gateway.name);
        
        return {
          gateway: gateway,
          score: health * 0.5 + (1 - cost) * 0.3 + performance * 0.2
        };
      })
    );
    
    // Select best gateway
    scores.sort((a, b) => b.score - a.score);
    return scores[0].gateway;
  }
  
  private async executePayment(
    gateway: PaymentGateway,
    request: any
  ): Promise<PaymentResult> {
    const startTime = Date.now();
    
    try {
      // Call gateway
      const response = await gateway.charge(request);
      
      // Log transaction
      await this.transactionLogger.log({
        gateway: gateway.name,
        request: request,
        response: response,
        duration: Date.now() - startTime,
        status: 'success'
      });
      
      // Transform response
      return this.transformGatewayResponse(gateway, response);
      
    } catch (error) {
      // Log failure
      await this.transactionLogger.log({
        gateway: gateway.name,
        request: request,
        error: error,
        duration: Date.now() - startTime,
        status: 'failed'
      });
      
      throw error;
    }
  }
}
```

#### 6.3.2 Gateway Adapters

```typescript
// Paystack Adapter
class PaystackAdapter implements PaymentGateway {
  private client: PaystackClient;
  
  async charge(request: PaymentRequest): Promise<any> {
    const paystackRequest = {
      email: request.customer.email,
      amount: request.amount * 100, // Convert to kobo
      currency: 'ZAR',
      reference: request.reference,
      callback_url: request.callback_url,
      metadata: {
        order_id: request.order_id,
        customer_id: request.customer_id,
        custom_fields: [
          {
            display_name: 'Order ID',
            variable_name: 'order_id',
            value: request.order_id
          }
        ]
      }
    };
    
    if (request.method === 'card') {
      // Initialize transaction for card payment
      return await this.client.transaction.initialize(paystackRequest);
    } else if (request.method === 'bank') {
      // Create virtual account
      return await this.client.virtualAccount.create({
        customer: request.customer.email,
        preferred_bank: request.bank_code
      });
    } else if (request.method === 'ussd') {
      // Generate USSD code
      return await this.client.charge.ussd({
        ...paystackRequest,
        ussd: {
          type: request.bank_code
        }
      });
    }
  }
  
  async verify(reference: string): Promise<any> {
    return await this.client.transaction.verify(reference);
  }
  
  async refund(transactionId: string, amount?: number): Promise<any> {
    return await this.client.refund.create({
      transaction: transactionId,
      amount: amount ? amount * 100 : undefined
    });
  }
}

// Ozow Adapter
class OzowAdapter implements PaymentGateway {
  private apiKey: string;
  private siteCode: string;
  
  async charge(request: PaymentRequest): Promise<any> {
    const ozowRequest = {
      SiteCode: this.siteCode,
      CountryCode: 'ZA',
      CurrencyCode: 'ZAR',
      Amount: request.amount,
      TransactionReference: request.reference,
      BankReference: request.order_id,
      Customer: request.customer.email,
      CancelUrl: request.cancel_url,
      ErrorUrl: request.error_url,
      SuccessUrl: request.success_url,
      NotifyUrl: request.webhook_url,
      IsTest: process.env.NODE_ENV !== 'production'
    };
    
    // Generate hash
    const hashCheck = this.generateHash(ozowRequest);
    ozowRequest['HashCheck'] = hashCheck;
    
    // Get payment link
    const response = await this.post('/GetRequest', ozowRequest);
    
    return {
      payment_url: response.url,
      request_id: response.requestId,
      status: 'pending'
    };
  }
  
  private generateHash(data: any): string {
    const hashString = [
      data.SiteCode,
      data.CountryCode,
      data.CurrencyCode,
      data.Amount,
      data.TransactionReference,
      data.BankReference,
      data.CancelUrl,
      data.ErrorUrl,
      data.SuccessUrl,
      data.NotifyUrl,
      data.IsTest,
      this.apiKey
    ].join('').toLowerCase();
    
    return crypto.createHash('sha512').update(hashString).digest('hex');
  }
}
```

#### 6.3.3 Reconciliation Engine
```typescript
class ReconciliationEngine {
  private database: Database;
  private gateways: Map<string, PaymentGateway>;
  
  async reconcile(date: Date): Promise<ReconciliationReport> {
    const report: ReconciliationReport = {
      date: date,
      gateways: {},
      discrepancies: [],
      total_processed: 0,
      total_matched: 0,
      total_unmatched: 0
    };
    
    // Process each gateway
    for (const [gatewayName, gateway] of this.gateways) {
      const gatewayReport = await this.reconcileGateway(gateway, date);
      report.gateways[gatewayName] = gatewayReport;
      
      // Update totals
      report.total_processed += gatewayReport.processed;
      report.total_matched += gatewayReport.matched;
      report.total_unmatched += gatewayReport.unmatched;
      
      // Collect discrepancies
      report.discrepancies.push(...gatewayReport.discrepancies);
    }
    
    // Save report
    await this.saveReconciliationReport(report);
    
    // Alert on discrepancies
    if (report.discrepancies.length > 0) {
      await this.alertDiscrepancies(report.discrepancies);
    }
    
    return report;
  }
  
  private async reconcileGateway(
    gateway: PaymentGateway,
    date: Date
  ): Promise<GatewayReconciliation> {
    // Get transactions from gateway
    const gatewayTransactions = await gateway.getTransactions(date);
    
    // Get transactions from database
    const dbTransactions = await this.database.query(`
      SELECT
        transaction_id,
        gateway_reference,
        amount,
        status,
        created_at
      FROM payments
      WHERE gateway = $1
        AND DATE(created_at) = $2
    `, [gateway.name, date]);
    
    // Create lookup maps
    const gatewayMap = new Map(
      gatewayTransactions.map(t => [t.reference, t])
    );
    const dbMap = new Map(
      dbTransactions.map(t => [t.gateway_reference, t])
    );
    
    const matched = [];
    const unmatched = [];
    const discrepancies = [];
    
    // Check each gateway transaction
    for (const [reference, gatewayTx] of gatewayMap) {
      const dbTx = dbMap.get(reference);
      
      if (!dbTx) {
        // Missing in database
        unmatched.push({
          type: 'missing_in_db',
          gateway_reference: reference,
          amount: gatewayTx.amount,
          gateway_status: gatewayTx.status
        });
      } else {
        // Check for discrepancies
        if (Math.abs(gatewayTx.amount - dbTx.amount) > 0.01) {
          discrepancies.push({
            type: 'amount_mismatch',
            reference: reference,
            gateway_amount: gatewayTx.amount,
            db_amount: dbTx.amount
          });
        } else if (gatewayTx.status !== dbTx.status) {
          discrepancies.push({
            type: 'status_mismatch',
            reference: reference,
            gateway_status: gatewayTx.status,
            db_status: dbTx.status
          });
        } else {
          matched.push(reference);
        }
        
        // Remove from db map
        dbMap.delete(reference);
      }
    }
    
    // Check remaining db transactions (missing in gateway)
    for (const [reference, dbTx] of dbMap) {
      unmatched.push({
        type: 'missing_in_gateway',
        gateway_reference: reference,
        amount: dbTx.amount,
        db_status: dbTx.status
      });
    }
    
    return {
      gateway: gateway.name,
      date: date,
      processed: gatewayTransactions.length,
      matched: matched.length,
      unmatched: unmatched.length,
      discrepancies: discrepancies,
      unmatched_transactions: unmatched
    };
  }
}
```

### 6.4 Payment Configuration

```yaml
payment_gateways:
  paystack:
    enabled: true
    priority: 1
    supported_methods:
      - card
      - bank_transfer
      - ussd
    supported_currencies:
      - ZAR
      - NGN
    fees:
      percentage: 1.5
      fixed: 100 # In cents
      international: 3.8
    webhooks:
      secret: ${PAYSTACK_WEBHOOK_SECRET}
      endpoints:
        - /webhooks/paystack
    
  ozow:
    enabled: true
    priority: 2
    supported_methods:
      - instant_eft
      - bank_transfer
    supported_currencies:
      - ZAR
    fees:
      percentage: 1.5
      fixed: 0
    webhooks:
      secret: ${OZOW_API_KEY}
      endpoints:
        - /webhooks/ozow
    
  mpesa:
    enabled: true
    priority: 3
    supported_methods:
      - mobile_money
    supported_currencies:
      - ZAR
    fees:
      percentage: 2.0
      fixed: 0
    webhooks:
      endpoints:
        - /webhooks/mpesa

payment_methods:
  card:
    gateways: [paystack]
    min_amount: 10
    max_amount: 50000
    
  instant_eft:
    gateways: [ozow]
    min_amount: 10
    max_amount: 50000
    
  mobile_money:
    gateways: [mpesa]
    min_amount: 1
    max_amount: 10000
    
  cash_on_delivery:
    enabled: true
    max_amount: 5000
    requires_verification: true
```

## 7. Delivery Service Architecture

### 7.1 Overview
Manages delivery logistics including driver dispatch, route optimization, real-time tracking, and proof of delivery.

### 7.2 Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│              Delivery API Layer                      │
│         (REST API, WebSocket, Mobile SDK)           │
└─────────────────────────┬───────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────┐
│           Dispatch Management Layer                  │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Driver     │  │    Route     │  │Allocation│  │
│  │   Matcher    │  │  Optimizer   │  │  Engine  │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────┤
│            Tracking Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Location   │  │    Status    │  │   ETA    │  │
│  │   Tracker    │  │   Manager    │  │Calculator│  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────┤
│           Driver Management Layer                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Driver     │  │  Incentive   │  │  Rating  │  │
│  │   Registry   │  │   Manager    │  │  System  │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────┘
```

### 7.3 Core Components

#### 7.3.1 Dispatch Engine
```typescript
class DispatchEngine {
  private driverMatcher: DriverMatcher;
  private routeOptimizer: RouteOptimizer;
  private allocationEngine: AllocationEngine;
  private trackingService: TrackingService;
  
  async dispatchDelivery(delivery: Delivery): Promise<DispatchResult> {
    // Get available drivers
    const availableDrivers = await this.getAvailableDrivers(
      delivery.pickup_location,
      delivery.vehicle_requirements
    );
    
    if (availableDrivers.length === 0) {
      return this.queueForLaterDispatch(delivery);
    }
    
    // Score and rank drivers
    const scoredDrivers = await this.scoreDrivers(
      delivery,
      availableDrivers
    );
    
    // Optimize routes for top candidates
    const routeOptions = await this.optimizeRoutes(
      delivery,
      scoredDrivers.slice(0, 5)
    );
    
    // Select best driver-route combination
    const selection = this.selectBestOption(routeOptions);
    
    // Create delivery offer
    const offer = await this.createDeliveryOffer(
      delivery,
      selection.driver,
      selection.route
    );
    
    // Send offer to driver
    const accepted = await this.sendOfferToDriver(offer);
    
    if (accepted) {
      // Assign delivery
      await this.assignDelivery(delivery, selection.driver, selection.route);
      
      // Start tracking
      await this.trackingService.startTracking(delivery.id, selection.driver.id);
      
      return {
        success: true,
        driver_id: selection.driver.id,
        estimated_pickup: selection.route.pickup_eta,
        estimated_delivery: selection.route.delivery_eta,
        distance: selection.route.distance,
        route: selection.route.polyline
      };
    } else {
      // Try next driver
      return this.dispatchToNextDriver(delivery, scoredDrivers, 1);
    }
  }
  
  private async scoreDrivers(
    delivery: Delivery,
    drivers: Driver[]
  ): Promise<ScoredDriver[]> {
    const scores = await Promise.all(
      drivers.map(async driver => {
        const score = await this.calculateDriverScore(delivery, driver);
        return { driver, score };
      })
    );
    
    return scores.sort((a, b) => b.score - a.score);
  }
  
  private async calculateDriverScore(
    delivery: Delivery,
    driver: Driver
  ): Promise<number> {
    const factors = {
      proximity: await this.calculateProximityScore(delivery, driver),
      rating: driver.rating / 5,
      completion_rate: driver.stats.completion_rate,
      vehicle_match: this.calculateVehicleMatch(delivery, driver),
      availability: await this.calculateAvailabilityScore(driver),
      experience: this.calculateExperienceScore(driver)
    };
    
    const weights = {
      proximity: 0.35,
      rating: 0.20,
      completion_rate: 0.15,
      vehicle_match: 0.15,
      availability: 0.10,
      experience: 0.05
    };
    
    return Object.entries(factors).reduce(
      (total, [factor, score]) => total + score * weights[factor],
      0
    );
  }
}
```

#### 7.3.2 Route Optimizer
```typescript
class RouteOptimizer {
  private mapService: MapService;
  private trafficService: TrafficService;
  
  async optimizeRoute(
    pickup: Location,
    dropoff: Location,
    driver: Driver,
    constraints?: RouteConstraints
  ): Promise<OptimizedRoute> {
    // Get multiple route options
    const routes = await this.mapService.getRoutes(
      driver.current_location,
      [pickup, dropoff],
      {
        avoid: constraints?.avoid || [],
        vehicle_type: driver.vehicle_type,
        departure_time: Date.now()
      }
    );
    
    // Score each route
    const scoredRoutes = await Promise.all(
      routes.map(async route => {
        const score = await this.scoreRoute(route, constraints);
        return { route, score };
      })
    );
    
    // Select best route
    const bestRoute = scoredRoutes.reduce(
      (best, current) => current.score > best.score ? current : best
    );
    
    // Add waypoints for multi-stop deliveries
    if (constraints?.waypoints) {
      bestRoute.route = await this.addWaypoints(
        bestRoute.route,
        constraints.waypoints
      );
    }
    
    return {
      polyline: bestRoute.route.polyline,
      distance: bestRoute.route.distance,
      duration: bestRoute.route.duration,
      pickup_eta: this.calculateETA(
        driver.current_location,
        pickup,
        bestRoute.route
      ),
      delivery_eta: this.calculateETA(
        pickup,
        dropoff,
        bestRoute.route
      ),
      instructions: bestRoute.route.instructions,
      traffic_conditions: await this.getTrafficConditions(bestRoute.route)
    };
  }
  
  private async scoreRoute(
    route: Route,
    constraints?: RouteConstraints
  ): Promise<number> {
    const factors = {
      distance: 1 - (route.distance / 50000), // Normalize to 50km max
      duration: 1 - (route.duration / 7200), // Normalize to 2 hours max
      traffic: await this.getTrafficScore(route),
      safety: await this.getSafetyScore(route),
      cost: this.calculateRouteCost(route)
    };
    
    const weights = constraints?.optimization_preference || {
      distance: 0.2,
      duration: 0.4,
      traffic: 0.2,
      safety: 0.15,
      cost: 0.05
    };
    
    return Object.entries(factors).reduce(
      (total, [factor, score]) => total + score * weights[factor],
      0
    );
  }
}
```

#### 7.3.3 Real-time Tracking
```typescript
class TrackingService {
  private locationStore: LocationStore;
  private websocketServer: WebSocketServer;
  private geofenceService: GeofenceService;
  
  async updateDriverLocation(
    driverId: string,
    location: LocationUpdate
  ): Promise<void> {
    // Validate location
    if (!this.isValidLocation(location)) {
      throw new InvalidLocationException();
    }
    
    // Get active deliveries
    const activeDeliveries = await this.getActiveDeliveries(driverId);
    
    for (const delivery of activeDeliveries) {
      // Update location
      await this.locationStore.update(delivery.id, {
        driver_location: location,
        timestamp: Date.now(),
        speed: location.speed,
        heading: location.heading,
        accuracy: location.accuracy
      });
      
      // Check geofences
      await this.checkGeofences(delivery, location);
      
      // Update ETA
      const newETA = await this.recalculateETA(delivery, location);
      if (Math.abs(newETA - delivery.eta) > 300) { // 5 minutes
        await this.updateDeliveryETA(delivery.id, newETA);
      }
      
      // Broadcast to subscribers
      this.broadcastLocationUpdate(delivery.id, {
        location: location,
        eta: newETA,
        distance_remaining: await this.calculateRemainingDistance(
          location,
          delivery.dropoff_location
        )
      });
    }
  }
  
  private async checkGeofences(
    delivery: Delivery,
    location: LocationUpdate
  ): Promise<void> {
    // Check pickup geofence
    if (delivery.status === 'assigned') {
      const atPickup = await this.geofenceService.isInside(
        location,
        delivery.pickup_location,
        50 // 50 meter radius
      );
      
      if (atPickup) {
        await this.handleArrivalAtPickup(delivery);
      }
    }
    
    // Check dropoff geofence
    if (delivery.status === 'in_transit') {
      const atDropoff = await this.geofenceService.isInside(
        location,
        delivery.dropoff_location,
        50 // 50 meter radius
      );
      
      if (atDropoff) {
        await this.handleArrivalAtDropoff(delivery);
      }
    }
    
    // Check for route deviation
    const offRoute = await this.checkRouteDeviation(delivery, location);
    if (offRoute) {
      await this.handleRouteDeviation(delivery, location);
    }
  }
  
  private broadcastLocationUpdate(
    deliveryId: string,
    update: any
  ): void {
    const subscribers = this.websocketServer.getSubscribers(deliveryId);
    
    for (const subscriber of subscribers) {
      subscriber.send(JSON.stringify({
        type: 'location_update',
        delivery_id: deliveryId,
        data: update,
        timestamp: Date.now()
      }));
    }
  }
}
```

### 7.4 Driver Management

```typescript
class DriverManager {
  private driverRegistry: DriverRegistry;
  private incentiveManager: IncentiveManager;
  private ratingSystem: RatingSystem;
  
  async onboardDriver(application: DriverApplication): Promise<Driver> {
    // Verify documents
    const verification = await this.verifyDocuments(application);
    if (!verification.passed) {
      throw new DriverVerificationException(verification.reasons);
    }
    
    // Create driver profile
    const driver: Driver = {
      id: uuid(),
      personal_info: {
        name: application.name,
        phone: application.phone,
        email: application.email,
        id_number: application.id_number
      },
      vehicle_info: {
        type: application.vehicle_type,
        make: application.vehicle_make,
        model: application.vehicle_model,
        year: application.vehicle_year,
        registration: application.vehicle_registration,
        has_cold_storage: application.has_cold_storage
      },
      documents: {
        drivers_license: application.drivers_license,
        vehicle_registration: application.vehicle_registration_doc,
        insurance: application.insurance_doc,
        police_clearance: application.police_clearance
      },
      status: 'active',
      rating: 5.0,
      stats: {
        total_deliveries: 0,
        completion_rate: 1.0,
        average_rating: 5.0,
        total_earnings: 0
      },
      created_at: Date.now()
    };
    
    // Save driver
    await this.driverRegistry.create(driver);
    
    // Set up payment account
    await this.setupDriverPayments(driver);
    
    // Send welcome package
    await this.sendWelcomePackage(driver);
    
    return driver;
  }
  
  async calculateEarnings(
    delivery: CompletedDelivery
  ): Promise<DriverEarnings> {
    const driver = await this.driverRegistry.get(delivery.driver_id);
    
    // Base fare
    let earnings = this.calculateBaseFare(delivery.distance);
    
    // Time component
    earnings += this.calculateTimeFare(delivery.duration);
    
    // Apply incentives
    const incentives = await this.incentiveManager.getApplicableIncentives(
      driver,
      delivery
    );
    
    for (const incentive of incentives) {
      earnings += incentive.calculate(earnings, delivery);
    }
    
    // Apply surge pricing
    if (delivery.surge_multiplier > 1) {
      earnings *= delivery.surge_multiplier;
    }
    
    // Deduct platform fee
    const platformFee = earnings * 0.15; // 15% platform fee
    const netEarnings = earnings - platformFee;
    
    return {
      gross_earnings: earnings,
      platform_fee: platformFee,
      net_earnings: netEarnings,
      incentives: incentives.map(i => ({
        type: i.type,
        amount: i.amount,
        description: i.description
      })),
      breakdown: {
        base_fare: this.calculateBaseFare(delivery.distance),
        time_fare: this.calculateTimeFare(delivery.duration),
        surge_bonus: earnings * (delivery.surge_multiplier - 1),
        incentive_bonus: incentives.reduce((sum, i) => sum + i.amount, 0)
      }
    };
  }
}
```

## 8. Analytics Service Architecture

### 8.1 Overview
Provides real-time and batch analytics, reporting, and business intelligence across all platform operations.

### 8.2 Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│              Analytics API Layer                     │
│         (REST API, GraphQL, Dashboards)             │
└─────────────────────────┬───────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────┐
│           Data Processing Layer                      │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Stream     │  │    Batch     │  │  Machine │  │
│  │  Processor   │  │  Processor   │  │ Learning │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────┤
│             Data Storage Layer                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │  Time Series │  │    OLAP      │  │  Cache   │  │
│  │   Database   │  │   Warehouse  │  │  Layer   │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────┤
│            Visualization Layer                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │  Dashboard   │  │   Report     │  │  Alert   │  │
│  │   Engine     │  │  Generator   │  │  Manager │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────┘
```

### 8.3 Core Components

#### 8.3.1 Stream Processor
```typescript
class StreamProcessor {
  private kafka: KafkaClient;
  private clickhouse: ClickHouseClient;
  private aggregator: MetricsAggregator;
  
  async processEventStream(): Promise<void> {
    const consumer = this.kafka.consumer({ groupId: 'analytics-processor' });
    
    await consumer.subscribe({ 
      topics: ['orders', 'payments', 'deliveries', 'user-actions'],
      fromBeginning: false 
    });
    
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const event = JSON.parse(message.value.toString());
        
        // Enrich event
        const enrichedEvent = await this.enrichEvent(event);
        
        // Process based on event type
        switch (event.event_type) {
          case 'order.created':
            await this.processOrderCreated(enrichedEvent);
            break;
          case 'payment.processed':
            await this.processPaymentProcessed(enrichedEvent);
            break;
          case 'delivery.completed':
            await this.processDeliveryCompleted(enrichedEvent);
            break;
          default:
            await this.processGenericEvent(enrichedEvent);
        }
        
        // Update real-time metrics
        await this.updateRealTimeMetrics(enrichedEvent);
      }
    });
  }
  
  private async processOrderCreated(event: EnrichedEvent): Promise<void> {
    // Extract metrics
    const metrics = {
      tenant_id: event.tenant_id,
      timestamp: event.timestamp,
      order_value: event.data.total,
      items_count: event.data.items.length,
      customer_type: event.data.is_new_customer ? 'new' : 'returning',
      payment_method: event.data.payment_method,
      location: event.data.delivery_location,
      hour_of_day: new Date(event.timestamp).getHours(),
      day_of_week: new Date(event.timestamp).getDay()
    };
    
    // Store in time series database
    await this.clickhouse.insert('order_metrics', metrics);
    
    // Update aggregations
    await this.aggregator.updateHourlyMetrics('orders', metrics);
    await this.aggregator.updateDailyMetrics('orders', metrics);
    
    // Check for alerts
    await this.checkOrderAlerts(metrics);
  }
  
  private async updateRealTimeMetrics(event: EnrichedEvent): Promise<void> {
    const key = `metrics:${event.tenant_id}:realtime`;
    
    // Update counters
    await this.redis.hincrby(key, `${event.event_type}:count`, 1);
    
    // Update moving averages
    if (event.data.value) {
      await this.updateMovingAverage(
        `${key}:${event.event_type}:avg_value`,
        event.data.value
      );
    }
    
    // Set TTL
    await this.redis.expire(key, 3600); // 1 hour
  }
}
```

#### 8.3.2 Analytics Engine
```typescript
class AnalyticsEngine {
  private warehouse: DataWarehouse;
  private cache: AnalyticsCache;
  private mlPipeline: MLPipeline;
  
  async generateDashboardData(
    tenantId: string,
    period: TimePeriod
  ): Promise<DashboardData> {
    // Check cache
    const cacheKey = `dashboard:${tenantId}:${period.start}:${period.end}`;
    const cached = await this.cache.get(cacheKey);
    
    if (cached && !this.isStale(cached)) {
      return cached;
    }
    
    // Generate fresh data
    const [
      salesMetrics,
      customerMetrics,
      productMetrics,
      deliveryMetrics,
      financialMetrics
    ] = await Promise.all([
      this.calculateSalesMetrics(tenantId, period),
      this.calculateCustomerMetrics(tenantId, period),
      this.calculateProductMetrics(tenantId, period),
      this.calculateDeliveryMetrics(tenantId, period),
      this.calculateFinancialMetrics(tenantId, period)
    ]);
    
    // Generate predictions
    const predictions = await this.mlPipeline.predict({
      tenant_id: tenantId,
      historical_data: {
        sales: salesMetrics,
        customers: customerMetrics
      }
    });
    
    const dashboardData = {
      period: period,
      metrics: {
        sales: salesMetrics,
        customers: customerMetrics,
        products: productMetrics,
        delivery: deliveryMetrics,
        financial: financialMetrics
      },
      predictions: predictions,
      generated_at: Date.now()
    };
    
    // Cache with appropriate TTL
    const ttl = this.calculateCacheTTL(period);
    await this.cache.set(cacheKey, dashboardData, ttl);
    
    return dashboardData;
  }
  
  private async calculateSalesMetrics(
    tenantId: string,
    period: TimePeriod
  ): Promise<SalesMetrics> {
    const query = `
      SELECT
        COUNT(DISTINCT order_id) as total_orders,
        SUM(order_value) as total_revenue,
        AVG(order_value) as avg_order_value,
        COUNT(DISTINCT customer_id) as unique_customers,
        SUM(items_count) as total_items_sold,
        
        -- Time series
        toStartOfHour(timestamp) as hour,
        COUNT(*) as orders_per_hour,
        SUM(order_value) as revenue_per_hour
        
      FROM order_metrics
      WHERE tenant_id = {tenant_id:UUID}
        AND timestamp BETWEEN {start:DateTime} AND {end:DateTime}
      GROUP BY hour
      ORDER BY hour
    `;
    
    const results = await this.warehouse.query(query, {
      tenant_id: tenantId,
      start: period.start,
      end: period.end
    });
    
    // Calculate growth rates
    const previousPeriod = this.getPreviousPeriod(period);
    const previousMetrics = await this.getPreviousPeriodMetrics(
      tenantId,
      previousPeriod
    );
    
    return {
      total_orders: results.total_orders,
      total_revenue: results.total_revenue,
      avg_order_value: results.avg_order_value,
      unique_customers: results.unique_customers,
      total_items_sold: results.total_items_sold,
      growth_rates: {
        orders: this.calculateGrowthRate(
          results.total_orders,
          previousMetrics.total_orders
        ),
        revenue: this.calculateGrowthRate(
          results.total_revenue,
          previousMetrics.total_revenue
        ),
        customers: this.calculateGrowthRate(
          results.unique_customers,
          previousMetrics.unique_customers
        )
      },
      time_series: results.map(row => ({
        timestamp: row.hour,
        orders: row.orders_per_hour,
        revenue: row.revenue_per_hour
      }))
    };
  }
}
```

#### 8.3.3 Report Generator
```typescript
class ReportGenerator {
  private templateEngine: TemplateEngine;
  private pdfGenerator: PDFGenerator;
  private emailService: EmailService;
  
  async generateReport(
    request: ReportRequest
  ): Promise<Report> {
    // Load report template
    const template = await this.templateEngine.load(request.template_id);
    
    // Gather data
    const data = await this.gatherReportData(request);
    
    // Apply calculations and formatting
    const processedData = await this.processReportData(data, template);
    
    // Generate report
    const report = await this.renderReport(template, processedData);
    
    // Save report
    const reportId = await this.saveReport(report);
    
    // Schedule delivery if requested
    if (request.delivery) {
      await this.scheduleDelivery(reportId, request.delivery);
    }
    
    return {
      id: reportId,
      name: report.name,
      type: request.template_id,
      generated_at: Date.now(),
      download_url: `/reports/${reportId}/download`,
      expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
    };
  }
  
  private async gatherReportData(
    request: ReportRequest
  ): Promise<ReportData> {
    const dataSources = request.data_sources || this.getDefaultDataSources(
      request.template_id
    );
    
    const data = {};
    
    for (const source of dataSources) {
      switch (source.type) {
        case 'query':
          data[source.name] = await this.executeQuery(
            source.query,
            request.parameters
          );
          break;
          
        case 'api':
          data[source.name] = await this.fetchFromAPI(
            source.endpoint,
            request.parameters
          );
          break;
          
        case 'calculation':
          data[source.name] = await this.calculate(
            source.formula,
            data
          );
          break;
      }
    }
    
    return data;
  }
}
```

### 8.4 Analytics Configuration

```yaml
analytics:
  stream_processing:
    kafka:
      brokers: ${KAFKA_BROKERS}
      topics:
        - name: orders
          partitions: 10
          retention_ms: 604800000 # 7 days
        - name: payments
          partitions: 10
          retention_ms: 604800000
        - name: deliveries
          partitions: 10
          retention_ms: 604800000
    
  storage:
    clickhouse:
      cluster: analytics-cluster
      database: wakala_analytics
      tables:
        - name: order_metrics
          engine: ReplicatedMergeTree
          partition_by: toYYYYMM(timestamp)
          order_by: (tenant_id, timestamp)
          ttl: timestamp + INTERVAL 2 YEAR
        
        - name: customer_events
          engine: ReplicatedMergeTree
          partition_by: toYYYYMM(timestamp)
          order_by: (tenant_id, customer_id, timestamp)
          ttl: timestamp + INTERVAL 1 YEAR
    
  ml_models:
    demand_forecast:
      type: prophet
      features:
        - historical_orders
        - seasonality
        - holidays
        - weather
      update_frequency: daily
    
    churn_prediction:
      type: xgboost
      features:
        - order_frequency
        - average_order_value
        - days_since_last_order
        - customer_lifetime_value
      update_frequency: weekly
    
  dashboards:
    real_time:
      refresh_interval: 5s
      metrics:
        - active_orders
        - revenue_today
        - active_drivers
        - average_delivery_time
    
    executive:
      refresh_interval: 1h
      metrics:
        - monthly_revenue
        - customer_acquisition_cost
        - lifetime_value
        - gross_margin
```

## Conclusion

This component architecture provides a comprehensive design for each microservice in the Wakala OS platform. Each service is designed with:

1. **Clear boundaries** - Well-defined responsibilities and interfaces
2. **Scalability** - Horizontal scaling capabilities built-in
3. **Resilience** - Circuit breakers, retries, and fallback mechanisms
4. **Observability** - Comprehensive logging, metrics, and tracing
5. **Security** - Authentication, authorization, and data protection
6. **Flexibility** - Configurable and extensible components

The architecture supports the unique requirements of township commerce while maintaining enterprise-grade reliability and performance.