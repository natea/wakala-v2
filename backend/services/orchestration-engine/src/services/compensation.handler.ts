import { EventStore } from './event.store';
import {
  SagaStep,
  CompensationResult,
  CompensationStrategy,
  WorkflowContext,
  EventType
} from '../interfaces/workflow.interface';

export class CompensationHandler {
  constructor(private eventStore: EventStore) {}

  async executeWithCompensation(
    steps: SagaStep[],
    context: WorkflowContext,
    strategy: CompensationStrategy = CompensationStrategy.SEQUENTIAL
  ): Promise<CompensationResult> {
    throw new Error('Not implemented');
  }

  async compensate(
    executedSteps: Array<{ step: SagaStep; result: any }>,
    context: WorkflowContext,
    strategy: CompensationStrategy
  ): Promise<void> {
    throw new Error('Not implemented');
  }

  private async executeSequential(
    steps: SagaStep[],
    context: WorkflowContext
  ): Promise<CompensationResult> {
    throw new Error('Not implemented');
  }

  private async executeParallel(
    steps: SagaStep[],
    context: WorkflowContext
  ): Promise<CompensationResult> {
    throw new Error('Not implemented');
  }
}