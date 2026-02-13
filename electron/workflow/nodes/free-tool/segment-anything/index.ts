import type { NodeTypeDefinition } from '../../../../../src/workflow/types/node-defs'
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../../base'
import { executeFreeToolInRenderer } from '../../../ipc/free-tool.ipc'

export const segmentAnythingDef: NodeTypeDefinition = {
  type: 'free-tool/segment-anything',
  category: 'free-tool',
  label: 'Segment Anything',
  icon: '🖱️',
  inputs: [{ key: 'input', label: 'Image', dataType: 'image', required: true }],
  outputs: [{ key: 'output', label: 'Mask', dataType: 'image', required: true }],
  params: []
}

export class SegmentAnythingHandler extends BaseNodeHandler {
  constructor() {
    super(segmentAnythingDef)
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
        error: 'No input image provided.'
      }
    }

    try {
      ctx.onProgress(0, 'Running segment anything in renderer...')
      const result = await executeFreeToolInRenderer({
        nodeType: 'free-tool/segment-anything',
        workflowId: ctx.workflowId,
        nodeId: ctx.nodeId,
        inputs: { input },
        params: {
          pointX: ctx.params.pointX ?? 0.5,
          pointY: ctx.params.pointY ?? 0.5,
          __segmentPoints: ctx.params.__segmentPoints,
          __previewMask: ctx.params.__previewMask
        }
      })
      ctx.onProgress(100, 'Segmentation completed.')
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
