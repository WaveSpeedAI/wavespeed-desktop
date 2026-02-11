/**
 * Preview Display node — URL-aware preview that auto-detects content type.
 */
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../base'
import type { NodeTypeDefinition } from '../../../../src/workflow/types/node-defs'

export type PreviewContentType = 'image' | 'video' | 'audio' | '3d' | 'unknown'

export const previewDisplayDef: NodeTypeDefinition = {
  type: 'output/preview', category: 'output', label: 'Preview', icon: '👀',
  inputs: [{ key: 'input', label: 'URL', dataType: 'url', required: true }],
  outputs: [],
  params: [
    { key: 'autoDetect', label: 'Auto-detect Type', type: 'boolean', default: true },
    { key: 'forceType', label: 'Force Type', type: 'select', default: 'auto', options: [
      { label: 'Auto', value: 'auto' }, { label: 'Image', value: 'image' },
      { label: 'Video', value: 'video' }, { label: 'Audio', value: 'audio' },
      { label: '3D Model', value: '3d' }
    ]}
  ]
}

export class PreviewDisplayHandler extends BaseNodeHandler {
  constructor() { super(previewDisplayDef) }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const url = String(ctx.inputs.input ?? '')
    if (!url) {
      return { status: 'error', outputs: {}, durationMs: Date.now() - start, cost: 0, error: 'No URL provided for preview' }
    }
    const forceType = String(ctx.params.forceType ?? 'auto')
    const contentType: PreviewContentType = forceType !== 'auto' ? forceType as PreviewContentType : detectContentType(url)
    return {
      status: 'success', outputs: {},
      resultMetadata: { previewUrl: url, contentType, preview: url },
      durationMs: Date.now() - start, cost: 0
    }
  }
}

function detectContentType(url: string): PreviewContentType {
  const p = url.toLowerCase().split('?')[0]
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)$/.test(p)) return 'image'
  if (/\.(mp4|webm|mov|avi|mkv)$/.test(p)) return 'video'
  if (/\.(mp3|wav|ogg|flac|aac|m4a)$/.test(p)) return 'audio'
  if (/\.(glb|gltf)$/.test(p)) return '3d'
  if (p.includes('/image') || p.includes('img')) return 'image'
  if (p.includes('/video') || p.includes('vid')) return 'video'
  if (p.includes('/audio') || p.includes('/tts') || p.includes('/music')) return 'audio'
  return 'unknown'
}
