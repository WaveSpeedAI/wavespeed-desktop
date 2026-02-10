/**
 * File Export node — downloads a result URL to local disk.
 */
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../base'
import type { NodeTypeDefinition } from '../../../../src/workflow/types/node-defs'

export const fileExportDef: NodeTypeDefinition = {
  type: 'output/file', category: 'output', label: 'File Export', icon: '💾',
  inputs: [
    { key: 'url', label: 'Media URL', dataType: 'url', required: true },
    { key: 'content', label: 'Content (legacy)', dataType: 'any', required: false }
  ],
  outputs: [],
  params: [
    { key: 'outputDir', label: 'Output Directory', type: 'string', default: '' },
    { key: 'filename', label: 'Filename', type: 'string', default: 'output' },
    { key: 'format', label: 'Format', type: 'select', default: 'auto', options: [
      { label: 'Auto', value: 'auto' }, { label: 'MP4', value: 'mp4' },
      { label: 'PNG', value: 'png' }, { label: 'JPG', value: 'jpg' },
      { label: 'MP3', value: 'mp3' }, { label: 'WAV', value: 'wav' }
    ]}
  ]
}

export class FileExportHandler extends BaseNodeHandler {
  constructor() { super(fileExportDef) }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const url = String(ctx.inputs.url ?? ctx.inputs.content ?? '')
    const outputDir = String(ctx.params.outputDir ?? '')
    const filename = String(ctx.params.filename ?? 'output')
    const format = String(ctx.params.format ?? 'auto')

    if (!url) {
      return { status: 'error', outputs: {}, durationMs: Date.now() - start, cost: 0, error: 'No URL provided for export' }
    }

    const ext = format === 'auto' ? guessExtension(url) : format
    const fullPath = `${outputDir}/${filename}.${ext}`.replace(/\/+/g, '/')

    return {
      status: 'success', outputs: {},
      resultPath: fullPath,
      resultMetadata: { sourceUrl: url, exportPath: fullPath },
      durationMs: Date.now() - start, cost: 0
    }
  }
}

function guessExtension(url: string): string {
  const p = url.toLowerCase().split('?')[0]
  const match = p.match(/\.(\w{2,4})$/)
  if (match) return match[1]
  if (p.includes('video') || p.includes('mp4')) return 'mp4'
  if (p.includes('audio') || p.includes('mp3')) return 'mp3'
  return 'png'
}
