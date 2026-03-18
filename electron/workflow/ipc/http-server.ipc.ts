/**
 * IPC handlers for the global HTTP server — start, stop, status.
 */
import { ipcMain } from "electron";
import {
  startHttpServer,
  stopHttpServer,
  getHttpServerStatus,
} from "../services/http-server";

export function registerHttpServerIpc(): void {
  ipcMain.handle(
    "http-server:start",
    async (_event, args: { port?: number; workflowId?: string }) => {
      return startHttpServer(args?.port ?? 3100, args?.workflowId);
    },
  );

  ipcMain.handle("http-server:stop", async () => {
    return stopHttpServer();
  });

  ipcMain.handle("http-server:status", async () => {
    return getHttpServerStatus();
  });
}
