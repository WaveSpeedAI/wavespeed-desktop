/**
 * Execution IPC handlers — run, retry, continue, cancel.
 */
import { ipcMain, BrowserWindow } from "electron";
import { ExecutionEngine } from "../engine/executor";
import type { NodeStatus } from "../../../src/workflow/types/execution";

let engine: ExecutionEngine | null = null;

export function setExecutionEngine(e: ExecutionEngine): void {
  engine = e;
}

function getEngine(): ExecutionEngine {
  if (!engine) throw new Error("ExecutionEngine not initialized");
  return engine;
}

export function registerExecutionIpc(): void {
  ipcMain.handle(
    "execution:run-all",
    async (_event, args: { workflowId: string }) => {
      await getEngine().runAll(args.workflowId);
    },
  );

  ipcMain.handle(
    "execution:run-node",
    async (_event, args: { workflowId: string; nodeId: string }) => {
      await getEngine().runNode(args.workflowId, args.nodeId);
    },
  );

  ipcMain.handle(
    "execution:continue-from",
    async (_event, args: { workflowId: string; nodeId: string }) => {
      await getEngine().continueFrom(args.workflowId, args.nodeId);
    },
  );

  ipcMain.handle(
    "execution:retry",
    async (_event, args: { workflowId: string; nodeId: string }) => {
      await getEngine().retryNode(args.workflowId, args.nodeId);
    },
  );

  ipcMain.handle(
    "execution:cancel",
    async (_event, args: { workflowId: string; nodeId: string }) => {
      getEngine().cancel(args.workflowId, args.nodeId);
    },
  );
}

export function emitNodeStatus(
  workflowId: string,
  nodeId: string,
  status: NodeStatus,
  errorMessage?: string,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("execution:node-status", {
      workflowId,
      nodeId,
      status,
      errorMessage,
    });
  }
}

export function emitProgress(
  workflowId: string,
  nodeId: string,
  progress: number,
  message?: string,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("execution:progress", {
      workflowId,
      nodeId,
      progress,
      message,
    });
  }
}

export function emitEdgeStatus(
  workflowId: string,
  edgeId: string,
  status: "no-data" | "has-data",
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("execution:edge-status", {
      workflowId,
      edgeId,
      status,
    });
  }
}
