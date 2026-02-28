/**
 * Upload IPC handlers — file upload to WaveSpeed CDN.
 */
import { ipcMain } from "electron";
import { getWaveSpeedClient } from "../services/service-locator";

export function registerUploadIpc(): void {
  ipcMain.handle(
    "upload:file",
    async (
      _event,
      args: { fileData: ArrayBuffer; filename: string },
    ): Promise<string> => {
      const ws = getWaveSpeedClient();
      const buffer = Buffer.from(args.fileData);
      const blob = new Blob([buffer]);
      const file = new File([blob], args.filename);
      const url = await ws.uploadFile(file, args.filename);
      return url;
    },
  );
}
