import { Pool } from 'pg';
import { WorkflowEventRecord, EventType } from '../interfaces/workflow.interface';

export class EventStore {
  constructor(private pool: Pool) {}

  async append(event: Omit<WorkflowEventRecord, 'id'>): Promise<void> {
    throw new Error('Not implemented');
  }

  async getEvents(workflowId: string, afterVersion?: number): Promise<WorkflowEventRecord[]> {
    throw new Error('Not implemented');
  }

  async getEventsByType(workflowId: string, eventType: EventType): Promise<WorkflowEventRecord[]> {
    throw new Error('Not implemented');
  }

  async getLastEvent(workflowId: string): Promise<WorkflowEventRecord | null> {
    throw new Error('Not implemented');
  }
}