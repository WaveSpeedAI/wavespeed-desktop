/**
 * Circuit breaker — halt execution after too many retries.
 */
export class CircuitBreaker {
  private retryCountMap = new Map<string, number>()
  constructor(private maxRetries: number = 3) {}

  recordRetry(nodeId: string): boolean {
    const count = (this.retryCountMap.get(nodeId) ?? 0) + 1
    this.retryCountMap.set(nodeId, count)
    return count >= this.maxRetries
  }

  isTripped(nodeId: string): boolean {
    return (this.retryCountMap.get(nodeId) ?? 0) >= this.maxRetries
  }

  reset(nodeId: string): void { this.retryCountMap.delete(nodeId) }
  getRetryCount(nodeId: string): number { return this.retryCountMap.get(nodeId) ?? 0 }
}
