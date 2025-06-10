import { createMachine, interpret, State } from 'xstate';
import { v4 as uuidv4 } from 'uuid';
import { EventStore } from '../services/event.store';
import { CompensationHandler } from '../services/compensation.handler';
import { WorkflowRepository } from '../repositories/workflow.repository';
import {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowEvent,
  WorkflowContext,
  WorkflowStatus,
  WorkflowTemplate,
  SagaStep,
  CompensationResult,
  CompensationStrategy,
  EventType,
  WorkflowEventRecord,
  WorkflowState,
  WorkflowTransition
} from '../interfaces/workflow.interface';

export class WorkflowEngine {
  private activeInstances: Map<string, any> = new Map();

  constructor(
    private eventStore: EventStore,
    private compensationHandler: CompensationHandler,
    private workflowRepository: WorkflowRepository
  ) {}

  /**
   * Create a new workflow instance
   */
  async createWorkflow(
    definition: WorkflowDefinition,
    initialContext: WorkflowContext
  ): Promise<WorkflowInstance> {
    // Validate workflow definition
    this.validateDefinition(definition);

    const workflowId = uuidv4();
    const now = new Date();

    // Create workflow instance
    const instance: Omit<WorkflowInstance, 'id' | 'createdAt' | 'updatedAt'> = {
      definitionId: definition.id,
      currentState: definition.initialState,
      context: { ...definition.context, ...initialContext },
      status: WorkflowStatus.ACTIVE,
      version: 0
    };

    const createdInstance = await this.workflowRepository.create(instance);

    // Record workflow started event
    await this.eventStore.append({
      workflowId: createdInstance.id,
      type: EventType.WORKFLOW_STARTED,
      timestamp: now,
      data: {
        state: definition.initialState,
        context: createdInstance.context
      }
    });

    // Create and start state machine
    this.startStateMachine(createdInstance, definition);

    return createdInstance;
  }

  /**
   * Transition workflow to next state
   */
  async transition(
    workflowId: string,
    event: WorkflowEvent
  ): Promise<WorkflowInstance> {
    const instance = await this.workflowRepository.findById(workflowId);
    if (!instance) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const definition = await this.workflowRepository.getDefinition(instance.definitionId);
    if (!definition) {
      throw new Error(`Workflow definition not found: ${instance.definitionId}`);
    }

    // Check if transition is valid
    const currentStateConfig = definition.states[instance.currentState];
    if (!currentStateConfig || !currentStateConfig.on || !currentStateConfig.on[event.type]) {
      throw new Error(`Invalid transition: No transition for event ${event.type} in state ${instance.currentState}`);
    }

    // Get target state
    const transition = currentStateConfig.on[event.type];
    const targetState = typeof transition === 'string' ? transition : transition.target;

    // Update workflow instance
    const updatedInstance = await this.workflowRepository.update(workflowId, {
      currentState: targetState,
      context: { ...instance.context, ...event.data },
      version: instance.version + 1
    });

    // Record state transition event
    await this.eventStore.append({
      workflowId,
      type: EventType.STATE_TRANSITIONED,
      timestamp: new Date(),
      data: {
        from: instance.currentState,
        to: targetState,
        event
      }
    });

    // Check if workflow is completed
    const targetStateConfig = definition.states[targetState];
    if (targetStateConfig && targetStateConfig.type === 'final') {
      await this.completeWorkflow(workflowId);
    }

    return updatedInstance;
  }

  /**
   * Execute saga with compensation
   */
  async executeSaga(
    workflowId: string,
    steps: SagaStep[],
    context: WorkflowContext,
    strategy: CompensationStrategy = CompensationStrategy.SEQUENTIAL
  ): Promise<CompensationResult> {
    // Record saga started event
    await this.eventStore.append({
      workflowId,
      type: EventType.SAGA_STARTED,
      timestamp: new Date(),
      data: {
        steps: steps.map(s => s.name),
        strategy
      }
    });

    try {
      const result = await this.compensationHandler.executeWithCompensation(
        steps,
        context,
        strategy
      );

      if (result.success) {
        await this.eventStore.append({
          workflowId,
          type: EventType.SAGA_COMPLETED,
          timestamp: new Date(),
          data: { results: result.results }
        });
      }

      return result;
    } catch (error) {
      await this.eventStore.append({
        workflowId,
        type: EventType.SAGA_FAILED,
        timestamp: new Date(),
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
          failedStep: (error as any).failedStep
        }
      });
      throw error;
    }
  }

  /**
   * Get workflow history
   */
  async getWorkflowHistory(workflowId: string): Promise<WorkflowEventRecord[]> {
    return await this.eventStore.getEvents(workflowId);
  }

  /**
   * Apply workflow template
   */
  async applyTemplate(
    templateId: string,
    parameters: Record<string, any>
  ): Promise<WorkflowInstance> {
    const template = await this.workflowRepository.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Validate parameters
    for (const param of template.parameters) {
      if (!(param in parameters)) {
        throw new Error(`Missing required parameter: ${param}`);
      }
    }

    // Create workflow from template
    return await this.createWorkflow(template.definition, parameters);
  }

  /**
   * Cancel workflow
   */
  async cancelWorkflow(workflowId: string, reason: string): Promise<WorkflowInstance> {
    const instance = await this.workflowRepository.findById(workflowId);
    if (!instance) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (instance.status === WorkflowStatus.COMPLETED || instance.status === WorkflowStatus.CANCELLED) {
      throw new Error(`Cannot cancel workflow in status: ${instance.status}`);
    }

    const updatedInstance = await this.workflowRepository.update(workflowId, {
      status: WorkflowStatus.CANCELLED
    });

    await this.eventStore.append({
      workflowId,
      type: EventType.WORKFLOW_CANCELLED,
      timestamp: new Date(),
      data: { reason }
    });

    // Stop state machine if active
    this.stopStateMachine(workflowId);

    return updatedInstance;
  }

  /**
   * Retry failed workflow
   */
  async retryFailedWorkflow(workflowId: string): Promise<WorkflowInstance> {
    const instance = await this.workflowRepository.findById(workflowId);
    if (!instance) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (instance.status !== WorkflowStatus.FAILED) {
      throw new Error(`Can only retry failed workflows. Current status: ${instance.status}`);
    }

    // Find last successful state
    const events = await this.eventStore.getEvents(workflowId);
    const lastSuccessfulTransition = events
      .filter(e => e.type === EventType.STATE_TRANSITIONED)
      .reverse()
      .find(e => e.data.to !== 'FAILED');

    const retryState = lastSuccessfulTransition ? lastSuccessfulTransition.data.to : instance.context.lastSuccessfulState || 'PROCESSING';

    const updatedInstance = await this.workflowRepository.update(workflowId, {
      currentState: retryState,
      status: WorkflowStatus.ACTIVE
    });

    await this.eventStore.append({
      workflowId,
      type: EventType.WORKFLOW_RETRIED,
      timestamp: new Date(),
      data: { fromState: instance.currentState, toState: retryState }
    });

    return updatedInstance;
  }

  /**
   * Validate workflow definition
   */
  private validateDefinition(definition: WorkflowDefinition): void {
    if (!definition.states || Object.keys(definition.states).length === 0) {
      throw new Error('Invalid workflow definition: No states defined');
    }

    if (!definition.initialState || !definition.states[definition.initialState]) {
      throw new Error('Invalid workflow definition: Invalid initial state');
    }

    // Additional validation logic can be added here
  }

  /**
   * Start state machine for workflow
   */
  private startStateMachine(instance: WorkflowInstance, definition: WorkflowDefinition): void {
    // This is a simplified implementation
    // In a real implementation, you would create an XState machine
    this.activeInstances.set(instance.id, { instance, definition });
  }

  /**
   * Stop state machine for workflow
   */
  private stopStateMachine(workflowId: string): void {
    this.activeInstances.delete(workflowId);
  }

  /**
   * Complete workflow
   */
  private async completeWorkflow(workflowId: string): Promise<void> {
    await this.workflowRepository.update(workflowId, {
      status: WorkflowStatus.COMPLETED,
      completedAt: new Date()
    });

    await this.eventStore.append({
      workflowId,
      type: EventType.WORKFLOW_COMPLETED,
      timestamp: new Date(),
      data: {}
    });

    this.stopStateMachine(workflowId);
  }
}