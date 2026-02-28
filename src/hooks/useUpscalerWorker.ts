import { useRef, useCallback, useEffect } from "react";
import type { ProgressDetail } from "@/types/progress";

type ModelType = "slim" | "medium" | "thick";
type ScaleType = "2x" | "3x" | "4x";

interface UpscaleResult {
  imageData: ImageData;
  width: number;
  height: number;
  id: number;
}

interface WorkerMessage {
  type: "loaded" | "phase" | "progress" | "result" | "error" | "disposed";
  payload?: unknown;
}

interface PhasePayload {
  phase: string;
  id?: number;
}

interface ProgressPayload {
  phase: string;
  progress: number;
  detail?: ProgressDetail;
  id?: number;
}

interface UseUpscalerWorkerOptions {
  onPhase?: (phase: string) => void;
  onProgress?: (
    phase: string,
    progress: number,
    detail?: ProgressDetail,
  ) => void;
  onError?: (error: string) => void;
}

// Helper function to convert ImageData to data URL
function imageDataToDataURL(
  imageData: ImageData,
  width: number,
  height: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

export function useUpscalerWorker(options: UseUpscalerWorkerOptions = {}) {
  const workerRef = useRef<Worker | null>(null);
  const callbacksRef = useRef<Map<number, (result: string) => void>>(new Map());
  const idCounterRef = useRef(0);
  const optionsRef = useRef(options);
  const hasFailedRef = useRef(false);

  // Keep options ref up to date
  optionsRef.current = options;

  const createWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }
    hasFailedRef.current = false;

    workerRef.current = new Worker(
      new URL("../workers/upscaler.worker.ts", import.meta.url),
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
        case "result": {
          const { imageData, width, height, id } = payload as UpscaleResult;
          const callback = callbacksRef.current.get(id);
          if (callback) {
            // Convert ImageData to data URL in main thread
            const dataURL = imageDataToDataURL(imageData, width, height);
            callback(dataURL);
            callbacksRef.current.delete(id);
          }
          break;
        }
        case "error":
          hasFailedRef.current = true;
          optionsRef.current.onError?.(payload as string);
          break;
      }
    };
  }, []);

  const ensureWorker = useCallback(() => {
    if (!workerRef.current) {
      createWorker();
    }
  }, [createWorker]);

  // Initialize worker
  useEffect(() => {
    createWorker();

    return () => {
      workerRef.current?.postMessage({ type: "dispose" });
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [createWorker]);

  const loadModel = useCallback(
    (model: ModelType, scale: ScaleType): Promise<void> => {
      return new Promise((resolve, reject) => {
        ensureWorker();

        if (!workerRef.current) {
          reject(new Error("Worker not initialized"));
          return;
        }

        const id = idCounterRef.current++;

        const handleMessage = (e: MessageEvent<WorkerMessage>) => {
          if (e.data.type === "loaded") {
            workerRef.current?.removeEventListener("message", handleMessage);
            resolve();
          } else if (e.data.type === "error") {
            workerRef.current?.removeEventListener("message", handleMessage);
            reject(new Error(e.data.payload as string));
          }
        };

        workerRef.current.addEventListener("message", handleMessage);
        workerRef.current.postMessage({
          type: "load",
          payload: { model, scale, id },
        });
      });
    },
    [ensureWorker],
  );

  const upscale = useCallback(
    (imageData: ImageData): Promise<string> => {
      return new Promise((resolve, reject) => {
        ensureWorker();

        if (!workerRef.current) {
          reject(new Error("Worker not initialized"));
          return;
        }

        const id = idCounterRef.current++;
        callbacksRef.current.set(id, resolve);

        // Set up error handler for this specific call
        const handleError = (e: MessageEvent<WorkerMessage>) => {
          if (e.data.type === "error") {
            callbacksRef.current.delete(id);
            workerRef.current?.removeEventListener("message", handleError);
            reject(new Error(e.data.payload as string));
          }
        };
        workerRef.current.addEventListener("message", handleError);

        workerRef.current.postMessage({
          type: "upscale",
          payload: { imageData, id },
        });
      });
    },
    [ensureWorker],
  );

  const dispose = useCallback(() => {
    workerRef.current?.postMessage({ type: "dispose" });
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const hasFailed = useCallback(() => hasFailedRef.current, []);

  const retryWorker = useCallback(() => {
    createWorker();
  }, [createWorker]);

  // Cancel ongoing processing by terminating and recreating the worker
  const cancel = useCallback(() => {
    // Clear all pending callbacks
    callbacksRef.current.clear();
    // Terminate and recreate worker
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    createWorker();
  }, [createWorker]);

  return { loadModel, upscale, dispose, hasFailed, retryWorker, cancel };
}
