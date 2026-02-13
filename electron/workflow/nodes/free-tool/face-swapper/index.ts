import type { NodeTypeDefinition } from '../../../../../src/workflow/types/node-defs'
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../../base'
import { executeFreeToolInRenderer } from '../../../ipc/free-tool.ipc'

export const faceSwapperDef: NodeTypeDefinition = {
  type: 'free-tool/face-swapper',
  category: 'free-tool',
  label: 'Face Swapper',
  icon: '🔁',
  inputs: [
    { key: 'source', label: 'Source Face', dataType: 'image', required: true },
    { key: 'target', label: 'Target Image', dataType: 'image', required: true }
  ],
  outputs: [{ key: 'output', label: 'Output', dataType: 'image', required: true }],
  params: []
}

export class FaceSwapperHandler extends BaseNodeHandler {
  constructor() {
    super(faceSwapperDef)
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const source = String(ctx.inputs.source ?? ctx.params.source ?? '')
    const target = String(ctx.inputs.target ?? ctx.params.target ?? '')

    if (!source) {
      return {
        status: 'error',
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: 'No source image provided.'
      }
    }
    if (!target) {
      return {
        status: 'error',
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: 'No target image provided.'
      }
    }

    try {
      ctx.onProgress(0, 'Running face swapper in renderer...')
      const result = await executeFreeToolInRenderer({
        nodeType: 'free-tool/face-swapper',
        workflowId: ctx.workflowId,
        nodeId: ctx.nodeId,
        inputs: { source, target },
        params: {}
      })
      ctx.onProgress(100, 'Face swap completed.')
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
