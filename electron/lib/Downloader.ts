/**
 * Generic file downloader with HTTP Range resume support
 *
 * Features:
 * - HTTP Range requests for resume support
 * - Automatic retry with exponential backoff
 * - Progress tracking
 * - Proxy support (via environment variables)
 * - File integrity validation
 */

import {
  createWriteStream,
  existsSync,
  statSync,
  renameSync,
  unlinkSync,
  WriteStream
} from 'fs'
import { mkdir } from 'fs/promises'
import { dirname } from 'path'

export interface DownloadOptions {
  url: string
  destPath: string
  onProgress?: (progress: DownloadProgress) => void
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
    current: number // MB
    total: number // MB
    unit: 'MB'
  }
}

export interface DownloadResult {
  success: boolean
  filePath?: string
  error?: string
}

export interface ActiveDownload {
  request: any
  cancelled: boolean
  fileStream?: WriteStream
}

export class Downloader {
  private activeDownloads: Map<string, ActiveDownload> = new Map()
  private inactivityTimeout = 120000 // 2 minutes

  /**
   * Download a file with resume support
   */
  async download(options: DownloadOptions): Promise<DownloadResult> {
    const {
      url,
      destPath,
      onProgress,
      timeout = 30000,
      maxRetries = 3,
      minValidSize = 0
    } = options

    // Cancel any existing download for this destination
    this.cancelDownload(destPath)

    // Ensure destination directory exists
    const destDir = dirname(destPath)
    if (!existsSync(destDir)) {
      await mkdir(destDir, { recursive: true })
    }

    const partPath = destPath + '.part'

    // Check if final file already exists and is valid
    if (existsSync(destPath)) {
      const stats = statSync(destPath)
      const fileSizeMB = Math.round(stats.size / 1024 / 1024)
      console.log(`[Downloader] Found existing file: ${fileSizeMB}MB`)

      // Validate file size if minValidSize is specified
      if (minValidSize > 0 && stats.size < minValidSize) {
        console.warn(
          `[Downloader] File is too small (${fileSizeMB}MB < ${Math.round(minValidSize / 1024 / 1024)}MB), likely incomplete`
        )
        console.warn(`[Downloader] Deleting incomplete file and restarting download...`)
        unlinkSync(destPath)
      } else {
        console.log(`[Downloader] File size looks valid, skipping download`)
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
      let startByte = 0
      if (existsSync(partPath)) {
        const stats = statSync(partPath)
        startByte = stats.size
        console.log(
          `[Downloader] Found partial download: ${Math.round(startByte / 1024 / 1024)}MB`
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
          onProgress
        })

        if (result.success) {
          return result
        }

        lastError = result.error || 'Unknown error'

        // If user cancelled, don't retry
        if (lastError.includes('cancelled by user')) {
          console.log('[Downloader] User cancelled download, stopping retry attempts')
          return { success: false, error: lastError }
        }

        // If not the last attempt, wait before retrying
        if (attempt < maxRetries) {
          const waitTime = attempt * 2000 // 2s, 4s, 6s
          console.log(`[Downloader] Retry ${attempt + 1}/${maxRetries} in ${waitTime / 1000}s...`)
          await new Promise((resolve) => setTimeout(resolve, waitTime))

          // Update startByte for resume
          if (existsSync(partPath)) {
            startByte = statSync(partPath).size
          }
        }
      } catch (error) {
        lastError = (error as Error).message
        console.error(`[Downloader] Attempt ${attempt} failed:`, lastError)

        // If user cancelled, don't retry
        if (lastError.includes('cancelled by user')) {
          console.log('[Downloader] User cancelled download, stopping retry attempts')
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
    onProgress?: (progress: DownloadProgress) => void
  }): Promise<DownloadResult> {
    return new Promise((resolve) => {
      // Flag to prevent multiple resolves
      let resolved = false
      const safeResolve = (result: DownloadResult) => {
        if (!resolved) {
          resolved = true
          resolve(result)
        }
      }

      // Use follow-redirects for automatic redirect handling
      const { https } = require('follow-redirects')
      const urlObj = new URL(params.url)

      // Check for proxy settings
      const proxyUrl =
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy

      const requestOptions: any = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers:
          params.startByte > 0
            ? {
                Range: `bytes=${params.startByte}-`,
                'User-Agent': 'Mozilla/5.0'
              }
            : {
                'User-Agent': 'Mozilla/5.0'
              },
        maxRedirects: 5,
        timeout: params.timeout
      }

      // Use proxy if configured
      if (proxyUrl) {
        const { HttpsProxyAgent } = require('https-proxy-agent')
        requestOptions.agent = new HttpsProxyAgent(proxyUrl)
        console.log(`[Downloader] Using proxy: ${proxyUrl}`)
      }

      console.log(`[Downloader] Attempt ${params.attempt}: Starting download from:`, params.url)
      if (params.startByte > 0) {
        console.log(
          `[Downloader] Requesting resume from byte ${params.startByte} (${Math.round(params.startByte / 1024 / 1024)}MB)`
        )
      }

      let inactivityTimer: NodeJS.Timeout | null = null
      let fileStream: WriteStream | null = null

      // Reset inactivity timer
      const resetInactivityTimer = () => {
        if (inactivityTimer) {
          clearTimeout(inactivityTimer)
        }
        inactivityTimer = setTimeout(() => {
          console.error('[Downloader] Download stalled (no data received for 2 minutes)')
          if (fileStream) fileStream.destroy()
          safeResolve({
            success: false,
            error: 'Download stalled (no data received for 2 minutes)'
          })
        }, this.inactivityTimeout)
      }

      const request = https.get(requestOptions, (response: any) => {
        console.log(`[Downloader] Connected! Response status: ${response.statusCode}`)
        if (response.responseUrl) {
          console.log(`[Downloader] Final URL after redirects: ${response.responseUrl}`)
        }

        // Check for valid response (200 for new download, 206 for resumed download)
        if (response.statusCode !== 200 && response.statusCode !== 206) {
          if (inactivityTimer) clearTimeout(inactivityTimer)
          this.activeDownloads.delete(params.destPath)
          safeResolve({
            success: false,
            error: `Server responded with status ${response.statusCode}`
          })
          return
        }

        // Check if server supports resume
        if (params.startByte > 0 && response.statusCode === 200) {
          console.warn('[Downloader] WARNING: Server does NOT support Range requests!')
          console.warn('[Downloader] Server returned 200 instead of 206, will restart download from 0')
          console.warn('[Downloader] Deleting .part file and restarting...')
          if (existsSync(params.partPath)) {
            unlinkSync(params.partPath)
          }
          params.startByte = 0
        }

        // Get total size from headers
        let totalBytes = 0
        if (response.statusCode === 206 && response.headers['content-range']) {
          const match = response.headers['content-range'].match(/bytes \d+-\d+\/(\d+)/)
          if (match) {
            totalBytes = parseInt(match[1], 10)
          }
          console.log(`[Downloader] ✓ Server supports resume! Content-Range: ${response.headers['content-range']}`)
        } else if (response.headers['content-length']) {
          const contentLength = parseInt(response.headers['content-length'], 10)
          totalBytes = params.startByte > 0 ? params.startByte + contentLength : contentLength
        }

        console.log(`[Downloader] Total size: ${Math.round(totalBytes / 1024 / 1024)}MB`)
        console.log(
          `[Downloader] Starting from: ${Math.round(params.startByte / 1024 / 1024)}MB (${params.startByte > 0 ? 'RESUME' : 'NEW'})`
        )

        // Open .part file for appending (if resuming) or writing (if new)
        const writeMode = params.startByte > 0 ? 'a' : 'w'
        fileStream = createWriteStream(params.partPath, { flags: writeMode })

        let receivedBytes = params.startByte
        let lastProgressUpdate = Date.now()
        let lastFlushTime = Date.now()

        // Save request and fileStream for cancellation
        this.activeDownloads.set(params.destPath, {
          request,
          cancelled: false,
          fileStream
        })

        // Start inactivity monitoring
        resetInactivityTimer()

        // Track progress
        response.on('data', (chunk: Buffer) => {
          // Check if download was cancelled
          const activeDownload = this.activeDownloads.get(params.destPath)
          if (activeDownload?.cancelled) {
            console.log('[Downloader] Download cancelled by user')
            if (fileStream) fileStream.destroy()
            if (inactivityTimer) clearTimeout(inactivityTimer)
            this.activeDownloads.delete(params.destPath)
            safeResolve({
              success: false,
              error: 'Download cancelled by user'
            })
            return
          }

          receivedBytes += chunk.length

          // Reset inactivity timer on each data chunk
          resetInactivityTimer()

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

          // Flush to disk every 5 seconds
          const timeSinceLastFlush = now - lastFlushTime
          if (timeSinceLastFlush >= 5000 && fileStream) {
            // Force flush by writing empty buffer
            fileStream.write('', () => {
              // Optional: force fsync if fd is available (cast to any to avoid TS error)
              const stream = fileStream as any
              if (stream?.fd !== undefined) {
                require('fs').fsync(stream.fd, (err: any) => {
                  if (err) console.error('[Downloader] Flush error:', err)
                })
              }
            })
            lastFlushTime = now
          }
        })

        response.on('error', (err: Error) => {
          if (fileStream) fileStream.destroy()
          if (inactivityTimer) clearTimeout(inactivityTimer)
          console.error('[Downloader] Response error:', err.message)

          const wasCancelled = this.activeDownloads.get(params.destPath)?.cancelled
          this.activeDownloads.delete(params.destPath)
          safeResolve({
            success: false,
            error: wasCancelled ? 'Download cancelled by user' : `Response error: ${err.message}`
          })
        })

        response.pipe(fileStream)

        fileStream.on('finish', () => {
          fileStream!.close()
          if (inactivityTimer) clearTimeout(inactivityTimer)

          // Check if already resolved (e.g., by error handler)
          if (resolved) {
            console.log('[Downloader] Already resolved, skipping finish handler')
            return
          }

          // Check if download was cancelled
          const activeDownload = this.activeDownloads.get(params.destPath)
          if (activeDownload?.cancelled) {
            console.log('[Downloader] Download was cancelled, NOT renaming .part file')
            console.log(
              `[Downloader] Partial file saved at: ${params.partPath} (${Math.round(receivedBytes / 1024 / 1024)}MB)`
            )
            this.activeDownloads.delete(params.destPath)
            safeResolve({
              success: false,
              error: 'Download cancelled by user'
            })
            return
          }

          console.log(
            `[Downloader] Download completed, received ${Math.round(receivedBytes / 1024 / 1024)}MB`
          )

          // Rename .part file to final filename
          try {
            console.log(`[Downloader] Renaming ${params.partPath} -> ${params.destPath}`)
            renameSync(params.partPath, params.destPath)
            console.log(`[Downloader] File successfully saved to ${params.destPath}`)

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

            this.activeDownloads.delete(params.destPath)

            safeResolve({
              success: true,
              filePath: params.destPath
            })
          } catch (error) {
            console.error('[Downloader] Failed to rename file:', error)
            this.activeDownloads.delete(params.destPath)
            safeResolve({
              success: false,
              error: `Failed to rename file: ${(error as Error).message}`
            })
          }
        })

        fileStream.on('error', (err: Error) => {
          fileStream!.close()
          if (inactivityTimer) clearTimeout(inactivityTimer)
          console.error('[Downloader] File write error:', err.message)

          const wasCancelled = this.activeDownloads.get(params.destPath)?.cancelled
          this.activeDownloads.delete(params.destPath)
          safeResolve({
            success: false,
            error: wasCancelled ? 'Download cancelled by user' : `File write error: ${err.message}`
          })
        })
      })

      request.on('error', (err: Error) => {
        if (fileStream) fileStream.destroy()
        if (inactivityTimer) clearTimeout(inactivityTimer)
        console.error('[Downloader] Request error:', err.message)

        const wasCancelled = this.activeDownloads.get(params.destPath)?.cancelled
        this.activeDownloads.delete(params.destPath)
        safeResolve({
          success: false,
          error: wasCancelled ? 'Download cancelled by user' : `Request error: ${err.message}`
        })
      })

      request.on('timeout', () => {
        request.destroy()
        if (fileStream) fileStream.destroy()
        if (inactivityTimer) clearTimeout(inactivityTimer)
        console.error('[Downloader] Connection timeout')
        this.activeDownloads.delete(params.destPath)
        safeResolve({
          success: false,
          error: 'Connection timeout'
        })
      })
    })
  }

  /**
   * Cancel an active download
   */
  cancelDownload(destPath: string): void {
    const activeDownload = this.activeDownloads.get(destPath)
    if (activeDownload) {
      console.log(`[Downloader] Cancelling download for ${destPath}`)
      activeDownload.cancelled = true
      activeDownload.request.destroy()
      // Don't manually close fileStream - let it end naturally
      // The error handlers will clean up and check the cancelled flag
    }
  }

  /**
   * Cancel all active downloads
   */
  cancelAll(): void {
    console.log(`[Downloader] Cancelling all active downloads (${this.activeDownloads.size})`)
    const destPaths = Array.from(this.activeDownloads.keys())
    for (const destPath of destPaths) {
      this.cancelDownload(destPath)
    }
  }
}
