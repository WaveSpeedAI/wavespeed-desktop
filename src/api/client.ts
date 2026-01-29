import axios, { AxiosInstance, AxiosError } from 'axios'
import type { Model, ModelsResponse } from '@/types/model'
import type { PredictionResult, PredictionResponse, HistoryResponse, UploadResponse } from '@/types/prediction'
import packageJson from '../../package.json'

const BASE_URL = 'https://api.wavespeed.ai'

// Get app version from package.json
const version = packageJson.version

// Detect operating system - works in Electron, browser, and Node.js
function getOperatingSystem(): string {
  // Try Node.js/Electron process.platform first (most reliable)
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform // 'darwin', 'win32', 'linux', etc.
  }

  // Fall back to user agent parsing (browser environment)
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    const userAgent = navigator.userAgent.toLowerCase()

    if (userAgent.includes('mac os x') || userAgent.includes('macintosh')) {
      return 'darwin'
    } else if (userAgent.includes('windows') || userAgent.includes('win64') || userAgent.includes('win32')) {
      return 'win32'
    } else if (userAgent.includes('android')) {
      return 'android'
    } else if (userAgent.includes('iphone') || userAgent.includes('ipad') || userAgent.includes('ipod')) {
      return 'ios'
    } else if (userAgent.includes('cros')) {
      return 'chromeos'
    } else if (userAgent.includes('linux')) {
      return 'linux'
    } else if (userAgent.includes('freebsd')) {
      return 'freebsd'
    }
  }

  return 'unknown'
}

// Custom error class with detailed information
export class APIError extends Error {
  code?: number
  status?: number
  details?: unknown

  constructor(message: string, options?: { code?: number; status?: number; details?: unknown }) {
    super(message)
    this.name = 'APIError'
    this.code = options?.code
    this.status = options?.status
    this.details = options?.details
  }
}

// Extract detailed error message from various error formats
function extractErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const response = error.response
    const status = response?.status
    const statusText = response?.statusText

    // Handle timeout errors
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return `Request timed out. The server may be experiencing high load.`
    }

    // Handle network errors
    if (error.code === 'ERR_NETWORK') {
      return `Network error: Unable to connect to the server. Please check your internet connection.`
    }

    if (response?.data) {
      const data = response.data as Record<string, unknown>
      // Try various error message formats
      if (typeof data.message === 'string') {
        return `${status ? `[${status}] ` : ''}${data.message}`
      }
      if (typeof data.error === 'string') {
        return `${status ? `[${status}] ` : ''}${data.error}`
      }
      if (typeof data.detail === 'string') {
        return `${status ? `[${status}] ` : ''}${data.detail}`
      }
      if (Array.isArray(data.detail)) {
        const details = data.detail.map((d: { msg?: string; message?: string }) => d.msg || d.message || JSON.stringify(d)).join('; ')
        return `${status ? `[${status}] ` : ''}${details}`
      }
      if (data.errors && Array.isArray(data.errors)) {
        const errors = data.errors.map((e: { message?: string }) => e.message || JSON.stringify(e)).join('; ')
        return `${status ? `[${status}] ` : ''}${errors}`
      }
      // Fallback to stringified response with status
      return `${status ? `[${status}${statusText ? ' ' + statusText : ''}] ` : ''}${JSON.stringify(data)}`
    }

    // HTTP status without response body
    if (status) {
      return `HTTP ${status}${statusText ? ': ' + statusText : ''}`
    }

    if (error.message) return error.message
  }
  if (error instanceof Error) return error.message
  return String(error)
}

function createAPIError(error: unknown, fallbackMessage: string): APIError {
  const message = extractErrorMessage(error) || fallbackMessage
  const axiosError = error instanceof AxiosError ? error : null
  return new APIError(message, {
    code: axiosError?.response?.data?.code,
    status: axiosError?.response?.status,
    details: axiosError?.response?.data
  })
}

export interface RunOptions {
  timeout?: number
  pollInterval?: number
  enableSyncMode?: boolean
}

export interface HistoryFilters {
  model?: string
  status?: 'completed' | 'failed' | 'processing' | 'created'
  created_after?: string
  created_before?: string
}

class WaveSpeedClient {
  private client: AxiosInstance
  private apiKey: string = ''

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 60000, // 60 second timeout for connection and read
      maxBodyLength: Infinity, // Allow large file uploads
      maxContentLength: Infinity, // Allow large response content
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Name': 'wavespeed-desktop',
        'X-Client-Version': version,
        'X-Client-OS': getOperatingSystem()
      }
    })

    this.client.interceptors.request.use((config) => {
      if (this.apiKey) {
        config.headers.Authorization = `Bearer ${this.apiKey}`
      }
      return config
    })
  }

  setApiKey(apiKey: string) {
    this.apiKey = apiKey
  }

  getApiKey(): string {
    return this.apiKey
  }

  async listModels(): Promise<Model[]> {
    try {
      const response = await this.client.get<ModelsResponse>('/api/v3/models')
      if (response.data.code !== 200) {
        throw new APIError(response.data.message || 'Failed to fetch models', {
          code: response.data.code,
          details: response.data
        })
      }
      return response.data.data
    } catch (error) {
      throw createAPIError(error, 'Failed to fetch models')
    }
  }

  async runPrediction(model: string, input: Record<string, unknown>, options?: { timeout?: number }): Promise<PredictionResult> {
    try {
      const response = await this.client.post<PredictionResponse>(`/api/v3/${model}`, input, {
        timeout: options?.timeout
      })
      if (response.data.code !== 200) {
        throw new APIError(response.data.message || 'Failed to run prediction', {
          code: response.data.code,
          details: response.data
        })
      }
      return response.data.data
    } catch (error) {
      throw createAPIError(error, 'Failed to run prediction')
    }
  }

  async getResult(requestId: string): Promise<PredictionResult> {
    try {
      const response = await this.client.get<PredictionResponse>(`/api/v3/predictions/${requestId}/result`)
      if (response.data.code !== 200) {
        throw new APIError(response.data.message || 'Failed to get result', {
          code: response.data.code,
          details: response.data
        })
      }
      return response.data.data
    } catch (error) {
      throw createAPIError(error, 'Failed to get result')
    }
  }

  // Check if error is a connection/network error that should be retried
  private isConnectionError(error: unknown): boolean {
    if (error instanceof AxiosError) {
      // Timeout errors
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        return true
      }
      // Network errors
      if (error.code === 'ERR_NETWORK' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return true
      }
    }
    return false
  }

  async run(
    model: string,
    input: Record<string, unknown>,
    options: RunOptions = {}
  ): Promise<PredictionResult> {
    const { timeout = 36000000, pollInterval = 1000, enableSyncMode = false } = options

    // If sync mode is enabled, add it to input and wait for response (use longer timeout)
    if (enableSyncMode) {
      const result = await this.runPrediction(model, { ...input, enable_sync_mode: true }, { timeout: 120000 })
      return result
    }

    // Submit prediction
    const prediction = await this.runPrediction(model, input)
    const requestId = prediction.id

    if (!requestId) {
      throw new Error('No request ID in response')
    }

    // Poll for result with retry on connection errors
    const startTime = Date.now()
    while (true) {
      if (Date.now() - startTime > timeout) {
        throw new Error('Prediction timed out')
      }

      try {
        const result = await this.getResult(requestId)

        if (result.status === 'completed') {
          return result
        }

        if (result.status === 'failed') {
          throw new APIError(result.error || 'Prediction failed', {
            details: result
          })
        }
      } catch (error) {
        // Retry after 1 second on connection errors
        if (this.isConnectionError(error)) {
          console.warn('Connection error during polling, retrying in 1 second...', error)
          await new Promise(resolve => setTimeout(resolve, 1000))
          continue
        }
        // Re-throw non-connection errors
        throw error
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }
  }

  async getHistory(
    page: number = 1,
    pageSize: number = 20,
    filters?: HistoryFilters
  ): Promise<HistoryResponse['data']> {
    try {
      // Default to last 24 hours if no date filters provided
      const now = new Date()
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

      const body: Record<string, unknown> = {
        page,
        page_size: pageSize,
        created_after: filters?.created_after || oneDayAgo.toISOString(),
        created_before: filters?.created_before || now.toISOString()
      }

      if (filters?.model) body.model = filters.model
      if (filters?.status) body.status = filters.status

      const response = await this.client.post<HistoryResponse>('/api/v3/predictions', body)
      if (response.data.code !== 200) {
        throw new APIError(response.data.message || 'Failed to fetch history', {
          code: response.data.code,
          details: response.data
        })
      }
      return response.data.data
    } catch (error) {
      throw createAPIError(error, 'Failed to fetch history')
    }
  }

  async deletePrediction(predictionId: string): Promise<void> {
    await this.deletePredictions([predictionId])
  }

  async deletePredictions(predictionIds: string[]): Promise<void> {
    try {
      const response = await this.client.post<{
        code: number
        message: string
        data?: unknown
      }>('/api/v3/predictions/delete', {
        ids: predictionIds
      })

      if (response.data.code !== 200) {
        throw new APIError(response.data.message || 'Failed to delete prediction', {
          code: response.data.code,
          details: response.data
        })
      }
    } catch (error) {
      throw createAPIError(error, 'Failed to delete prediction')
    }
  }

  async uploadFile(file: File, signal?: AbortSignal): Promise<string> {
    try {
      const formData = new FormData()
      formData.append('file', file)

      // Dynamic timeout based on file size
      // Minimum 120 seconds, add 1 second per MB, maximum 10 minutes
      const minTimeout = 120000
      const maxTimeout = 600000
      const fileSizeMb = file.size / (1024 * 1024)
      const timeout = Math.min(maxTimeout, Math.max(minTimeout, Math.ceil(fileSizeMb) * 1000 + minTimeout))

      const response = await this.client.post<UploadResponse>('/api/v3/media/upload/binary', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        timeout,
        signal
      })

      if (response.data.code !== 200) {
        throw new APIError(response.data.message || 'Failed to upload file', {
          code: response.data.code,
          details: response.data
        })
      }

      return response.data.data.download_url
    } catch (error) {
      // Check if this is a cancellation error
      if (axios.isCancel(error) || (error instanceof Error && error.name === 'CanceledError')) {
        throw new APIError('Upload cancelled', { code: 0 })
      }
      throw createAPIError(error, 'Failed to upload file')
    }
  }

  async optimizePrompt(input: Record<string, unknown>): Promise<string> {
    try {
      const result = await this.run(
        'wavespeed-ai/prompt-optimizer',
        { ...input, enable_sync_mode: true },
        { enableSyncMode: true }
      )

      if (result.outputs && result.outputs.length > 0) {
        const output = result.outputs[0]
        // Prompt optimizer always returns a string
        return typeof output === 'string' ? output : JSON.stringify(output)
      }

      throw new APIError('No optimized prompt returned')
    } catch (error) {
      throw createAPIError(error, 'Failed to optimize prompt')
    }
  }

  async calculatePricing(modelId: string, inputs: Record<string, unknown>): Promise<number> {
    try {
      const response = await this.client.post<{
        code: number
        message: string
        data: { unit_price: number }
      }>('/api/v3/model/pricing', {
        model_id: modelId,
        inputs
      })

      if (response.data.code !== 200) {
        throw new APIError(response.data.message || 'Failed to calculate pricing', {
          code: response.data.code,
          details: response.data
        })
      }

      return response.data.data.unit_price
    } catch (error) {
      throw createAPIError(error, 'Failed to calculate pricing')
    }
  }

  async getBalance(): Promise<number> {
    try {
      const response = await this.client.get<{
        code: number
        message: string
        data: { balance: number }
      }>('/api/v3/balance')

      if (response.data.code !== 200) {
        throw new APIError(response.data.message || 'Failed to fetch balance', {
          code: response.data.code,
          details: response.data
        })
      }

      return response.data.data.balance
    } catch (error) {
      throw createAPIError(error, 'Failed to fetch balance')
    }
  }
}

export const apiClient = new WaveSpeedClient()
export default apiClient
