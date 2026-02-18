import type { NodeTypeDefinition } from '../../../../../src/workflow/types/node-defs'
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../../base'
import { executeFreeToolInRenderer } from '../../../ipc/free-tool.ipc'

export const imageEraserDef: NodeTypeDefinition = {
  type: 'free-tool/image-eraser',
  category: 'free-tool',
  label: 'Image Eraser',
  inputs: [
    { key: 'input', label: 'Image', dataType: 'image', required: true },
    { key: 'mask', label: 'Mask', dataType: 'image', required: true }
  ],
  outputs: [{ key: 'output', label: 'Output', dataType: 'image', required: true }],
  params: []
}

export class ImageEraserHandler extends BaseNodeHandler {
  constructor() {
    super(imageEraserDef)
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const input = String(ctx.inputs.input ?? ctx.params.input ?? '')
    const mask = String(ctx.inputs.mask ?? ctx.params.mask ?? '')

    if (!input) {
      return {
        status: 'error',
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: 'No input image provided.'
      }
    }
    if (!mask) {
      return {
        status: 'error',
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: 'No mask image provided.'
      }
    }

    try {
      ctx.onProgress(0, 'Running image eraser in renderer...')
      const result = await executeFreeToolInRenderer({
        nodeType: 'free-tool/image-eraser',
        workflowId: ctx.workflowId,
        nodeId: ctx.nodeId,
        inputs: { input, mask },
        params: {}
      })
      ctx.onProgress(100, 'Image eraser completed.')
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
