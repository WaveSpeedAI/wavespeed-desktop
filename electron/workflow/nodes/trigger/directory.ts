/**
 * Directory Trigger — scans a local directory for media files.
 * Batch trigger: the engine executes the workflow once per file.
 *
 * Unlike the old directory-import node which output an array,
 * this trigger produces one item per file. Each workflow execution
 * receives a single local-asset:// URL.
 */
import {
  BaseNodeHandler,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from "../base";
import type { NodeTypeDefinition } from "../../../../src/workflow/types/node-defs";
import type { TriggerHandler, TriggerMode, BatchItem } from "./base";
import { readdirSync, existsSync } from "fs";
import { join, extname, basename } from "path";

const MEDIA_EXTENSIONS: Record<string, string[]> = {
  image: [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".bmp",
    ".tiff",
    ".tif",
    ".svg",
    ".avif",
  ],
  video: [".mp4", ".webm", ".mov", ".avi", ".mkv", ".flv", ".wmv", ".m4v"],
  audio: [".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac", ".wma"],
  all: [],
};
MEDIA_EXTENSIONS.all = [
  ...MEDIA_EXTENSIONS.image,
  ...MEDIA_EXTENSIONS.video,
  ...MEDIA_EXTENSIONS.audio,
];

export const directoryTriggerDef: NodeTypeDefinition = {
  type: "trigger/directory",
  category: "trigger",
  label: "Directory",
  inputs: [],
  outputs: [{ key: "output", label: "File", dataType: "url", required: true }],
  params: [
    {
      key: "directoryPath",
      label: "Directory",
      type: "string",
      dataType: "text",
      connectable: false,
      default: "",
    },
    {
      key: "mediaType",
      label: "File Type",
      type: "select",
      dataType: "text",
      connectable: false,
      default: "image",
      options: [
        { label: "Images", value: "image" },
        { label: "Videos", value: "video" },
        { label: "Audio", value: "audio" },
        { label: "All Media", value: "all" },
      ],
    },
  ],
};

export class DirectoryTriggerHandler
  extends BaseNodeHandler
  implements TriggerHandler
{
  readonly triggerMode: TriggerMode = "batch";

  constructor() {
    super(directoryTriggerDef);
  }

  /**
   * Return all files in the directory as batch items.
   * Each item is a single local-asset:// URL.
   */
  async getItems(params: Record<string, unknown>): Promise<BatchItem[]> {
    const dirPath = String(params.directoryPath ?? "").trim();
    const mediaType = String(params.mediaType ?? "image");

    if (!dirPath || !existsSync(dirPath)) return [];

    const allowedExts = new Set(
      MEDIA_EXTENSIONS[mediaType] ?? MEDIA_EXTENSIONS.all,
    );
    const files = scanDirectory(dirPath, allowedExts);
    files.sort();

    return files.map((filePath) => ({
      id: filePath,
      value: `local-asset://${encodeURIComponent(filePath)}`,
      label: basename(filePath),
    }));
  }

  /**
   * Execute for a single file. When called by the engine in batch mode,
   * ctx.params.__triggerValue contains the current item's value.
   */
  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();

    // In batch mode, the engine injects the current item value
    const triggerValue = ctx.params.__triggerValue as string | undefined;
    const url = triggerValue ?? "";

    if (!url) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: "No file provided.",
      };
    }

    return {
      status: "success",
      outputs: { output: url },
      resultPath: url,
      resultMetadata: {
        output: url,
        resultUrl: url,
        resultUrls: [url],
        mediaType: ctx.params.mediaType ?? "image",
      },
      durationMs: Date.now() - start,
      cost: 0,
    };
  }
}

function scanDirectory(dir: string, allowedExts: Set<string>): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (allowedExts.has(ext)) {
          results.push(join(dir, entry.name));
        }
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return results;
}
