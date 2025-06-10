import { WorkflowEngine } from '../engines/workflow.engine';
import { EventStore } from '../services/event.store';
import { CompensationHandler } from '../services/compensation.handler';
import { WorkflowRepository } from '../repositories/workflow.repository';
import {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowState,
  WorkflowEvent,
  WorkflowContext,
  WorkflowTransition,
  CompensationStrategy,
  WorkflowTemplate,
  WorkflowStatus,
  SagaStep,
  EventType
} from '../interfaces/workflow.interface';
import { createMachine } from 'xstate';
import { v4 as uuidv4 } from 'uuid';

jest.mock('../services/event.store');
jest.mock('../services/compensation.handler');
jest.mock('../repositories/workflow.repository');

describe('WorkflowEngine', () => {
  let workflowEngine: WorkflowEngine;
  let mockEventStore: jest.Mocked<EventStore>;
  let mockCompensationHandler: jest.Mocked<CompensationHandler>;
  let mockWorkflowRepository: jest.Mocked<WorkflowRepository>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockEventStore = new EventStore({} as any) as jest.Mocked<EventStore>;
    mockCompensationHandler = new CompensationHandler(mockEventStore) as jest.Mocked<CompensationHandler>;
    mockWorkflowRepository = new WorkflowRepository({} as any) as jest.Mocked<WorkflowRepository>;

    workflowEngine = new WorkflowEngine(
      mockEventStore,
      mockCompensationHandler,
      mockWorkflowRepository
    );
  });

  describe('createWorkflow', () => {
    it('should create a new workflow instance', async () => {
      // Arrange
      const definition: WorkflowDefinition = {
        id: 'order-workflow',
        name: 'Order Processing Workflow',
        version: '1.0.0',
        states: {
          PENDING: {
            on: {
              CONFIRM: 'PROCESSING'
            }
          },
          PROCESSING: {
            on: {
              COMPLETE: 'COMPLETED',
              FAIL: 'FAILED'
            }
          },
          COMPLETED: { type: 'final' },
          FAILED: { type: 'final' }
        },
        initialState: 'PENDING',
        context: {
          orderId: null,
          customerId: null,
          items: []
        }
      };

      const initialContext = {
        orderId: '12345',
        customerId: 'cust-123',
        items: ['item1', 'item2']
      };

      const expectedInstance: WorkflowInstance = {
        id: uuidv4(),
        definitionId: definition.id,
        currentState: 'PENDING',
        context: initialContext,
        status: WorkflowStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 0
      };

      mockWorkflowRepository.create.mockResolvedValue(expectedInstance);
      mockEventStore.append.mockResolvedValue();

      // Act
      const result = await workflowEngine.createWorkflow(definition, initialContext);

      // Assert
      expect(mockWorkflowRepository.create).toHaveBeenCalledWith(expect.objectContaining({
        definitionId: definition.id,
        currentState: 'PENDING',
        context: initialContext,
        status: WorkflowStatus.ACTIVE
      }));
      expect(mockEventStore.append).toHaveBeenCalledWith(expect.objectContaining({
        workflowId: expectedInstance.id,
        type: EventType.WORKFLOW_STARTED,
        data: { state: 'PENDING', context: initialContext }
      }));
      expect(result).toEqual(expectedInstance);
    });

    it('should validate workflow definition before creation', async () => {
      // Arrange
      const invalidDefinition: WorkflowDefinition = {
        id: 'invalid-workflow',
        name: 'Invalid Workflow',
        version: '1.0.0',
        states: {}, // No states defined
        initialState: 'PENDING',
        context: {}
      };

      // Act & Assert
      await expect(workflowEngine.createWorkflow(invalidDefinition, {}))
        .rejects
        .toThrow('Invalid workflow definition: No states defined');
    });
  });

  describe('transition', () => {
    it('should transition workflow to next state', async () => {
      // Arrange
      const workflowId = uuidv4();
      const currentInstance: WorkflowInstance = {
        id: workflowId,
        definitionId: 'order-workflow',
        currentState: 'PENDING',
        context: { orderId: '12345' },
        status: WorkflowStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1
      };

      const definition: WorkflowDefinition = {
        id: 'order-workflow',
        name: 'Order Workflow',
        version: '1.0.0',
        states: {
          PENDING: {
            on: {
              CONFIRM: {
                target: 'PROCESSING',
                actions: ['notifyCustomer']
              }
            }
          },
          PROCESSING: {
            on: {
              COMPLETE: 'COMPLETED'
            }
          },
          COMPLETED: { type: 'final' }
        },
        initialState: 'PENDING',
        context: {}
      };

      const event: WorkflowEvent = {
        type: 'CONFIRM',
        data: { confirmed: true }
      };

      mockWorkflowRepository.findById.mockResolvedValue(currentInstance);
      mockWorkflowRepository.getDefinition.mockResolvedValue(definition);
      mockWorkflowRepository.update.mockResolvedValue({
        ...currentInstance,
        currentState: 'PROCESSING',
        version: 2
      });
      mockEventStore.append.mockResolvedValue();

      // Act
      const result = await workflowEngine.transition(workflowId, event);

      // Assert
      expect(mockWorkflowRepository.update).toHaveBeenCalledWith(workflowId, {
        currentState: 'PROCESSING',
        context: expect.any(Object),
        version: 2
      });
      expect(mockEventStore.append).toHaveBeenCalledWith(expect.objectContaining({
        type: EventType.STATE_TRANSITIONED,
        data: {
          from: 'PENDING',
          to: 'PROCESSING',
          event
        }
      }));
      expect(result.currentState).toBe('PROCESSING');
    });

    it('should handle invalid transition', async () => {
      // Arrange
      const workflowId = uuidv4();
      const currentInstance: WorkflowInstance = {
        id: workflowId,
        definitionId: 'order-workflow',
        currentState: 'COMPLETED',
        context: { orderId: '12345' },
        status: WorkflowStatus.COMPLETED,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1
      };

      const definition: WorkflowDefinition = {
        id: 'order-workflow',
        name: 'Order Workflow',
        version: '1.0.0',
        states: {
          COMPLETED: { type: 'final' }
        },
        initialState: 'PENDING',
        context: {}
      };

      const event: WorkflowEvent = {
        type: 'INVALID_EVENT',
        data: {}
      };

      mockWorkflowRepository.findById.mockResolvedValue(currentInstance);
      mockWorkflowRepository.getDefinition.mockResolvedValue(definition);

      // Act & Assert
      await expect(workflowEngine.transition(workflowId, event))
        .rejects
        .toThrow('Invalid transition: No transition for event INVALID_EVENT in state COMPLETED');
    });
  });

  describe('executeSaga', () => {
    it('should execute saga with compensation on failure', async () => {
      // Arrange
      const workflowId = uuidv4();
      const sagaSteps: SagaStep[] = [
        {
          name: 'reserveInventory',
          action: jest.fn().mockResolvedValue({ reserved: true }),
          compensation: jest.fn().mockResolvedValue({ released: true })
        },
        {
          name: 'chargePayment',
          action: jest.fn().mockResolvedValue({ charged: true }),
          compensation: jest.fn().mockResolvedValue({ refunded: true })
        },
        {
          name: 'createShipment',
          action: jest.fn().mockRejectedValue(new Error('Shipping service unavailable')),
          compensation: jest.fn()
        }
      ];

      const context = { orderId: '12345', amount: 100 };

      mockCompensationHandler.executeWithCompensation.mockImplementation(
        async (steps, ctx, strategy) => {
          const executedSteps = [];
          try {
            for (const step of steps) {
              const result = await step.action(ctx);
              executedSteps.push({ step, result });
            }
            return { success: true, results: executedSteps };
          } catch (error) {
            // Compensate in reverse order
            for (const executed of executedSteps.reverse()) {
              await executed.step.compensation(ctx);
            }
            throw error;
          }
        }
      );

      // Act & Assert
      await expect(workflowEngine.executeSaga(workflowId, sagaSteps, context))
        .rejects
        .toThrow('Shipping service unavailable');

      expect(sagaSteps[0].action).toHaveBeenCalledWith(context);
      expect(sagaSteps[1].action).toHaveBeenCalledWith(context);
      expect(sagaSteps[2].action).toHaveBeenCalledWith(context);
      expect(mockEventStore.append).toHaveBeenCalledWith(expect.objectContaining({
        type: EventType.SAGA_FAILED
      }));
    });

    it('should execute saga successfully', async () => {
      // Arrange
      const workflowId = uuidv4();
      const sagaSteps: SagaStep[] = [
        {
          name: 'step1',
          action: jest.fn().mockResolvedValue({ result: 'success1' }),
          compensation: jest.fn()
        },
        {
          name: 'step2',
          action: jest.fn().mockResolvedValue({ result: 'success2' }),
          compensation: jest.fn()
        }
      ];

      const context = { data: 'test' };

      mockCompensationHandler.executeWithCompensation.mockResolvedValue({
        success: true,
        results: [
          { step: sagaSteps[0], result: { result: 'success1' } },
          { step: sagaSteps[1], result: { result: 'success2' } }
        ]
      });

      // Act
      const result = await workflowEngine.executeSaga(workflowId, sagaSteps, context);

      // Assert
      expect(result).toEqual({
        success: true,
        results: expect.any(Array)
      });
      expect(mockEventStore.append).toHaveBeenCalledWith(expect.objectContaining({
        type: EventType.SAGA_COMPLETED
      }));
    });
  });

  describe('getWorkflowHistory', () => {
    it('should retrieve workflow event history', async () => {
      // Arrange
      const workflowId = uuidv4();
      const events = [
        {
          id: uuidv4(),
          workflowId,
          type: EventType.WORKFLOW_STARTED,
          timestamp: new Date('2024-01-01'),
          data: { state: 'PENDING' }
        },
        {
          id: uuidv4(),
          workflowId,
          type: EventType.STATE_TRANSITIONED,
          timestamp: new Date('2024-01-02'),
          data: { from: 'PENDING', to: 'PROCESSING' }
        }
      ];

      mockEventStore.getEvents.mockResolvedValue(events);

      // Act
      const result = await workflowEngine.getWorkflowHistory(workflowId);

      // Assert
      expect(mockEventStore.getEvents).toHaveBeenCalledWith(workflowId);
      expect(result).toEqual(events);
    });
  });

  describe('applyTemplate', () => {
    it('should create workflow from template', async () => {
      // Arrange
      const template: WorkflowTemplate = {
        id: 'order-processing-template',
        name: 'Order Processing Template',
        description: 'Standard order processing workflow',
        definition: {
          id: 'order-workflow',
          name: 'Order Workflow',
          version: '1.0.0',
          states: {
            PENDING: { on: { CONFIRM: 'PROCESSING' } },
            PROCESSING: { on: { COMPLETE: 'COMPLETED' } },
            COMPLETED: { type: 'final' }
          },
          initialState: 'PENDING',
          context: {
            orderId: null,
            customerId: null
          }
        },
        parameters: ['orderId', 'customerId']
      };

      const params = {
        orderId: '12345',
        customerId: 'cust-123'
      };

      const expectedInstance: WorkflowInstance = {
        id: uuidv4(),
        definitionId: template.definition.id,
        currentState: 'PENDING',
        context: params,
        status: WorkflowStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 0
      };

      mockWorkflowRepository.getTemplate.mockResolvedValue(template);
      mockWorkflowRepository.create.mockResolvedValue(expectedInstance);
      mockEventStore.append.mockResolvedValue();

      // Act
      const result = await workflowEngine.applyTemplate(template.id, params);

      // Assert
      expect(mockWorkflowRepository.getTemplate).toHaveBeenCalledWith(template.id);
      expect(mockWorkflowRepository.create).toHaveBeenCalledWith(expect.objectContaining({
        definitionId: template.definition.id,
        context: params
      }));
      expect(result).toEqual(expectedInstance);
    });

    it('should validate template parameters', async () => {
      // Arrange
      const template: WorkflowTemplate = {
        id: 'template-1',
        name: 'Template',
        description: 'Test template',
        definition: {} as WorkflowDefinition,
        parameters: ['required1', 'required2']
      };

      const invalidParams = {
        required1: 'value1'
        // missing required2
      };

      mockWorkflowRepository.getTemplate.mockResolvedValue(template);

      // Act & Assert
      await expect(workflowEngine.applyTemplate(template.id, invalidParams))
        .rejects
        .toThrow('Missing required parameter: required2');
    });
  });

  describe('cancelWorkflow', () => {
    it('should cancel active workflow', async () => {
      // Arrange
      const workflowId = uuidv4();
      const instance: WorkflowInstance = {
        id: workflowId,
        definitionId: 'workflow-1',
        currentState: 'PROCESSING',
        context: {},
        status: WorkflowStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1
      };

      mockWorkflowRepository.findById.mockResolvedValue(instance);
      mockWorkflowRepository.update.mockResolvedValue({
        ...instance,
        status: WorkflowStatus.CANCELLED
      });
      mockEventStore.append.mockResolvedValue();

      // Act
      const result = await workflowEngine.cancelWorkflow(workflowId, 'User requested cancellation');

      // Assert
      expect(mockWorkflowRepository.update).toHaveBeenCalledWith(workflowId, {
        status: WorkflowStatus.CANCELLED
      });
      expect(mockEventStore.append).toHaveBeenCalledWith(expect.objectContaining({
        type: EventType.WORKFLOW_CANCELLED,
        data: { reason: 'User requested cancellation' }
      }));
      expect(result.status).toBe(WorkflowStatus.CANCELLED);
    });

    it('should not cancel already completed workflow', async () => {
      // Arrange
      const workflowId = uuidv4();
      const instance: WorkflowInstance = {
        id: workflowId,
        definitionId: 'workflow-1',
        currentState: 'COMPLETED',
        context: {},
        status: WorkflowStatus.COMPLETED,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1
      };

      mockWorkflowRepository.findById.mockResolvedValue(instance);

      // Act & Assert
      await expect(workflowEngine.cancelWorkflow(workflowId, 'Cancel attempt'))
        .rejects
        .toThrow('Cannot cancel workflow in status: COMPLETED');
    });
  });

  describe('retryFailedWorkflow', () => {
    it('should retry failed workflow from last successful state', async () => {
      // Arrange
      const workflowId = uuidv4();
      const instance: WorkflowInstance = {
        id: workflowId,
        definitionId: 'workflow-1',
        currentState: 'FAILED',
        context: { lastSuccessfulState: 'PROCESSING' },
        status: WorkflowStatus.FAILED,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 2
      };

      const events = [
        {
          id: uuidv4(),
          workflowId,
          type: EventType.STATE_TRANSITIONED,
          timestamp: new Date(),
          data: { from: 'PENDING', to: 'PROCESSING' }
        },
        {
          id: uuidv4(),
          workflowId,
          type: EventType.STATE_TRANSITIONED,
          timestamp: new Date(),
          data: { from: 'PROCESSING', to: 'FAILED' }
        }
      ];

      mockWorkflowRepository.findById.mockResolvedValue(instance);
      mockEventStore.getEvents.mockResolvedValue(events);
      mockWorkflowRepository.update.mockResolvedValue({
        ...instance,
        currentState: 'PROCESSING',
        status: WorkflowStatus.ACTIVE
      });
      mockEventStore.append.mockResolvedValue();

      // Act
      const result = await workflowEngine.retryFailedWorkflow(workflowId);

      // Assert
      expect(mockWorkflowRepository.update).toHaveBeenCalledWith(workflowId, {
        currentState: 'PROCESSING',
        status: WorkflowStatus.ACTIVE
      });
      expect(mockEventStore.append).toHaveBeenCalledWith(expect.objectContaining({
        type: EventType.WORKFLOW_RETRIED
      }));
      expect(result.status).toBe(WorkflowStatus.ACTIVE);
    });
  });
});