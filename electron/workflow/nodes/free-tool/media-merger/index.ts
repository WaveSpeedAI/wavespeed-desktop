import * as fs from 'fs'
import * as path from 'path'
import type { NodeTypeDefinition } from '../../../../../src/workflow/types/node-defs'
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../../base'
import { createOutputPath, resolveInputToLocalFile, runFfmpeg, toLocalAssetUrl } from '../shared/media-utils'

export const mediaMergerDef: NodeTypeDefinition = {
  type: 'free-tool/media-merger',
  category: 'free-tool',
  label: 'Media Merger',
  icon: '🧩',
  inputs: [
    { key: 'first', label: 'Input A', dataType: 'url', required: true },
    { key: 'second', label: 'Input B', dataType: 'url', required: true }
  ],
  outputs: [{ key: 'output', label: 'Output', dataType: 'url', required: true }],
  params: [
    { key: 'format', label: 'Output Format', type: 'string', dataType: 'text', default: 'mp4', connectable: false }
  ]
}

export class MediaMergerHandler extends BaseNodeHandler {
  constructor() {
    super(mediaMergerDef)
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const first = String(ctx.inputs.first ?? ctx.params.first ?? '')
    const second = String(ctx.inputs.second ?? ctx.params.second ?? '')
    const format = String(ctx.params.format ?? 'mp4').toLowerCase()

    if (!first || !second) {
      return {
        status: 'error',
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: 'Media merger requires two inputs.'
      }
    }

    const firstResolved = await resolveInputToLocalFile(first, ctx.workflowId, ctx.nodeId)
    const secondResolved = await resolveInputToLocalFile(second, ctx.workflowId, ctx.nodeId)
    const outputPath = createOutputPath(ctx.workflowId, ctx.nodeId, 'media_merger', format)
    const concatListPath = path.join(path.dirname(outputPath), `concat_${Date.now()}.txt`)

    try {
      ctx.onProgress(10, 'Preparing merge...')
      const escapedA = firstResolved.localPath.replace(/'/g, "'\\''")
      const escapedB = secondResolved.localPath.replace(/'/g, "'\\''")
      fs.writeFileSync(concatListPath, `file '${escapedA}'\nfile '${escapedB}'\n`, 'utf-8')

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
      } catch {
        // ignore
      }
      firstResolved.cleanup()
      secondResolved.cleanup()
    }
  }
}

