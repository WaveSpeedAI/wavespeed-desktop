import { useRef, useCallback, useEffect } from "react";
import type { ProgressDetail } from "@/types/progress";

interface PointPrompt {
  point: [number, number]; // Normalized coordinates (0-1)
  label: 0 | 1; // 0 = negative (exclude), 1 = positive (include)
}

export interface MaskResult {
  mask: Uint8Array;
  width: number;
  height: number;
  scores: Float32Array;
}

interface UseSegmentAnythingOptions {
  onPhase?: (phase: string) => void;
  onProgress?: (
    phase: string,
    progress: number,
    detail?: ProgressDetail,
  ) => void;
  onReady?: () => void;
  onSegmented?: () => void;
  onError?: (error: string) => void;
}

// Worker message types
interface PhasePayload {
  phase: string;
  id: number;
}

interface ProgressPayload {
  phase: string;
  progress: number;
  detail?: ProgressDetail;
  id: number;
}

interface MaskResultPayload {
  mask: ArrayBuffer;
  width: number;
  height: number;
  scores: ArrayBuffer;
  id: number;
}

interface ErrorPayload {
  message: string;
  id: number;
}

interface WorkerMessage {
  type:
    | "phase"
    | "progress"
    | "ready"
    | "segmented"
    | "maskResult"
    | "reset"
    | "error"
    | "disposed";
  payload:
    | PhasePayload
    | ProgressPayload
    | MaskResultPayload
    | ErrorPayload
    | { id: number };
}

export function useSegmentAnythingWorker(
  options: UseSegmentAnythingOptions = {},
) {
  const workerRef = useRef<Worker | null>(null);
  const optionsRef = useRef(options);
  const idCounterRef = useRef(0);
  const maskCallbacksRef = useRef<Map<number, (result: MaskResult) => void>>(
    new Map(),
  );
  const segmentCallbacksRef = useRef<Map<number, () => void>>(new Map());
  const resetCallbacksRef = useRef<Map<number, () => void>>(new Map());
  const initCallbacksRef = useRef<Map<number, () => void>>(new Map());
  const hasFailedRef = useRef(false);
  const isInitializedRef = useRef(false);
  const isSegmentedRef = useRef(false);

  // Keep options ref up to date
  optionsRef.current = options;

  const createWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }
    hasFailedRef.current = false;
    isInitializedRef.current = false;
    isSegmentedRef.current = false;

    workerRef.current = new Worker(
      new URL("../workers/segmentAnything.worker.ts", import.meta.url),
      { type: "module" },
    );

    workerRef.current.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const { type, payload } = e.data;

      switch (type) {
        case "phase": {
          const { phase } = payload as PhasePayload;
          optionsRef.current.onPhase?.(phase);
          break;
        }
        case "progress": {
          const { phase, progress, detail } = payload as ProgressPayload;
          optionsRef.current.onProgress?.(phase, progress, detail);
          break;
        }
        case "ready": {
          const { id } = payload as { id: number };
          isInitializedRef.current = true;
          optionsRef.current.onReady?.();
          const callback = initCallbacksRef.current.get(id);
          if (callback) {
            callback();
            initCallbacksRef.current.delete(id);
          }
          break;
        }
        case "segmented": {
          const { id } = payload as { id: number };
          isSegmentedRef.current = true;
          optionsRef.current.onSegmented?.();
          const callback = segmentCallbacksRef.current.get(id);
          if (callback) {
            callback();
            segmentCallbacksRef.current.delete(id);
          }
          break;
        }
        case "maskResult": {
          const { mask, width, height, scores, id } =
            payload as MaskResultPayload;
          const callback = maskCallbacksRef.current.get(id);
          if (callback) {
            callback({
              mask: new Uint8Array(mask),
              width,
              height,
              scores: new Float32Array(scores),
            });
            maskCallbacksRef.current.delete(id);
          }
          break;
        }
        case "reset": {
          const { id } = payload as { id: number };
          isSegmentedRef.current = false;
          const callback = resetCallbacksRef.current.get(id);
          if (callback) {
            callback();
            resetCallbacksRef.current.delete(id);
          }
          break;
        }
        case "error": {
          const { message } = payload as ErrorPayload;
          hasFailedRef.current = true;
          optionsRef.current.onError?.(message);
          break;
        }
        case "disposed":
          isSegmentedRef.current = false;
          break;
      }
    };

    workerRef.current.onerror = (e) => {
      console.error("Worker error:", e);
      hasFailedRef.current = true;
      optionsRef.current.onError?.(e.message || "Worker error");
    };
  }, []);

  const ensureWorker = useCallback(() => {
    if (!workerRef.current) {
      createWorker();
    }
  }, [createWorker]);

  // Initialize worker on mount
  useEffect(() => {
    createWorker();

    return () => {
      workerRef.current?.postMessage({ type: "dispose", payload: {} });
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [createWorker]);

  const initModel = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      ensureWorker();

      if (!workerRef.current) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const id = idCounterRef.current++;
      initCallbacksRef.current.set(id, resolve);

      const handleError = (e: MessageEvent<WorkerMessage>) => {
        if (
          e.data.type === "error" &&
          (e.data.payload as ErrorPayload).id === id
        ) {
          initCallbacksRef.current.delete(id);
          workerRef.current?.removeEventListener("message", handleError);
          reject(new Error((e.data.payload as ErrorPayload).message));
        }
      };
      workerRef.current.addEventListener("message", handleError);

      workerRef.current.postMessage({ type: "init", payload: { id } });
    });
  }, [ensureWorker]);

  const segmentImage = useCallback(
    (imageDataUrl: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        ensureWorker();

        if (!workerRef.current) {
          reject(new Error("Worker not initialized"));
          return;
        }

        const id = idCounterRef.current++;
        segmentCallbacksRef.current.set(id, resolve);

        const handleError = (e: MessageEvent<WorkerMessage>) => {
          if (
            e.data.type === "error" &&
            (e.data.payload as ErrorPayload).id === id
          ) {
            segmentCallbacksRef.current.delete(id);
            workerRef.current?.removeEventListener("message", handleError);
            reject(new Error((e.data.payload as ErrorPayload).message));
          }
        };
        workerRef.current.addEventListener("message", handleError);

        workerRef.current.postMessage({
          type: "segment",
          payload: { id, imageDataUrl },
        });
      });
    },
    [ensureWorker],
  );

  const decodeMask = useCallback(
    (points: PointPrompt[]): Promise<MaskResult> => {
      return new Promise((resolve, reject) => {
        ensureWorker();

        if (!workerRef.current) {
          reject(new Error("Worker not initialized"));
          return;
        }

        const id = idCounterRef.current++;
        maskCallbacksRef.current.set(id, resolve);

        const handleError = (e: MessageEvent<WorkerMessage>) => {
          if (
            e.data.type === "error" &&
            (e.data.payload as ErrorPayload).id === id
          ) {
            maskCallbacksRef.current.delete(id);
            workerRef.current?.removeEventListener("message", handleError);
            reject(new Error((e.data.payload as ErrorPayload).message));
          }
        };
        workerRef.current.addEventListener("message", handleError);

        workerRef.current.postMessage({
          type: "decodeMask",
          payload: { id, points },
        });
      });
    },
    [ensureWorker],
  );

  const reset = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      ensureWorker();

      if (!workerRef.current) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const id = idCounterRef.current++;
      resetCallbacksRef.current.set(id, resolve);

      workerRef.current.postMessage({ type: "reset", payload: { id } });
    });
  }, [ensureWorker]);

  const dispose = useCallback(() => {
    workerRef.current?.postMessage({ type: "dispose", payload: {} });
    workerRef.current?.terminate();
    workerRef.current = null;
    isSegmentedRef.current = false;
  }, []);

  const retryWorker = useCallback(() => {
    createWorker();
  }, [createWorker]);

  const checkIsInitialized = useCallback(() => isInitializedRef.current, []);
  const checkIsSegmented = useCallback(() => isSegmentedRef.current, []);
  const checkHasFailed = useCallback(() => hasFailedRef.current, []);

  // Cancel ongoing processing by terminating and recreating the worker
  const cancel = useCallback(() => {
    // Clear all pending callbacks
    maskCallbacksRef.current.clear();
    segmentCallbacksRef.current.clear();
    resetCallbacksRef.current.clear();
    initCallbacksRef.current.clear();
    // Terminate and recreate worker
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    isInitializedRef.current = false;
    isSegmentedRef.current = false;
    createWorker();
  }, [createWorker]);

  return {
    initModel,
    segmentImage,
    decodeMask,
    reset,
    dispose,
    retryModel: retryWorker,
    isInitialized: checkIsInitialized,
    isSegmented: checkIsSegmented,
    hasFailed: checkHasFailed,
    cancel,
  };
}
