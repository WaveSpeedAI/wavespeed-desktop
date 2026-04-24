/**
 * Save workflow execution results to My Assets directory.
 *
 * Reuses the same assets directory and metadata infrastructure as the
 * Playground's auto-save feature, so workflow outputs appear in My Assets.
 */
import { app, BrowserWindow, net } from "electron";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  statSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
} from "fs";
import { join, extname } from "path";

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
  predictionId?: string;
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
  // Fallback: infer from URL path segments for CDN URLs without extensions
  if (/\/(image|img)[s]?\//i.test(cleaned)) return "image";
  if (/\/(video|vid)[s]?\//i.test(cleaned)) return "video";
  if (/\/(audio|sound)[s]?\//i.test(cleaned)) return "audio";
  return null;
}

/** Map detected asset type to a sensible default extension (used when URL has none). */
function defaultExtForType(type: "image" | "video" | "audio"): string {
  switch (type) {
    case "image":
      return ".png";
    case "video":
      return ".mp4";
    case "audio":
      return ".mp3";
  }
}

function guessExt(
  url: string,
  assetType?: "image" | "video" | "audio" | null,
): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = extname(pathname).toLowerCase();
    if (ext && ext.length <= 5) return ext;
  } catch {
    /* ignore */
  }
  // Fallback to type-appropriate extension instead of always .png
  return assetType ? defaultExtForType(assetType) : ".png";
}

/** Minimum file sizes (bytes) to consider a download valid. Anything smaller is likely corrupt. */
const MIN_FILE_SIZES: Record<string, number> = {
  image: 100,
  video: 1000,
  audio: 100,
};

/** Download a remote URL to a local file path using Electron net.fetch (respects system proxy). */
async function downloadToFile(
  url: string,
  destPath: string,
  expectedType?: "image" | "video" | "audio" | null,
): Promise<boolean> {
  const tempPath = destPath + ".download";
  try {
    const response = await net.fetch(url);
    if (!response.ok) return false;

    const contentLength = Number(response.headers.get("content-length") || 0);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Validate: if server declared Content-Length, actual bytes must match
    if (contentLength > 0 && buffer.length < contentLength) {
      console.error(
        `[save-to-assets] Truncated download: expected ${contentLength} bytes, got ${buffer.length} for ${url}`,
      );
      return false;
    }

    // Validate: file must meet minimum size for its type
    const minSize = expectedType ? (MIN_FILE_SIZES[expectedType] ?? 0) : 0;
    if (buffer.length < minSize) {
      console.error(
        `[save-to-assets] Download too small: ${buffer.length} bytes (min ${minSize}) for ${url}`,
      );
      return false;
    }

    writeFileSync(tempPath, buffer);
    renameSync(tempPath, destPath);
    return true;
  } catch {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      /* best-effort */
    }
    return false;
  }
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
  /** Node params at execution time — forwarded to renderer for Customize restore */
  params?: Record<string, unknown>;
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
  const ext = guessExt(options.url, assetType).replace(/^\./, "");
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
    ok = await downloadToFile(options.url, filePath, assetType);
  }

  if (!ok || !existsSync(filePath)) return;

  let fileSize = 0;
  try {
    fileSize = statSync(filePath).size;
  } catch {
    /* ignore */
  }

  // Reject empty or suspiciously small files (likely corrupt downloads)
  const minSize = MIN_FILE_SIZES[assetType] ?? 0;
  if (fileSize < minSize) {
    console.error(
      `[save-to-assets] File too small (${fileSize} bytes), removing: ${filePath}`,
    );
    try {
      unlinkSync(filePath);
    } catch {
      /* best-effort */
    }
    return;
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
    predictionId: options.executionId,
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

  // Notify renderer windows so My Assets refreshes and params are persisted
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send("assets:new-asset", metadata);
      // Send node params so renderer can store them for Customize restore
      if (options.params && Object.keys(options.params).length > 0) {
        win.webContents.send("assets:save-prediction-inputs", {
          predictionId: options.executionId,
          modelId: options.modelId || "workflow",
          modelName: options.workflowName || "Workflow",
          inputs: options.params,
        });
      }
    } catch {
      /* window may be destroyed */
    }
  }
}
