export interface PredictionResult {
  id: string
  model: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  outputs?: string[]
  error?: string
  has_nsfw_contents?: boolean[]
  created_at?: string
  timings?: {
    inference?: number
  }
  urls?: {
    get?: string
  }
}

export interface PredictionResponse {
  code: number
  message: string
  data: PredictionResult
}

export interface HistoryItem {
  id: string
  model: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  outputs?: string[]
  created_at: string
  execution_time?: number
  has_nsfw_contents?: boolean[]
}

export interface HistoryResponse {
  code: number
  message: string
  data: {
    page: number
    total: number
    items: HistoryItem[]
  }
}

export interface UploadResponse {
  code: number
  message: string
  data: {
    type: string
    download_url: string
    filename: string
    size: number
  }
}
