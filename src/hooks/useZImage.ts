/**
 * Z-Image Hook - Local AI Image Generation
 * Manages model downloading, caching, and generation
 *
 * Uses ChunkedDownloader for efficient downloads with:
 * - Browser fetch API (automatic proxy support)
 * - Large chunk transfers (5-10MB) to minimize IPC overhead
 * - HTTP Range requests for resume support
 */

import { useCallback, useRef, useEffect } from 'react'
import type { GenerationParams } from '@/types/stable-diffusion'
import { useSDModelsStore } from '@/stores/sdModelsStore'
import { ChunkedDownloader } from '@/lib/chunkedDownloader'
import { getDownloadTimeoutMs } from '@/stores/settingsStore'
import type { ProgressDetail } from '@/types/progress'

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
    updateBinaryStatus,
    updateVaeStatus,
    updateLlmStatus
  } = useSDModelsStore()

  const optionsRef = useRef(options)

  // Track active downloader instances for cancellation
  const downloadersRef = useRef<{
    llm?: ChunkedDownloader
    vae?: ChunkedDownloader
    binary?: ChunkedDownloader
  }>({})

  // Update options ref when options change
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  /**
   * Download LLM model
   */
  const downloadLlm = useCallback(async () => {
    try {
      // Check if file already exists before starting download
      const checkResult = await window.electronAPI?.sdCheckAuxiliaryModels()
      if (checkResult?.success && checkResult.llmExists) {
        console.log('[useZImage] LLM already exists, skipping download')
        updateLlmStatus({ downloaded: true, downloading: false, progress: 100, error: null })
        optionsRef.current.onProgress?.('download-llm', 100, { current: 100, total: 100, unit: 'percent' })
        return
      }

      // Get download path
      const pathResult = await window.electronAPI?.sdGetAuxiliaryModelDownloadPath('llm')
      if (!pathResult?.success || !pathResult.path) {
        throw new Error('Failed to get LLM download path')
      }

      // Start download
      updateLlmStatus({ downloaded: false, downloading: true, progress: 0, error: null })
      optionsRef.current.onPhase?.('download-llm')
      console.log('[useZImage] Starting LLM download...')

      // Create and track downloader instance
      const downloader = new ChunkedDownloader()
      downloadersRef.current.llm = downloader

      const result = await downloader.download({
        url: MODELS.llm.url,
        destPath: pathResult.path,
        onProgress: (progress) => {
          updateLlmStatus({ downloading: true, downloaded: false, progress: progress.progress, detail: progress.detail })
          optionsRef.current.onProgress?.('download-llm', progress.progress, progress.detail)
        },
        chunkSize: 10 * 1024 * 1024, // 10MB chunks
        minValidSize: MODELS.llm.size * 0.95, // Allow 5% tolerance
        timeout: getDownloadTimeoutMs()
      })

      // Clear downloader reference
      downloadersRef.current.llm = undefined

      if (!result.success) {
        throw new Error(result.error || 'Failed to download LLM model')
      }

      // Download completed - verify file exists before marking as downloaded
      const verifyResult = await window.electronAPI?.sdCheckAuxiliaryModels()
      if (!verifyResult?.success || !verifyResult.llmExists) {
        throw new Error('LLM download completed but file verification failed')
      }

      console.log('[useZImage] LLM download completed and verified successfully')
      updateLlmStatus({ downloaded: true, downloading: false, progress: 100, error: null })
      optionsRef.current.onProgress?.('download-llm', 100, { current: 100, total: 100, unit: 'percent' })
    } catch (error) {
      // Clear downloader reference on error
      downloadersRef.current.llm = undefined

      const errorMsg = (error as Error).message
      console.error('[useZImage] LLM download failed:', errorMsg)
      updateLlmStatus({ downloaded: false, downloading: false, progress: 0, error: errorMsg })
      optionsRef.current.onError?.(errorMsg)
      throw error // Re-throw to stop the download chain
    }
  }, [updateLlmStatus])

  /**
   * Download VAE model
   */
  const downloadVae = useCallback(async () => {
    try {
      // Check if file already exists before starting download
      const checkResult = await window.electronAPI?.sdCheckAuxiliaryModels()
      if (checkResult?.success && checkResult.vaeExists) {
        console.log('[useZImage] VAE already exists, skipping download')
        updateVaeStatus({ downloaded: true, downloading: false, progress: 100, error: null })
        optionsRef.current.onProgress?.('download-vae', 100, { current: 100, total: 100, unit: 'percent' })
        return
      }

      // Get download path
      const pathResult = await window.electronAPI?.sdGetAuxiliaryModelDownloadPath('vae')
      if (!pathResult?.success || !pathResult.path) {
        throw new Error('Failed to get VAE download path')
      }

      // Start download
      updateVaeStatus({ downloaded: false, downloading: true, progress: 0, error: null })
      optionsRef.current.onPhase?.('download-vae')
      console.log('[useZImage] Starting VAE download...')

      // Create and track downloader instance
      const downloader = new ChunkedDownloader()
      downloadersRef.current.vae = downloader

      const result = await downloader.download({
        url: MODELS.vae.url,
        destPath: pathResult.path,
        onProgress: (progress) => {
          updateVaeStatus({ downloading: true, downloaded: false, progress: progress.progress, detail: progress.detail })
          optionsRef.current.onProgress?.('download-vae', progress.progress, progress.detail)
        },
        chunkSize: 10 * 1024 * 1024, // 10MB chunks
        minValidSize: MODELS.vae.size * 0.95, // Allow 5% tolerance
        timeout: getDownloadTimeoutMs()
      })

      // Clear downloader reference
      downloadersRef.current.vae = undefined

      if (!result.success) {
        throw new Error(result.error || 'Failed to download VAE model')
      }

      // Download completed - verify file exists before marking as downloaded
      const verifyResult = await window.electronAPI?.sdCheckAuxiliaryModels()
      if (!verifyResult?.success || !verifyResult.vaeExists) {
        throw new Error('VAE download completed but file verification failed')
      }

      console.log('[useZImage] VAE download completed and verified successfully')
      updateVaeStatus({ downloaded: true, downloading: false, progress: 100, error: null })
      optionsRef.current.onProgress?.('download-vae', 100, { current: 100, total: 100, unit: 'percent' })
    } catch (error) {
      // Clear downloader reference on error
      downloadersRef.current.vae = undefined

      const errorMsg = (error as Error).message
      console.error('[useZImage] VAE download failed:', errorMsg)
      updateVaeStatus({ downloaded: false, downloading: false, progress: 0, error: errorMsg })
      optionsRef.current.onError?.(errorMsg)
      throw error // Re-throw to stop the download chain
    }
  }, [updateVaeStatus])

  /**
   * Download SD binary
   */
  const downloadBinary = useCallback(async () => {
    try {
      // Check if file already exists before starting download
      const checkResult = await window.electronAPI?.sdGetBinaryPath()
      if (checkResult?.success && checkResult.path) {
        console.log('[useZImage] SD Binary already exists, skipping download')
        const detail: ProgressDetail = { current: 100, total: 100, unit: 'percent' }
        updateBinaryStatus({ downloaded: true, downloading: false, progress: 100, error: null, detail })
        optionsRef.current.onProgress?.('download-binary', 100, detail)
        return
      }

      // Get download path
      const pathResult = await window.electronAPI?.sdGetBinaryDownloadPath()
      if (!pathResult?.success || !pathResult.path) {
        throw new Error('Failed to get binary download path')
      }

      // Get system info to determine download URL
      const systemInfo = await window.electronAPI?.sdGetSystemInfo()
      if (!systemInfo) {
        throw new Error('Failed to get system info')
      }

      const { platform, acceleration } = systemInfo

      console.log(`[useZImage] System info - Platform: ${platform}, Acceleration: ${acceleration}`)

      // Determine download URL based on platform and acceleration
      let url = ''
      const githubBaseUrl = 'https://github.com/WaveSpeedAI/stable-diffusion.cpp/releases/download/master-433-700a797'

      if (platform === 'win32') {
        // Windows: Use Vulkan build from WaveSpeed release
        console.log('[useZImage] Using Windows Vulkan build from WaveSpeed release')
        url = `${githubBaseUrl}/sd-master-700a797-bin-win-vulkan-x64.zip`
      } else if (platform === 'darwin') {
        // macOS: Use Metal build from WaveSpeed release
        console.log('[useZImage] Using macOS Metal build from WaveSpeed release')
        url = `${githubBaseUrl}/sd-master-700a797-bin-Darwin-macOS-15.7.2-arm64-metal.zip`
      } else {
        // Linux: Use AVX512 build from WaveSpeed release
        url = `${githubBaseUrl}/sd-master-700a797-bin-Linux-Ubuntu-24.04-x86_64-avx512.zip`
      }

      console.log(`[useZImage] Download URL: ${url}`)

      // Start download
      updateBinaryStatus({ downloaded: false, downloading: true, progress: 0, error: null })
      optionsRef.current.onPhase?.('download-binary')
      console.log('[useZImage] Starting SD Binary download...')

      // Create and track downloader instance
      const downloader = new ChunkedDownloader()
      downloadersRef.current.binary = downloader

      const zipPath = pathResult.path + '.zip'
      const result = await downloader.download({
        url,
        destPath: zipPath,
        onProgress: (progress) => {
          updateBinaryStatus({ downloading: true, downloaded: false, progress: progress.progress, detail: progress.detail })
          optionsRef.current.onProgress?.('download-binary', progress.progress, progress.detail)
        },
        chunkSize: 10 * 1024 * 1024, // 10MB chunks
        minValidSize: 1024 * 1024, // At least 1MB
        timeout: getDownloadTimeoutMs()
      })

      // Clear downloader reference
      downloadersRef.current.binary = undefined

      if (!result.success) {
        throw new Error(result.error || 'Failed to download SD binary')
      }

      console.log('[useZImage] Download completed, extracting zip file...')

      // Extract zip file
      const extractResult = await window.electronAPI?.sdExtractBinary(zipPath, pathResult.path)
      if (!extractResult?.success) {
        throw new Error(extractResult?.error || 'Failed to extract SD binary')
      }

      console.log('[useZImage] SD Binary extracted and verified successfully')
      const detail: ProgressDetail = { current: 100, total: 100, unit: 'percent' }
      updateBinaryStatus({ downloaded: true, downloading: false, progress: 100, error: null, detail })
      optionsRef.current.onProgress?.('download-binary', 100, detail)
    } catch (error) {
      // Clear downloader reference on error
      downloadersRef.current.binary = undefined

      const errorMsg = (error as Error).message
      console.error('[useZImage] SD Binary download failed:', errorMsg)
      updateBinaryStatus({ downloaded: false, downloading: false, progress: 0, error: errorMsg })
      optionsRef.current.onError?.(errorMsg)
      throw error // Re-throw to stop the download chain
    }
  }, [updateBinaryStatus])

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

      // Generate output path using electron API to ensure correct path separators on all platforms
      const outputPath = await window.electronAPI.getZImageOutputPath()

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
   * Cancel download
   * ChunkedDownloader uses AbortController for clean cancellation
   */
  const cancelDownload = useCallback(() => {
    console.log('[useZImage] Cancelling all active downloads')

    // Cancel LLM download
    if (downloadersRef.current.llm) {
      console.log('[useZImage] Cancelling LLM download')
      downloadersRef.current.llm.cancel()
      downloadersRef.current.llm = undefined
    }

    // Cancel VAE download
    if (downloadersRef.current.vae) {
      console.log('[useZImage] Cancelling VAE download')
      downloadersRef.current.vae.cancel()
      downloadersRef.current.vae = undefined
    }

    // Cancel Binary download
    if (downloadersRef.current.binary) {
      console.log('[useZImage] Cancelling Binary download')
      downloadersRef.current.binary.cancel()
      downloadersRef.current.binary = undefined
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
