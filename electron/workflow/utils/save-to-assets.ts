/**
 * Save workflow execution results to My Assets directory.
 *
 * Reuses the same assets directory and metadata infrastructure as the
 * Playground's auto-save feature, so workflow outputs appear in My Assets.
 */
import { app, BrowserWindow } from "electron";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  statSync,
  createWriteStream,
  readFileSync,
  writeFileSync,
} from "fs";
import { join, extname } from "path";
import https from "https";
import http from "http";

/* ─── Settings / metadata paths (mirrors electron/main.ts) ─────────── */

const userDataPath = app.getPath("userData");
const settingsPath = join(userDataPath, "settings.json");
const assetsMetadataPath = join(userDataPath, "assets-metadata.json");
const defaultAssetsDirectory = join(app.getPath("documents"), "WaveSpeed");

interface AssetMetadata {
  id: string;
  filePath: string;
  fileName: string;
  type: "image" | "video" | "audio";
  modelId: string;
  createdAt: string;
  fileSize: number;
  tags: string[];
  favorite: boolean;
  originalUrl?: string;
  source?: "workflow" | "playground" | "free-tool" | "z-image";
  workflowId?: string;
  workflowName?: string;
  nodeId?: string;
  executionId?: string;
}

function loadSettings(): { autoSaveAssets: boolean; assetsDirectory: string } {
  try {
    if (existsSync(settingsPath)) {
      const data = JSON.parse(readFileSync(settingsPath, "utf-8"));
      return {
        autoSaveAssets: data.autoSaveAssets ?? true,
        assetsDirectory: data.assetsDirectory || defaultAssetsDirectory,
      };
    }
  } catch {
    /* use defaults */
  }
  return { autoSaveAssets: true, assetsDirectory: defaultAssetsDirectory };
}

function loadAssetsMetadata(): AssetMetadata[] {
  try {
    if (existsSync(assetsMetadataPath)) {
      return JSON.parse(readFileSync(assetsMetadataPath, "utf-8"));
    }
  } catch {
    /* empty */
  }
  return [];
}

function saveAssetsMetadata(metadata: AssetMetadata[]): void {
  try {
    if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true });
    writeFileSync(assetsMetadataPath, JSON.stringify(metadata, null, 2));
  } catch (err) {
    console.error("[save-to-assets] Failed to persist metadata:", err);
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function getSubDir(type: "image" | "video" | "audio"): string {
  switch (type) {
    case "image":
      return "images";
    case "video":
      return "videos";
    case "audio":
      return "audio";
  }
}

function detectAssetType(url: string): "image" | "video" | "audio" | null {
  const cleaned = url.split("?")[0].toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)$/.test(cleaned)) return "image";
  if (/\.(mp4|webm|mov|avi|mkv)$/.test(cleaned)) return "video";
  if (/\.(mp3|wav|ogg|flac|aac|m4a|wma)$/.test(cleaned)) return "audio";
  return null;
}

function guessExt(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = extname(pathname).toLowerCase();
    if (ext && ext.length <= 5) return ext;
  } catch {
    /* ignore */
  }
  return ".png";
}

/** Download a remote URL to a local file path. Returns true on success. */
function downloadToFile(url: string, destPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proto = url.startsWith("https") ? https : http;
    const file = createWriteStream(destPath);
    const handleResponse = (response: http.IncomingMessage) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const loc = response.headers.location;
        if (loc) {
          const rp = loc.startsWith("https") ? https : http;
          rp.get(loc, handleResponse).on("error", () => resolve(false));
          return;
        }
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve(true);
      });
    };
    proto.get(url, handleResponse).on("error", () => resolve(false));
  });
}

/* ─── Public API ───────────────────────────────────────────────────── */

export interface SaveToAssetsOptions {
  url: string;
  modelId: string;
  workflowId: string;
  workflowName: string;
  nodeId: string;
  executionId: string;
  resultIndex?: number;
}

/**
 * Save a single workflow result URL to the My Assets directory.
 * Respects the user's autoSaveAssets setting.
 * Notifies all renderer windows so the assets list refreshes.
 */
export async function saveWorkflowResultToAssets(
  options: SaveToAssetsOptions,
): Promise<void> {
  const settings = loadSettings();
  if (!settings.autoSaveAssets) return;

  const assetType = detectAssetType(options.url);
  if (!assetType) return;

  // Check for duplicate by executionId + resultIndex
  const existing = loadAssetsMetadata();
  const isDuplicate = existing.some(
    (a) => a.executionId === options.executionId && a.source === "workflow",
  );
  if (isDuplicate) return;

  const subDir = getSubDir(assetType);
  const baseDir = settings.assetsDirectory || defaultAssetsDirectory;
  const targetDir = join(baseDir, subDir);
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  // Build filename: workflow_{model-slug}_{executionId}_{index}.{ext}
  const modelSlug =
    options.modelId
      .replace(/\//g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "-")
      .toLowerCase()
      .replace(/-+/g, "-") || "workflow";
  const idx = options.resultIndex ?? 0;
  const ext = guessExt(options.url).replace(/^\./, "");
  const fileName = `${modelSlug}_${options.executionId}_${idx}.${ext}`;
  const filePath = join(targetDir, fileName);

  // Copy or download the file
  let ok = false;
  if (/^local-asset:\/\//i.test(options.url)) {
    try {
      const localPath = decodeURIComponent(
        options.url.replace(/^local-asset:\/\//i, ""),
      );
      if (existsSync(localPath)) {
        copyFileSync(localPath, filePath);
        ok = true;
      }
    } catch {
      /* best-effort */
    }
  } else if (
    options.url.startsWith("http://") ||
    options.url.startsWith("https://")
  ) {
    ok = await downloadToFile(options.url, filePath);
  }

  if (!ok || !existsSync(filePath)) return;

  let fileSize = 0;
  try {
    fileSize = statSync(filePath).size;
  } catch {
    /* ignore */
  }

  const metadata: AssetMetadata = {
    id: generateId(),
    filePath,
    fileName,
    type: assetType,
    modelId: options.modelId || "workflow",
    createdAt: new Date().toISOString(),
    fileSize,
    tags: [],
    favorite: false,
    originalUrl: options.url,
    source: "workflow",
    workflowId: options.workflowId,
    workflowName: options.workflowName,
    nodeId: options.nodeId,
    executionId: options.executionId,
  };

  // Append to metadata file
  const allMetadata = loadAssetsMetadata();
  allMetadata.unshift(metadata);
  saveAssetsMetadata(allMetadata);

  // Notify renderer windows so My Assets refreshes
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send("assets:new-asset", metadata);
    } catch {
      /* window may be destroyed */
    }
  }
}
