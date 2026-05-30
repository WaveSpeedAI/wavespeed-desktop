import { useCallback, useEffect, useRef } from "react";
import type { ProgressDetail } from "@/types/progress";

export type ColorizeMode = "ai" | "natural" | "vintage" | "vivid" | "portrait";

export interface ColorizeOptions {
  mode: ColorizeMode;
  strength: number;
  saturation: number;
  preserveContrast: boolean;
}

interface WorkerMessage {
  type: "phase" | "progress" | "result" | "error" | "disposed";
  payload?: unknown;
}

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

interface ResultPayload {
  arrayBuffer: ArrayBuffer;
  id: number;
}

interface UseImageColorizerWorkerOptions {
  onPhase?: (phase: string) => void;
  onProgress?: (
    phase: string,
    progress: number,
    detail?: ProgressDetail,
  ) => void;
  onError?: (error: string) => void;
}

export function useImageColorizerWorker(
  options: UseImageColorizerWorkerOptions = {},
) {
  const workerRef = useRef<Worker | null>(null);
  const callbacksRef = useRef<Map<number, (result: Blob) => void>>(new Map());
  const idCounterRef = useRef(0);
  const optionsRef = useRef(options);
  const hasFailedRef = useRef(false);

  optionsRef.current = options;

  const createWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }
    hasFailedRef.current = false;

    workerRef.current = new Worker(
      new URL("../workers/imageColorizer.worker.ts", import.meta.url),
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
          const { arrayBuffer, id } = payload as ResultPayload;
          const callback = callbacksRef.current.get(id);
          if (callback) {
            callback(new Blob([arrayBuffer], { type: "image/png" }));
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

  useEffect(() => {
    createWorker();

    return () => {
      workerRef.current?.postMessage({ type: "dispose" });
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [createWorker]);

  const colorize = useCallback(
    (imageBlob: Blob, colorizeOptions: ColorizeOptions): Promise<Blob> =>
      new Promise((resolve, reject) => {
        ensureWorker();

        if (!workerRef.current) {
          reject(new Error("Worker not initialized"));
          return;
        }

        const id = idCounterRef.current++;
        callbacksRef.current.set(id, resolve);

        const handleError = (e: MessageEvent<WorkerMessage>) => {
          if (e.data.type === "error") {
            callbacksRef.current.delete(id);
            workerRef.current?.removeEventListener("message", handleError);
            reject(new Error(e.data.payload as string));
          }
        };
        workerRef.current.addEventListener("message", handleError);

        workerRef.current.postMessage({
          type: "process",
          payload: { imageBlob, options: colorizeOptions, id },
        });
      }),
    [ensureWorker],
  );

  const dispose = useCallback(() => {
    workerRef.current?.postMessage({ type: "dispose" });
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const retryWorker = useCallback(() => {
    createWorker();
  }, [createWorker]);

  const hasFailed = useCallback(() => hasFailedRef.current, []);

  return {
    colorize,
    dispose,
    retryWorker,
    hasFailed,
  };
}
