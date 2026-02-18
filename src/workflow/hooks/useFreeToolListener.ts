/**
 * Sets up IPC listener for free-tool:execute from main process.
 * Renderer runs the Web Worker and responds via free-tool:complete/error.
 */
import { useEffect } from 'react'
import { freeToolIpc } from '../ipc/ipc-client'
import { useExecutionStore } from '../stores/execution.store'
import { runImageEnhancer, runBackgroundRemover, runFaceEnhancer, runVideoEnhancer, runFaceSwapper, runImageEraser, runSegmentAnything } from '../lib/free-tool-runner'

function getApi() {
  return window.workflowAPI
}

export function useFreeToolListener(): void {
  useEffect(() => {
    const handler = async (data: {
      requestId: string
      nodeType: string
      workflowId: string
      nodeId: string
      inputs: Record<string, string>
      params: Record<string, unknown>
    }) => {
      const { requestId, nodeType, workflowId, nodeId, inputs, params } = data

      // Progress callback that updates the execution store directly
      const onProgress = (progress: number, message?: string) => {
        useExecutionStore.getState().updateProgress(nodeId, progress, message)
      }

      try {
        if (nodeType === 'free-tool/image-enhancer') {
          const inputUrl = inputs.input
          if (!inputUrl) throw new Error('Missing input')
          const outputData = await runImageEnhancer(inputUrl, params as { model?: string; scale?: string }, onProgress)
          await freeToolIpc.complete({
            requestId,
            workflowId,
            nodeId,
            outputData,
            outputExt: 'png',
            outputPrefix: 'image_enhancer'
          })
        } else if (nodeType === 'free-tool/background-remover') {
          const inputUrl = inputs.input
          if (!inputUrl) throw new Error('Missing input')
          const outputData = await runBackgroundRemover(inputUrl, params as { model?: string }, onProgress)
          await freeToolIpc.complete({
            requestId,
            workflowId,
            nodeId,
            outputData,
            outputExt: 'png',
            outputPrefix: 'background_remover'
          })
        } else if (nodeType === 'free-tool/face-enhancer') {
          const inputUrl = inputs.input
          if (!inputUrl) throw new Error('Missing input')
          const outputData = await runFaceEnhancer(inputUrl, params, onProgress)
          await freeToolIpc.complete({
            requestId,
            workflowId,
            nodeId,
            outputData,
            outputExt: 'png',
            outputPrefix: 'face_enhancer'
          })
        } else if (nodeType === 'free-tool/video-enhancer') {
          const inputUrl = inputs.input
          if (!inputUrl) throw new Error('Missing input')
          const outputData = await runVideoEnhancer(inputUrl, params as { model?: string; scale?: string }, onProgress)
          await freeToolIpc.complete({
            requestId,
            workflowId,
            nodeId,
            outputData,
            outputExt: 'webm',
            outputPrefix: 'video_enhancer'
          })
        } else if (nodeType === 'free-tool/face-swapper') {
          const sourceUrl = inputs.source
          const targetUrl = inputs.target
          if (!sourceUrl || !targetUrl) throw new Error('Missing source or target image')
          const outputData = await runFaceSwapper(sourceUrl, targetUrl, params, onProgress)
          await freeToolIpc.complete({
            requestId,
            workflowId,
            nodeId,
            outputData,
            outputExt: 'png',
            outputPrefix: 'face_swapper'
          })
        } else if (nodeType === 'free-tool/image-eraser') {
          const imageUrl = inputs.input
          const maskUrl = inputs.mask
          if (!imageUrl || !maskUrl) throw new Error('Missing image or mask')
          const outputData = await runImageEraser(imageUrl, maskUrl, params, onProgress)
          await freeToolIpc.complete({
            requestId,
            workflowId,
            nodeId,
            outputData,
            outputExt: 'png',
            outputPrefix: 'image_eraser'
          })
        } else if (nodeType === 'free-tool/segment-anything') {
          const inputUrl = inputs.input
          if (!inputUrl) throw new Error('Missing input')
          const outputData = await runSegmentAnything(inputUrl, params as { pointX?: number; pointY?: number; __segmentPoints?: string; __previewMask?: string; invertMask?: boolean }, onProgress)
          await freeToolIpc.complete({
            requestId,
            workflowId,
            nodeId,
            outputData,
            outputExt: 'png',
            outputPrefix: 'segment_mask'
          })
        } else {
          await freeToolIpc.error({
            requestId,
            error: `Unsupported free-tool node type: ${nodeType}`
          })
        }
      } catch (err) {
        await freeToolIpc.error({
          requestId,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }

    const api = getApi()
    if (!api) return
    api.on('free-tool:execute', handler)
    return () => {
      api.removeListener('free-tool:execute', handler)
    }
  }, [])
}
