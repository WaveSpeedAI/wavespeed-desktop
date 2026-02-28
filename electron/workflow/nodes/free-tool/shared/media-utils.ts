import * as fs from "fs";
import * as path from "path";
import http from "http";
import https from "https";
import { spawn } from "child_process";
import { getFileStorageInstance } from "../../../utils/file-storage";

type DownloadedInput = {
  localPath: string;
  cleanup: () => void;
};

let ffmpegChecked = false;
let hasFfmpegBinary = false;

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function safeExt(ext: string): string {
  if (!ext) return ".bin";
  const normalized = ext.startsWith(".") ? ext : `.${ext}`;
  return normalized.length <= 10 ? normalized : ".bin";
}

function extFromUrl(input: string): string {
  try {
    const pathname = new URL(input).pathname;
    return safeExt(path.extname(pathname));
  } catch {
    return ".bin";
  }
}

function tempFilePath(
  workflowId: string,
  nodeId: string,
  suffix: string,
): string {
  const storage = getFileStorageInstance();
  const dir = path.join(storage.getNodeOutputDir(workflowId, nodeId), "_tmp");
  ensureDir(dir);
  return path.join(
    dir,
    `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${suffix}`,
  );
}

function downloadToFile(url: string, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https://") ? https : http;
    const file = fs.createWriteStream(filePath);
    const req = proto.get(url, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        file.close();
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {
          // ignore
        }
        downloadToFile(res.headers.location, filePath)
          .then(resolve)
          .catch(reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        file.close();
        reject(new Error(`Failed to download file: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
      file.on("error", (err) => {
        file.close();
        reject(err);
      });
    });

    req.on("error", reject);
  });
}

export async function resolveInputToLocalFile(
  input: string,
  workflowId: string,
  nodeId: string,
): Promise<DownloadedInput> {
  if (!input) throw new Error("Input is empty.");

  if (input.startsWith("local-asset://")) {
    const localPath = decodeURIComponent(input.replace("local-asset://", ""));
    if (!fs.existsSync(localPath)) {
      throw new Error("Local input file not found.");
    }
    return { localPath, cleanup: () => {} };
  }

  if (input.startsWith("http://") || input.startsWith("https://")) {
    const targetPath = tempFilePath(workflowId, nodeId, extFromUrl(input));
    await downloadToFile(input, targetPath);
    return {
      localPath: targetPath,
      cleanup: () => {
        try {
          if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        } catch {
          // ignore cleanup errors
        }
      },
    };
  }

  if (fs.existsSync(input)) {
    return { localPath: input, cleanup: () => {} };
  }

  throw new Error("Unsupported input URL/path.");
}

export function createOutputPath(
  workflowId: string,
  nodeId: string,
  prefix: string,
  ext: string,
): string {
  const storage = getFileStorageInstance();
  const outDir = storage.getNodeOutputDir(workflowId, nodeId);
  ensureDir(outDir);
  const fileName = `${prefix}_${Date.now()}${safeExt(ext)}`;
  return path.join(outDir, fileName);
}

export function toLocalAssetUrl(filePath: string): string {
  return `local-asset://${encodeURIComponent(filePath)}`;
}

export async function ensureFfmpegAvailable(): Promise<void> {
  if (ffmpegChecked) {
    if (!hasFfmpegBinary)
      throw new Error("ffmpeg is not installed or not available in PATH.");
    return;
  }

  ffmpegChecked = true;
  hasFfmpegBinary = await new Promise<boolean>((resolve) => {
    const proc = spawn("ffmpeg", ["-version"]);
    proc.on("error", () => resolve(false));
    proc.on("exit", (code) => resolve(code === 0));
  });

  if (!hasFfmpegBinary) {
    throw new Error("ffmpeg is not installed or not available in PATH.");
  }
}

export async function runFfmpeg(args: string[]): Promise<void> {
  await ensureFfmpegAvailable();
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `ffmpeg failed with exit code ${code}`));
      }
    });
  });
}
