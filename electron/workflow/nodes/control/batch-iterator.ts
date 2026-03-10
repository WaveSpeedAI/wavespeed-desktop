/**
 * Batch Iterator node — iterates through a folder of files (images, videos, etc.)
 * and provides the current item on each workflow run.
 * 
 * This node enables batch processing workflows where the entire workflow runs
 * once for each file in the folder, with automatic iteration state management.
 */
import {
  BaseNodeHandler,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from "../base";
import type { NodeTypeDefinition } from "../../../../src/workflow/types/node-defs";
import {
  getIterationState,
  initIterationState,
} from "../../db/iteration.repo";
import { readdirSync, statSync } from "fs";
import { join, basename } from "path";

export const batchIteratorDef: NodeTypeDefinition = {
  type: "input/batch-iterator",
  category: "input",
  label: "Batch Iterator",
  inputs: [],
  outputs: [
    { key: "current", label: "Current Item", dataType: "url", required: true },
    { key: "index", label: "Index", dataType: "text", required: true },
    { key: "total", label: "Total", dataType: "text", required: true },
    { key: "filename", label: "Filename", dataType: "text", required: true },
  ],
  params: [
    {
      key: "folderPath",
      label: "Folder Path",
      type: "string",
      default: "",
      connectable: false,
      description: "Path to folder containing files to iterate through",
    },
    {
      key: "filePattern",
      label: "File Pattern",
      type: "string",
      default: "*.{jpg,jpeg,png,gif,webp,bmp,tiff}",
      description: "Glob pattern for file matching (e.g., *.jpg or *.{png,jpg})",
    },
    {
      key: "sortOrder",
      label: "Sort Order",
      type: "select",
      default: "name-asc",
      options: [
        { label: "Name (A-Z)", value: "name-asc" },
        { label: "Name (Z-A)", value: "name-desc" },
        { label: "Date (Oldest)", value: "date-asc" },
        { label: "Date (Newest)", value: "date-desc" },
      ],
    },
  ],
};

export class BatchIteratorHandler extends BaseNodeHandler {
  constructor() {
    super(batchIteratorDef);
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const folderPath = String(ctx.params.folderPath ?? "").trim();

    if (!folderPath) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error:
          "Folder path is required. Please provide a path to a folder containing files to iterate through.",
      };
    }

    let state = getIterationState(ctx.workflowId);

    if (!state) {
      try {
        const filePattern = String(
          ctx.params.filePattern ?? "*.{jpg,jpeg,png,gif,webp,bmp,tiff}",
        );
        const sortOrder = String(ctx.params.sortOrder ?? "name-asc");
        const files = this.scanFolder(folderPath, filePattern, sortOrder);

        if (files.length === 0) {
          return {
            status: "error",
            outputs: {},
            durationMs: Date.now() - start,
            cost: 0,
            error: `No files found in "${folderPath}" matching pattern "${filePattern}". Please check the folder path and pattern.`,
          };
        }

        state = initIterationState(ctx.workflowId, files);
        console.log(
          `[BatchIterator] Initialized with ${files.length} files from ${folderPath}`,
        );
      } catch (error) {
        return {
          status: "error",
          outputs: {},
          durationMs: Date.now() - start,
          cost: 0,
          error: `Failed to scan folder: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const currentFile = state.iterationData[state.currentIndex];
    const filename = basename(currentFile);
    const progress = Math.round(
      ((state.currentIndex + 1) / state.totalItems) * 100,
    );

    console.log(
      `[BatchIterator] Processing item ${state.currentIndex + 1}/${state.totalItems}: ${filename}`,
    );

    // Report progress to UI
    ctx.onProgress(
      progress,
      `Processing ${state.currentIndex + 1}/${state.totalItems}: ${filename}`,
    );

    return {
      status: "success",
      outputs: {
        current: `local-asset://${currentFile}`,
        index: String(state.currentIndex),
        total: String(state.totalItems),
        filename: filename,
      },
      resultPath: `local-asset://${currentFile}`,
      resultMetadata: {
        currentIndex: state.currentIndex,
        totalItems: state.totalItems,
        filename: filename,
        progress: progress,
        output: `local-asset://${currentFile}`,
        resultUrl: `local-asset://${currentFile}`,
        resultUrls: [`local-asset://${currentFile}`],
      },
      durationMs: Date.now() - start,
      cost: 0,
    };
  }

  private matchesPattern(filename: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\./g, "\\.")
      .replace(/\*/g, ".*")
      .replace(/\{([^}]+)\}/g, (_, group) => `(${group.replace(/,/g, "|")})`)
      .replace(/\?/g, ".");
    const regex = new RegExp(`^${regexPattern}$`, "i");
    return regex.test(filename);
  }

  private scanFolder(
    folderPath: string,
    pattern: string,
    sortOrder: string,
  ): string[] {
    try {
      const allFiles = readdirSync(folderPath)
        .map((f) => join(folderPath, f))
        .filter((f) => {
          try {
            const filename = basename(f);
            // Skip macOS hidden files and system files
            if (filename.startsWith('.') || filename.startsWith('._')) {
              return false;
            }
            return statSync(f).isFile();
          } catch {
            return false;
          }
        });
      const matchedFiles: Array<{ path: string; stat: ReturnType<typeof statSync> }> = [];

      for (const file of allFiles) {
        const fullPath = file;
        try {
          const stat = statSync(fullPath);
          if (stat.isFile() && this.matchesPattern(basename(file), pattern)) {
            matchedFiles.push({ path: fullPath, stat });
          }
        } catch {
          continue;
        }
      }

      matchedFiles.sort((a, b) => {
        switch (sortOrder) {
          case "name-desc":
            return basename(b.path).localeCompare(basename(a.path));
          case "date-asc":
            return (a.stat?.mtime.getTime() ?? 0) - (b.stat?.mtime.getTime() ?? 0);
          case "date-desc":
            return (b.stat?.mtime.getTime() ?? 0) - (a.stat?.mtime.getTime() ?? 0);
          case "name-asc":
          default:
            return basename(a.path).localeCompare(basename(b.path));
        }
      });

      return matchedFiles.map((f) => f.path);
    } catch (error) {
      throw new Error(
        `Failed to read directory "${folderPath}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
