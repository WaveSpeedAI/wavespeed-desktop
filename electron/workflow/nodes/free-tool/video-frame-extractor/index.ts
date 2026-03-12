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

export const videoFrameExtractorDef: NodeTypeDefinition = {
  type: "free-tool/video-frame-extractor",
  category: "free-tool",
  label: "Video Frame Extractor",
  inputs: [{ key: "input", label: "Video", dataType: "video", required: true }],
  outputs: [
    { key: "output", label: "Frame", dataType: "image", required: true },
  ],
  params: [
    {
      key: "position",
      label: "Position",
      type: "select",
      default: "last",
      dataType: "text",
      connectable: false,
      options: [
        { label: "First Frame", value: "first" },
        { label: "Last Frame", value: "last" },
        { label: "Middle Frame", value: "middle" },
        { label: "Specific Time", value: "time" },
      ],
    },
    {
      key: "timeSeconds",
      label: "Time (seconds)",
      type: "number",
      default: 0,
      dataType: "text",
      connectable: false,
      validation: { min: 0, step: 0.1 },
      description: "Used when Position is 'Specific Time'",
    },
    {
      key: "format",
      label: "Format",
      type: "select",
      default: "png",
      dataType: "text",
      connectable: false,
      options: [
        { label: "PNG", value: "png" },
        { label: "JPG", value: "jpg" },
        { label: "WebP", value: "webp" },
      ],
    },
  ],
};

export class VideoFrameExtractorHandler extends BaseNodeHandler {
  constructor() {
    super(videoFrameExtractorDef);
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const position = String(ctx.params.position ?? "last");
    const timeSeconds = Number(ctx.params.timeSeconds ?? 0);
    const format = String(ctx.params.format ?? "png");
    const input = String(ctx.inputs.input ?? ctx.params.input ?? "");

    const resolved = await resolveInputToLocalFile(
      input,
      ctx.workflowId,
      ctx.nodeId,
    );
    const outputPath = createOutputPath(
      ctx.workflowId,
      ctx.nodeId,
      "frame",
      format,
    );

    try {
      ctx.onProgress(10, "Extracting frame from video...");

      let seekArgs: string[] = [];

      if (position === "first") {
        seekArgs = ["-ss", "0"];
      } else if (position === "middle") {
        // For middle frame, we'll use a percentage-based seek (50%)
        // This is approximate but works well for most cases
        seekArgs = ["-vf", "select='eq(n\\,0)'"];
      } else if (position === "time") {
        seekArgs = ["-ss", String(timeSeconds)];
      } else {
        // last frame - use reverse seeking
        seekArgs = ["-sseof", "-0.1"];
      }

      const args = ["-y"];
      
      // Add seek args before input for faster seeking
      if (position !== "middle") {
        args.push(...seekArgs);
      }
      
      args.push("-i", resolved.localPath);

      // Extract single frame
      args.push("-frames:v", "1");
      
      // Quality settings
      if (format === "jpg") {
        args.push("-q:v", "2");
      }

      args.push(outputPath);
      
      await runFfmpeg(args);

      ctx.onProgress(100, "Frame extraction completed.");
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
