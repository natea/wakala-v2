import { createMachine, StateMachine } from 'xstate';
import { 
  OrderStatus, 
  OrderEvent, 
  OrderEventType,
  OrderTransition 
} from '../interfaces/order.interface';

export class OrderStateMachine {
  private machine: StateMachine<any, any, any>;

  constructor() {
    this.machine = this.createOrderMachine();
  }

  getInitialState(): OrderStatus {
    return OrderStatus.PENDING;
  }

  transition(currentState: OrderStatus, event: OrderEvent): OrderTransition {
    throw new Error('Not implemented');
  }

  canTransition(currentState: OrderStatus, eventType: OrderEventType): boolean {
    throw new Error('Not implemented');
  }

  getAvailableTransitions(currentState: OrderStatus): OrderEventType[] {
    throw new Error('Not implemented');
  }

  private createOrderMachine() {
    return createMachine({
      id: 'order',
      initial: OrderStatus.PENDING,
      states: {
        [OrderStatus.PENDING]: {
          on: {
            [OrderEventType.CONFIRM]: OrderStatus.CONFIRMED,
            [OrderEventType.CANCEL]: OrderStatus.CANCELLED
          }
        },
        [OrderStatus.CONFIRMED]: {
          on: {
            [OrderEventType.START_PROCESSING]: OrderStatus.PROCESSING,
            [OrderEventType.CANCEL]: OrderStatus.CANCELLED
          }
        },
        [OrderStatus.PROCESSING]: {
          on: {
            [OrderEventType.MARK_READY]: OrderStatus.READY_FOR_PICKUP,
            [OrderEventType.FAIL]: OrderStatus.FAILED
          }
        },
        [OrderStatus.READY_FOR_PICKUP]: {
          on: {
            [OrderEventType.DISPATCH]: OrderStatus.OUT_FOR_DELIVERY
          }
        },
        [OrderStatus.OUT_FOR_DELIVERY]: {
          on: {
            [OrderEventType.DELIVER]: OrderStatus.DELIVERED,
            [OrderEventType.FAIL]: OrderStatus.FAILED
          }
        },
        [OrderStatus.DELIVERED]: {
          type: 'final'
        },
        [OrderStatus.CANCELLED]: {
          on: {
            [OrderEventType.REFUND]: OrderStatus.REFUNDED
          }
        },
        [OrderStatus.REFUNDED]: {
          type: 'final'
        },
        [OrderStatus.FAILED]: {
          type: 'final'
        }
      }
    });
  }
}