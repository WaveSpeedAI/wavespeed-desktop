/**
 * Z-Image Hook - Local AI Image Generation
 * Manages model downloading, caching, and generation
 */

import { useCallback, useRef, useEffect } from 'react'
import type { GenerationParams } from '@/types/stable-diffusion'
import { useSDModelsStore } from '@/stores/sdModelsStore'

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

  // Polling-based download status sync
  // This ensures continuous status updates even when user switches pages
  useEffect(() => {
    const pollDownloadStatus = async () => {
      try {
        // Query current download status from Electron
        const downloadStatus = await window.electronAPI?.sdGetDownloadStatus()

        if (downloadStatus) {
          // Update LLM status
          if (downloadStatus.llm) {
            const { progress, receivedBytes, totalBytes } = downloadStatus.llm
            const detail = {
              current: Math.round((receivedBytes / 1024 / 1024) * 100) / 100,
              total: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
              unit: 'MB'
            }
            updateLlmStatus({ downloading: true, downloaded: false, progress, detail })
            optionsRef.current.onProgress?.('download-llm', progress, detail)
          } else if (llmStatus.downloading && !llmStatus.downloaded) {
            // No active download - check if file exists
            const result = await window.electronAPI?.sdCheckAuxiliaryModels()
            if (result?.success && result.llmExists) {
              updateLlmStatus({ downloaded: true, downloading: false, progress: 100 })
            }
          }

          // Update VAE status
          if (downloadStatus.vae) {
            const { progress, receivedBytes, totalBytes } = downloadStatus.vae
            const detail = {
              current: Math.round((receivedBytes / 1024 / 1024) * 100) / 100,
              total: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
              unit: 'MB'
            }
            updateVaeStatus({ downloading: true, downloaded: false, progress, detail })
            optionsRef.current.onProgress?.('download-vae', progress, detail)
          } else if (vaeStatus.downloading && !vaeStatus.downloaded) {
            // No active download - check if file exists
            const result = await window.electronAPI?.sdCheckAuxiliaryModels()
            if (result?.success && result.vaeExists) {
              updateVaeStatus({ downloaded: true, downloading: false, progress: 100 })
            }
          }

          // Update Binary status
          if (downloadStatus.binary) {
            const { progress, receivedBytes, totalBytes } = downloadStatus.binary
            const detail = {
              current: Math.round((receivedBytes / 1024 / 1024) * 100) / 100,
              total: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
              unit: 'MB'
            }
            updateBinaryStatus({ downloading: true, downloaded: false, progress, detail })
            optionsRef.current.onProgress?.('download-sd', progress, detail)
          } else if (binaryStatus.downloading && !binaryStatus.downloaded) {
            // No active download - check if file exists
            const result = await window.electronAPI?.sdGetBinaryPath()
            if (result?.success && result.path) {
              updateBinaryStatus({ downloaded: true, downloading: false, progress: 100 })
            }
          }
        }
      } catch (error) {
        console.error('Failed to poll download status:', error)
      }
    }

    // Initial check
    pollDownloadStatus()

    // Start polling if any download is in progress
    const shouldPoll = llmStatus.downloading || vaeStatus.downloading || binaryStatus.downloading

    if (shouldPoll) {
      const interval = setInterval(pollDownloadStatus, 500) // Poll every 500ms
      return () => clearInterval(interval)
    }
  }, [llmStatus.downloading, vaeStatus.downloading, binaryStatus.downloading, llmStatus.downloaded, vaeStatus.downloaded, updateLlmStatus, updateVaeStatus])

  // Note: IPC event listeners removed - using polling instead for reliability
  // Polling ensures status updates continue even when user switches pages


  /**
   * Download LLM model
   */
  const downloadLlm = useCallback(async () => {
    try {
      if (!window.electronAPI?.sdDownloadAuxiliaryModel) {
        throw new Error('Electron API not available')
      }

      // Check if file already exists before starting download
      const checkResult = await window.electronAPI.sdCheckAuxiliaryModels()
      if (checkResult.success && checkResult.llmExists) {
        console.log('[useZImage] LLM already exists, skipping download')
        updateLlmStatus({ downloaded: true, downloading: false, progress: 100, error: null })
        optionsRef.current.onProgress?.('download-llm', 100, { current: 100, total: 100, unit: 'percent' })
        return
      }

      // Start download
      updateLlmStatus({ downloaded: false, downloading: true, progress: 0, error: null })
      optionsRef.current.onPhase?.('download-llm')
      console.log('[useZImage] Starting LLM download...')

      // Use Electron's download API (supports resume automatically)
      // Progress updates are handled by polling in the useEffect above
      const result = await window.electronAPI.sdDownloadAuxiliaryModel('llm', MODELS.llm.url)

      if (!result.success) {
        throw new Error(result.error || 'Failed to download LLM model')
      }

      // Download completed - verify file exists before marking as downloaded
      const verifyResult = await window.electronAPI.sdCheckAuxiliaryModels()
      if (!verifyResult.success || !verifyResult.llmExists) {
        throw new Error('LLM download completed but file verification failed')
      }

      console.log('[useZImage] LLM download completed and verified successfully')
      updateLlmStatus({ downloaded: true, downloading: false, progress: 100, error: null })
      optionsRef.current.onProgress?.('download-llm', 100, { current: 100, total: 100, unit: 'percent' })
    } catch (error) {
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
      if (!window.electronAPI?.sdDownloadAuxiliaryModel) {
        throw new Error('Electron API not available')
      }

      // Check if file already exists before starting download
      const checkResult = await window.electronAPI.sdCheckAuxiliaryModels()
      if (checkResult.success && checkResult.vaeExists) {
        console.log('[useZImage] VAE already exists, skipping download')
        updateVaeStatus({ downloaded: true, downloading: false, progress: 100, error: null })
        optionsRef.current.onProgress?.('download-vae', 100, { current: 100, total: 100, unit: 'percent' })
        return
      }

      // Start download
      updateVaeStatus({ downloaded: false, downloading: true, progress: 0, error: null })
      optionsRef.current.onPhase?.('download-vae')
      console.log('[useZImage] Starting VAE download...')

      // Use Electron's download API (supports resume automatically)
      // Progress updates are handled by polling in the useEffect above
      const result = await window.electronAPI.sdDownloadAuxiliaryModel('vae', MODELS.vae.url)

      if (!result.success) {
        throw new Error(result.error || 'Failed to download VAE model')
      }

      // Download completed - verify file exists before marking as downloaded
      const verifyResult = await window.electronAPI.sdCheckAuxiliaryModels()
      if (!verifyResult.success || !verifyResult.vaeExists) {
        throw new Error('VAE download completed but file verification failed')
      }

      console.log('[useZImage] VAE download completed and verified successfully')
      updateVaeStatus({ downloaded: true, downloading: false, progress: 100, error: null })
      optionsRef.current.onProgress?.('download-vae', 100, { current: 100, total: 100, unit: 'percent' })
    } catch (error) {
      const errorMsg = (error as Error).message
      console.error('[useZImage] VAE download failed:', errorMsg)
      updateVaeStatus({ downloaded: false, downloading: false, progress: 0, error: errorMsg })
      optionsRef.current.onError?.(errorMsg)
      throw error // Re-throw to stop the download chain
    }
  }, [updateVaeStatus])

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
    try {
      if (!window.electronAPI?.sdDownloadBinary) {
        throw new Error('Electron API not available')
      }

      // Check if file already exists before starting download
      const checkResult = await window.electronAPI.sdGetBinaryPath()
      if (checkResult.success && checkResult.path) {
        console.log('[useZImage] SD Binary already exists, skipping download')
        const detail = { current: 100, total: 100, unit: 'percent' }
        updateBinaryStatus({ downloaded: true, downloading: false, progress: 100, error: null, detail })
        optionsRef.current.onProgress?.('download-binary', 100, detail)
        return
      }

      // Start download
      updateBinaryStatus({ downloaded: false, downloading: true, progress: 0, error: null })
      optionsRef.current.onPhase?.('download-binary')
      console.log('[useZImage] Starting SD Binary download...')

      const result = await window.electronAPI.sdDownloadBinary()

      if (!result.success) {
        throw new Error(result.error || 'Failed to download SD binary')
      }

      // Download completed - verify file exists before marking as downloaded
      const verifyResult = await window.electronAPI.sdGetBinaryPath()
      if (!verifyResult.success || !verifyResult.path) {
        throw new Error('SD binary download completed but file verification failed')
      }

      console.log('[useZImage] SD Binary download completed and verified successfully')
      const detail = { current: 100, total: 100, unit: 'percent' }
      updateBinaryStatus({ downloaded: true, downloading: false, progress: 100, error: null, detail })
      optionsRef.current.onProgress?.('download-binary', 100, detail)
    } catch (error) {
      const errorMsg = (error as Error).message
      console.error('[useZImage] SD Binary download failed:', errorMsg)
      updateBinaryStatus({ downloaded: false, downloading: false, progress: 0, error: errorMsg })
      optionsRef.current.onError?.(errorMsg)
      throw error // Re-throw to stop the download chain
    }
  }, [updateBinaryStatus])

  /**
   * Cancel download
   * Note: Electron's download API handles cancellation automatically.
   * If the download is interrupted, it can be resumed on the next attempt.
   */
  const cancelDownload = useCallback(() => {
    // Electron downloads are managed by the main process
    // Cancellation would require closing the app or manually deleting the partial file
    console.log('Download cancellation: Please close the app to stop downloads')
  }, [])

  return {
    downloadLlm,
    downloadVae,
    downloadBinary,
    generate,
    cancelDownload
  }
}
