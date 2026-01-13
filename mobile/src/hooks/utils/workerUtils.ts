/**
 * Utility functions for worker hooks
 * Provides common patterns for handling worker messages with proper cleanup
 */

interface WorkerMessage {
  type: string
  payload?: unknown
}

/**
 * Creates a promise that resolves on a specific message type and properly cleans up listeners
 * @param worker The worker instance
 * @param successType The message type that indicates success
 * @param errorType The message type that indicates error (default: 'error')
 * @param getPayload Function to extract payload from success message
 * @param postMessage Function to send the initial message
 */
export function createWorkerPromise<T>(
  worker: Worker,
  successType: string,
  options: {
    errorType?: string
    matchId?: number
    onSuccess: (payload: unknown) => T
    onError?: (payload: unknown) => Error
    postMessage: () => void
  }
): Promise<T> {
  const { errorType = 'error', matchId, onSuccess, onError, postMessage } = options

  return new Promise((resolve, reject) => {
    let resolved = false

    const cleanup = () => {
      worker.removeEventListener('message', handleMessage)
    }

    const handleMessage = (e: MessageEvent<WorkerMessage>) => {
      if (resolved) return

      const { type, payload } = e.data
      const payloadId = (payload as { id?: number })?.id

      // If matchId is specified, only handle messages with matching id
      if (matchId !== undefined && payloadId !== undefined && payloadId !== matchId) {
        return
      }

      if (type === successType) {
        resolved = true
        cleanup()
        resolve(onSuccess(payload))
      } else if (type === errorType) {
        resolved = true
        cleanup()
        const error = onError
          ? onError(payload)
          : new Error((payload as { message?: string })?.message || String(payload))
        reject(error)
      }
    }

    worker.addEventListener('message', handleMessage)
    postMessage()
  })
}

/**
 * Logger utility that only logs in development mode
 */
export const devLog = {
  log: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.log(...args)
    }
  },
  warn: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.warn(...args)
    }
  },
  error: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.error(...args)
    }
  }
}
