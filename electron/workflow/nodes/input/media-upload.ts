/**
 * Media Upload node — uploads local media file to WaveSpeed CDN.
 * The output is a URL that can be connected to AI Task nodes.
 *
 * In the workflow canvas, this node renders as a drag-and-drop zone.
 * The actual upload happens in the renderer (CustomNode) and the
 * resulting URL is stored in params.uploadedUrl.
 *
 * When executed, this node simply passes through the uploadedUrl.
 */
import { BaseNodeHandler, type NodeExecutionContext, type NodeExecutionResult } from '../base'
import type { NodeTypeDefinition } from '../../../../src/workflow/types/node-defs'

export const mediaUploadDef: NodeTypeDefinition = {
  type: 'input/media-upload',
  category: 'input',
  label: 'Upload',
  icon: '📁',
  inputs: [],
  outputs: [
    { key: 'output', label: 'Media URL', dataType: 'url', required: true }
  ],
  params: [
    // uploadedUrl is set by the renderer after file upload completes
    { key: 'uploadedUrl', label: 'URL', type: 'string', dataType: 'url', connectable: false, default: '' },
    { key: 'mediaType', label: 'Type', type: 'string', dataType: 'text', connectable: false, default: '' },
    { key: 'fileName', label: 'File', type: 'string', dataType: 'text', connectable: false, default: '' }
  ]
}

export class MediaUploadHandler extends BaseNodeHandler {
  constructor() { super(mediaUploadDef) }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const url = String(ctx.params.uploadedUrl ?? '')

    if (!url) {
      return { status: 'error', outputs: {}, durationMs: Date.now() - start, cost: 0, error: 'No file uploaded. Please upload a file first.' }
    }

    return {
      status: 'success',
      outputs: { output: url },
      resultPath: url,
      resultMetadata: {
        output: url,
        resultUrl: url,
        resultUrls: [url],
        mediaType: ctx.params.mediaType ?? 'image',
        fileName: ctx.params.fileName ?? ''
      },
      durationMs: Date.now() - start,
      cost: 0
    }
  }
}
