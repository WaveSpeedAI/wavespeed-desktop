/**
 * Node type definitions for browser (no Electron).
 * Mirrors the definitions used in electron/workflow/nodes so the palette and config UI work.
 */
import type { NodeTypeDefinition } from '@/workflow/types/node-defs'

// ─── Input ─────────────────────────────────────────────────────────────────
export const mediaUploadDef: NodeTypeDefinition = {
  type: 'input/media-upload',
  category: 'input',
  label: 'Upload',
  inputs: [{ key: 'media', label: 'Media', dataType: 'url', required: false }],
  outputs: [{ key: 'output', label: 'URL', dataType: 'url', required: true }],
  params: [
    { key: 'uploadedUrl', label: 'URL', type: 'string', dataType: 'url', connectable: false, default: '' },
    { key: 'mediaType', label: 'Type', type: 'string', dataType: 'text', connectable: false, default: '' },
    { key: 'fileName', label: 'File', type: 'string', dataType: 'text', connectable: false, default: '' }
  ]
}

export const textInputDef: NodeTypeDefinition = {
  type: 'input/text-input',
  category: 'input',
  label: 'Text',
  inputs: [],
  outputs: [{ key: 'output', label: 'Text', dataType: 'text', required: true }],
  params: [
    { key: 'text', label: 'Text', type: 'textarea', dataType: 'text', connectable: false, default: '' }
  ]
}

// ─── AI Task ───────────────────────────────────────────────────────────────
export const aiTaskDef: NodeTypeDefinition = {
  type: 'ai-task/run',
  category: 'ai-task',
  label: '',
  inputs: [],
  outputs: [{ key: 'output', label: 'Output', dataType: 'url', required: true }],
  params: [
    { key: 'modelId', label: 'Model', type: 'string', dataType: 'text', connectable: false, default: '' }
  ]
}

// ─── Output ────────────────────────────────────────────────────────────────
export const fileExportDef: NodeTypeDefinition = {
  type: 'output/file',
  category: 'output',
  label: 'File Export',
  inputs: [{ key: 'url', label: 'URL', dataType: 'url', required: true }],
  outputs: [],
  params: [
    { key: 'outputDir', label: 'Output Directory', type: 'string', default: '' },
    { key: 'filename', label: 'Filename Prefix', type: 'string', default: 'output' },
    {
      key: 'format',
      label: 'Format',
      type: 'select',
      default: 'auto',
      options: [
        { label: 'Auto', value: 'auto' },
        { label: 'MP4', value: 'mp4' },
        { label: 'PNG', value: 'png' },
        { label: 'JPG', value: 'jpg' },
        { label: 'MP3', value: 'mp3' },
        { label: 'WAV', value: 'wav' }
      ]
    }
  ]
}

export const previewDisplayDef: NodeTypeDefinition = {
  type: 'output/preview',
  category: 'output',
  label: 'Preview',
  inputs: [{ key: 'input', label: 'URL', dataType: 'url', required: true }],
  outputs: [],
  params: [
    { key: 'autoDetect', label: 'Auto-detect Type', type: 'boolean', default: true },
    {
      key: 'forceType',
      label: 'Force Type',
      type: 'select',
      default: 'auto',
      options: [
        { label: 'Auto', value: 'auto' },
        { label: 'Image', value: 'image' },
        { label: 'Video', value: 'video' },
        { label: 'Audio', value: 'audio' },
        { label: '3D Model', value: '3d' }
      ]
    }
  ]
}

// ─── Free tools ─────────────────────────────────────────────────────────────
const IMAGE_ENHANCER_OPTS = [
  { label: 'Slim (fast)', value: 'slim' },
  { label: 'Medium', value: 'medium' },
  { label: 'Thick (quality)', value: 'thick' }
]
const SCALE_OPTS = [
  { label: '2×', value: '2x' },
  { label: '3×', value: '3x' },
  { label: '4×', value: '4x' }
]

export const imageEnhancerDef: NodeTypeDefinition = {
  type: 'free-tool/image-enhancer',
  category: 'free-tool',
  label: 'Image Enhancer',
  inputs: [{ key: 'input', label: 'Image', dataType: 'image', required: true }],
  outputs: [{ key: 'output', label: 'Output', dataType: 'image', required: true }],
  params: [
    { key: 'model', label: 'Model', type: 'select', default: 'slim', dataType: 'text', connectable: false, options: IMAGE_ENHANCER_OPTS },
    { key: 'scale', label: 'Scale', type: 'select', default: '2x', dataType: 'text', connectable: false, options: SCALE_OPTS }
  ]
}

export const backgroundRemoverDef: NodeTypeDefinition = {
  type: 'free-tool/background-remover',
  category: 'free-tool',
  label: 'Background Remover',
  inputs: [{ key: 'input', label: 'Image', dataType: 'image', required: true }],
  outputs: [{ key: 'output', label: 'Output', dataType: 'image', required: true }],
  params: [
    {
      key: 'model',
      label: 'Model',
      type: 'select',
      default: 'isnet_fp16',
      dataType: 'text',
      connectable: false,
      options: [
        { label: 'ISNet Quint8 (fast)', value: 'isnet_quint8' },
        { label: 'ISNet FP16', value: 'isnet_fp16' },
        { label: 'ISNet (quality)', value: 'isnet' }
      ]
    }
  ]
}

export const faceEnhancerDef: NodeTypeDefinition = {
  type: 'free-tool/face-enhancer',
  category: 'free-tool',
  label: 'Face Enhancer',
  inputs: [{ key: 'input', label: 'Image', dataType: 'image', required: true }],
  outputs: [{ key: 'output', label: 'Output', dataType: 'image', required: true }],
  params: []
}

export const videoEnhancerDef: NodeTypeDefinition = {
  type: 'free-tool/video-enhancer',
  category: 'free-tool',
  label: 'Video Enhancer',
  inputs: [{ key: 'input', label: 'Video', dataType: 'video', required: true }],
  outputs: [{ key: 'output', label: 'Output', dataType: 'video', required: true }],
  params: [
    { key: 'model', label: 'Model', type: 'select', default: 'slim', dataType: 'text', connectable: false, options: IMAGE_ENHANCER_OPTS },
    { key: 'scale', label: 'Scale', type: 'select', default: '2x', dataType: 'text', connectable: false, options: SCALE_OPTS }
  ]
}

export const faceSwapperDef: NodeTypeDefinition = {
  type: 'free-tool/face-swapper',
  category: 'free-tool',
  label: 'Face Swapper',
  inputs: [
    { key: 'source', label: 'Source Face', dataType: 'image', required: true },
    { key: 'target', label: 'Target Image', dataType: 'image', required: true }
  ],
  outputs: [{ key: 'output', label: 'Output', dataType: 'image', required: true }],
  params: []
}

export const imageEraserDef: NodeTypeDefinition = {
  type: 'free-tool/image-eraser',
  category: 'free-tool',
  label: 'Image Eraser',
  inputs: [
    { key: 'input', label: 'Image', dataType: 'image', required: true },
    { key: 'mask_image', label: 'Mask', dataType: 'image', required: true }
  ],
  outputs: [{ key: 'output', label: 'Output', dataType: 'image', required: true }],
  params: []
}

export const segmentAnythingDef: NodeTypeDefinition = {
  type: 'free-tool/segment-anything',
  category: 'free-tool',
  label: 'Segment Anything',
  inputs: [{ key: 'input', label: 'Image', dataType: 'image', required: true }],
  outputs: [{ key: 'output', label: 'Mask', dataType: 'image', required: true }],
  params: [{ key: 'invertMask', label: 'Invert Mask', type: 'boolean', default: false }]
}

const VIDEO_FORMATS = [
  { label: 'MP4 (H.264)', value: 'mp4-h264' },
  { label: 'MP4 (H.265/HEVC)', value: 'mp4-h265' },
  { label: 'WebM (VP9)', value: 'webm-vp9' },
  { label: 'WebM (VP8)', value: 'webm-vp8' },
  { label: 'MOV', value: 'mov' },
  { label: 'AVI', value: 'avi' },
  { label: 'MKV', value: 'mkv' }
]
const QUALITY_PRESETS = [
  { label: 'Low (Fast)', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Ultra', value: 'ultra' }
]
const RESOLUTION_PRESETS = [
  { label: 'Original', value: 'original' },
  { label: '1080p', value: '1920:1080' },
  { label: '720p', value: '1280:720' },
  { label: '480p', value: '854:480' }
]

export const videoConverterDef: NodeTypeDefinition = {
  type: 'free-tool/video-converter',
  category: 'free-tool',
  label: 'Video Converter',
  inputs: [{ key: 'input', label: 'Video', dataType: 'video', required: true }],
  outputs: [{ key: 'output', label: 'Output', dataType: 'video', required: true }],
  params: [
    { key: 'format', label: 'Format', type: 'select', default: 'mp4-h264', dataType: 'text', connectable: false, options: VIDEO_FORMATS },
    { key: 'quality', label: 'Quality', type: 'select', default: 'medium', dataType: 'text', connectable: false, options: QUALITY_PRESETS },
    { key: 'resolution', label: 'Resolution', type: 'select', default: 'original', dataType: 'text', connectable: false, options: RESOLUTION_PRESETS }
  ]
}

const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'm4a', 'ogg'].map(v => ({ label: v.toUpperCase(), value: v }))

export const audioConverterDef: NodeTypeDefinition = {
  type: 'free-tool/audio-converter',
  category: 'free-tool',
  label: 'Audio Converter',
  inputs: [{ key: 'input', label: 'Audio', dataType: 'audio', required: true }],
  outputs: [{ key: 'output', label: 'Output', dataType: 'audio', required: true }],
  params: [
    { key: 'format', label: 'Format', type: 'select', default: 'mp3', dataType: 'text', connectable: false, options: AUDIO_FORMATS }
  ]
}

const IMAGE_FORMATS = ['png', 'jpg', 'webp', 'gif', 'bmp'].map(v => ({ label: v.toUpperCase(), value: v }))

export const imageConverterDef: NodeTypeDefinition = {
  type: 'free-tool/image-converter',
  category: 'free-tool',
  label: 'Image Converter',
  inputs: [{ key: 'input', label: 'Image', dataType: 'image', required: true }],
  outputs: [{ key: 'output', label: 'Output', dataType: 'image', required: true }],
  params: [
    { key: 'format', label: 'Format', type: 'select', default: 'png', dataType: 'text', connectable: false, options: IMAGE_FORMATS }
  ]
}

export const mediaTrimmerDef: NodeTypeDefinition = {
  type: 'free-tool/media-trimmer',
  category: 'free-tool',
  label: 'Media Trimmer',
  inputs: [{ key: 'input', label: 'Media', dataType: 'video', required: true }],
  outputs: [{ key: 'output', label: 'Output', dataType: 'url', required: true }],
  params: [
    { key: 'startTime', label: 'Start (s)', type: 'number', dataType: 'text', default: 0, connectable: false, validation: { min: 0, step: 0.1 } },
    { key: 'endTime', label: 'End (s)', type: 'number', dataType: 'text', default: 10, connectable: false, validation: { min: 0, step: 0.1 } },
    { key: 'format', label: 'Output Format', type: 'string', dataType: 'text', default: 'mp4', connectable: false }
  ]
}

export const mediaMergerDef: NodeTypeDefinition = {
  type: 'free-tool/media-merger',
  category: 'free-tool',
  label: 'Media Merger',
  inputs: [
    { key: 'input1', label: 'Input 1', dataType: 'video', required: true },
    { key: 'input2', label: 'Input 2', dataType: 'video', required: true },
    { key: 'input3', label: 'Input 3', dataType: 'video', required: false },
    { key: 'input4', label: 'Input 4', dataType: 'video', required: false },
    { key: 'input5', label: 'Input 5', dataType: 'video', required: false }
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
        { label: 'MKV', value: 'mkv' }
      ]
    }
  ]
}

// ─── Helper / processing ──────────────────────────────────────────────────
/** Concatenate multiple values into one array. Connect any number of inputs; empty slots are skipped. */
export const concatDef: NodeTypeDefinition = {
  type: 'processing/concat',
  category: 'processing',
  label: 'Concat',
  inputs: [
    { key: 'value1', label: 'Value 1', dataType: 'any', required: true },
    { key: 'value2', label: 'Value 2', dataType: 'any', required: true },
    { key: 'value3', label: 'Value 3', dataType: 'any', required: false },
    { key: 'value4', label: 'Value 4', dataType: 'any', required: false },
    { key: 'value5', label: 'Value 5', dataType: 'any', required: false }
  ],
  outputs: [{ key: 'output', label: 'Array', dataType: 'any', required: true }],
  params: []
}

/** Select one value from an array by index (0-based). Connect an array output (e.g. from Concat). */
export const selectDef: NodeTypeDefinition = {
  type: 'processing/select',
  category: 'processing',
  label: 'Select',
  inputs: [{ key: 'input', label: 'Array', dataType: 'any', required: true }],
  outputs: [{ key: 'output', label: 'Value', dataType: 'any', required: true }],
  params: [
    { key: 'index', label: 'Index', type: 'number', default: 0, connectable: false, validation: { min: 0, step: 1 } }
  ]
}

// ─── All definitions (registry:get-all) ───────────────────────────────────
export const BROWSER_NODE_DEFINITIONS: NodeTypeDefinition[] = [
  mediaUploadDef,
  textInputDef,
  aiTaskDef,
  fileExportDef,
  previewDisplayDef,
  imageEnhancerDef,
  backgroundRemoverDef,
  faceEnhancerDef,
  videoEnhancerDef,
  faceSwapperDef,
  imageEraserDef,
  segmentAnythingDef,
  videoConverterDef,
  audioConverterDef,
  imageConverterDef,
  mediaTrimmerDef,
  mediaMergerDef,
  concatDef,
  selectDef
]
