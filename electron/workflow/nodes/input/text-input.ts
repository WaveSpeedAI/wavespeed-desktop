/**
 * Text Input node — provides a text/prompt value to downstream nodes.
 *
 * Features:
 * - Large textarea for prompt / text editing
 * - Prompt Optimizer integration (AI-powered prompt enhancement)
 * - Prompt Library (save / load reusable text snippets)
 *
 * Output is a text string that can connect to AI Task nodes' prompt
 * or any other text parameter handle.
 */
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../base'
import type { NodeTypeDefinition } from '../../../../src/workflow/types/node-defs'

export const textInputDef: NodeTypeDefinition = {
  type: 'input/text-input',
  category: 'input',
  label: 'Text',
  icon: '✏️',
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

    return {
      status: 'success',
      outputs: { output: text },
      resultPath: text,
      resultMetadata: { output: text },
      durationMs: Date.now() - start,
      cost: 0
    }
  }
}
