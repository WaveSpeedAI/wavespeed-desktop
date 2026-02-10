/**
 * AI Task node — universal node for all WaveSpeed AI models.
 * Uses Desktop's API client instead of improver's WaveSpeedClient.
 */
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../base'
import type { NodeTypeDefinition } from '../../../../src/workflow/types/node-defs'
import { getWaveSpeedClient } from '../../services/service-locator'
import { getModelById } from '../../services/model-list'

export const aiTaskDef: NodeTypeDefinition = {
  type: 'ai-task/run',
  category: 'ai-task',
  label: 'Generate',
  icon: '🤖',
  inputs: [],
  outputs: [
    { key: 'output', label: 'Output', dataType: 'url', required: true }
  ],
  params: [
    { key: 'modelId', label: 'Model', type: 'string', dataType: 'text', connectable: false, default: '' }
  ]
}

export class AITaskHandler extends BaseNodeHandler {
  constructor() { super(aiTaskDef) }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const modelId = String(ctx.params.modelId ?? '')

    if (!modelId) {
      return { status: 'error', outputs: {}, durationMs: Date.now() - start, cost: 0, error: 'No model selected.' }
    }

    const apiParams = this.buildApiParams(ctx)
    ctx.onProgress(5, `Running ${modelId}...`)

    try {
      const client = getWaveSpeedClient()
      // Use Desktop's apiClient.run() which handles submit + poll
      const result = await client.run(modelId, apiParams)

      const outputUrl = Array.isArray(result.outputs) && result.outputs.length > 0
        ? String(result.outputs[0])
        : ''

      const model = getModelById(modelId)
      const cost = model?.costPerRun ?? 0

      return {
        status: 'success',
        outputs: { output: outputUrl },
        resultPath: outputUrl,
        resultMetadata: {
          // Store output by handle key so resolveInputs can find it
          output: outputUrl,
          resultUrl: outputUrl,
          resultUrls: Array.isArray(result.outputs) ? result.outputs : [outputUrl],
          modelId,
          raw: result
        },
        durationMs: Date.now() - start,
        cost
      }
    } catch (error) {
      return {
        status: 'error', outputs: {}, durationMs: Date.now() - start, cost: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  estimateCost(params: Record<string, unknown>): number {
    const modelId = String(params.modelId ?? '')
    if (!modelId) return 0
    const model = getModelById(modelId)
    return model?.costPerRun ?? 0
  }

  private buildApiParams(ctx: NodeExecutionContext): Record<string, unknown> {
    const params: Record<string, unknown> = {}
    // Internal keys to skip
    const skipKeys = new Set(['modelId', '__meta', '__locks', '__nodeWidth', '__nodeHeight'])
    for (const [key, value] of Object.entries(ctx.params)) {
      if (skipKeys.has(key) || key.startsWith('__')) continue
      if (value !== undefined && value !== null && value !== '') params[key] = value
    }
    // Merge resolved inputs (from upstream connections) — these override local params
    for (const [key, value] of Object.entries(ctx.inputs)) {
      if (key.startsWith('__arrayInput_')) {
        // Array input map: merge connected items into the existing param array
        const paramName = key.slice('__arrayInput_'.length)
        const indexMap = value as Record<number, string>
        const existing = Array.isArray(params[paramName]) ? [...params[paramName] as unknown[]] : []
        for (const [idx, val] of Object.entries(indexMap)) {
          existing[Number(idx)] = val
        }
        // Filter out empty/null entries — API expects only valid values
        params[paramName] = existing.filter(v => v !== undefined && v !== null && v !== '')
      } else if (value !== undefined && value !== null && value !== '') {
        params[key] = Array.isArray(value) ? value : String(value)
      }
    }
    if (typeof params.seed === 'number' && params.seed < 0) delete params.seed
    return params
  }
}
