import type { NodeTypeDefinition } from "../../../../src/workflow/types/node-defs";
import {
  BaseNodeHandler,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from "../base";
import { nodeRegistry } from "../registry";
import { videoConverterDef, VideoConverterHandler } from "./video-converter";
import { audioConverterDef, AudioConverterHandler } from "./audio-converter";
import { imageConverterDef, ImageConverterHandler } from "./image-converter";
import { mediaTrimmerDef, MediaTrimmerHandler } from "./media-trimmer";
import { mediaMergerDef, MediaMergerHandler } from "./media-merger";
import { imageEnhancerDef, ImageEnhancerHandler } from "./image-enhancer";
import {
  backgroundRemoverDef,
  BackgroundRemoverHandler,
} from "./background-remover";
import { faceEnhancerDef, FaceEnhancerHandler } from "./face-enhancer";
import { videoEnhancerDef, VideoEnhancerHandler } from "./video-enhancer";
import { faceSwapperDef, FaceSwapperHandler } from "./face-swapper";
import { imageEraserDef, ImageEraserHandler } from "./image-eraser";
import { segmentAnythingDef, SegmentAnythingHandler } from "./segment-anything";

type FreeToolSpec = {
  type: string;
  label: string;
  inputType?: "image" | "video" | "audio" | "url";
  outputType?: "image" | "video" | "audio" | "url";
};

const FREE_TOOL_SPECS: FreeToolSpec[] = [];

const INPUT_LABEL_BY_TYPE: Record<string, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  url: "URL",
};

function toDefinition(spec: FreeToolSpec): NodeTypeDefinition {
  const inputType = spec.inputType ?? "url";
  const inputLabel = INPUT_LABEL_BY_TYPE[inputType] ?? "Input";
  return {
    type: spec.type,
    category: "free-tool",
    label: spec.label,
    inputs: [
      {
        key: "input",
        label: inputLabel,
        dataType: inputType,
        required: true,
      },
    ],
    outputs: [
      {
        key: "output",
        label: "Output",
        dataType: spec.outputType ?? "url",
        required: true,
      },
    ],
    params: [],
  };
}

class UnsupportedFreeToolHandler extends BaseNodeHandler {
  constructor(definition: NodeTypeDefinition) {
    super(definition);
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const input = String(ctx.inputs.input ?? "");

    if (!input) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: "No input provided.",
      };
    }

    return {
      status: "error",
      outputs: {},
      durationMs: Date.now() - start,
      cost: 0,
      error: `Node "${this.definition.label}" is registered, but executor is not implemented yet.`,
    };
  }
}

export function registerFreeToolNodes(): void {
  nodeRegistry.register(videoConverterDef, new VideoConverterHandler());
  nodeRegistry.register(audioConverterDef, new AudioConverterHandler());
  nodeRegistry.register(imageConverterDef, new ImageConverterHandler());
  nodeRegistry.register(mediaTrimmerDef, new MediaTrimmerHandler());
  nodeRegistry.register(mediaMergerDef, new MediaMergerHandler());
  nodeRegistry.register(imageEnhancerDef, new ImageEnhancerHandler());
  nodeRegistry.register(backgroundRemoverDef, new BackgroundRemoverHandler());
  nodeRegistry.register(faceEnhancerDef, new FaceEnhancerHandler());
  nodeRegistry.register(videoEnhancerDef, new VideoEnhancerHandler());
  nodeRegistry.register(faceSwapperDef, new FaceSwapperHandler());
  nodeRegistry.register(imageEraserDef, new ImageEraserHandler());
  nodeRegistry.register(segmentAnythingDef, new SegmentAnythingHandler());

  // Placeholder for any future free-tool nodes
  for (const spec of FREE_TOOL_SPECS) {
    const definition = toDefinition(spec);
    nodeRegistry.register(
      definition,
      new UnsupportedFreeToolHandler(definition),
    );
  }
}
