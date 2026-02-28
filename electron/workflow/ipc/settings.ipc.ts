/**
 * Settings IPC handlers — reads API key from Desktop's existing settings + node registry.
 * Unlike improver, we don't have a separate api_keys table. We read from Desktop's settings.json.
 */
import { ipcMain, app } from "electron";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { nodeRegistry } from "../nodes/registry";
import { resetClients } from "../services/service-locator";
import type { ApiKeyConfig } from "../../../src/workflow/types/ipc";
import type { NodeTypeDefinition } from "../../../src/workflow/types/node-defs";

function getDesktopSettingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

export function registerSettingsIpc(): void {
  // Read API key from Desktop's settings
  ipcMain.handle("settings:get-api-keys", async (): Promise<ApiKeyConfig> => {
    try {
      const settingsPath = getDesktopSettingsPath();
      if (existsSync(settingsPath)) {
        const data = JSON.parse(readFileSync(settingsPath, "utf-8"));
        return { wavespeedKey: data.apiKey || "" };
      }
    } catch {}
    return { wavespeedKey: "" };
  });

  // When workflow settings panel saves keys, update Desktop's settings
  ipcMain.handle(
    "settings:set-api-keys",
    async (_event, config: ApiKeyConfig) => {
      try {
        const settingsPath = getDesktopSettingsPath();
        let data: Record<string, unknown> = {};
        if (existsSync(settingsPath)) {
          data = JSON.parse(readFileSync(settingsPath, "utf-8"));
        }
        if (config.wavespeedKey !== undefined) {
          data.apiKey = config.wavespeedKey;
        }
        const dir = app.getPath("userData");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(settingsPath, JSON.stringify(data, null, 2));
        resetClients();
      } catch (error) {
        console.error("[Settings] Failed to save API keys:", error);
      }
    },
  );

  ipcMain.handle(
    "registry:get-all",
    async (): Promise<NodeTypeDefinition[]> => {
      return nodeRegistry.getAll();
    },
  );
}
