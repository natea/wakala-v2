export interface CircuitBreakerConfig {
  failureThreshold?: number;
  resetTimeout?: number;
  monitoringPeriod?: number;
}

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export class CircuitBreaker {
  private serviceName: string;
  private state: CircuitState;
  private failureCount: number;
  private lastFailureTime: number;
  private successCount: number;
  private config: Required<CircuitBreakerConfig>;

  constructor(serviceName: string, config?: CircuitBreakerConfig) {
    this.serviceName = serviceName;
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.successCount = 0;
    
    this.config = {
      failureThreshold: config?.failureThreshold || 5,
      resetTimeout: config?.resetTimeout || 60000, // 1 minute
      monitoringPeriod: config?.monitoringPeriod || 10000 // 10 seconds
    };
  }

  public isOpen(): boolean {
    this.updateState();
    return this.state === CircuitState.OPEN;
  }

  public recordSuccess(): void {
    this.failureCount = 0;
    this.successCount++;

    if (this.state === CircuitState.HALF_OPEN && this.successCount >= 3) {
      this.state = CircuitState.CLOSED;
      console.log(`Circuit breaker for ${this.serviceName} is now CLOSED`);
    }
  }

  public recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.successCount = 0;

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      console.log(`Circuit breaker for ${this.serviceName} is now OPEN`);
    }
  }

  private updateState(): void {
    if (this.state === CircuitState.OPEN) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      
      if (timeSinceLastFailure >= this.config.resetTimeout) {
        this.state = CircuitState.HALF_OPEN;
        this.failureCount = 0;
        this.successCount = 0;
        console.log(`Circuit breaker for ${this.serviceName} is now HALF_OPEN`);
      }
    }
  }

  public getState(): CircuitState {
    this.updateState();
    return this.state;
  }

  public getMetrics(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime
    };
  }

  public reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }
}