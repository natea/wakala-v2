export enum WorkflowStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  SUSPENDED = 'SUSPENDED'
}

export enum EventType {
  WORKFLOW_STARTED = 'WORKFLOW_STARTED',
  STATE_TRANSITIONED = 'STATE_TRANSITIONED',
  WORKFLOW_COMPLETED = 'WORKFLOW_COMPLETED',
  WORKFLOW_FAILED = 'WORKFLOW_FAILED',
  WORKFLOW_CANCELLED = 'WORKFLOW_CANCELLED',
  WORKFLOW_RETRIED = 'WORKFLOW_RETRIED',
  SAGA_STARTED = 'SAGA_STARTED',
  SAGA_COMPLETED = 'SAGA_COMPLETED',
  SAGA_FAILED = 'SAGA_FAILED',
  COMPENSATION_STARTED = 'COMPENSATION_STARTED',
  COMPENSATION_COMPLETED = 'COMPENSATION_COMPLETED'
}

export enum CompensationStrategy {
  SEQUENTIAL = 'SEQUENTIAL',
  PARALLEL = 'PARALLEL',
  BEST_EFFORT = 'BEST_EFFORT'
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  states: Record<string, WorkflowState>;
  initialState: string;
  context: WorkflowContext;
  metadata?: Record<string, any>;
}

export interface WorkflowState {
  type?: 'final' | 'parallel' | 'compound';
  on?: Record<string, string | WorkflowTransition>;
  entry?: string | string[];
  exit?: string | string[];
  invoke?: WorkflowInvocation;
  always?: WorkflowTransition[];
  after?: Record<string, string | WorkflowTransition>;
}

export interface WorkflowTransition {
  target: string;
  cond?: string | WorkflowCondition;
  actions?: string | string[] | WorkflowAction[];
  internal?: boolean;
}

export interface WorkflowCondition {
  type: string;
  params?: Record<string, any>;
}

export interface WorkflowAction {
  type: string;
  params?: Record<string, any>;
}

export interface WorkflowInvocation {
  id: string;
  src: string;
  onDone?: string | WorkflowTransition;
  onError?: string | WorkflowTransition;
  data?: Record<string, any>;
}

export interface WorkflowContext {
  [key: string]: any;
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  currentState: string;
  context: WorkflowContext;
  status: WorkflowStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  version: number;
  parentWorkflowId?: string;
  metadata?: Record<string, any>;
}

export interface WorkflowEvent {
  type: string;
  data?: any;
  timestamp?: Date;
}

export interface WorkflowEventRecord {
  id: string;
  workflowId: string;
  type: EventType;
  timestamp: Date;
  data: any;
  version?: number;
  correlationId?: string;
}

export interface SagaStep {
  name: string;
  action: (context: WorkflowContext) => Promise<any>;
  compensation: (context: WorkflowContext) => Promise<any>;
  retryPolicy?: RetryPolicy;
  timeout?: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMultiplier?: number;
  initialDelay?: number;
  maxDelay?: number;
}

export interface CompensationResult {
  success: boolean;
  results?: Array<{
    step: SagaStep;
    result: any;
  }>;
  failedStep?: string;
  error?: Error;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  definition: WorkflowDefinition;
  parameters: string[];
  tags?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WorkflowFilter {
  status?: WorkflowStatus[];
  definitionId?: string;
  parentWorkflowId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}

export interface WorkflowMetrics {
  totalCount: number;
  statusCounts: Record<WorkflowStatus, number>;
  averageCompletionTime?: number;
  failureRate?: number;
  throughput?: number;
}