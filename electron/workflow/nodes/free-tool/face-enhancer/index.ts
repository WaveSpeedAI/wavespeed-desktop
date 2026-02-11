import type { NodeTypeDefinition } from '../../../../../src/workflow/types/node-defs'
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../../base'
import { executeFreeToolInRenderer } from '../../../ipc/free-tool.ipc'

export const faceEnhancerDef: NodeTypeDefinition = {
  type: 'free-tool/face-enhancer',
  category: 'free-tool',
  label: 'Face Enhancer',
  icon: '✨',
  inputs: [{ key: 'input', label: 'Image', dataType: 'image', required: true }],
  outputs: [{ key: 'output', label: 'Output', dataType: 'image', required: true }],
  params: []
}

export class FaceEnhancerHandler extends BaseNodeHandler {
  constructor() {
    super(faceEnhancerDef)
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
      ctx.onProgress(0, 'Running face enhancer in renderer...')
      const result = await executeFreeToolInRenderer({
        nodeType: 'free-tool/face-enhancer',
        workflowId: ctx.workflowId,
        nodeId: ctx.nodeId,
        inputs: { input },
        params: {}
      })
      ctx.onProgress(100, 'Face enhancement completed.')
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
