import type { NodeTypeDefinition } from '../../../../../src/workflow/types/node-defs'
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../../base'
import { executeFreeToolInRenderer } from '../../../ipc/free-tool.ipc'

const MODEL_OPTIONS = [
  { label: 'Slim (fast)', value: 'slim' },
  { label: 'Medium', value: 'medium' },
  { label: 'Thick (quality)', value: 'thick' }
]
const SCALE_OPTIONS = [
  { label: '2×', value: '2x' },
  { label: '3×', value: '3x' },
  { label: '4×', value: '4x' }
]

export const imageEnhancerDef: NodeTypeDefinition = {
  type: 'free-tool/image-enhancer',
  category: 'free-tool',
  label: 'Image Enhancer',
  icon: '🖼️',
  inputs: [{ key: 'input', label: 'Image', dataType: 'image', required: true }],
  outputs: [{ key: 'output', label: 'Output', dataType: 'image', required: true }],
  params: [
    {
      key: 'model',
      label: 'Model',
      type: 'select',
      default: 'slim',
      dataType: 'text',
      connectable: false,
      options: MODEL_OPTIONS
    },
    {
      key: 'scale',
      label: 'Scale',
      type: 'select',
      default: '2x',
      dataType: 'text',
      connectable: false,
      options: SCALE_OPTIONS
    }
  ]
}

export class ImageEnhancerHandler extends BaseNodeHandler {
  constructor() {
    super(imageEnhancerDef)
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const input = String(ctx.inputs.input ?? ctx.params.input ?? '')

    if (!input) {
      return {
        status: 'error',
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: 'No input provided.'
      }
    }

    try {
      ctx.onProgress(0, 'Running image enhancer in renderer...')
      const result = await executeFreeToolInRenderer({
        nodeType: 'free-tool/image-enhancer',
        workflowId: ctx.workflowId,
        nodeId: ctx.nodeId,
        inputs: { input },
        params: {
          model: ctx.params.model ?? 'slim',
          scale: ctx.params.scale ?? '2x'
        }
      })
      ctx.onProgress(100, 'Image enhancement completed.')
      return result
    } catch (error) {
      return {
        status: 'error',
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
