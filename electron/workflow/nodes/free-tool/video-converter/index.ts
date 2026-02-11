import type { NodeTypeDefinition } from '../../../../../src/workflow/types/node-defs'
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../../base'
import { createOutputPath, resolveInputToLocalFile, runFfmpeg, toLocalAssetUrl } from '../shared/media-utils'

const VIDEO_FORMATS = ['mp4', 'mov', 'webm', 'avi', 'mkv'] as const

export const videoConverterDef: NodeTypeDefinition = {
  type: 'free-tool/video-converter',
  category: 'free-tool',
  label: 'Video Converter',
  icon: '🎞️',
  inputs: [{ key: 'input', label: 'Video', dataType: 'video', required: true }],
  outputs: [{ key: 'output', label: 'Output', dataType: 'video', required: true }],
  params: [
    {
      key: 'format',
      label: 'Format',
      type: 'select',
      default: 'mp4',
      dataType: 'text',
      connectable: false,
      options: VIDEO_FORMATS.map(v => ({ label: v.toUpperCase(), value: v }))
    }
  ]
}

export class VideoConverterHandler extends BaseNodeHandler {
  constructor() {
    super(videoConverterDef)
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const format = String(ctx.params.format ?? 'mp4').toLowerCase()
    const input = String(ctx.inputs.input ?? ctx.params.input ?? '')

    if (!VIDEO_FORMATS.includes(format as (typeof VIDEO_FORMATS)[number])) {
      return {
        status: 'error',
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: `Unsupported video format: ${format}`
      }
    }

    const resolved = await resolveInputToLocalFile(input, ctx.workflowId, ctx.nodeId)
    const outputPath = createOutputPath(ctx.workflowId, ctx.nodeId, 'video_converter', format)

    try {
      ctx.onProgress(10, 'Preparing video conversion...')
      await runFfmpeg(['-y', '-i', resolved.localPath, outputPath])
      ctx.onProgress(100, 'Video conversion completed.')
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

