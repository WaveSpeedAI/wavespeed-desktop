import type { NodeTypeDefinition } from "../../../../../src/workflow/types/node-defs";
import {
  BaseNodeHandler,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from "../../base";
import { executeFreeToolInRenderer } from "../../../ipc/free-tool.ipc";

const MODEL_OPTIONS = [
  { label: "ISNet Quint8 (fast)", value: "isnet_quint8" },
  { label: "ISNet FP16", value: "isnet_fp16" },
  { label: "ISNet (quality)", value: "isnet" },
];

export const backgroundRemoverDef: NodeTypeDefinition = {
  type: "free-tool/background-remover",
  category: "free-tool",
  label: "Background Remover",
  inputs: [{ key: "input", label: "Image", dataType: "image", required: true }],
  outputs: [
    { key: "output", label: "Output", dataType: "image", required: true },
  ],
  params: [
    {
      key: "model",
      label: "Model",
      type: "select",
      default: "isnet_fp16",
      dataType: "text",
      connectable: false,
      options: MODEL_OPTIONS,
    },
  ],
};

export class BackgroundRemoverHandler extends BaseNodeHandler {
  constructor() {
    super(backgroundRemoverDef);
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const input = String(ctx.inputs.input ?? ctx.params.input ?? "");

    if (!input) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: "No input provided.",
      };
    }

    try {
      ctx.onProgress(0, "Running background remover in renderer...");
      const result = await executeFreeToolInRenderer({
        nodeType: "free-tool/background-remover",
        workflowId: ctx.workflowId,
        nodeId: ctx.nodeId,
        inputs: { input },
        params: { model: ctx.params.model ?? "isnet_fp16" },
      });
      ctx.onProgress(100, "Background removal completed.");
      return result;
    } catch (error) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
