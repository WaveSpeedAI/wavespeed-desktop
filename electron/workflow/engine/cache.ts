/**
 * Cache service — lookup execution results by hash.
 */
import { findByCache } from '../db/execution.repo'
import type { NodeExecutionRecord } from '../../../src/workflow/types/execution'

export class CacheService {
  lookup(nodeId: string, inputHash: string, paramsHash: string): NodeExecutionRecord | null {
    return findByCache(nodeId, inputHash, paramsHash)
  }
}
