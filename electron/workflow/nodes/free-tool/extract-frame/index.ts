import type { NodeTypeDefinition } from "../../../../../src/workflow/types/node-defs";
import {
  BaseNodeHandler,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from "../../base";
import {
  createOutputPath,
  resolveInputToLocalFile,
  runFfmpeg,
  toLocalAssetUrl,
} from "../shared/media-utils";
import * as fs from "fs";
import * as path from "path";

const FRAME_FORMATS = ["png", "jpg", "webp"] as const;

export const extractFrameDef: NodeTypeDefinition = {
  type: "free-tool/extract-frame",
  category: "free-tool",
  label: "Extract Frame",
  inputs: [
    {
      key: "input",
      label: "Video",
      dataType: "video",
      required: true,
      description:
        "Upload a video or connect one from an upstream node, then scrub the preview to choose a frame.",
    },
  ],
  outputs: [
    { key: "output", label: "Frame", dataType: "image", required: true },
  ],
  params: [
    {
      key: "time",
      label: "Time (s)",
      type: "number",
      dataType: "text",
      default: 0,
      connectable: false,
      description: "The timestamp of the selected frame in seconds.",
      validation: { min: 0, step: 0.001 },
    },
    {
      key: "format",
      label: "Format",
      type: "select",
      default: "png",
      dataType: "text",
      connectable: true,
      description: "The image format used when saving the captured frame.",
      options: FRAME_FORMATS.map((v) => ({
        label: v.toUpperCase(),
        value: v,
      })),
    },
    {
      key: "outputDir",
      label: "Save to Local Folder",
      type: "string",
      default: "",
      connectable: false,
      description:
        "Optional. Set a folder to export an extra local copy of the extracted frame.",
    },
  ],
};

export class ExtractFrameHandler extends BaseNodeHandler {
  constructor() {
    super(extractFrameDef);
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const input = String(ctx.inputs.input ?? ctx.params.input ?? "");
    const time = Number(ctx.params.time ?? 0);
    const format = String(ctx.params.format ?? "png").toLowerCase();
    const outputDir = String(ctx.params.outputDir ?? "").trim();

    if (!input) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: "No input video provided.",
      };
    }

    if (!Number.isFinite(time) || time < 0) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: "Invalid frame time: time must be 0 or greater.",
      };
    }

    if (!FRAME_FORMATS.includes(format as (typeof FRAME_FORMATS)[number])) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: `Unsupported frame format: ${format}`,
      };
    }

    const resolved = await resolveInputToLocalFile(
      input,
      ctx.workflowId,
      ctx.nodeId,
    );
    const outputPath = createOutputPath(
      ctx.workflowId,
      ctx.nodeId,
      "extract_frame",
      format,
    );

    try {
      ctx.onProgress(10, "Preparing frame extraction...");
      await runFfmpeg([
        "-y",
        "-ss",
        String(time),
        "-i",
        resolved.localPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        outputPath,
      ]);
      ctx.onProgress(100, "Frame extracted.");
      const outputUrl = toLocalAssetUrl(outputPath);
      const exportPath = outputDir
        ? copyToExportDirectory(outputPath, outputDir)
        : "";

      return {
        status: "success",
        outputs: { output: outputUrl },
        resultPath: outputUrl,
        resultMetadata: {
          output: outputUrl,
          resultUrl: outputUrl,
          resultUrls: [outputUrl],
          outputPath,
          exportPath,
          outputDir,
          time,
          format,
        },
        durationMs: Date.now() - start,
        cost: 0,
      };
    } catch (error) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      resolved.cleanup();
    }
  }
}

function copyToExportDirectory(sourcePath: string, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const parsed = path.parse(path.basename(sourcePath));
  let targetPath = path.join(outputDir, `${parsed.name}${parsed.ext}`);
  if (fs.existsSync(targetPath)) {
    targetPath = path.join(
      outputDir,
      `${parsed.name}_${Date.now()}${parsed.ext}`,
    );
  }
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}
