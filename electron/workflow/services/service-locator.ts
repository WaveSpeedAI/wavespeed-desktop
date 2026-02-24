/**
 * Service locator — provides configured API clients to node handlers.
 * Reads API key from Desktop's existing settings (electron-store / settings.json).
 */
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'

// We reuse Desktop's apiClient pattern but in main process we need to read the key directly
let _apiKey: string = ''

function loadApiKeyFromDesktopSettings(): string {
  if (_apiKey) return _apiKey
  try {
    const userDataPath = app.getPath('userData')
    const settingsPath = join(userDataPath, 'settings.json')
    if (existsSync(settingsPath)) {
      const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      if (data.apiKey) {
        _apiKey = data.apiKey
        return _apiKey
      }
    }
  } catch (error) {
    console.error('[ServiceLocator] Failed to load API key from Desktop settings:', error)
  }
  throw new Error('WaveSpeed API key not configured. Go to Settings to add it.')
}

/**
 * Lightweight wrapper that mimics the Desktop apiClient's run/uploadFile interface
 * for use in the workflow engine's main process.
 * run() accepts an optional AbortSignal so Stop can cancel in-flight requests and polling.
 */
export interface WaveSpeedMainClient {
  run(model: string, input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<{ outputs: unknown[]; [key: string]: unknown }>
  uploadFile(file: File, filename: string): Promise<string>
}

let _wsClient: WaveSpeedMainClient | null = null

export function getWaveSpeedClient(): WaveSpeedMainClient {
  if (_wsClient) return _wsClient

  const apiKey = loadApiKeyFromDesktopSettings()
  const BASE_URL = 'https://api.wavespeed.ai'

  _wsClient = {
    async run(model: string, input: Record<string, unknown>, options?: { signal?: AbortSignal }) {
      const signal = options?.signal

      /** Throw AbortError as soon as signal is aborted (works even if fetch ignores signal). */
      function throwIfAborted(): void {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      }

      /** Race a promise with the abort signal so we stop immediately on Stop. */
      async function withAbort<T>(p: Promise<T>): Promise<T> {
        throwIfAborted()
        if (!signal) return p
        const abortPromise = new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
        })
        return Promise.race([p, abortPromise])
      }

      // Submit prediction
      const submitRes = await withAbort(
        fetch(`${BASE_URL}/api/v3/${model}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'X-Client-Name': 'wavespeed-desktop-workflow'
          },
          body: JSON.stringify(input),
          ...(signal && { signal })
        })
      )
      const submitData = await submitRes.json() as { code: number; message: string; data: { id: string; status: string; outputs?: unknown[] } }
      if (submitData.code !== 200) throw new Error(submitData.message || 'Failed to run prediction')

      const requestId = submitData.data.id
      if (!requestId) throw new Error('No request ID in response')

      // Poll for result
      const startTime = Date.now()
      const timeout = 600000 // 10 min
      while (true) {
        throwIfAborted()
        if (Date.now() - startTime > timeout) throw new Error('Prediction timed out')

        const pollRes = await withAbort(
          fetch(`${BASE_URL}/api/v3/predictions/${requestId}/result`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            ...(signal && { signal })
          })
        )
        const pollData = await pollRes.json() as { code: number; data: { status: string; outputs?: unknown[]; error?: string } }
        if (pollData.code !== 200) throw new Error('Failed to get result')

        if (pollData.data.status === 'completed') return pollData.data as { outputs: unknown[] }
        if (pollData.data.status === 'failed') throw new Error(pollData.data.error || 'Prediction failed')

        // Wait 1s but bail out immediately if aborted
        await withAbort(new Promise(r => setTimeout(r, 1000)))
      }
    },

    async uploadFile(file: File, filename: string) {
      const formData = new FormData()
      formData.append('file', file, filename)

      const res = await fetch(`${BASE_URL}/api/v3/media/upload/binary`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        body: formData
      })
      const data = await res.json() as { code: number; message: string; data: { download_url: string } }
      if (data.code !== 200) throw new Error(data.message || 'Failed to upload file')
      return data.data.download_url
    }
  }

  return _wsClient
}

/** Reset cached clients (call when API keys change) */
export function resetClients(): void {
  _wsClient = null
  _apiKey = null
}
