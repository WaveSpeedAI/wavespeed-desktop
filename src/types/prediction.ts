export interface PredictionResult {
  id: string;
  model: string;
  status: "pending" | "processing" | "completed" | "failed" | "created";
  outputs?: (string | Record<string, unknown>)[];
  error?: string;
  has_nsfw_contents?: boolean[];
  created_at?: string;
  timings?: {
    inference?: number;
  };
  urls?: {
    get?: string;
  };
}

export interface PredictionResponse {
  code: number;
  message: string;
  data: PredictionResult;
}

export interface HistoryItem {
  id: string;
  model: string;
  status: "pending" | "processing" | "completed" | "failed" | "created";
  outputs?: (string | Record<string, unknown>)[];
  created_at: string;
  execution_time?: number;
  has_nsfw_contents?: boolean[];
}

export interface HistoryResponse {
  code: number;
  message: string;
  data: {
    page: number;
    total: number;
    items: HistoryItem[];
  };
}

export interface GenerationHistoryItem {
  id: string;
  prediction: PredictionResult;
  outputs: (string | Record<string, unknown>)[];
  formValues?: Record<string, unknown>;
  addedAt: number;
  thumbnailUrl: string | null;
  thumbnailType: "image" | "video" | null;
}

export interface UploadResponse {
  code: number;
  message: string;
  data: {
    type: string;
    download_url: string;
    filename: string;
    size: number;
  };
}
