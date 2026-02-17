/**
 * Text Input node — provides a text/prompt value to downstream nodes.
 *
 * Features:
 * - Large textarea for prompt / text editing
 * - Prompt Optimizer integration (AI-powered prompt enhancement)
 * - Prompt Library (save / load reusable text snippets)
 * - "Optimize on Run": automatically optimizes the prompt via the
 *   wavespeed-ai/prompt-optimizer model before passing it downstream.
 *
 * Output is a text string that can connect to AI Task nodes' prompt
 * or any other text parameter handle.
 */
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../base'
import type { NodeTypeDefinition } from '../../../../src/workflow/types/node-defs'
import { getWaveSpeedClient } from '../../services/service-locator'

const OPTIMIZER_MODEL = 'wavespeed-ai/prompt-optimizer'

export const textInputDef: NodeTypeDefinition = {
  type: 'input/text-input',
  category: 'input',
  label: 'Text',
  inputs: [],
  outputs: [
    { key: 'output', label: 'Text', dataType: 'text', required: true }
  ],
  params: [
    { key: 'text', label: 'Text', type: 'textarea', dataType: 'text', connectable: false, default: '' }
  ]
}

export class TextInputHandler extends BaseNodeHandler {
  constructor() { super(textInputDef) }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const text = String(ctx.params.text ?? '')

    if (!text.trim()) {
      return {
        status: 'error',
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: 'No text provided. Please enter some text.'
      }
    }

    // ── "Optimize on Run" prompt optimization ──────────────────────────────
    const settings = (ctx.params.__optimizerSettings ?? {}) as Record<string, unknown>
    const optimizeOnRun = Boolean(settings.optimizeOnRun ?? settings.autoOptimize ?? false)

    // Skip if manually optimized text matches current text (already optimized)
    const lastManual = settings.lastManualOptimizedText
    const alreadyOptimized = typeof lastManual === 'string' && lastManual === text

    if (optimizeOnRun && !alreadyOptimized) {
      ctx.onProgress(10, 'Optimizing prompt...')
      try {
        const optimized = await this.optimizePrompt(text, settings, ctx.abortSignal)
        ctx.onProgress(90, 'Prompt optimized')
        return {
          status: 'success',
          outputs: { output: optimized },
          resultPath: optimized,
          resultMetadata: { output: optimized, originalText: text, optimized: true },
          durationMs: Date.now() - start,
          cost: 0 // optimizer cost is tracked by the optimizer model itself
        }
      } catch (error) {
        // Optimization failed — fall through and use original text
        console.warn('[TextInput] Prompt optimization failed, using original text:', error)
      }
    }

    return {
      status: 'success',
      outputs: { output: text },
      resultPath: text,
      resultMetadata: { output: text },
      durationMs: Date.now() - start,
      cost: 0
    }
  }

  /**
   * Call the prompt optimizer model with the user's text and saved settings.
   * Returns the optimized prompt string.
   */
  private async optimizePrompt(
    text: string,
    settings: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<string> {
    // Build API params — pass through optimizer settings (mode, style, etc.)
    // but strip internal keys that aren't API params.
    const apiParams: Record<string, unknown> = {}
    const skipKeys = new Set([
      'optimizeOnRun', 'autoOptimize', 'lastManualOptimizedText'
    ])
    for (const [key, value] of Object.entries(settings)) {
      if (skipKeys.has(key) || key.startsWith('__')) continue
      if (value !== undefined && value !== null && value !== '') {
        apiParams[key] = value
      }
    }
    apiParams.text = text

    if (signal.aborted) throw new Error('Aborted')

    const client = getWaveSpeedClient()
    const result = await client.run(OPTIMIZER_MODEL, apiParams)

    if (result.outputs && result.outputs.length > 0) {
      const output = result.outputs[0]
      return typeof output === 'string' ? output : JSON.stringify(output)
    }

    throw new Error('No optimized prompt returned from optimizer')
  }
}
