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

const AUDIO_FORMATS = ["mp3", "wav", "flac", "m4a", "ogg"] as const;

export const audioConverterDef: NodeTypeDefinition = {
  type: "free-tool/audio-converter",
  category: "free-tool",
  label: "Audio Converter",
  inputs: [{ key: "input", label: "Audio", dataType: "audio", required: true }],
  outputs: [
    { key: "output", label: "Output", dataType: "audio", required: true },
  ],
  params: [
    {
      key: "format",
      label: "Format",
      type: "select",
      default: "mp3",
      dataType: "text",
      connectable: false,
      options: AUDIO_FORMATS.map((v) => ({ label: v.toUpperCase(), value: v })),
    },
  ],
};

export class AudioConverterHandler extends BaseNodeHandler {
  constructor() {
    super(audioConverterDef);
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const format = String(ctx.params.format ?? "mp3").toLowerCase();
    const input = String(ctx.inputs.input ?? ctx.params.input ?? "");

    if (!AUDIO_FORMATS.includes(format as (typeof AUDIO_FORMATS)[number])) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: `Unsupported audio format: ${format}`,
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
      "audio_converter",
      format,
    );

    try {
      ctx.onProgress(10, "Preparing audio conversion...");
      await runFfmpeg(["-y", "-i", resolved.localPath, outputPath]);
      ctx.onProgress(100, "Audio conversion completed.");
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
