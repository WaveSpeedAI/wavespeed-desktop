/**
 * File Export node — downloads a result URL to local disk.
 */
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../base'
import type { NodeTypeDefinition } from '../../../../src/workflow/types/node-defs'
import { getFileStorageInstance } from '../../utils/file-storage'
import * as path from 'path'
import * as fs from 'fs'
import https from 'https'
import http from 'http'
import { randomUUID } from 'crypto'

export const fileExportDef: NodeTypeDefinition = {
  type: 'output/file', category: 'output', label: 'File Export',
  inputs: [
    { key: 'url', label: 'URL', dataType: 'url', required: true }
  ],
  outputs: [],
  params: [
    { key: 'outputDir', label: 'Output Directory', type: 'string', default: '' },
    { key: 'filename', label: 'Filename Prefix', type: 'string', default: 'output' },
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
    const outputDir = String(ctx.params.outputDir ?? '').trim()
    const filenamePrefix = sanitizeFilename(String(ctx.params.filename ?? 'output'))
    const format = String(ctx.params.format ?? 'auto')

    if (!url) {
      return { status: 'error', outputs: {}, durationMs: Date.now() - start, cost: 0, error: 'No URL provided for export' }
    }

    const ext = sanitizeExtension(format === 'auto' ? guessExtension(url) : format)
    const resolvedOutputDir = outputDir || getFileStorageInstance().getMediaOutputDir(ctx.workflowId)
    fs.mkdirSync(resolvedOutputDir, { recursive: true })
    const uniqueName = `${filenamePrefix}_${randomUUID()}`
    const fullPath = path.join(resolvedOutputDir, `${uniqueName}.${ext}`)

    await saveToPath(url, fullPath)

    return {
      status: 'success', outputs: {},
      resultPath: fullPath,
      resultMetadata: {
        sourceUrl: url,
        exportPath: fullPath,
        outputDir: resolvedOutputDir,
        filenamePrefix,
        generatedName: `${uniqueName}.${ext}`
      },
      durationMs: Date.now() - start, cost: 0
    }
  }
}

async function saveToPath(source: string, destPath: string): Promise<void> {
  // local-asset://<encoded absolute path>
  if (/^local-asset:\/\//i.test(source)) {
    const localPath = decodeURIComponent(source.replace(/^local-asset:\/\//i, ''))
    fs.copyFileSync(localPath, destPath)
    return
  }

  // file:// URL
  if (/^file:\/\//i.test(source)) {
    const fileUrl = new URL(source)
    fs.copyFileSync(fileUrl.pathname, destPath)
    return
  }

  // data URL
  if (/^data:/i.test(source)) {
    const m = source.match(/^data:.*?;base64,(.+)$/i)
    if (!m) throw new Error('Unsupported data URL format')
    fs.writeFileSync(destPath, Buffer.from(m[1], 'base64'))
    return
  }

  // http(s) URL
  if (/^https?:\/\//i.test(source)) {
    await downloadToFile(source, destPath)
    return
  }

  // Fallback: treat as local absolute/relative path
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, destPath)
    return
  }

  throw new Error('Unsupported export source URL')
}

function downloadToFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http
    const out = fs.createWriteStream(destPath)
    client.get(url, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        out.close()
        fs.rmSync(destPath, { force: true })
        downloadToFile(res.headers.location, destPath).then(resolve).catch(reject)
        return
      }
      if (res.statusCode && res.statusCode >= 400) {
        out.close()
        fs.rmSync(destPath, { force: true })
        reject(new Error(`Download failed: HTTP ${res.statusCode}`))
        return
      }
      res.pipe(out)
      out.on('finish', () => {
        out.close()
        resolve()
      })
    }).on('error', (error) => {
      out.close()
      fs.rmSync(destPath, { force: true })
      reject(error)
    })
  })
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim()
  return cleaned || 'output'
}

function sanitizeExtension(ext: string): string {
  return ext.replace(/^\./, '').trim().toLowerCase() || 'png'
}

function guessExtension(url: string): string {
  const p = url.toLowerCase().split('?')[0]
  const match = p.match(/\.(\w{2,4})$/)
  if (match) return match[1]
  if (p.includes('video') || p.includes('mp4')) return 'mp4'
  if (p.includes('audio') || p.includes('mp3')) return 'mp3'
  return 'png'
}
