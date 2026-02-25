/**
 * Run workflow in the browser (no Electron).
 * Uses apiClient for AI tasks and free-tool-runner for free-tool nodes.
 */
import { apiClient } from '@/api/client'
import { topologicalLevels, type SimpleEdge } from '@/workflow/lib/topological'
import {
  runImageEnhancer,
  runBackgroundRemover,
  runFaceEnhancer,
  runVideoEnhancer,
  runFaceSwapper,
  runImageEraser,
  runSegmentAnything
} from '@/workflow/lib/free-tool-runner'
import { normalizePayloadArrays } from '@/lib/schemaToForm'
import { BROWSER_NODE_DEFINITIONS } from './node-definitions'
import type { ModelParamSchema } from '@/workflow/types/node-defs'

const SKIP_KEYS = new Set(['modelId', '__meta', '__locks', '__nodeWidth', '__nodeHeight'])

const nodeDefMap = new Map(BROWSER_NODE_DEFINITIONS.map(d => [d.type, d]))

export interface BrowserNode {
  id: string
  data: { nodeType: string; params?: Record<string, unknown> }
}

export interface BrowserEdge {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface RunInBrowserCallbacks {
  onNodeStatus: (nodeId: string, status: 'running' | 'confirmed' | 'error', errorMessage?: string) => void
  onProgress: (nodeId: string, progress: number, message?: string) => void
  onNodeComplete: (nodeId: string, result: { urls: string[]; cost: number; durationMs?: number }) => void
}

interface NodeResult {
  outputUrl: string
  resultMetadata: Record<string, unknown>
}

function buildApiParams(
  params: Record<string, unknown>,
  inputs: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const meta = params.__meta as Record<string, unknown> | undefined
  const schema = (meta?.modelInputSchema ?? []) as Array<{ name: string; default?: unknown; enum?: string[] }>
  for (const s of schema) {
    if (SKIP_KEYS.has(s.name) || s.name.startsWith('__')) continue
    if (s.default !== undefined && s.default !== null && s.default !== '') out[s.name] = s.default
    else if (s.enum?.length) out[s.name] = s.enum[0]
  }
  for (const [key, value] of Object.entries(params)) {
    if (SKIP_KEYS.has(key) || key.startsWith('__')) continue
    if (value !== undefined && value !== null && value !== '') out[key] = value
  }
  for (const [key, value] of Object.entries(inputs)) {
    if (key.startsWith('__arrayInput_')) {
      const paramName = key.slice('__arrayInput_'.length)
      const indexMap = value as Record<number, string>
      const existing = Array.isArray(out[paramName]) ? [...(out[paramName] as unknown[])] : []
      for (const [idx, val] of Object.entries(indexMap)) existing[Number(idx)] = val
      out[paramName] = existing.filter(v => v !== undefined && v !== null && v !== '')
    } else if (value !== undefined && value !== null && value !== '') {
      out[key] = Array.isArray(value) ? value : String(value)
    }
  }
  if (typeof out.seed === 'number' && (out.seed as number) < 0) delete out.seed
  return normalizePayloadArrays(out, [])
}

function resolveInputs(
  nodeId: string,
  _nodeMap: Map<string, BrowserNode>,
  edges: { source: string; target: string; sourceHandle: string; targetHandle: string }[],
  results: Map<string, NodeResult>
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  const incoming = edges.filter(e => e.target === nodeId)
  for (const e of incoming) {
    const res = results.get(e.source)
    if (!res) continue
    let outputValue: unknown = res.resultMetadata[e.sourceHandle] ?? res.resultMetadata.output ?? res.resultMetadata.resultUrl ?? res.outputUrl
    if (outputValue === undefined) outputValue = res.outputUrl

    const targetKey = e.targetHandle
    const arrayMatch = /^(.+)\[(\d+)\]$/.exec(targetKey)
    if (arrayMatch) {
      const paramName = arrayMatch[1]
      const index = parseInt(arrayMatch[2], 10)
      const mapKey = `__arrayInput_${paramName}`
      if (!inputs[mapKey]) (inputs as Record<string, unknown>)[mapKey] = {} as Record<number, string>
      ((inputs as Record<string, unknown>)[mapKey] as Record<number, string>)[index] = String(outputValue)
    } else if (targetKey.startsWith('param-')) {
      inputs[targetKey.slice(6)] = Array.isArray(outputValue) ? outputValue : String(outputValue)
    } else if (targetKey.startsWith('input-')) {
      inputs[targetKey.slice(6)] = Array.isArray(outputValue) ? outputValue : String(outputValue)
    } else {
      inputs[targetKey] = outputValue
    }
  }
  return inputs
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
}

/**
 * Validate that all required fields are present before running a node.
 * Returns a list of missing field labels (empty = valid).
 */
function validateNodeInputs(
  nodeType: string,
  params: Record<string, unknown>,
  inputs: Record<string, unknown>
): string[] {
  const missing: string[] = []

  if (nodeType === 'ai-task/run') {
    const meta = params.__meta as Record<string, unknown> | undefined
    const schema = (meta?.modelInputSchema ?? []) as ModelParamSchema[]
    for (const field of schema) {
      if (!field.required) continue
      const val = inputs[field.name] ?? params[field.name]
      if (isEmpty(val) && isEmpty(field.default)) {
        missing.push(field.label || field.name)
      }
    }
    return missing
  }

  const def = nodeDefMap.get(nodeType)
  if (def) {
    for (const inp of def.inputs) {
      if (!inp.required) continue
      const val = inputs[inp.key] ?? inputs[`input-${inp.key}`] ?? params[inp.key]
      if (isEmpty(val)) {
        missing.push(inp.label || inp.key)
      }
    }
  }
  return missing
}

function base64ToDataUrl(base64: string, mime = 'image/png'): string {
  if (base64.startsWith('data:')) return base64
  return `data:${mime};base64,${base64}`
}

/** Collect nodeId and all nodes that feed into it (upstream subgraph). */
function upstreamNodeIds(nodeId: string, simpleEdges: SimpleEdge[]): Set<string> {
  const out = new Set<string>([nodeId])
  const reverse = new Map<string, string[]>()
  for (const e of simpleEdges) {
    const list = reverse.get(e.targetNodeId) ?? []
    list.push(e.sourceNodeId)
    reverse.set(e.targetNodeId, list)
  }
  let queue = [nodeId]
  while (queue.length > 0) {
    const next: string[] = []
    for (const id of queue) {
      for (const src of reverse.get(id) ?? []) {
        if (!out.has(src)) {
          out.add(src)
          next.push(src)
        }
      }
    }
    queue = next
  }
  return out
}

/** Collect a node and all its downstream (forward) dependents. */
function downstreamNodeIds(nodeId: string, simpleEdges: SimpleEdge[]): Set<string> {
  const out = new Set<string>([nodeId])
  const forward = new Map<string, string[]>()
  for (const e of simpleEdges) {
    const list = forward.get(e.sourceNodeId) ?? []
    list.push(e.targetNodeId)
    forward.set(e.sourceNodeId, list)
  }
  let queue = [nodeId]
  while (queue.length > 0) {
    const next: string[] = []
    for (const id of queue) {
      for (const tgt of forward.get(id) ?? []) {
        if (!out.has(tgt)) {
          out.add(tgt)
          next.push(tgt)
        }
      }
    }
    queue = next
  }
  return out
}


export async function executeWorkflowInBrowser(
  nodes: BrowserNode[],
  edges: BrowserEdge[],
  callbacks: RunInBrowserCallbacks,
  options?: { runOnlyNodeId?: string; continueFromNodeId?: string; existingResults?: Map<string, string>; signal?: AbortSignal }
): Promise<void> {
  const signal = options?.signal
  const throwIfAborted = (): void => {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  }
  const simpleEdges: SimpleEdge[] = edges.map(e => ({
    sourceNodeId: e.source,
    targetNodeId: e.target
  }))
  const allNodeIds = nodes.map(n => n.id)
  let nodeIds: string[]
  let filteredNodes: BrowserNode[]
  let filteredEdges: BrowserEdge[]
  /** Nodes whose results should be reused (not re-executed) in continueFrom mode */
  let skipNodeIds: Set<string> | null = null
  if (options?.continueFromNodeId && allNodeIds.includes(options.continueFromNodeId)) {
    // Run the target node + all downstream; include upstream in the graph but skip executing them
    const downstream = downstreamNodeIds(options.continueFromNodeId, simpleEdges)
    const upstream = upstreamNodeIds(options.continueFromNodeId, simpleEdges)
    // The subgraph is upstream ∪ downstream so edges resolve correctly
    const subset = new Set([...upstream, ...downstream])
    nodeIds = allNodeIds.filter(id => subset.has(id))
    filteredNodes = nodes.filter(n => subset.has(n.id))
    filteredEdges = edges.filter(e => subset.has(e.source) && subset.has(e.target))
    // Skip upstream nodes (except the target node itself) — they keep their previous results
    skipNodeIds = new Set([...upstream].filter(id => !downstream.has(id)))
  } else if (options?.runOnlyNodeId && allNodeIds.includes(options.runOnlyNodeId)) {
    const subset = upstreamNodeIds(options.runOnlyNodeId, simpleEdges)
    nodeIds = allNodeIds.filter(id => subset.has(id))
    filteredNodes = nodes.filter(n => subset.has(n.id))
    filteredEdges = edges.filter(e => subset.has(e.source) && subset.has(e.target))
  } else {
    nodeIds = allNodeIds
    filteredNodes = nodes
    filteredEdges = edges
  }
  const nodeMap = new Map(filteredNodes.map(n => [n.id, n]))
  const edgesWithHandles = filteredEdges.map(e => ({
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? 'output',
    targetHandle: e.targetHandle ?? 'input'
  }))
  const simpleEdgesSubgraph: SimpleEdge[] = filteredEdges.map(e => ({
    sourceNodeId: e.source,
    targetNodeId: e.target
  }))
  const results = new Map<string, NodeResult>()
  const failedNodes = new Set<string>()
  const levels = topologicalLevels(nodeIds, simpleEdgesSubgraph)
  const upstreamMap = new Map<string, string[]>()
  for (const e of simpleEdgesSubgraph) {
    const deps = upstreamMap.get(e.targetNodeId) ?? []
    deps.push(e.sourceNodeId)
    upstreamMap.set(e.targetNodeId, deps)
  }

  for (const level of levels) {
    throwIfAborted()
    await Promise.all(level.map(async nodeId => {
      throwIfAborted()
      const upstreams = upstreamMap.get(nodeId) ?? []
      if (upstreams.some(uid => failedNodes.has(uid))) {
        failedNodes.add(nodeId)
        callbacks.onNodeStatus(nodeId, 'error', 'Skipped: upstream node failed')
        return
      }

      const node = nodeMap.get(nodeId)
      if (!node) return
      const nodeType = node.data.nodeType
      const params = node.data.params ?? {}

      // continueFrom: skip upstream nodes — use existing results so downstream can resolve inputs
      if (skipNodeIds?.has(nodeId)) {
        const existingUrl = options?.existingResults?.get(nodeId)
        const existingOutput = existingUrl || String(params.uploadedUrl ?? params.text ?? params.prompt ?? params.output ?? '')
        if (existingOutput) {
          results.set(nodeId, { outputUrl: existingOutput, resultMetadata: { output: existingOutput } })
        }
        return
      }

      const inputs = resolveInputs(nodeId, nodeMap, edgesWithHandles, results)

      // Validate required fields before running
      const missingFields = validateNodeInputs(nodeType, params, inputs)
      if (missingFields.length > 0) {
        failedNodes.add(nodeId)
        callbacks.onNodeStatus(nodeId, 'error', `Missing required fields: ${missingFields.join(', ')}`)
        return
      }

      callbacks.onNodeStatus(nodeId, 'running')
      const start = Date.now()
      const onProgress = (p: number, msg?: string) => callbacks.onProgress(nodeId, p, msg)

      try {
        if (nodeType === 'ai-task/run') {
          const modelId = String(params.modelId ?? '')
          if (!modelId) {
            throw new Error('No model selected.')
          }
          const apiParams = buildApiParams(params, inputs)
          callbacks.onProgress(nodeId, 5, `Running ${modelId}...`)
          const result = await apiClient.run(modelId, apiParams, { signal })
          const outputUrl = Array.isArray(result.outputs) && result.outputs.length > 0
            ? String(result.outputs[0])
            : ''
          const durationMs = Date.now() - start
          results.set(nodeId, {
            outputUrl,
            resultMetadata: {
              output: outputUrl,
              resultUrl: outputUrl,
              resultUrls: Array.isArray(result.outputs) ? result.outputs.map(String) : [outputUrl],
              modelId,
              raw: result
            }
          })
          callbacks.onNodeStatus(nodeId, 'confirmed')
          callbacks.onNodeComplete(nodeId, {
            urls: Array.isArray(result.outputs) ? result.outputs.map(String) : [outputUrl],
            cost: 0,
            durationMs
          })
          return
        }

        if (nodeType === 'input/media-upload') {
          const url = String(inputs.media ?? params.uploadedUrl ?? '')
          if (!url) throw new Error('No file uploaded or connected.')
          results.set(nodeId, { outputUrl: url, resultMetadata: { output: url, resultUrl: url } })
          callbacks.onNodeStatus(nodeId, 'confirmed')
          callbacks.onNodeComplete(nodeId, { urls: [url], cost: 0, durationMs: Date.now() - start })
          return
        }

        if (nodeType === 'input/text-input') {
          const text = String(params.text ?? params.prompt ?? '')
          results.set(nodeId, { outputUrl: text, resultMetadata: { output: text, text } })
          callbacks.onNodeStatus(nodeId, 'confirmed')
          callbacks.onNodeComplete(nodeId, { urls: [text], cost: 0, durationMs: Date.now() - start })
          return
        }

        if (nodeType === 'output/preview') {
          const url = String(inputs.input ?? '')
          if (!url) throw new Error('No URL provided for preview.')
          results.set(nodeId, { outputUrl: url, resultMetadata: { previewUrl: url } })
          callbacks.onNodeStatus(nodeId, 'confirmed')
          callbacks.onNodeComplete(nodeId, { urls: [url], cost: 0, durationMs: Date.now() - start })
          return
        }

        // Free-tool nodes
        if (nodeType === 'free-tool/image-enhancer') {
          const inputUrl = String(inputs.input ?? '')
          if (!inputUrl) throw new Error('Missing input')
          const base64 = await runImageEnhancer(inputUrl, params as { model?: string; scale?: string }, onProgress)
          const dataUrl = base64ToDataUrl(base64)
          results.set(nodeId, { outputUrl: dataUrl, resultMetadata: { output: dataUrl, resultUrl: dataUrl } })
          callbacks.onNodeStatus(nodeId, 'confirmed')
          callbacks.onNodeComplete(nodeId, { urls: [dataUrl], cost: 0, durationMs: Date.now() - start })
          return
        }
        if (nodeType === 'free-tool/background-remover') {
          const inputUrl = String(inputs.input ?? '')
          if (!inputUrl) throw new Error('Missing input')
          const base64 = await runBackgroundRemover(inputUrl, params as { model?: string }, onProgress)
          const dataUrl = base64ToDataUrl(base64)
          results.set(nodeId, { outputUrl: dataUrl, resultMetadata: { output: dataUrl, resultUrl: dataUrl } })
          callbacks.onNodeStatus(nodeId, 'confirmed')
          callbacks.onNodeComplete(nodeId, { urls: [dataUrl], cost: 0, durationMs: Date.now() - start })
          return
        }
        if (nodeType === 'free-tool/face-enhancer') {
          const inputUrl = String(inputs.input ?? '')
          if (!inputUrl) throw new Error('Missing input')
          const base64 = await runFaceEnhancer(inputUrl, params, onProgress)
          const dataUrl = base64ToDataUrl(base64)
          results.set(nodeId, { outputUrl: dataUrl, resultMetadata: { output: dataUrl, resultUrl: dataUrl } })
          callbacks.onNodeStatus(nodeId, 'confirmed')
          callbacks.onNodeComplete(nodeId, { urls: [dataUrl], cost: 0, durationMs: Date.now() - start })
          return
        }
        if (nodeType === 'free-tool/video-enhancer') {
          const inputUrl = String(inputs.input ?? '')
          if (!inputUrl) throw new Error('Missing input')
          const base64 = await runVideoEnhancer(inputUrl, params as { model?: string; scale?: string }, onProgress)
          const dataUrl = base64ToDataUrl(base64, 'video/webm')
          results.set(nodeId, { outputUrl: dataUrl, resultMetadata: { output: dataUrl, resultUrl: dataUrl } })
          callbacks.onNodeStatus(nodeId, 'confirmed')
          callbacks.onNodeComplete(nodeId, { urls: [dataUrl], cost: 0, durationMs: Date.now() - start })
          return
        }
        if (nodeType === 'free-tool/face-swapper') {
          const sourceUrl = String(inputs.source ?? '')
          const targetUrl = String(inputs.target ?? '')
          if (!sourceUrl || !targetUrl) throw new Error('Missing source or target image')
          const base64 = await runFaceSwapper(sourceUrl, targetUrl, params, onProgress)
          const dataUrl = base64ToDataUrl(base64)
          results.set(nodeId, { outputUrl: dataUrl, resultMetadata: { output: dataUrl, resultUrl: dataUrl } })
          callbacks.onNodeStatus(nodeId, 'confirmed')
          callbacks.onNodeComplete(nodeId, { urls: [dataUrl], cost: 0, durationMs: Date.now() - start })
          return
        }
        if (nodeType === 'free-tool/image-eraser') {
          const imageUrl = String(inputs.input ?? '')
          const maskUrl = String(inputs.mask_image ?? '')
          if (!imageUrl || !maskUrl) throw new Error('Missing image or mask')
          const base64 = await runImageEraser(imageUrl, maskUrl, params, onProgress)
          const dataUrl = base64ToDataUrl(base64)
          results.set(nodeId, { outputUrl: dataUrl, resultMetadata: { output: dataUrl, resultUrl: dataUrl } })
          callbacks.onNodeStatus(nodeId, 'confirmed')
          callbacks.onNodeComplete(nodeId, { urls: [dataUrl], cost: 0, durationMs: Date.now() - start })
          return
        }
        if (nodeType === 'free-tool/segment-anything') {
          const inputUrl = String(inputs.input ?? '')
          if (!inputUrl) throw new Error('Missing input')
          const base64 = await runSegmentAnything(
            inputUrl,
            params as { pointX?: number; pointY?: number; __segmentPoints?: string; __previewMask?: string; invertMask?: boolean },
            onProgress
          )
          const dataUrl = base64ToDataUrl(base64)
          results.set(nodeId, { outputUrl: dataUrl, resultMetadata: { output: dataUrl, resultUrl: dataUrl } })
          callbacks.onNodeStatus(nodeId, 'confirmed')
          callbacks.onNodeComplete(nodeId, { urls: [dataUrl], cost: 0, durationMs: Date.now() - start })
          return
        }

        // Helper / processing nodes
        if (nodeType === 'processing/concat') {
          const VALUE_KEYS = ['value1', 'value2', 'value3', 'value4', 'value5']
          const arr: string[] = []
          for (const key of VALUE_KEYS) {
            const v = inputs[key] ?? params[key]
            if (v === undefined || v === null) continue
            if (Array.isArray(v)) {
              for (const item of v) {
                if (item !== undefined && item !== null && item !== '') arr.push(String(item))
              }
            } else {
              const s = String(v).trim()
              if (s) arr.push(s)
            }
          }
          if (arr.length === 0) throw new Error('Concat requires at least one non-empty value.')
          results.set(nodeId, {
            outputUrl: arr[0],
            resultMetadata: { output: arr, resultUrl: arr[0], resultUrls: arr }
          })
          callbacks.onNodeStatus(nodeId, 'confirmed')
          callbacks.onNodeComplete(nodeId, { urls: arr, cost: 0, durationMs: Date.now() - start })
          return
        }
        if (nodeType === 'processing/select') {
          const raw = inputs.input ?? params.input
          let arr: string[]
          if (Array.isArray(raw)) {
            arr = raw.filter((x): x is string => x !== undefined && x !== null).map(String)
          } else if (raw !== undefined && raw !== null && raw !== '') {
            const s = String(raw).trim()
            arr = s.includes(',') ? s.split(',').map(x => x.trim()).filter(Boolean) : [s]
          } else {
            arr = []
          }
          const index = Math.floor(Number(params.index ?? 0))
          if (index < 0 || index >= arr.length) {
            throw new Error(`Index ${index} out of range (array length ${arr.length}).`)
          }
          const value = arr[index]
          results.set(nodeId, {
            outputUrl: value,
            resultMetadata: { output: value, resultUrl: value, resultUrls: [value] }
          })
          callbacks.onNodeStatus(nodeId, 'confirmed')
          callbacks.onNodeComplete(nodeId, { urls: [value], cost: 0, durationMs: Date.now() - start })
          return
        }

        // Unsupported node type — treat as pass-through if it has a single input
        const inputUrl = String(inputs.input ?? inputs.media ?? params.uploadedUrl ?? '')
        if (inputUrl) {
          results.set(nodeId, { outputUrl: inputUrl, resultMetadata: { output: inputUrl } })
          callbacks.onNodeStatus(nodeId, 'confirmed')
          callbacks.onNodeComplete(nodeId, { urls: [inputUrl], cost: 0, durationMs: Date.now() - start })
        } else {
          throw new Error(`Unsupported node type in browser: ${nodeType}`)
        }
      } catch (err) {
        failedNodes.add(nodeId)
        const msg = err instanceof Error ? err.message : String(err)
        callbacks.onNodeStatus(nodeId, 'error', msg)
      }
    }))
  }
}
