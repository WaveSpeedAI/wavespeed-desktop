/**
 * Z-Image Hook - Local AI Image Generation
 * Manages model downloading, caching, and generation
 */

import { useCallback, useRef, useEffect } from 'react'
import type { GenerationParams } from '@/types/stable-diffusion'
import { useSDModelsStore } from '@/stores/sdModelsStore'

const CACHE_NAME = 'zimage-models-cache'

// Global abort controllers to persist across component remounts
const globalAbortControllers = {
  llm: null as AbortController | null,
  vae: null as AbortController | null
}

// Model URLs
const MODELS = {
  llm: {
    url: 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf',
    name: 'Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf',
    size: 2400000000
  },
  vae: {
    url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors',
    name: 'ae.safetensors',
    size: 335000000
  },
  binary: {
    getUrl: (platform: string, arch: string) => {
      let platformStr = ''
      if (platform === 'darwin' && arch === 'arm64') platformStr = 'macos-arm64'
      else if (platform === 'darwin' && arch === 'x64') platformStr = 'macos-x64'
      else if (platform === 'win32' && arch === 'x64') platformStr = 'win32-x64'
      else if (platform === 'linux' && arch === 'x64') platformStr = 'ubuntu-x64'
      else throw new Error(`Unsupported platform: ${platform}-${arch}`)

      return `https://github.com/leejet/stable-diffusion.cpp/releases/download/master-408-8823dc4/sd-master-408-8823dc4-bin-${platformStr}.zip`
    }
  }
}

interface UseZImageOptions {
  onPhase?: (phase: string) => void
  onProgress?: (phase: string, progress: number, detail?: unknown) => void
  onError?: (error: string) => void
}

export function useZImage(options: UseZImageOptions = {}) {
  // Use store for persistent state
  const {
    binaryStatus,
    vaeStatus,
    llmStatus,
    updateBinaryStatus,
    updateVaeStatus,
    updateLlmStatus
  } = useSDModelsStore()

  const optionsRef = useRef(options)

  // Update options ref when options change
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  // Listen for SD binary download progress
  useEffect(() => {
    if (!window.electronAPI?.onSdBinaryDownloadProgress) return

    const unsubscribe = window.electronAPI.onSdBinaryDownloadProgress((data) => {
      const { phase, progress, detail } = data

      // Convert bytes to MB for display
      const convertedDetail = detail?.unit === 'bytes' ? {
        current: Math.round((detail.current / 1024 / 1024) * 100) / 100,
        total: Math.round((detail.total / 1024 / 1024) * 100) / 100,
        unit: 'MB'
      } : detail

      // Update binary status progress and detail via store
      updateBinaryStatus({ progress, detail: convertedDetail })

      // Notify parent component using the latest options
      if (optionsRef.current.onProgress) {
        optionsRef.current.onProgress('download-binary', progress, convertedDetail)
      }
    })

    return () => {
      unsubscribe?.()
    }
  }, [updateBinaryStatus])

  /**
   * Download file with progress tracking and caching
   */
  const downloadFile = useCallback(
    async (
      url: string,
      filename: string,
      type: 'llm' | 'vae',
      onProgress: (progress: number, loaded: number, total: number) => void
    ): Promise<Blob> => {
      // Check cache first
      const cache = await caches.open(CACHE_NAME)
      const cachedResponse = await cache.match(url)

      if (cachedResponse) {
        const blob = await cachedResponse.blob()
        onProgress(100, blob.size, blob.size)
        return blob
      }

      // Create new abort controller and store globally
      const abortController = new AbortController()
      globalAbortControllers[type] = abortController

      try {
        const response = await fetch(url, {
          signal: abortController.signal
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('Response body is not readable')
        }

        const contentLength = parseInt(response.headers.get('content-length') || '0')
        let receivedLength = 0
        const chunks: Uint8Array[] = []
        let lastProgressUpdate = 0

        while (true) {
          const { done, value } = await reader.read()

          if (done) break

          chunks.push(value)
          receivedLength += value.length

          // Throttle progress updates to every 500ms
          const now = Date.now()
          if (now - lastProgressUpdate > 500 || done) {
            const progress = contentLength > 0 ? Math.round((receivedLength / contentLength) * 100) : 0
            onProgress(progress, receivedLength, contentLength)
            lastProgressUpdate = now
          }
        }

        // Final progress update
        const progress = contentLength > 0 ? 100 : 0
        onProgress(progress, receivedLength, contentLength)

        // Combine chunks
        const blob = new Blob(chunks)

        // Cache the response
        await cache.put(url, new Response(blob))

        // Clear global abort controller
        globalAbortControllers[type] = null

        return blob
      } catch (error) {
        // Clear global abort controller
        globalAbortControllers[type] = null

        // Check if it's an abort error
        if ((error as Error).name === 'AbortError') {
          throw new Error('Download cancelled by user')
        }
        throw error
      }
    },
    []
  )

  /**
   * Download LLM model
   */
  const downloadLlm = useCallback(async () => {
    updateLlmStatus({ downloaded: false, downloading: true, progress: 0, error: null })
    optionsRef.current.onPhase?.('download-llm')

    try {
      const blob = await downloadFile(
        MODELS.llm.url,
        MODELS.llm.name,
        'llm',
        (progress, loaded, total) => {
          const detail = {
            current: Math.round((loaded / 1024 / 1024) * 100) / 100,
            total: Math.round((total / 1024 / 1024) * 100) / 100,
            unit: 'MB'
          }
          // Update store with progress and detail
          updateLlmStatus({ progress, detail })
          // Notify parent component using optionsRef to get latest callback
          optionsRef.current.onProgress?.('download-llm', progress, detail)
        }
      )

      // Save to file system via Electron
      if (window.electronAPI?.sdSaveModelFromCache) {
        const arrayBuffer = await blob.arrayBuffer()
        const result = await window.electronAPI.sdSaveModelFromCache(
          MODELS.llm.name,
          new Uint8Array(arrayBuffer),
          'llm'
        )

        if (!result.success) {
          throw new Error(result.error || 'Failed to save LLM model')
        }

        const sizeMB = Math.round((blob.size / 1024 / 1024) * 100) / 100
        const detail = { current: sizeMB, total: sizeMB, unit: 'MB' }
        updateLlmStatus({ downloaded: true, downloading: false, progress: 100, error: null, detail })
        optionsRef.current.onProgress?.('download-llm', 100, detail)
      }
    } catch (error) {
      const errorMsg = (error as Error).message
      updateLlmStatus({ downloaded: false, downloading: false, progress: 0, error: errorMsg })
      optionsRef.current.onError?.(errorMsg)
      throw error // Re-throw to stop the download chain
    }
  }, [downloadFile, updateLlmStatus])

  /**
   * Download VAE model
   */
  const downloadVae = useCallback(async () => {
    updateVaeStatus({ downloaded: false, downloading: true, progress: 0, error: null })
    optionsRef.current.onPhase?.('download-vae')

    try {
      const blob = await downloadFile(
        MODELS.vae.url,
        MODELS.vae.name,
        'vae',
        (progress, loaded, total) => {
          const detail = {
            current: Math.round((loaded / 1024 / 1024) * 100) / 100,
            total: Math.round((total / 1024 / 1024) * 100) / 100,
            unit: 'MB'
          }
          // Update store with progress and detail
          updateVaeStatus({ progress, detail })
          // Notify parent component using optionsRef to get latest callback
          optionsRef.current.onProgress?.('download-vae', progress, detail)
        }
      )

      // Save to file system via Electron
      if (window.electronAPI?.sdSaveModelFromCache) {
        const arrayBuffer = await blob.arrayBuffer()
        const result = await window.electronAPI.sdSaveModelFromCache(
          MODELS.vae.name,
          new Uint8Array(arrayBuffer),
          'vae'
        )

        if (!result.success) {
          throw new Error(result.error || 'Failed to save VAE model')
        }

        const sizeMB = Math.round((blob.size / 1024 / 1024) * 100) / 100
        const detail = { current: sizeMB, total: sizeMB, unit: 'MB' }
        updateVaeStatus({ downloaded: true, downloading: false, progress: 100, error: null, detail })
        optionsRef.current.onProgress?.('download-vae', 100, detail)
      }
    } catch (error) {
      const errorMsg = (error as Error).message
      updateVaeStatus({ downloaded: false, downloading: false, progress: 0, error: errorMsg })
      optionsRef.current.onError?.(errorMsg)
      throw error // Re-throw to stop the download chain
    }
  }, [downloadFile, updateVaeStatus])

  /**
   * Generate image
   */
  const generate = useCallback(
    async (params: Omit<GenerationParams, 'outputPath'>) => {
      optionsRef.current.onPhase?.('generate')

      if (!window.electronAPI?.sdGenerateImage) {
        throw new Error('Electron API not available')
      }

      // Get models info
      const modelsInfo = await window.electronAPI.sdCheckAuxiliaryModels()
      if (!modelsInfo.success) {
        throw new Error('Failed to check models')
      }

      // Generate output path
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const assetsDir = await window.electronAPI.getDefaultAssetsDirectory()
      const outputPath = `${assetsDir}/zimage_${timestamp}.png`

      const result = await window.electronAPI.sdGenerateImage({
        ...params,
        llmPath: modelsInfo.llmPath,
        vaePath: modelsInfo.vaePath,
        outputPath
      })

      return result
    },
    []
  )

  /**
   * Download SD binary
   */
  const downloadBinary = useCallback(async () => {
    updateBinaryStatus({ downloaded: false, downloading: true, progress: 0, error: null })
    optionsRef.current.onPhase?.('download-binary')

    try {
      if (!window.electronAPI?.sdDownloadBinary) {
        throw new Error('Electron API not available')
      }

      const result = await window.electronAPI.sdDownloadBinary()

      if (!result.success) {
        throw new Error(result.error || 'Failed to download SD binary')
      }

      // Update to 100% and notify parent
      const detail = { current: 100, total: 100, unit: 'percent' }
      updateBinaryStatus({ downloaded: true, downloading: false, progress: 100, error: null, detail })
      optionsRef.current.onProgress?.('download-binary', 100, detail)
    } catch (error) {
      const errorMsg = (error as Error).message
      updateBinaryStatus({ downloaded: false, downloading: false, progress: 0, error: errorMsg })
      optionsRef.current.onError?.(errorMsg)
      throw error // Re-throw to stop the download chain
    }
  }, [updateBinaryStatus])

  /**
   * Cancel download
   */
  const cancelDownload = useCallback(() => {
    // Cancel LLM download
    if (globalAbortControllers.llm) {
      globalAbortControllers.llm.abort()
      globalAbortControllers.llm = null
    }
    // Cancel VAE download
    if (globalAbortControllers.vae) {
      globalAbortControllers.vae.abort()
      globalAbortControllers.vae = null
    }
  }, [])

  return {
    downloadLlm,
    downloadVae,
    downloadBinary,
    generate,
    cancelDownload
  }
}
