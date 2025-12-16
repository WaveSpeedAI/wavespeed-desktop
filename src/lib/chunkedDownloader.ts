/**
 * Chunked file downloader using IPC for file operations
 *
 * Features:
 * - Uses browser fetch API (automatic proxy support)
 * - HTTP Range requests for resume support
 * - Large chunk transfers (5-10MB) to minimize IPC overhead
 * - Progress tracking with throttling
 * - Automatic retry with exponential backoff
 * - Cancellation support
 */

export interface ChunkedDownloadOptions {
  url: string
  destPath: string
  onProgress?: (progress: DownloadProgress) => void
  chunkSize?: number // Bytes to accumulate before IPC transfer (default: 5MB)
  timeout?: number // Connection timeout in ms (default: 30000)
  maxRetries?: number // Maximum retry attempts (default: 3)
  minValidSize?: number // Minimum valid file size in bytes (0 = no validation)
}

export interface DownloadProgress {
  receivedBytes: number
  totalBytes: number
  progress: number // 0-100
  phase: 'download'
  detail: {
    current: number // bytes
    total: number // bytes
    unit: 'bytes'
  }
}

export interface ChunkedDownloadResult {
  success: boolean
  filePath?: string
  error?: string
}

/**
 * Chunked downloader using fetch + IPC file operations
 */
export class ChunkedDownloader {
  private abortController: AbortController | null = null
  private chunkSize: number

  constructor(chunkSize = 5 * 1024 * 1024) {
    // Default 5MB chunks
    this.chunkSize = chunkSize
  }

  /**
   * Download a file with resume support
   */
  async download(options: ChunkedDownloadOptions): Promise<ChunkedDownloadResult> {
    const {
      url,
      destPath,
      onProgress,
      chunkSize = this.chunkSize,
      timeout = 30000,
      maxRetries = 3,
      minValidSize = 0
    } = options

    const partPath = destPath + '.part'

    // Check if final file already exists and is valid
    const finalFileCheck = await window.electronAPI?.fileGetSize(destPath)
    if (finalFileCheck?.success && finalFileCheck.size && finalFileCheck.size > 0) {
      const fileSizeMB = Math.round(finalFileCheck.size / 1024 / 1024)
      console.log(`[ChunkedDownloader] Found existing file: ${fileSizeMB}MB`)

      // Validate file size if minValidSize is specified
      if (minValidSize > 0 && finalFileCheck.size < minValidSize) {
        console.warn(
          `[ChunkedDownloader] File is too small (${fileSizeMB}MB < ${Math.round(minValidSize / 1024 / 1024)}MB), likely incomplete`
        )
        console.warn(`[ChunkedDownloader] Deleting incomplete file and restarting download...`)
        await window.electronAPI?.fileDelete(destPath)
      } else {
        console.log(`[ChunkedDownloader] File size looks valid, skipping download`)
        return {
          success: true,
          filePath: destPath
        }
      }
    }

    // Attempt download with retries
    let lastError = ''
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Check for partial download
      const partFileCheck = await window.electronAPI?.fileGetSize(partPath)
      const startByte = partFileCheck?.success && partFileCheck.size ? partFileCheck.size : 0

      if (startByte > 0) {
        console.log(
          `[ChunkedDownloader] Found partial download: ${Math.round(startByte / 1024 / 1024)}MB`
        )
      }

      try {
        const result = await this.attemptDownload({
          url,
          destPath,
          partPath,
          startByte,
          attempt,
          timeout,
          chunkSize,
          onProgress
        })

        if (result.success) {
          return result
        }

        lastError = result.error || 'Unknown error'

        // If user cancelled, don't retry
        if (lastError.includes('cancelled') || lastError.includes('aborted')) {
          console.log('[ChunkedDownloader] User cancelled download, stopping retry attempts')
          return { success: false, error: lastError }
        }

        // If not the last attempt, wait before retrying
        if (attempt < maxRetries) {
          const waitTime = attempt * 2000 // 2s, 4s, 6s
          console.log(`[ChunkedDownloader] Retry ${attempt + 1}/${maxRetries} in ${waitTime / 1000}s...`)
          await new Promise((resolve) => setTimeout(resolve, waitTime))
        }
      } catch (error) {
        lastError = (error as Error).message
        console.error(`[ChunkedDownloader] Attempt ${attempt} failed:`, lastError)

        // If user cancelled, don't retry
        if (lastError.includes('cancelled') || lastError.includes('aborted')) {
          console.log('[ChunkedDownloader] User cancelled download, stopping retry attempts')
          return { success: false, error: lastError }
        }
      }
    }

    // All retries failed
    return {
      success: false,
      error: `Download failed after ${maxRetries} attempts: ${lastError}`
    }
  }

  /**
   * Attempt a single download with resume support
   */
  private async attemptDownload(params: {
    url: string
    destPath: string
    partPath: string
    startByte: number
    attempt: number
    timeout: number
    chunkSize: number
    onProgress?: (progress: DownloadProgress) => void
  }): Promise<ChunkedDownloadResult> {
    // Create new abort controller for this attempt
    this.abortController = new AbortController()

    const headers: HeadersInit = {
      'User-Agent': 'Mozilla/5.0'
    }

    // Add Range header for resume support
    if (params.startByte > 0) {
      headers['Range'] = `bytes=${params.startByte}-`
      console.log(
        `[ChunkedDownloader] Requesting resume from byte ${params.startByte} (${Math.round(params.startByte / 1024 / 1024)}MB)`
      )
    }

    console.log(`[ChunkedDownloader] Attempt ${params.attempt}: Starting download from:`, params.url)

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout')), params.timeout)
      })

      // Race between fetch and timeout
      const response = await Promise.race([
        fetch(params.url, {
          headers,
          signal: this.abortController.signal
        }),
        timeoutPromise
      ])

      console.log(`[ChunkedDownloader] Connected! Response status: ${response.status}`)

      // Check for valid response (200 for new download, 206 for resumed download)
      if (response.status !== 200 && response.status !== 206) {
        return {
          success: false,
          error: `Server responded with status ${response.status}`
        }
      }

      // Check if server supports resume
      if (params.startByte > 0 && response.status === 200) {
        console.warn('[ChunkedDownloader] WARNING: Server does NOT support Range requests!')
        console.warn('[ChunkedDownloader] Server returned 200 instead of 206, will restart download from 0')
        console.warn('[ChunkedDownloader] Deleting .part file and restarting...')
        await window.electronAPI?.fileDelete(params.partPath)
        params.startByte = 0
      }

      // Get total size from headers
      let totalBytes = 0
      if (response.status === 206 && response.headers.get('content-range')) {
        const contentRange = response.headers.get('content-range')!
        const match = contentRange.match(/bytes \d+-\d+\/(\d+)/)
        if (match) {
          totalBytes = parseInt(match[1], 10)
        }
        console.log(`[ChunkedDownloader] ✓ Server supports resume! Content-Range: ${contentRange}`)
      } else {
        const contentLength = response.headers.get('content-length')
        if (contentLength) {
          const length = parseInt(contentLength, 10)
          totalBytes = params.startByte > 0 ? params.startByte + length : length
        }
      }

      console.log(`[ChunkedDownloader] Total size: ${Math.round(totalBytes / 1024 / 1024)}MB`)
      console.log(
        `[ChunkedDownloader] Starting from: ${Math.round(params.startByte / 1024 / 1024)}MB (${params.startByte > 0 ? 'RESUME' : 'NEW'})`
      )

      // Read response body as stream
      const reader = response.body?.getReader()
      if (!reader) {
        return { success: false, error: 'Response body is not readable' }
      }

      let receivedBytes = params.startByte
      let buffer: Uint8Array[] = []
      let bufferSize = 0
      let lastProgressUpdate = Date.now()

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          // Flush remaining buffer
          if (bufferSize > 0) {
            const chunk = this.mergeBuffers(buffer, bufferSize)
            const appendResult = await window.electronAPI?.fileAppendChunk(params.partPath, chunk.buffer)
            if (!appendResult?.success) {
              return { success: false, error: `Failed to write chunk: ${appendResult?.error}` }
            }
          }
          break
        }

        // Accumulate into buffer
        buffer.push(value)
        bufferSize += value.length
        receivedBytes += value.length

        // Throttle progress updates to every 500ms
        const now = Date.now()
        if (now - lastProgressUpdate > 500 || receivedBytes === totalBytes) {
          const progress = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0

          if (params.onProgress) {
            params.onProgress({
              receivedBytes,
              totalBytes,
              progress,
              phase: 'download',
              detail: {
                current: Math.round((receivedBytes / 1024 / 1024) * 100) / 100,
                total: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
                unit: 'MB'
              }
            })
          }
          lastProgressUpdate = now
        }

        // Write to file when buffer reaches chunk size
        if (bufferSize >= params.chunkSize) {
          const chunk = this.mergeBuffers(buffer, bufferSize)
          const appendResult = await window.electronAPI?.fileAppendChunk(params.partPath, chunk.buffer)

          if (!appendResult?.success) {
            return { success: false, error: `Failed to write chunk: ${appendResult?.error}` }
          }

          // Reset buffer
          buffer = []
          bufferSize = 0
        }
      }

      console.log(
        `[ChunkedDownloader] Download completed, received ${Math.round(receivedBytes / 1024 / 1024)}MB`
      )

      // Rename .part file to final filename
      console.log(`[ChunkedDownloader] Renaming ${params.partPath} -> ${params.destPath}`)
      const renameResult = await window.electronAPI?.fileRename(params.partPath, params.destPath)

      if (!renameResult?.success) {
        return { success: false, error: `Failed to rename file: ${renameResult?.error}` }
      }

      console.log(`[ChunkedDownloader] File successfully saved to ${params.destPath}`)

      // Send 100% progress
      if (params.onProgress) {
        params.onProgress({
          receivedBytes: totalBytes,
          totalBytes,
          progress: 100,
          phase: 'download',
          detail: {
            current: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
            total: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
            unit: 'MB'
          }
        })
      }

      return {
        success: true,
        filePath: params.destPath
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { success: false, error: 'Download cancelled by user' }
        }
        return { success: false, error: error.message }
      }
      return { success: false, error: 'Unknown error' }
    }
  }

  /**
   * Merge multiple Uint8Array buffers into a single Uint8Array
   */
  private mergeBuffers(buffers: Uint8Array[], totalLength: number): Uint8Array {
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const buffer of buffers) {
      result.set(buffer, offset)
      offset += buffer.length
    }
    return result
  }

  /**
   * Cancel the current download
   */
  cancel(): void {
    if (this.abortController) {
      console.log('[ChunkedDownloader] Cancelling download')
      this.abortController.abort()
      this.abortController = null
    }
  }
}
