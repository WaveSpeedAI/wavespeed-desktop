import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  Menu,
  clipboard,
  protocol,
  net,
} from "electron";
import { join, dirname } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  createWriteStream,
  unlinkSync,
  statSync,
  readdirSync,
  copyFileSync,
} from "fs";
import { readdir, stat } from "fs/promises";
import AdmZip from "adm-zip";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { autoUpdater, UpdateInfo } from "electron-updater";
import { spawn, execSync } from "child_process";
import https from "https";
import http from "http";
import { pathToFileURL } from "url";
import { SDGenerator } from "./lib/sdGenerator";
import log from "electron-log";
import { initWorkflowModule, closeWorkflowDatabase } from "./workflow";

// Suppress Chromium's noisy ffmpeg pixel format warnings (harmless, caused by video thumbnail decoding)
// These come from GPU/renderer processes' stderr and cannot be disabled via command-line switches.
// Filter them at the process level:
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (
  chunk: string | Uint8Array,
  ...args: unknown[]
): boolean => {
  const str = typeof chunk === "string" ? chunk : chunk.toString();
  if (
    str.includes("Unsupported pixel format") ||
    str.includes("ffmpeg_common.cc")
  )
    return true;
  return (originalStderrWrite as (...a: unknown[]) => boolean)(chunk, ...args);
};

// Linux-specific flags
if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
}

// Configure electron-log
// Log files location:
// - Windows: %USERPROFILE%\AppData\Roaming\wavespeed-desktop\logs\main.log
// - macOS: ~/Library/Logs/wavespeed-desktop/main.log
// - Linux: ~/.config/wavespeed-desktop/logs/main.log
log.transports.file.level = "info";
log.transports.console.level = is.dev ? "debug" : "info";
log.info("=".repeat(80));
log.info("Application starting...");
log.info("Version:", app.getVersion());
log.info("Platform:", process.platform, process.arch);
log.info("Electron:", process.versions.electron);
log.info("Chrome:", process.versions.chrome);
log.info("Node:", process.versions.node);
log.info("Log file:", log.transports.file.getFile().path);
log.info("=".repeat(80));

// Override console methods to use electron-log
console.log = log.log.bind(log);
console.info = log.info.bind(log);
console.warn = log.warn.bind(log);
console.error = log.error.bind(log);
console.debug = log.debug.bind(log);

// Settings storage
const userDataPath = app.getPath("userData");
const settingsPath = join(userDataPath, "settings.json");

// Global instances for SD operations
const sdGenerator = new SDGenerator();

// Global reference to active SD generation process (deprecated - using sdGenerator)
let activeSDProcess: ReturnType<typeof spawn> | null = null;

// Cache for system info to avoid repeated checks
let systemInfoCache: {
  platform: string;
  arch: string;
  acceleration: string;
  supported: boolean;
} | null = null;
let metalSupportCache: boolean | null = null;
let binaryPathLoggedOnce = false;

function parseMaxNumberFromOutput(output: string): number | null {
  const values = output
    .split(/\r?\n/)
    .map((line) => parseInt(line.replace(/[^\d]/g, "").trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (values.length === 0) {
    return null;
  }

  return Math.max(...values);
}

function getNvidiaVramMb(): number | null {
  try {
    const output = execSync(
      "nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits",
      { encoding: "utf8", timeout: 3000 },
    );
    return parseMaxNumberFromOutput(output);
  } catch (error) {
    return null;
  }
}

function getWindowsGpuVramMb(): number | null {
  try {
    const output = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty AdapterRAM"',
      { encoding: "utf8", timeout: 3000 },
    );
    const bytes = parseMaxNumberFromOutput(output);
    if (!bytes) return null;
    return Math.round(bytes / (1024 * 1024));
  } catch (error) {
    try {
      const output = execSync(
        "wmic path win32_VideoController get AdapterRAM",
        { encoding: "utf8", timeout: 3000 },
      );
      const bytes = parseMaxNumberFromOutput(output);
      if (!bytes) return null;
      return Math.round(bytes / (1024 * 1024));
    } catch (err) {
      return null;
    }
  }
}

function getGpuVramMb(): number | null {
  if (process.platform !== "win32") {
    return null;
  }

  return getNvidiaVramMb() ?? getWindowsGpuVramMb();
}

interface Settings {
  apiKey: string;
  theme: "light" | "dark" | "system";
  defaultPollInterval: number;
  defaultTimeout: number;
  updateChannel: "stable" | "nightly";
  autoCheckUpdate: boolean;
  autoSaveAssets: boolean;
  assetsDirectory: string;
  language: string;
}

interface AssetMetadata {
  id: string;
  filePath: string;
  fileName: string;
  type: "image" | "video" | "audio" | "text" | "json";
  modelId: string;
  modelName: string;
  createdAt: string;
  fileSize: number;
  tags: string[];
  favorite: boolean;
  predictionId?: string;
  originalUrl?: string;
  source?: "playground" | "workflow" | "free-tool";
  workflowId?: string;
  workflowName?: string;
  nodeId?: string;
  executionId?: string;
}

// ─── Persistent key-value state (survives app restarts, unlike renderer localStorage) ────
const statePath = join(userDataPath, "renderer-state.json");

function loadState(): Record<string, unknown> {
  try {
    if (existsSync(statePath)) {
      return JSON.parse(readFileSync(statePath, "utf-8"));
    }
  } catch {
    /* corrupted file — start fresh */
  }
  return {};
}

function saveState(state: Record<string, unknown>): void {
  try {
    if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error("Failed to save renderer state:", error);
  }
}

const defaultAssetsDirectory = join(app.getPath("documents"), "WaveSpeed");
const assetsMetadataPath = join(userDataPath, "assets-metadata.json");

const defaultSettings: Settings = {
  apiKey: "",
  theme: "system",
  defaultPollInterval: 1000,
  defaultTimeout: 36000,
  updateChannel: "stable",
  autoCheckUpdate: true,
  autoSaveAssets: true,
  assetsDirectory: defaultAssetsDirectory,
  language: "auto",
};

function loadSettings(): Settings {
  try {
    if (existsSync(settingsPath)) {
      const data = readFileSync(settingsPath, "utf-8");
      return { ...defaultSettings, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error("Failed to load settings:", error);
  }
  return { ...defaultSettings };
}

function saveSettings(settings: Partial<Settings>): void {
  try {
    const currentSettings = loadSettings();
    const newSettings = { ...currentSettings, ...settings };
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true });
    }
    writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));
  } catch (error) {
    console.error("Failed to save settings:", error);
  }
}

function createWindow(): void {
  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    icon: join(__dirname, "../../build/icon.png"),
    backgroundColor: "#080c16",
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac ? { trafficLightPosition: { x: 10, y: 8 } } : {}),
    ...(process.platform !== "darwin"
      ? {
          titleBarOverlay: {
            color: "#080c16",
            symbolColor: "#6b7280",
            height: 32,
          },
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !is.dev, // Disable web security in dev mode to bypass CORS
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  // macOS: Hide window instead of closing when clicking the red button
  // The app will only quit when user presses Cmd+Q
  if (process.platform === "darwin") {
    mainWindow.on("close", (event) => {
      if (!(app as typeof app & { isQuitting?: boolean }).isQuitting) {
        event.preventDefault();
        if (mainWindow?.isFullScreen()) {
          const targetWindow = mainWindow;
          targetWindow.once("leave-full-screen", () => {
            targetWindow.hide();
          });
          targetWindow.setFullScreen(false);
        } else {
          mainWindow?.hide();
        }
      }
    });
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // Error handling for renderer
  mainWindow.webContents.on(
    "did-fail-load",
    (_, errorCode, errorDescription, validatedURL) => {
      console.error(
        "Failed to load:",
        errorCode,
        errorDescription,
        validatedURL,
      );
    },
  );

  mainWindow.webContents.on("render-process-gone", (_, details) => {
    console.error("Render process gone:", details);
  });

  // Load the app
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    const indexPath = join(__dirname, "../renderer/index.html");
    console.log("Loading renderer from:", indexPath);
    console.log("File exists:", existsSync(indexPath));
    mainWindow.loadFile(indexPath);
  }

  // Open DevTools with keyboard shortcut (Cmd+Opt+I on Mac, Ctrl+Shift+I on Windows/Linux)
  mainWindow.webContents.on("before-input-event", (_, input) => {
    if (
      (input.meta || input.control) &&
      input.shift &&
      input.key.toLowerCase() === "i"
    ) {
      mainWindow?.webContents.toggleDevTools();
    }
    // Also allow F12
    if (input.key === "F12") {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  // Enable right-click context menu
  mainWindow.webContents.on("context-menu", (_, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = [];

    // Add text editing options when in editable field
    if (params.isEditable) {
      menuItems.push(
        { label: "Cut", role: "cut", enabled: params.editFlags.canCut },
        { label: "Copy", role: "copy", enabled: params.editFlags.canCopy },
        { label: "Paste", role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { label: "Select All", role: "selectAll" },
      );
    } else if (params.selectionText) {
      // Add copy option when text is selected
      menuItems.push({ label: "Copy", role: "copy" });
    }

    // Add link options
    if (params.linkURL) {
      if (menuItems.length > 0) menuItems.push({ type: "separator" });
      menuItems.push(
        {
          label: "Open Link in Browser",
          click: () => shell.openExternal(params.linkURL),
        },
        {
          label: "Copy Link",
          click: () => clipboard.writeText(params.linkURL),
        },
      );
    }

    // Add image options
    if (params.mediaType === "image") {
      if (menuItems.length > 0) menuItems.push({ type: "separator" });
      menuItems.push(
        {
          label: "Copy Image",
          click: () => mainWindow?.webContents.copyImageAt(params.x, params.y),
        },
        {
          label: "Open Image in Browser",
          click: () => shell.openExternal(params.srcURL),
        },
      );
    }

    if (menuItems.length > 0) {
      const menu = Menu.buildFromTemplate(menuItems);
      menu.popup();
    }
  });
}

// IPC Handlers

// Update title bar overlay colors when theme changes (Windows only)
ipcMain.handle("update-titlebar-theme", (_, isDark: boolean) => {
  if (process.platform === "darwin" || !mainWindow) return;
  try {
    mainWindow.setTitleBarOverlay({
      color: isDark ? "#080c16" : "#f6f7f9",
      symbolColor: isDark ? "#9ca3af" : "#6b7280",
      height: 32,
    });
  } catch {
    // setTitleBarOverlay may not be available on all platforms
  }
});

ipcMain.handle("get-api-key", () => {
  const settings = loadSettings();
  return settings.apiKey;
});

ipcMain.handle("set-api-key", (_, apiKey: string) => {
  saveSettings({ apiKey });
  return true;
});

ipcMain.handle("get-settings", () => {
  const settings = loadSettings();
  return {
    theme: settings.theme,
    defaultPollInterval: settings.defaultPollInterval,
    defaultTimeout: settings.defaultTimeout,
    updateChannel: settings.updateChannel,
    autoCheckUpdate: settings.autoCheckUpdate,
    language: settings.language,
  };
});

ipcMain.handle("set-settings", (_, newSettings: Partial<Settings>) => {
  saveSettings(newSettings);
  return true;
});

ipcMain.handle("clear-all-data", () => {
  saveSettings(defaultSettings);
  return true;
});

// Persistent renderer state (key-value, survives restarts)
ipcMain.handle("get-state", (_, key: string) => {
  const state = loadState();
  return state[key] ?? null;
});

ipcMain.handle("set-state", (_, key: string, value: unknown) => {
  const state = loadState();
  if (value === null || value === undefined) {
    delete state[key];
  } else {
    state[key] = value;
  }
  saveState(state);
  return true;
});

ipcMain.handle("remove-state", (_, key: string) => {
  const state = loadState();
  delete state[key];
  saveState(state);
  return true;
});

// Open external URL handler
ipcMain.handle("open-external", async (_, url: string) => {
  await shell.openExternal(url);
});

// Download file handler
ipcMain.handle(
  "download-file",
  async (_, url: string, defaultFilename: string) => {
    const mainWindow = BrowserWindow.getFocusedWindow();
    if (!mainWindow) return { success: false, error: "No focused window" };

    // Show save dialog
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultFilename,
      filters: [
        { name: "All Files", extensions: ["*"] },
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
        { name: "Videos", extensions: ["mp4", "webm", "mov"] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    // Handle local-asset:// URLs (Z-Image local outputs)
    if (url.startsWith("local-asset://")) {
      try {
        const localPath = decodeURIComponent(url.replace("local-asset://", ""));
        if (!existsSync(localPath)) {
          return { success: false, error: "Source file not found" };
        }
        copyFileSync(localPath, result.filePath);
        return { success: true, filePath: result.filePath };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }

    // Download the file from http/https
    return new Promise((resolve) => {
      const httpProtocol = url.startsWith("https") ? https : http;
      const file = createWriteStream(result.filePath!);

      httpProtocol
        .get(url, (response) => {
          // Handle redirects
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              const redirectProtocol = redirectUrl.startsWith("https")
                ? https
                : http;
              redirectProtocol
                .get(redirectUrl, (redirectResponse) => {
                  redirectResponse.pipe(file);
                  file.on("finish", () => {
                    file.close();
                    resolve({ success: true, filePath: result.filePath });
                  });
                })
                .on("error", (err) => {
                  resolve({ success: false, error: err.message });
                });
              return;
            }
          }

          response.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve({ success: true, filePath: result.filePath });
          });
        })
        .on("error", (err) => {
          resolve({ success: false, error: err.message });
        });
    });
  },
);

// Silent file save handler — saves a remote URL to a local directory without dialog
ipcMain.handle(
  "save-file-silent",
  async (_, url: string, dir: string, fileName: string) => {
    try {
      if (!fileName) return { success: false, error: "Missing filename" };
      const targetDir = dir || app.getPath("downloads");
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      const filePath = join(targetDir, fileName);

      // Handle local-asset:// URLs
      if (url.startsWith("local-asset://")) {
        const localPath = decodeURIComponent(url.replace("local-asset://", ""));
        if (!existsSync(localPath))
          return { success: false, error: "Source file not found" };
        copyFileSync(localPath, filePath);
        return { success: true, filePath };
      }

      // Handle data: URLs
      if (url.startsWith("data:")) {
        const matches = url.match(/^data:[^;]+;base64,(.+)$/);
        if (matches) {
          writeFileSync(filePath, Buffer.from(matches[1], "base64"));
          return { success: true, filePath };
        }
        return { success: false, error: "Invalid data URL" };
      }

      // Download from http/https
      return new Promise((resolve) => {
        const httpProtocol = url.startsWith("https") ? https : http;
        const file = createWriteStream(filePath);
        httpProtocol
          .get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
              const redirectUrl = response.headers.location;
              if (redirectUrl) {
                const rp = redirectUrl.startsWith("https") ? https : http;
                rp.get(redirectUrl, (rr) => {
                  rr.pipe(file);
                  file.on("finish", () => {
                    file.close();
                    resolve({ success: true, filePath });
                  });
                }).on("error", (err) =>
                  resolve({ success: false, error: err.message }),
                );
                return;
              }
            }
            response.pipe(file);
            file.on("finish", () => {
              file.close();
              resolve({ success: true, filePath });
            });
          })
          .on("error", (err) =>
            resolve({ success: false, error: err.message }),
          );
      });
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },
);

// Assets metadata helpers
function loadAssetsMetadata(): AssetMetadata[] {
  try {
    if (existsSync(assetsMetadataPath)) {
      const data = readFileSync(assetsMetadataPath, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Failed to load assets metadata:", error);
  }
  return [];
}

function saveAssetsMetadata(metadata: AssetMetadata[]): void {
  try {
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true });
    }
    writeFileSync(assetsMetadataPath, JSON.stringify(metadata, null, 2));
  } catch (error) {
    console.error("Failed to save assets metadata:", error);
  }
}

// Assets IPC Handlers
ipcMain.handle("get-assets-settings", () => {
  const settings = loadSettings();
  return {
    autoSaveAssets: settings.autoSaveAssets,
    assetsDirectory: settings.assetsDirectory || defaultAssetsDirectory,
  };
});

ipcMain.handle(
  "set-assets-settings",
  (_, newSettings: { autoSaveAssets?: boolean; assetsDirectory?: string }) => {
    saveSettings(newSettings);
    return true;
  },
);

ipcMain.handle("get-default-assets-directory", () => {
  return defaultAssetsDirectory;
});

ipcMain.handle("get-zimage-output-path", () => {
  // Use same ID format as other assets: base36 timestamp + random suffix
  const id =
    Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  const settings = loadSettings();
  const assetsDir = settings.assetsDirectory || defaultAssetsDirectory;
  const imagesDir = join(assetsDir, "images");
  // Ensure images subdirectory exists
  if (!existsSync(imagesDir)) {
    mkdirSync(imagesDir, { recursive: true });
  }
  // Format: {owner}_{model}_{id}_{resultIndex}.{ext} - consistent with generateFileName in assetsStore
  return join(imagesDir, `local_z-image_${id}_0.png`);
});

ipcMain.handle("select-directory", async () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) return { success: false, error: "No focused window" };

  const result = await dialog.showOpenDialog(focusedWindow, {
    properties: ["openDirectory", "createDirectory"],
    title: "Select Assets Directory",
  });

  if (result.canceled || !result.filePaths[0]) {
    return { success: false, canceled: true };
  }

  return { success: true, path: result.filePaths[0] };
});

ipcMain.handle(
  "save-asset",
  async (_, url: string, _type: string, fileName: string, subDir: string) => {
    const settings = loadSettings();
    const baseDir = settings.assetsDirectory || defaultAssetsDirectory;
    const targetDir = join(baseDir, subDir);

    // Ensure directory exists
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    const filePath = join(targetDir, fileName);

    // Handle local-asset:// URLs (Z-Image local outputs)
    if (url.startsWith("local-asset://")) {
      try {
        const localPath = decodeURIComponent(url.replace("local-asset://", ""));
        if (!existsSync(localPath)) {
          return { success: false, error: "Source file not found" };
        }
        copyFileSync(localPath, filePath);
        const stats = statSync(filePath);
        return { success: true, filePath, fileSize: stats.size };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }

    // Download file from http/https
    return new Promise((resolve) => {
      const httpProtocol = url.startsWith("https") ? https : http;
      const file = createWriteStream(filePath);

      const handleResponse = (response: http.IncomingMessage) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            const redirectProtocol = redirectUrl.startsWith("https")
              ? https
              : http;
            redirectProtocol
              .get(redirectUrl, (redirectResponse) => {
                handleResponse(redirectResponse);
              })
              .on("error", (err) => {
                resolve({ success: false, error: err.message });
              });
            return;
          }
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          try {
            const stats = statSync(filePath);
            resolve({ success: true, filePath, fileSize: stats.size });
          } catch {
            resolve({ success: true, filePath, fileSize: 0 });
          }
        });
      };

      httpProtocol.get(url, handleResponse).on("error", (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  },
);

ipcMain.handle("delete-asset", async (_, filePath: string) => {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle("delete-assets-bulk", async (_, filePaths: string[]) => {
  let deleted = 0;
  for (const filePath of filePaths) {
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        deleted++;
      }
    } catch (error) {
      console.error("Failed to delete:", filePath, error);
    }
  }
  return { success: true, deleted };
});

ipcMain.handle("get-assets-metadata", () => {
  return loadAssetsMetadata();
});

ipcMain.handle("save-assets-metadata", (_, metadata: AssetMetadata[]) => {
  saveAssetsMetadata(metadata);
  return true;
});

ipcMain.handle("open-file-location", async (_, filePath: string) => {
  if (existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return { success: true };
  }
  return { success: false, error: "File not found" };
});

/**
 * File operations for chunked downloads from Worker/Renderer
 */
ipcMain.handle("file-get-size", (_, filePath: string) => {
  try {
    if (existsSync(filePath)) {
      return { success: true, size: statSync(filePath).size };
    }
    return { success: true, size: 0 };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle(
  "file-append-chunk",
  (_, filePath: string, chunk: ArrayBuffer) => {
    try {
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const buffer = Buffer.from(chunk);

      // Append to file (create if not exists)
      if (existsSync(filePath)) {
        const fd = require("fs").openSync(filePath, "a");
        require("fs").writeSync(fd, buffer);
        require("fs").closeSync(fd);
      } else {
        writeFileSync(filePath, buffer);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
);

ipcMain.handle("file-rename", (_, oldPath: string, newPath: string) => {
  try {
    if (existsSync(oldPath)) {
      require("fs").renameSync(oldPath, newPath);
      return { success: true };
    }
    return { success: false, error: "File not found" };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle("file-delete", (_, filePath: string) => {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      return { success: true };
    }
    return { success: true }; // Already deleted
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle("check-file-exists", (_, filePath: string) => {
  return existsSync(filePath);
});

ipcMain.handle("open-assets-folder", async () => {
  const settings = loadSettings();
  const assetsDir = settings.assetsDirectory || defaultAssetsDirectory;

  // Ensure directory exists
  if (!existsSync(assetsDir)) {
    mkdirSync(assetsDir, { recursive: true });
  }

  const result = await shell.openPath(assetsDir);
  return { success: !result, error: result || undefined };
});

// Scan assets directory and return all files found (async for non-blocking)
ipcMain.handle("scan-assets-directory", async () => {
  const settings = loadSettings();
  const assetsDir = settings.assetsDirectory || defaultAssetsDirectory;

  const subDirs = ["images", "videos", "audio", "text"];
  const files: Array<{
    filePath: string;
    fileName: string;
    type: "image" | "video" | "audio" | "text";
    fileSize: number;
    createdAt: string;
  }> = [];

  const typeMap: Record<string, "image" | "video" | "audio" | "text"> = {
    images: "image",
    videos: "video",
    audio: "audio",
    text: "text",
  };

  // Process directories in parallel for better performance
  await Promise.all(
    subDirs.map(async (subDir) => {
      const dirPath = join(assetsDir, subDir);
      if (!existsSync(dirPath)) return;

      try {
        const entries = await readdir(dirPath);
        // Process files in parallel batches
        const filePromises = entries.map(async (entry) => {
          const filePath = join(dirPath, entry);
          try {
            const stats = await stat(filePath);
            if (stats.isFile()) {
              return {
                filePath,
                fileName: entry,
                type: typeMap[subDir],
                fileSize: stats.size,
                createdAt: stats.birthtime.toISOString(),
              };
            }
          } catch {
            // Skip files we can't stat
          }
          return null;
        });
        const results = await Promise.all(filePromises);
        files.push(
          ...results.filter((f): f is NonNullable<typeof f> => f !== null),
        );
      } catch {
        // Skip directories we can't read
      }
    }),
  );

  return files;
});

// SD download path helpers for chunked downloads
ipcMain.handle("sd-get-binary-download-path", () => {
  try {
    const platform = process.platform;
    const binaryName = platform === "win32" ? "sd.exe" : "sd";

    const binaryDir = join(app.getPath("userData"), "sd-bin");
    const binaryPath = join(binaryDir, binaryName);

    // Ensure directory exists
    if (!existsSync(binaryDir)) {
      mkdirSync(binaryDir, { recursive: true });
    }

    return { success: true, path: binaryPath };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle(
  "sd-get-auxiliary-model-download-path",
  (_, type: "llm" | "vae") => {
    try {
      const auxDir = getAuxiliaryModelsDir();

      // Ensure directory exists
      if (!existsSync(auxDir)) {
        mkdirSync(auxDir, { recursive: true });
      }

      const filename =
        type === "llm"
          ? "Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf"
          : "ae.safetensors";

      const filePath = join(auxDir, filename);

      return { success: true, path: filePath };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
);

ipcMain.handle("sd-get-models-dir", () => {
  try {
    const modelsDir = getModelsDir();

    // Ensure directory exists
    if (!existsSync(modelsDir)) {
      mkdirSync(modelsDir, { recursive: true });
    }

    return { success: true, path: modelsDir };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

/**
 * Extract zip file and copy all contents to destination directory
 * Supports both old (sd) and new (sd-cli) binary names
 */
ipcMain.handle("sd-extract-binary", (_, zipPath: string, destPath: string) => {
  try {
    console.log("[SD Extract] Extracting:", zipPath);
    console.log("[SD Extract] Destination:", destPath);

    if (!existsSync(zipPath)) {
      throw new Error(`Zip file not found: ${zipPath}`);
    }

    const zip = new AdmZip(zipPath);
    const tempExtractDir = join(dirname(zipPath), "temp-extract");

    // Extract to temp directory
    zip.extractAllTo(tempExtractDir, true);
    console.log("[SD Extract] Extracted to temp directory:", tempExtractDir);

    // Find the binary file (sd, sd.exe, sd-cli, or sd-cli.exe)
    const possibleNames =
      process.platform === "win32"
        ? ["sd.exe", "sd-cli.exe"]
        : ["sd", "sd-cli"];

    let binaryPath: string | null = null;
    let actualBinaryName: string | null = null;

    const findBinary = (dir: string): { path: string; name: string } | null => {
      const files = readdirSync(dir, { withFileTypes: true });
      for (const file of files) {
        const fullPath = join(dir, file.name);
        if (file.isDirectory()) {
          const found = findBinary(fullPath);
          if (found) return found;
        } else if (possibleNames.includes(file.name)) {
          return { path: fullPath, name: file.name };
        }
      }
      return null;
    };

    const found = findBinary(tempExtractDir);
    if (!found) {
      throw new Error(
        `Binary not found in extracted files. Looked for: ${possibleNames.join(", ")}`,
      );
    }

    binaryPath = found.path;
    actualBinaryName = found.name;
    console.log("[SD Extract] Found binary:", binaryPath);

    // Get the directory containing the binary
    const binaryDir = dirname(binaryPath);
    console.log("[SD Extract] Binary directory:", binaryDir);

    // Ensure destination directory exists
    const destDir = dirname(destPath);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    // Copy all files from binary directory to destination directory
    const copyDirContents = (srcDir: string, dstDir: string) => {
      const files = readdirSync(srcDir, { withFileTypes: true });
      for (const file of files) {
        const srcPath = join(srcDir, file.name);
        const dstPath = join(dstDir, file.name);

        if (file.isDirectory()) {
          if (!existsSync(dstPath)) {
            mkdirSync(dstPath, { recursive: true });
          }
          copyDirContents(srcPath, dstPath);
        } else {
          // Copy file
          if (existsSync(dstPath)) {
            unlinkSync(dstPath);
          }
          require("fs").copyFileSync(srcPath, dstPath);
          console.log("[SD Extract] Copied:", file.name);
        }
      }
    };

    console.log("[SD Extract] Copying all files to:", destDir);
    copyDirContents(binaryDir, destDir);

    // If binary is sd-cli, create sd symlink/copy for compatibility
    const targetBinaryName = process.platform === "win32" ? "sd.exe" : "sd";
    const finalBinaryPath = join(destDir, targetBinaryName);

    if (actualBinaryName.startsWith("sd-cli")) {
      const sdCliPath = join(destDir, actualBinaryName);
      if (existsSync(sdCliPath) && !existsSync(finalBinaryPath)) {
        // Create a copy with the old name for compatibility
        require("fs").copyFileSync(sdCliPath, finalBinaryPath);
        console.log(
          `[SD Extract] Created ${targetBinaryName} copy for compatibility`,
        );
      }
    }

    // Make executables on Unix
    if (process.platform !== "win32") {
      const files = readdirSync(destDir);
      for (const file of files) {
        const filePath = join(destDir, file);
        if (statSync(filePath).isFile()) {
          try {
            execSync(`chmod +x "${filePath}"`);
          } catch (err) {
            // Ignore chmod errors for non-executable files
          }
        }
      }
      console.log("[SD Extract] Made files executable");

      // macOS: Fix rpath and dynamic library paths
      if (process.platform === "darwin") {
        try {
          console.log("[SD Extract] Fixing macOS dynamic library paths...");

          // Find all dylib files
          const dylibFiles = readdirSync(destDir).filter((f) =>
            f.endsWith(".dylib"),
          );

          // Fix binary files
          const binaryFiles = [targetBinaryName, actualBinaryName].filter(
            (name) => name && name !== null,
          );
          for (const binaryFile of binaryFiles) {
            const binaryFullPath = join(destDir, binaryFile);
            if (existsSync(binaryFullPath)) {
              try {
                // Delete existing rpaths pointing to build directories
                try {
                  execSync(
                    `install_name_tool -delete_rpath "/Users/runner/work/stable-diffusion.cpp/stable-diffusion.cpp/build/bin" "${binaryFullPath}" 2>/dev/null || true`,
                    { stdio: "ignore" },
                  );
                } catch (e) {
                  // Ignore if rpath doesn't exist
                }

                // Add @executable_path to rpath
                try {
                  execSync(
                    `install_name_tool -add_rpath "@executable_path" "${binaryFullPath}" 2>/dev/null || true`,
                    { stdio: "ignore" },
                  );
                } catch (e) {
                  // Ignore if rpath already exists
                }

                // Update references to dylib files to use @executable_path
                for (const dylibFile of dylibFiles) {
                  try {
                    execSync(
                      `install_name_tool -change "/Users/runner/work/stable-diffusion.cpp/stable-diffusion.cpp/build/bin/${dylibFile}" "@executable_path/${dylibFile}" "${binaryFullPath}" 2>/dev/null || true`,
                      { stdio: "ignore" },
                    );
                  } catch (e) {
                    // Ignore if reference doesn't exist
                  }
                }

                console.log(`[SD Extract] Fixed rpath for ${binaryFile}`);
              } catch (err) {
                console.warn(
                  `[SD Extract] Could not fully fix rpath for ${binaryFile}:`,
                  (err as Error).message,
                );
              }
            }
          }

          // Fix dylib files themselves
          for (const dylibFile of dylibFiles) {
            const dylibFullPath = join(destDir, dylibFile);
            try {
              // Update the dylib's install name to use @rpath
              execSync(
                `install_name_tool -id "@rpath/${dylibFile}" "${dylibFullPath}" 2>/dev/null || true`,
                { stdio: "ignore" },
              );

              // Update references to other dylibs
              for (const otherDylib of dylibFiles) {
                if (otherDylib !== dylibFile) {
                  try {
                    execSync(
                      `install_name_tool -change "/Users/runner/work/stable-diffusion.cpp/stable-diffusion.cpp/build/bin/${otherDylib}" "@rpath/${otherDylib}" "${dylibFullPath}" 2>/dev/null || true`,
                      { stdio: "ignore" },
                    );
                  } catch (e) {
                    // Ignore
                  }
                }
              }

              console.log(`[SD Extract] Fixed install name for ${dylibFile}`);
            } catch (err) {
              console.warn(
                `[SD Extract] Could not fix install name for ${dylibFile}:`,
                (err as Error).message,
              );
            }
          }

          console.log("[SD Extract] macOS library path fixes completed");
        } catch (err) {
          console.warn(
            "[SD Extract] Failed to fix macOS library paths:",
            (err as Error).message,
          );
        }
      }
    }

    // Clean up
    const cleanupDir = (dir: string) => {
      if (existsSync(dir)) {
        const files = readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
          const fullPath = join(dir, file.name);
          if (file.isDirectory()) {
            cleanupDir(fullPath);
          } else {
            unlinkSync(fullPath);
          }
        }
        require("fs").rmdirSync(dir);
      }
    };
    cleanupDir(tempExtractDir);
    if (existsSync(zipPath)) {
      unlinkSync(zipPath);
    }
    console.log("[SD Extract] Cleanup completed");

    return { success: true, path: finalBinaryPath };
  } catch (error) {
    console.error("[SD Extract] Error:", error);
    return { success: false, error: (error as Error).message };
  }
});

// Auto-updater state
let mainWindow: BrowserWindow | null = null;

// Configure auto-updater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdateStatus(status: string, data?: Record<string, unknown>) {
  if (mainWindow) {
    mainWindow.webContents.send("update-status", { status, ...data });
  }
}

function setupAutoUpdater() {
  if (is.dev) {
    return;
  }

  const updateConfigPath =
    (autoUpdater as typeof autoUpdater & { appUpdateConfigPath?: string })
      .appUpdateConfigPath ?? join(process.resourcesPath, "app-update.yml");
  if (!existsSync(updateConfigPath)) {
    console.warn(
      "[AutoUpdater] app-update.yml not found, skipping auto-updater setup:",
      updateConfigPath,
    );
    return;
  }

  const settings = loadSettings();
  const channel = settings.updateChannel || "stable";

  // Configure update channel
  if (channel === "nightly") {
    autoUpdater.allowPrerelease = true;
    autoUpdater.channel = "nightly";
    // Use generic provider pointing to nightly release assets
    autoUpdater.setFeedURL({
      provider: "generic",
      url: "https://github.com/WaveSpeedAI/wavespeed-desktop/releases/download/nightly",
    });
  } else {
    autoUpdater.allowPrerelease = false;
    autoUpdater.channel = "latest";
  }

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus("checking");
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    sendUpdateStatus("available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    sendUpdateStatus("not-available", { version: info.version });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendUpdateStatus("downloading", {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    sendUpdateStatus("downloaded", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("error", (error) => {
    sendUpdateStatus("error", { message: error.message });
  });
}

// Auto-updater IPC handlers
ipcMain.handle("check-for-updates", async () => {
  if (is.dev) {
    return {
      status: "dev-mode",
      message: "Auto-update disabled in development",
    };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: "success", updateInfo: result?.updateInfo };
  } catch (error) {
    return { status: "error", message: (error as Error).message };
  }
});

ipcMain.handle("download-update", async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: (error as Error).message };
  }
});

ipcMain.handle("install-update", () => {
  // Set quitting flag before calling quitAndInstall so macOS window close handler allows quit
  (app as typeof app & { isQuitting: boolean }).isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

ipcMain.handle("get-log-file-path", () => {
  return log.transports.file.getFile().path;
});

ipcMain.handle("open-log-directory", () => {
  const logPath = log.transports.file.getFile().path;
  const logDir = dirname(logPath);
  shell.openPath(logDir);
  return { success: true, path: logDir };
});

ipcMain.handle("set-update-channel", (_, channel: "stable" | "nightly") => {
  saveSettings({ updateChannel: channel });
  // Reconfigure updater with new channel
  if (channel === "nightly") {
    autoUpdater.allowPrerelease = true;
    autoUpdater.channel = "nightly";
    // Use generic provider pointing to nightly release assets
    autoUpdater.setFeedURL({
      provider: "generic",
      url: "https://github.com/WaveSpeedAI/wavespeed-desktop/releases/download/nightly",
    });
  } else {
    autoUpdater.allowPrerelease = false;
    autoUpdater.channel = "latest";
    autoUpdater.setFeedURL({
      provider: "github",
      owner: "WaveSpeedAI",
      repo: "wavespeed-desktop",
      releaseType: "release",
    });
  }
  return true;
});

// ==============================================================================
// Stable Diffusion IPC Handlers
// ==============================================================================

/**
 * Get stable-diffusion binary path
 * Checks multiple locations in priority order:
 * 1. Downloaded binary in userData/sd-bin
 * 2. Pre-compiled binary in resources directory
 */
ipcMain.handle("sd-get-binary-path", () => {
  try {
    const platform = process.platform;

    // Priority 1: Check downloaded binary in userData
    const userDataBinaryDir = join(app.getPath("userData"), "sd-bin");
    const binaryName = platform === "win32" ? "sd.exe" : "sd";
    const userDataBinaryPath = join(userDataBinaryDir, binaryName);

    if (existsSync(userDataBinaryPath)) {
      if (!binaryPathLoggedOnce) {
        console.log("[SD] Using downloaded binary:", userDataBinaryPath);
        binaryPathLoggedOnce = true;
      }
      return { success: true, path: userDataBinaryPath };
    }

    // Priority 2: Check pre-compiled binary in resources
    const basePath = is.dev
      ? join(__dirname, "../../resources/bin/stable-diffusion")
      : join(process.resourcesPath, "bin/stable-diffusion");

    const resourceBinaryPath = join(basePath, binaryName);
    if (existsSync(resourceBinaryPath)) {
      if (!binaryPathLoggedOnce) {
        console.log("[SD] Using pre-compiled binary:", resourceBinaryPath);
        binaryPathLoggedOnce = true;
      }
      return { success: true, path: resourceBinaryPath };
    }

    // Binary not found in any location
    return {
      success: false,
      error: `Binary not found. Checked: ${userDataBinaryPath}, ${resourceBinaryPath}`,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
});

/**
 * Check if macOS system supports Metal acceleration (cached)
 */
function checkMetalSupport(): boolean {
  // Return cached result if available
  if (metalSupportCache !== null) {
    return metalSupportCache;
  }

  try {
    // Check macOS version - Metal requires OS X 10.11 (El Capitan) or later
    const osRelease = require("os").release();
    const majorVersion = parseInt(osRelease.split(".")[0], 10);

    // Darwin kernel version 15.x = OS X 10.11 (El Capitan)
    // Metal was introduced in OS X 10.11
    if (majorVersion < 15) {
      console.log(
        "[Metal Check] macOS version too old for Metal (Darwin kernel < 15)",
      );
      metalSupportCache = false;
      return false;
    }

    // Check GPU capabilities using system_profiler
    try {
      const output = execSync("system_profiler SPDisplaysDataType", {
        encoding: "utf8",
        timeout: 5000,
      });

      // Check if output contains "Metal" support indication
      const hasMetalSupport = output.toLowerCase().includes("metal");
      console.log(`[Metal Check] Metal support detected: ${hasMetalSupport}`);
      metalSupportCache = hasMetalSupport;
      return hasMetalSupport;
    } catch (error) {
      console.error("[Metal Check] Failed to run system_profiler:", error);
      // If system_profiler fails but OS version is new enough, assume Metal is available
      metalSupportCache = majorVersion >= 15;
      return metalSupportCache;
    }
  } catch (error) {
    console.error("[Metal Check] Failed to check Metal support:", error);
    metalSupportCache = false;
    return false;
  }
}

/**
 * Get system information (platform and acceleration type) - cached
 */
ipcMain.handle("sd-get-system-info", () => {
  // Return cached result if available
  if (systemInfoCache !== null) {
    return systemInfoCache;
  }

  const platform = process.platform;
  const arch = process.arch;

  let acceleration = "CPU";

  if (platform === "darwin") {
    // macOS: Check for Metal acceleration support
    acceleration = checkMetalSupport() ? "metal" : "CPU";
  } else if (platform === "win32" || platform === "linux") {
    // Check for NVIDIA GPU (CUDA support)
    try {
      const { execSync } = require("child_process");

      // Try to detect NVIDIA GPU
      if (platform === "win32") {
        // Windows: Check for nvidia-smi
        try {
          execSync("nvidia-smi", { stdio: "ignore", timeout: 3000 });
          acceleration = "CUDA";
        } catch {
          // nvidia-smi not found or failed, use CPU
        }
      } else if (platform === "linux") {
        // Linux: Check for NVIDIA GPU in lspci or nvidia-smi
        try {
          const output = execSync("lspci 2>/dev/null | grep -i nvidia", {
            encoding: "utf8",
            timeout: 3000,
          });
          if (output.toLowerCase().includes("nvidia")) {
            acceleration = "CUDA";
          }
        } catch {
          // Try nvidia-smi as fallback
          try {
            execSync("nvidia-smi", { stdio: "ignore", timeout: 3000 });
            acceleration = "CUDA";
          } catch {
            // No NVIDIA GPU detected, use CPU
          }
        }
      }
    } catch (error) {
      console.error("[System Info] Failed to detect GPU:", error);
      // Fall back to CPU on error
    }
  }

  console.log(
    `[System Info] Platform: ${platform}, Acceleration: ${acceleration}`,
  );

  // Cache the result
  systemInfoCache = {
    platform,
    arch,
    acceleration,
    supported: true,
  };

  return systemInfoCache;
});

/**
 * Get GPU VRAM in MB (Windows only)
 */
ipcMain.handle("sd-get-gpu-vram", () => {
  try {
    return { success: true, vramMb: getGpuVramMb() };
  } catch (error) {
    return {
      success: false,
      vramMb: null,
      error: (error as Error).message,
    };
  }
});

/**
 * Generate image
 */
ipcMain.handle(
  "sd-generate-image",
  async (
    event,
    params: {
      modelPath: string;
      llmPath?: string;
      vaePath?: string;
      lowVramMode?: boolean;
      vaeTiling?: boolean;
      prompt: string;
      negativePrompt?: string;
      width: number;
      height: number;
      steps: number;
      cfgScale: number;
      seed?: number;
      samplingMethod?: string;
      scheduler?: string;
      outputPath: string;
    },
  ) => {
    try {
      // Get binary path using the same logic as sd-get-binary-path
      const platform = process.platform;
      const arch = process.arch;
      const userDataBinaryDir = join(app.getPath("userData"), "sd-bin");
      const binaryName = platform === "win32" ? "sd.exe" : "sd";

      let binaryPath: string | null = null;

      // Priority 1: Check downloaded binary in userData
      const userDataBinaryPath = join(userDataBinaryDir, binaryName);
      if (existsSync(userDataBinaryPath)) {
        binaryPath = userDataBinaryPath;
        console.log("[SD Generate] Using downloaded binary:", binaryPath);
      }

      // Priority 2: Check pre-compiled binary in resources
      if (!binaryPath) {
        const basePath = is.dev
          ? join(__dirname, "../../resources/bin/stable-diffusion")
          : join(process.resourcesPath, "bin/stable-diffusion");

        const resourceBinaryPath = join(
          basePath,
          `${platform}-${arch}`,
          binaryName,
        );
        if (existsSync(resourceBinaryPath)) {
          binaryPath = resourceBinaryPath;
          console.log("[SD Generate] Using pre-compiled binary:", binaryPath);
        }
      }

      if (!binaryPath) {
        throw new Error("SD binary not found. Please download it first.");
      }

      const vramMb = getGpuVramMb();
      const isLowVramGpu = vramMb !== null && vramMb < 16000;
      const lowVramMode = Boolean(params.lowVramMode) || isLowVramGpu;
      const useCpuOffload = lowVramMode;
      const useVaeTiling = Boolean(params.vaeTiling) || isLowVramGpu;

      if (vramMb !== null) {
        console.log(`[SD Generate] Detected GPU VRAM: ${vramMb} MB`);
      } else {
        console.log("[SD Generate] GPU VRAM detection unavailable");
      }

      if (Boolean(params.lowVramMode)) {
        console.log("[SD Generate] Enabling low VRAM mode from UI setting");
      } else if (isLowVramGpu) {
        console.log("[SD Generate] Enabling low VRAM mode for low VRAM GPU");
      }

      if (Boolean(params.vaeTiling)) {
        console.log("[SD Generate] Enabling VAE tiling from UI setting");
      } else if (isLowVramGpu) {
        console.log("[SD Generate] Enabling VAE tiling for low VRAM GPU");
      }

      // Use SDGenerator class for image generation
      const result = await sdGenerator.generate({
        binaryPath,
        modelPath: params.modelPath,
        llmPath: params.llmPath,
        vaePath: params.vaePath,
        clipOnCpu: useCpuOffload,
        vaeTiling: useVaeTiling,
        prompt: params.prompt,
        negativePrompt: params.negativePrompt,
        width: params.width,
        height: params.height,
        steps: params.steps,
        cfgScale: params.cfgScale,
        seed: params.seed,
        samplingMethod: params.samplingMethod,
        scheduler: params.scheduler,
        outputPath: params.outputPath,
        onProgress: (progress) => {
          // Send progress to frontend
          event.sender.send("sd-progress", {
            phase: progress.phase,
            progress: progress.progress,
            detail: progress.detail,
          });
        },
        onLog: (log) => {
          // Send logs to frontend
          event.sender.send("sd-log", {
            type: log.type,
            message: log.message,
          });
        },
      });

      // Also track via legacy activeSDProcess for backward compatibility
      // (This will be set/cleared by SDGenerator internally)

      return result;
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  },
);

/**
 * list models
 */
ipcMain.handle("sd-list-models", () => {
  try {
    const modelsDir = getModelsDir();

    if (!existsSync(modelsDir)) {
      return { success: true, models: [] };
    }

    const files = readdirSync(modelsDir);
    const models = files
      .filter((f) => f.endsWith(".gguf") && !f.endsWith(".part")) // Exclude .part files
      .map((f) => {
        const filePath = join(modelsDir, f);
        const stats = statSync(filePath);
        return {
          name: f,
          path: filePath,
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
        };
      });

    return { success: true, models };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
});

/**
 * delete model
 */
ipcMain.handle("sd-delete-model", (_, modelPath: string) => {
  try {
    if (existsSync(modelPath)) {
      unlinkSync(modelPath);
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
});

/**
 * Get file size
 */
ipcMain.handle("get-file-size", (_, filePath: string) => {
  try {
    if (existsSync(filePath)) {
      const stats = statSync(filePath);
      return stats.size;
    }
    return 0;
  } catch (error) {
    console.error("Failed to get file size:", error);
    return 0;
  }
});

/**
 * Delete SD binary
 */
ipcMain.handle("sd-delete-binary", () => {
  try {
    const platform = process.platform;
    const arch = process.arch;
    const binaryName = platform === "win32" ? "sd.exe" : "sd";

    // Delete downloaded binary in userData (cache)
    const userDataBinaryDir = join(app.getPath("userData"), "sd-bin");
    const userDataBinaryPath = join(userDataBinaryDir, binaryName);
    if (existsSync(userDataBinaryPath)) {
      unlinkSync(userDataBinaryPath);
    }

    // Delete pre-compiled binary in resources (if present)
    const basePath = is.dev
      ? join(__dirname, "../../resources/bin/stable-diffusion")
      : join(process.resourcesPath, "bin/stable-diffusion");

    const binaryPath = join(basePath, `${platform}-${arch}`, binaryName);

    if (existsSync(binaryPath)) {
      unlinkSync(binaryPath);
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
});

/**
 * Get main models directory (for z-image-turbo models)
 * Uses userData directory to keep models alongside sd-bin
 */
function getModelsDir(): string {
  return join(app.getPath("userData"), "models", "stable-diffusion");
}

/**
 * Get auxiliary models directory
 */
function getAuxiliaryModelsDir(): string {
  return join(getModelsDir(), "auxiliary");
}

/**
 * Check if auxiliary models exist
 */
ipcMain.handle("sd-check-auxiliary-models", () => {
  try {
    const auxDir = getAuxiliaryModelsDir();
    const llmPath = join(auxDir, "Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf");
    const vaePath = join(auxDir, "ae.safetensors");

    return {
      success: true,
      llmExists: existsSync(llmPath),
      vaeExists: existsSync(vaePath),
      llmPath,
      vaePath,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
});

/**
 * List all auxiliary models (LLM and VAE)
 */
ipcMain.handle("sd-list-auxiliary-models", () => {
  try {
    const auxDir = getAuxiliaryModelsDir();
    const models: Array<{
      name: string;
      path: string;
      size: number;
      type: "llm" | "vae";
    }> = [];

    if (!existsSync(auxDir)) {
      return { success: true, models: [] };
    }

    const llmPath = join(auxDir, "Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf");
    const vaePath = join(auxDir, "ae.safetensors");

    if (existsSync(llmPath)) {
      const stats = statSync(llmPath);
      models.push({
        name: "Qwen3-4B-Instruct LLM",
        path: llmPath,
        size: stats.size,
        type: "llm",
      });
    }

    if (existsSync(vaePath)) {
      const stats = statSync(vaePath);
      models.push({
        name: "Z-Image VAE",
        path: vaePath,
        size: stats.size,
        type: "vae",
      });
    }

    return { success: true, models };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
});

/**
 * Delete an auxiliary model
 */
ipcMain.handle("sd-delete-auxiliary-model", (_, type: "llm" | "vae") => {
  try {
    const auxDir = getAuxiliaryModelsDir();
    const fileName =
      type === "llm"
        ? "Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf"
        : "ae.safetensors";
    const filePath = join(auxDir, fileName);

    if (existsSync(filePath)) {
      unlinkSync(filePath);
      console.log(`[Auxiliary Models] Deleted ${type} model:`, filePath);
      return { success: true };
    } else {
      return { success: false, error: "Model file not found" };
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
});

/**
 * Cancel SD image generation
 */
ipcMain.handle("sd-cancel-generation", async () => {
  try {
    console.log("[SD Generation] Cancelling generation");

    // Cancel via SDGenerator class
    const cancelled = sdGenerator.cancel();

    // Also cancel legacy activeSDProcess if exists
    if (activeSDProcess) {
      activeSDProcess.kill("SIGTERM");
      activeSDProcess = null;
    }

    return { success: true, cancelled };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
});

/**
 * Save model from browser cache to file system
 */
ipcMain.handle(
  "sd-save-model-from-cache",
  async (
    _,
    fileName: string,
    data: Uint8Array,
    type: "llm" | "vae" | "model",
  ) => {
    try {
      let destPath: string;

      if (type === "model") {
        // Main model goes to models directory
        const modelsDir = getModelsDir();
        if (!existsSync(modelsDir)) {
          mkdirSync(modelsDir, { recursive: true });
        }
        destPath = join(modelsDir, fileName);
      } else {
        // Auxiliary models (LLM, VAE) go to auxiliary directory
        const auxDir = getAuxiliaryModelsDir();
        if (!existsSync(auxDir)) {
          mkdirSync(auxDir, { recursive: true });
        }
        destPath = join(auxDir, fileName);
      }

      // Write file
      writeFileSync(destPath, data);

      return {
        success: true,
        filePath: destPath,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  },
);

// Register custom protocol for local asset files (must be before app.whenReady)
protocol.registerSchemesAsPrivileged([
  {
    scheme: "local-asset",
    privileges: {
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

// App lifecycle
app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.wavespeed.desktop");

  // Handle local-asset:// protocol for loading local files (videos, images, etc.)
  protocol.handle("local-asset", (request) => {
    const filePath = decodeURIComponent(
      request.url.replace("local-asset://", ""),
    );
    return net.fetch(pathToFileURL(filePath).href);
  });

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  // Initialize workflow module (sql.js DB, node registry, IPC handlers)
  initWorkflowModule().catch((err) => {
    console.error("[Workflow] Failed to initialize:", err);
  });

  // Setup auto-updater after window is created
  setupAutoUpdater();

  // Check for updates on startup (after a short delay) if autoCheckUpdate is enabled
  if (!is.dev) {
    const settings = loadSettings();
    if (settings.autoCheckUpdate !== false) {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
          console.error("Failed to check for updates:", err);
        });
      }, 3000);
    }
  }

  app.on("activate", function () {
    // macOS: Show the hidden window when clicking dock icon
    if (mainWindow) {
      mainWindow.show();
    } else {
      createWindow();
    }
  });
});

// macOS: Set quitting flag so window close handler allows actual quit
app.on("before-quit", () => {
  (app as typeof app & { isQuitting: boolean }).isQuitting = true;
});

app.on("window-all-closed", () => {
  closeWorkflowDatabase();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
