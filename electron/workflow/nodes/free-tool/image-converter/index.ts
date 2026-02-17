import type { NodeTypeDefinition } from '../../../../../src/workflow/types/node-defs'
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../../base'
import { createOutputPath, resolveInputToLocalFile, runFfmpeg, toLocalAssetUrl } from '../shared/media-utils'

const IMAGE_FORMATS = ['png', 'jpg', 'webp', 'gif', 'bmp'] as const

export const imageConverterDef: NodeTypeDefinition = {
  type: 'free-tool/image-converter',
  category: 'free-tool',
  label: 'Image Converter',
  inputs: [{ key: 'input', label: 'Image', dataType: 'image', required: true }],
  outputs: [{ key: 'output', label: 'Output', dataType: 'image', required: true }],
  params: [
    {
      key: 'format',
      label: 'Format',
      type: 'select',
      default: 'png',
      dataType: 'text',
      connectable: false,
      options: IMAGE_FORMATS.map(v => ({ label: v.toUpperCase(), value: v }))
    }
  ]
}

export class ImageConverterHandler extends BaseNodeHandler {
  constructor() {
    super(imageConverterDef)
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const format = String(ctx.params.format ?? 'png').toLowerCase()
    const input = String(ctx.inputs.input ?? ctx.params.input ?? '')

    if (!IMAGE_FORMATS.includes(format as (typeof IMAGE_FORMATS)[number])) {
      return {
        status: 'error',
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: `Unsupported image format: ${format}`
      }
    }

    const resolved = await resolveInputToLocalFile(input, ctx.workflowId, ctx.nodeId)
    const outputPath = createOutputPath(ctx.workflowId, ctx.nodeId, 'image_converter', format)

    try {
      ctx.onProgress(10, 'Preparing image conversion...')
      await runFfmpeg(['-y', '-i', resolved.localPath, '-frames:v', '1', outputPath])
      ctx.onProgress(100, 'Image conversion completed.')
      const outputUrl = toLocalAssetUrl(outputPath)

      return {
        status: 'success',
        outputs: { output: outputUrl },
        resultPath: outputUrl,
        resultMetadata: {
          output: outputUrl,
          resultUrl: outputUrl,
          resultUrls: [outputUrl],
          outputPath
        },
        durationMs: Date.now() - start,
        cost: 0
      }
    } catch (error) {
      return {
        status: 'error',
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    } finally {
      resolved.cleanup()
    }
  }
}

