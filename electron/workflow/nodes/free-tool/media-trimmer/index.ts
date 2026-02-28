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

export const mediaTrimmerDef: NodeTypeDefinition = {
  type: "free-tool/media-trimmer",
  category: "free-tool",
  label: "Media Trimmer",
  inputs: [{ key: "input", label: "Media", dataType: "video", required: true }],
  outputs: [
    { key: "output", label: "Output", dataType: "url", required: true },
  ],
  params: [
    {
      key: "startTime",
      label: "Start (s)",
      type: "number",
      dataType: "text",
      default: 0,
      connectable: false,
      validation: { min: 0, step: 0.1 },
    },
    {
      key: "endTime",
      label: "End (s)",
      type: "number",
      dataType: "text",
      default: 10,
      connectable: false,
      validation: { min: 0, step: 0.1 },
    },
    {
      key: "format",
      label: "Output Format",
      type: "string",
      dataType: "text",
      default: "mp4",
      connectable: false,
    },
  ],
};

export class MediaTrimmerHandler extends BaseNodeHandler {
  constructor() {
    super(mediaTrimmerDef);
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const input = String(ctx.inputs.input ?? ctx.params.input ?? "");
    const startTime = Number(ctx.params.startTime ?? 0);
    const endTime = Number(ctx.params.endTime ?? 10);
    const format = String(ctx.params.format ?? "mp4").toLowerCase();

    if (
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      endTime <= startTime
    ) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: "Invalid trim range: endTime must be greater than startTime.",
      };
    }

    const duration = endTime - startTime;
    const resolved = await resolveInputToLocalFile(
      input,
      ctx.workflowId,
      ctx.nodeId,
    );
    const outputPath = createOutputPath(
      ctx.workflowId,
      ctx.nodeId,
      "media_trimmer",
      format,
    );

    try {
      ctx.onProgress(10, "Preparing trim...");
      await runFfmpeg([
        "-y",
        "-ss",
        String(startTime),
        "-i",
        resolved.localPath,
        "-t",
        String(duration),
        "-c",
        "copy",
        outputPath,
      ]);
      ctx.onProgress(100, "Trim completed.");
      const outputUrl = toLocalAssetUrl(outputPath);

      return {
        status: "success",
        outputs: { output: outputUrl },
        resultPath: outputUrl,
        resultMetadata: {
          output: outputUrl,
          resultUrl: outputUrl,
          resultUrls: [outputUrl],
          outputPath,
          startTime,
          endTime,
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
