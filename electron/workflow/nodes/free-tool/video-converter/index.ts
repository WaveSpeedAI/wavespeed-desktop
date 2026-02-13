import type { NodeTypeDefinition } from '../../../../../src/workflow/types/node-defs'
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../../base'
import { createOutputPath, resolveInputToLocalFile, runFfmpeg, toLocalAssetUrl } from '../shared/media-utils'

const VIDEO_FORMATS = [
  { label: 'MP4 (H.264)', value: 'mp4-h264' },
  { label: 'MP4 (H.265/HEVC)', value: 'mp4-h265' },
  { label: 'WebM (VP9)', value: 'webm-vp9' },
  { label: 'WebM (VP8)', value: 'webm-vp8' },
  { label: 'MOV', value: 'mov' },
  { label: 'AVI', value: 'avi' },
  { label: 'MKV', value: 'mkv' },
] as const

const QUALITY_PRESETS = [
  { label: 'Low (Fast)', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Ultra', value: 'ultra' },
] as const

const RESOLUTION_PRESETS = [
  { label: 'Original', value: 'original' },
  { label: '1080p', value: '1920:1080' },
  { label: '720p', value: '1280:720' },
  { label: '480p', value: '854:480' },
] as const

interface FormatConfig {
  ext: string
  videoCodec: string
  audioCodec: string
}

const FORMAT_MAP: Record<string, FormatConfig> = {
  'mp4-h264': { ext: 'mp4', videoCodec: 'libx264', audioCodec: 'aac' },
  'mp4-h265': { ext: 'mp4', videoCodec: 'libx265', audioCodec: 'aac' },
  'webm-vp9': { ext: 'webm', videoCodec: 'libvpx-vp9', audioCodec: 'libopus' },
  'webm-vp8': { ext: 'webm', videoCodec: 'libvpx', audioCodec: 'libvorbis' },
  'mov': { ext: 'mov', videoCodec: 'libx264', audioCodec: 'aac' },
  'avi': { ext: 'avi', videoCodec: 'libx264', audioCodec: 'aac' },
  'mkv': { ext: 'mkv', videoCodec: 'libx264', audioCodec: 'aac' },
  // Backward compat: old format values
  'mp4': { ext: 'mp4', videoCodec: 'libx264', audioCodec: 'aac' },
  'webm': { ext: 'webm', videoCodec: 'libvpx-vp9', audioCodec: 'libopus' },
}

const BITRATE_MAP: Record<string, { video: string; audio: string }> = {
  low: { video: '1M', audio: '96k' },
  medium: { video: '5M', audio: '128k' },
  high: { video: '10M', audio: '192k' },
  ultra: { video: '20M', audio: '320k' },
}

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
      default: 'mp4-h264',
      dataType: 'text',
      connectable: false,
      options: VIDEO_FORMATS.map(f => ({ label: f.label, value: f.value }))
    },
    {
      key: 'quality',
      label: 'Quality',
      type: 'select',
      default: 'medium',
      dataType: 'text',
      connectable: false,
      options: QUALITY_PRESETS.map(q => ({ label: q.label, value: q.value }))
    },
    {
      key: 'resolution',
      label: 'Resolution',
      type: 'select',
      default: 'original',
      dataType: 'text',
      connectable: false,
      options: RESOLUTION_PRESETS.map(r => ({ label: r.label, value: r.value }))
    }
  ]
}

export class VideoConverterHandler extends BaseNodeHandler {
  constructor() {
    super(videoConverterDef)
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const formatId = String(ctx.params.format ?? 'mp4-h264')
    const qualityId = String(ctx.params.quality ?? 'medium')
    const resolution = String(ctx.params.resolution ?? 'original')
    const input = String(ctx.inputs.input ?? ctx.params.input ?? '')

    const formatCfg = FORMAT_MAP[formatId]
    if (!formatCfg) {
      return {
        status: 'error',
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: `Unsupported video format: ${formatId}`
      }
    }

    const bitrate = BITRATE_MAP[qualityId] ?? BITRATE_MAP.medium
    const resolved = await resolveInputToLocalFile(input, ctx.workflowId, ctx.nodeId)
    const outputPath = createOutputPath(ctx.workflowId, ctx.nodeId, 'video_converter', formatCfg.ext)

    try {
      ctx.onProgress(10, 'Preparing video conversion...')

      const args = ['-y', '-i', resolved.localPath]
      args.push('-c:v', formatCfg.videoCodec, '-b:v', bitrate.video)
      args.push('-c:a', formatCfg.audioCodec, '-b:a', bitrate.audio)

      if (resolution !== 'original') {
        args.push('-vf', `scale=${resolution}`)
      }

      args.push(outputPath)
      await runFfmpeg(args)

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
