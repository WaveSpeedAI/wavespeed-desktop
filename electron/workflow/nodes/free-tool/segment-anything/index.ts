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
  params: [
    {
      key: 'pointX',
      label: 'Point X',
      type: 'slider',
      default: 0.5,
      dataType: 'text',
      connectable: false,
      validation: { min: 0, max: 1, step: 0.01 },
      description: 'Normalized X (0-1) for segmentation point'
    },
    {
      key: 'pointY',
      label: 'Point Y',
      type: 'slider',
      default: 0.5,
      dataType: 'text',
      connectable: false,
      validation: { min: 0, max: 1, step: 0.01 },
      description: 'Normalized Y (0-1) for segmentation point'
    }
  ]
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
          __segmentPoints: ctx.params.__segmentPoints
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
