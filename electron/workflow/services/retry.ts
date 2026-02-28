/**
 * API retry with exponential backoff.
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  skipClientErrors: boolean;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  skipClientErrors: true,
};

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<{ result: T; attempts: number; delays: number[] }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let attempts = 0;
  const delays: number[] = [];

  while (true) {
    attempts++;
    try {
      const result = await fn();
      return { result, attempts, delays };
    } catch (error) {
      if (
        error instanceof ApiError &&
        cfg.skipClientErrors &&
        error.statusCode >= 400 &&
        error.statusCode < 500
      ) {
        throw error;
      }
      if (attempts >= cfg.maxRetries) throw error;
      const delay = cfg.baseDelayMs * Math.pow(2, attempts - 1);
      delays.push(delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
