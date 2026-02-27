/**
 * Execution engine orchestrator — coordinates node execution across the workflow.
 */
import { v4 as uuid } from 'uuid'
import { topologicalLevels, downstreamNodes } from './scheduler'
import { CacheService } from './cache'
import { CostService } from './cost'
import { CircuitBreaker } from './circuit-breaker'
import { NodeRegistry } from '../nodes/registry'
import { computeInputHash, computeParamsHash } from '../utils/hash'
import { insertExecution, getExecutionById } from '../db/execution.repo'
import { getNodesByWorkflowId, updateNodeCurrentOutputId } from '../db/node.repo'
import { getEdgesByWorkflowId } from '../db/edge.repo'
import { getDatabase, persistDatabase } from '../db/connection'
import { getFileStorageInstance } from '../utils/file-storage'
import { saveWorkflowResultToAssets } from '../utils/save-to-assets'
import { getWorkflowById } from '../db/workflow.repo'
import type { NodeExecutionContext, NodeExecutionResult } from '../nodes/base'
import type { NodeStatus } from '../../../src/workflow/types/execution'
import type { WorkflowNode, WorkflowEdge } from '../../../src/workflow/types/workflow'
import { MAX_PARALLEL_EXECUTIONS } from '../../../src/workflow/constants'

function getFileStorage() { return getFileStorageInstance() }

export interface ExecutionCallbacks {
  onNodeStatus: (workflowId: string, nodeId: string, status: NodeStatus, errorMessage?: string) => void
  onProgress: (workflowId: string, nodeId: string, progress: number, message?: string) => void
  onEdgeStatus?: (workflowId: string, edgeId: string, status: 'no-data' | 'has-data') => void
}

export class ExecutionEngine {
  private abortControllers = new Map<string, AbortController>()

  constructor(
    private registry: NodeRegistry,
    private cache: CacheService,
    private costService: CostService,
    private circuitBreaker: CircuitBreaker,
    private callbacks: ExecutionCallbacks
  ) {}

  /** Run all nodes in topological order. */
  async runAll(workflowId: string): Promise<void> {
    const nodes = getNodesByWorkflowId(workflowId)
    const edges = getEdgesByWorkflowId(workflowId)
    const nodeIds = nodes.map(n => n.id)
    const simpleEdges = edges.map(e => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId }))

    // Cost estimate (for UI only) is done via cost:estimate IPC; we don't block runs on budget since actual API cost varies by inputs.
    const levels = topologicalLevels(nodeIds, simpleEdges)
    const nodeMap = new Map(nodes.map(n => [n.id, n]))
    const failedNodes = new Set<string>()

    // Build upstream dependency map for quick lookup
    const upstreamMap = new Map<string, string[]>()
    for (const e of simpleEdges) {
      const deps = upstreamMap.get(e.targetNodeId) ?? []
      deps.push(e.sourceNodeId)
      upstreamMap.set(e.targetNodeId, deps)
    }

    for (const level of levels) {
      // Stop the entire workflow if any node has failed
      if (failedNodes.size > 0) break
      const batch = level.slice(0, MAX_PARALLEL_EXECUTIONS)
      await Promise.all(batch.map(async nodeId => {
        // If another node in this batch failed, skip remaining
        if (failedNodes.size > 0) return
        // Skip if any upstream node failed
        const upstreams = upstreamMap.get(nodeId) ?? []
        if (upstreams.some(uid => failedNodes.has(uid))) {
          failedNodes.add(nodeId)
          this.callbacks.onNodeStatus(workflowId, nodeId, 'error', 'Skipped: upstream node failed')
          return
        }
        const success = await this.executeNode(workflowId, nodeId, nodeMap, edges, true)
        if (!success) failedNodes.add(nodeId)
      }))
    }
  }

  /** Run a single node, resolving upstream inputs. Always skips cache (user explicitly re-runs). */
  async runNode(workflowId: string, nodeId: string): Promise<void> {
    const nodes = getNodesByWorkflowId(workflowId)
    const edges = getEdgesByWorkflowId(workflowId)

    if (nodes.length === 0) {
      throw new Error(`No nodes found in workflow ${workflowId}. Please ensure the workflow is saved before running nodes.`)
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]))
    const node = nodeMap.get(nodeId)

    if (!node) {
      const availableIds = nodes.map(n => `${n.id} (${n.nodeType})`).join(', ')
      throw new Error(`Node ${nodeId} not found in workflow ${workflowId}. Available nodes: ${availableIds}`)
    }

    // skipCache=true: user clicked Run, they want a fresh execution
    await this.executeNode(workflowId, nodeId, nodeMap, edges, true)
  }

  /** Continue from a node — execute it and all downstream nodes. */
  async continueFrom(workflowId: string, nodeId: string): Promise<void> {
    const nodes = getNodesByWorkflowId(workflowId)
    const edges = getEdgesByWorkflowId(workflowId)
    const nodeIds = nodes.map(n => n.id)
    const simpleEdges = edges.map(e => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId }))
    const downstream = downstreamNodes(nodeId, nodeIds, simpleEdges)
    const nodeMap = new Map(nodes.map(n => [n.id, n]))

    const levels = topologicalLevels(nodeIds, simpleEdges)
    let stopped = false
    for (const level of levels) {
      if (stopped) break
      const toRun = level.filter(id => downstream.includes(id))
      if (toRun.length === 0) continue
      const results = await Promise.all(toRun.map(id => this.executeNode(workflowId, id, nodeMap, edges)))
      if (results.some(ok => !ok)) stopped = true
    }
  }

  /** Retry a node with a perturbed seed. */
  async retryNode(workflowId: string, nodeId: string): Promise<void> {
    if (this.circuitBreaker.isTripped(nodeId)) {
      throw new Error(`Circuit breaker tripped for node ${nodeId}`)
    }

    const nodes = getNodesByWorkflowId(workflowId)
    const edges = getEdgesByWorkflowId(workflowId)
    const nodeMap = new Map(nodes.map(n => [n.id, n]))
    const node = nodeMap.get(nodeId)
    if (!node) throw new Error(`Node ${nodeId} not found`)

    const perturbedParams = this.perturbSeed(node.params)
    const originalParams = { ...node.params }
    node.params = perturbedParams

    try {
      await this.executeNode(workflowId, nodeId, nodeMap, edges, true)
    } finally {
      node.params = originalParams
    }

    const tripped = this.circuitBreaker.recordRetry(nodeId)
    if (tripped) {
      this.callbacks.onNodeStatus(workflowId, nodeId, 'idle')
    }
  }

  /** Cancel a running node execution. */
  cancel(workflowId: string, nodeId: string): void {
    const key = `${workflowId}:${nodeId}`
    const controller = this.abortControllers.get(key)
    if (controller) {
      controller.abort()
      this.abortControllers.delete(key)
      this.callbacks.onNodeStatus(workflowId, nodeId, 'idle')
    }
  }

  /** Mark all downstream nodes as needing re-execution. */
  markDownstreamStale(workflowId: string, nodeId: string): string[] {
    const nodes = getNodesByWorkflowId(workflowId)
    const edges = getEdgesByWorkflowId(workflowId)
    const nodeIds = nodes.map(n => n.id)
    const simpleEdges = edges.map(e => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId }))
    const downstream = downstreamNodes(nodeId, nodeIds, simpleEdges)
    const staleNodes = downstream.filter(id => id !== nodeId)
    for (const id of staleNodes) {
      this.callbacks.onNodeStatus(workflowId, id, 'idle')
    }
    return staleNodes
  }

  /** Perturb seed parameter for retry diversity. */
  perturbSeed(params: Record<string, unknown>): Record<string, unknown> {
    const newParams = { ...params }
    if (typeof newParams.seed === 'number') {
      newParams.seed = newParams.seed + Math.floor(Math.random() * 1000) + 1
    } else {
      newParams.seed = Math.floor(Math.random() * 2147483647)
    }
    return newParams
  }

  /** Core execution logic for a single node. Returns true on success. */
  private async executeNode(
    workflowId: string,
    nodeId: string,
    nodeMap: Map<string, WorkflowNode>,
    edges: WorkflowEdge[],
    skipCache = false
  ): Promise<boolean> {
    const node = nodeMap.get(nodeId)
    if (!node) return false

    const handler = this.registry.getHandler(node.nodeType)
    if (!handler) {
      throw new Error(`No handler for node type: ${node.nodeType}`)
    }

    const inputs = this.resolveInputs(nodeId, nodeMap, edges)
    console.log(`[Executor] Node ${nodeId} (${node.nodeType}) resolved inputs:`, JSON.stringify(inputs).slice(0, 200))
    const inputHash = computeInputHash(inputs)
    const paramsHash = computeParamsHash(node.params)

    if (!skipCache) {
      const cached = this.cache.lookup(nodeId, inputHash, paramsHash)
      if (cached) {
        // Brief visual feedback before confirming cache hit
        this.callbacks.onNodeStatus(workflowId, nodeId, 'running')
        await new Promise(r => setTimeout(r, 300))
        updateNodeCurrentOutputId(nodeId, cached.id)
        node.currentOutputId = cached.id
        this.callbacks.onNodeStatus(workflowId, nodeId, 'confirmed')
        return true
      }
    }

    const abortKey = `${workflowId}:${nodeId}`
    const abortController = new AbortController()
    this.abortControllers.set(abortKey, abortController)

    this.callbacks.onNodeStatus(workflowId, nodeId, 'running')

    const executionId = uuid()
    insertExecution({
      id: executionId,
      nodeId,
      workflowId,
      inputHash,
      paramsHash,
      status: 'pending',
      resultPath: null,
      resultMetadata: null,
      durationMs: null,
      cost: 0,
      score: null,
      starred: false
    })

    const startTime = Date.now()
    let result: NodeExecutionResult
    let cancelledByUser = false

    try {
      const context: NodeExecutionContext = {
        nodeId,
        nodeType: node.nodeType,
        params: node.params,
        inputs,
        workflowId,
        abortSignal: abortController.signal,
        onProgress: (progress, message) => {
          this.callbacks.onProgress(workflowId, nodeId, progress, message)
        }
      }

      result = await handler.execute(context)
    } catch (error) {
      const isAbort = (err: unknown) =>
        err instanceof DOMException && err.name === 'AbortError' ||
        (err instanceof Error && err.message?.toLowerCase().includes('abort'))
      cancelledByUser = isAbort(error)
      result = {
        status: 'error',
        outputs: {},
        durationMs: Date.now() - startTime,
        cost: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    } finally {
      this.abortControllers.delete(abortKey)
    }

    const durationMs = result.durationMs || (Date.now() - startTime)
    const resultMetadata =
      result.resultMetadata ??
      (result.status === 'error' && result.error ? { error: result.error } : null)
    const dbConn = getDatabase()
    dbConn.run(
      `UPDATE node_executions SET status = ?, result_path = ?, result_metadata = ?, duration_ms = ?, cost = ? WHERE id = ?`,
      [result.status, result.resultPath ?? null, resultMetadata ? JSON.stringify(resultMetadata) : null,
       durationMs, result.cost, executionId]
    )
    persistDatabase()

    try {
      const storage = getFileStorage()
      storage.saveExecutionInput(workflowId, nodeId, executionId, inputs)
      storage.saveExecutionParams(workflowId, nodeId, executionId, node.params)
      storage.saveExecutionMetadata(workflowId, nodeId, executionId, {
        status: result.status,
        durationMs,
        cost: result.cost,
        createdAt: new Date().toISOString(),
        resultMetadata: resultMetadata ?? result.resultMetadata ?? {}
      })
    } catch (error) {
      console.error('[Executor] Failed to save execution snapshot:', error)
    }

    if (result.cost > 0) {
      this.costService.recordSpend(result.cost)
    }

    if (result.status === 'success') {
      updateNodeCurrentOutputId(nodeId, executionId)
      // CRITICAL: Also update the in-memory nodeMap so downstream nodes can resolve this output
      node.currentOutputId = executionId

      // Auto-download result media files to media_output/ directory
      try {
        const storage = getFileStorage()
        const modelId = String(node.params?.modelId ?? '')
        const resultUrls = result.resultMetadata?.resultUrls as string[] | undefined
        const urls = resultUrls ?? (result.resultPath ? [result.resultPath] : [])
        for (const url of urls) {
          if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            const localPath = await storage.downloadResult(workflowId, url, modelId)
            console.log(`[Executor] Downloaded result to: ${localPath}`)
          }
        }
      } catch (dlErr) {
        console.error('[Executor] Failed to download result:', dlErr)
      }

      // Save to My Assets (only for nodes that produce meaningful media output)
      const SAVEABLE_NODE_TYPES = ['ai-task/run']
      const isSaveableNode = SAVEABLE_NODE_TYPES.includes(node.nodeType) || node.nodeType.startsWith('free-tool/')
      if (isSaveableNode) {
        try {
          const workflow = getWorkflowById(workflowId)
          const wfName = workflow?.name ?? 'Workflow'
          const modelId = String(node.params?.modelId ?? node.nodeType)
          const resultUrls = result.resultMetadata?.resultUrls as string[] | undefined
          const urls = resultUrls ?? (result.resultPath ? [result.resultPath] : [])
          for (let i = 0; i < urls.length; i++) {
            const url = urls[i]
            if (url) {
              await saveWorkflowResultToAssets({
                url,
                modelId,
                workflowId,
                workflowName: wfName,
                nodeId,
                executionId,
                resultIndex: i
              })
            }
          }
        } catch (assetErr) {
          console.error('[Executor] Failed to save to My Assets:', assetErr)
        }
      }

      // Always set to confirmed after successful execution
      this.callbacks.onNodeStatus(workflowId, nodeId, 'confirmed')

      const outgoingEdges = edges.filter(e => e.sourceNodeId === nodeId)
      for (const edge of outgoingEdges) {
        this.callbacks.onEdgeStatus?.(workflowId, edge.id, 'has-data')
      }
      return true
    } else {
      const errorMsg = result.error || 'Unknown error'
      if (!cancelledByUser) {
        console.error('[Executor] Node execution failed:', errorMsg)
        this.callbacks.onNodeStatus(workflowId, nodeId, 'error', errorMsg)
      }
      // cancelledByUser: cancel() already set node to idle; don't overwrite with error

      const outgoingEdges = edges.filter(e => e.sourceNodeId === nodeId)
      for (const edge of outgoingEdges) {
        this.callbacks.onEdgeStatus?.(workflowId, edge.id, 'no-data')
      }
      return false
    }
  }

  /**
   * Resolve inputs for a node from upstream nodes' currentOutputId.
   *
   * Handle ID formats from the canvas:
   *   - "output"         → source output handle
   *   - "param-image"    → target param handle for "image"
   *   - "input-media"    → target input port handle for "media"
   *   - "images[0]"      → target array item handle for "images" at index 0
   *
   * This method:
   *   1. Gets the upstream node's latest execution result
   *   2. Reads the output value from resultMetadata by source handle key
   *   3. Maps it to the target param name, handling array indexing
   */
  private resolveInputs(
    nodeId: string,
    nodeMap: Map<string, WorkflowNode>,
    edges: WorkflowEdge[]
  ): Record<string, unknown> {
    const inputs: Record<string, unknown> = {}
    const incomingEdges = edges.filter(e => e.targetNodeId === nodeId)

    for (const edge of incomingEdges) {
      const sourceNode = nodeMap.get(edge.sourceNodeId)
      if (!sourceNode || !sourceNode.currentOutputId) continue

      const execution = getExecutionById(sourceNode.currentOutputId)
      if (!execution) continue

      // Get output value: try resultMetadata by handle key, then fallback to resultPath
      let outputValue: unknown
      if (execution.resultMetadata) {
        const meta = typeof execution.resultMetadata === 'string'
          ? JSON.parse(execution.resultMetadata)
          : execution.resultMetadata
        outputValue = meta[edge.sourceOutputKey]
        // Fallback: if not found by handle key, try 'resultUrl' (common pattern)
        if (outputValue === undefined) outputValue = meta.resultUrl
      }
      if (outputValue === undefined) outputValue = execution.resultPath
      if (outputValue === undefined) continue

      // Parse target handle ID to get the actual param name and optional array index
      const targetKey = edge.targetInputKey
      const arrayMatch = targetKey.match(/^(.+)\[(\d+)\]$/)

      if (arrayMatch) {
        // Array handle: "images[0]" → set inputs.images[0] = value
        // Store as a map so we can merge with node params later without sparse nulls
        const paramName = arrayMatch[1]
        const index = parseInt(arrayMatch[2])
        const mapKey = `__arrayInput_${paramName}`
        if (!inputs[mapKey]) inputs[mapKey] = {} as Record<number, string>
        ;(inputs[mapKey] as Record<number, string>)[index] = String(outputValue)
      } else if (targetKey.startsWith('param-')) {
        // Single param handle: "param-image" → set inputs.image = value
        const paramName = targetKey.slice(6) // remove "param-"
        inputs[paramName] = Array.isArray(outputValue) ? outputValue : String(outputValue)
      } else if (targetKey.startsWith('input-')) {
        // Input port handle: "input-media" → set inputs.media = value (pass arrays through for e.g. Select node)
        const inputName = targetKey.slice(6) // remove "input-"
        inputs[inputName] = Array.isArray(outputValue) ? outputValue : String(outputValue)
      } else {
        // Unknown format, use as-is
        inputs[targetKey] = outputValue
      }
    }

    return inputs
  }
}
