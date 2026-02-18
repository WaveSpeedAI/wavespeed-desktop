import * as fs from 'fs'
import * as path from 'path'
import type { NodeTypeDefinition } from '../../../../../src/workflow/types/node-defs'
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../../base'
import { createOutputPath, resolveInputToLocalFile, runFfmpeg, toLocalAssetUrl } from '../shared/media-utils'

export const mediaMergerDef: NodeTypeDefinition = {
  type: 'free-tool/media-merger',
  category: 'free-tool',
  label: 'Media Merger',
  inputs: [
    { key: 'input1', label: 'Input 1', dataType: 'video', required: true },
    { key: 'input2', label: 'Input 2', dataType: 'video', required: true },
    { key: 'input3', label: 'Input 3', dataType: 'video', required: false },
    { key: 'input4', label: 'Input 4', dataType: 'video', required: false },
    { key: 'input5', label: 'Input 5', dataType: 'video', required: false },
  ],
  outputs: [{ key: 'output', label: 'Output', dataType: 'video', required: true }],
  params: [
    {
      key: 'format',
      label: 'Output Format',
      type: 'select',
      dataType: 'text',
      default: 'mp4',
      connectable: false,
      options: [
        { label: 'MP4', value: 'mp4' },
        { label: 'WebM', value: 'webm' },
        { label: 'MOV', value: 'mov' },
        { label: 'MKV', value: 'mkv' },
      ]
    }
  ]
}

export class MediaMergerHandler extends BaseNodeHandler {
  constructor() {
    super(mediaMergerDef)
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const format = String(ctx.params.format ?? 'mp4').toLowerCase()

    // Collect all non-empty inputs
    const inputKeys = ['input1', 'input2', 'input3', 'input4', 'input5']
    const inputUrls: string[] = []
    for (const key of inputKeys) {
      const val = String(ctx.inputs[key] ?? ctx.params[key] ?? '')
      if (val) inputUrls.push(val)
    }

    if (inputUrls.length < 2) {
      return {
        status: 'error',
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: 'Media merger requires at least two inputs.'
      }
    }

    const resolvedInputs = await Promise.all(
      inputUrls.map(url => resolveInputToLocalFile(url, ctx.workflowId, ctx.nodeId))
    )
    const outputPath = createOutputPath(ctx.workflowId, ctx.nodeId, 'media_merger', format)
    const concatListPath = path.join(path.dirname(outputPath), `concat_${Date.now()}.txt`)

    try {
      ctx.onProgress(10, 'Preparing merge...')

      const lines = resolvedInputs.map(r => {
        const escaped = r.localPath.replace(/'/g, "'\\''")
        return `file '${escaped}'`
      })
      fs.writeFileSync(concatListPath, lines.join('\n') + '\n', 'utf-8')

      // Re-encode to ensure correct timestamps and duration
      await runFfmpeg([
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
        '-c', 'copy',
        outputPath
      ])

      ctx.onProgress(100, 'Merge completed.')
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
      try {
        if (fs.existsSync(concatListPath)) fs.unlinkSync(concatListPath)
      } catch { /* ignore */ }
      resolvedInputs.forEach(r => r.cleanup())
    }
  }
}
