/**
 * IPC bridge for renderer-based free-tool execution.
 * Main sends execute request to renderer; renderer runs Web Worker and responds.
 */
import { ipcMain, BrowserWindow } from "electron";
import { v4 as uuid } from "uuid";
import { getFileStorageInstance } from "../utils/file-storage";
import type { NodeExecutionResult } from "../nodes/base";

export interface FreeToolExecuteRequest {
  requestId: string;
  nodeType: string;
  workflowId: string;
  nodeId: string;
  /** Input URLs by port key (e.g. { input: url } or { source: url1, target: url2 }) */
  inputs: Record<string, string>;
  params: Record<string, unknown>;
}

export interface FreeToolCompletePayload {
  requestId: string;
  workflowId: string;
  nodeId: string;
  outputData: string;
  outputExt: string;
  outputPrefix: string;
}

export interface FreeToolErrorPayload {
  requestId: string;
  error: string;
}

const pending = new Map<
  string,
  {
    resolve: (r: NodeExecutionResult) => void;
    reject: (e: Error) => void;
    startTime: number;
  }
>();

function toLocalAssetUrl(filePath: string): string {
  return `local-asset://${encodeURIComponent(filePath)}`;
}

export function registerFreeToolIpc(): void {
  ipcMain.handle(
    "free-tool:complete",
    async (_event, payload: FreeToolCompletePayload) => {
      const {
        requestId,
        workflowId,
        nodeId,
        outputData,
        outputExt,
        outputPrefix,
      } = payload;
      const entry = pending.get(requestId);
      if (!entry) {
        console.warn("[FreeTool] Unknown requestId:", requestId);
        return;
      }
      pending.delete(requestId);
      const { resolve, startTime } = entry;
      try {
        const storage = getFileStorageInstance();
        const buffer = Buffer.from(outputData, "base64");
        const filePath = storage.saveNodeOutput(
          workflowId,
          nodeId,
          outputPrefix,
          outputExt,
          buffer,
        );
        const outputUrl = toLocalAssetUrl(filePath);
        const result: NodeExecutionResult = {
          status: "success",
          outputs: { output: outputUrl },
          resultPath: outputUrl,
          resultMetadata: {
            output: outputUrl,
            resultUrl: outputUrl,
            resultUrls: [outputUrl],
            outputPath: filePath,
          },
          durationMs: Date.now() - startTime,
          cost: 0,
        };
        resolve(result);
      } catch (err) {
        entry.reject(err instanceof Error ? err : new Error(String(err)));
      }
    },
  );

  ipcMain.handle(
    "free-tool:error",
    async (_event, payload: FreeToolErrorPayload) => {
      const { requestId, error } = payload;
      const entry = pending.get(requestId);
      if (!entry) {
        console.warn("[FreeTool] Invalid requestId:", requestId);
        return;
      }
      pending.delete(requestId);
      entry.reject(new Error(error));
    },
  );

  // Detect renderer reload/navigation — fail all pending requests immediately
  // so the user sees an error right away instead of waiting for timeout
  const onWebContentsCreated = (
    _event: Electron.Event,
    webContents: Electron.WebContents,
  ) => {
    webContents.on("did-start-navigation", () => {
      if (pending.size > 0) {
        console.warn(
          `[FreeTool] Renderer reloading — failing ${pending.size} pending request(s)`,
        );
        for (const [reqId, entry] of pending) {
          pending.delete(reqId);
          entry.reject(
            new Error("Renderer reloaded during execution. Please retry."),
          );
        }
      }
    });
  };
  const { app } = require("electron");
  app.on("web-contents-created", onWebContentsCreated);
}

/**
 * Execute a free-tool in the renderer process and wait for the result.
 */
export function executeFreeToolInRenderer(
  req: Omit<FreeToolExecuteRequest, "requestId">,
): Promise<NodeExecutionResult> {
  return new Promise((resolve, reject) => {
    const requestId = uuid();
    const startTime = Date.now();

    const timeoutMs =
      req.nodeType === "free-tool/video-enhancer"
        ? 600_000
        : req.nodeType === "free-tool/face-swapper" ||
            req.nodeType === "free-tool/image-eraser" ||
            req.nodeType === "free-tool/face-enhancer"
          ? 300_000
          : 120_000;
    const timeout = setTimeout(() => {
      const entry = pending.get(requestId);
      if (entry) {
        pending.delete(requestId);
        entry.reject(
          new Error(`Free-tool execution timed out (${timeoutMs / 1000}s)`),
        );
      }
    }, timeoutMs);

    const wrapResolve = (r: NodeExecutionResult) => {
      clearTimeout(timeout);
      resolve(r);
    };
    const wrapReject = (e: Error) => {
      clearTimeout(timeout);
      reject(e);
    };

    pending.set(requestId, {
      resolve: wrapResolve,
      reject: wrapReject,
      startTime,
    });

    const win =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win?.webContents) {
      pending.delete(requestId);
      clearTimeout(timeout);
      reject(new Error("No browser window available for free-tool execution"));
      return;
    }

    win.webContents.send("free-tool:execute", { ...req, requestId });
  });
}
