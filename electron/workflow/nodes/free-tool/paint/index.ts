import type { NodeTypeDefinition } from "../../../../../src/workflow/types/node-defs";
import type { Model } from "../../../../../src/types/model";
import {
  BaseNodeHandler,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from "../../base";
import { executeFreeToolInRenderer } from "../../../ipc/free-tool.ipc";
import { getWaveSpeedClient } from "../../../services/service-locator";
import { getModelById } from "../../../services/model-list";
import {
  getAvgExecutionTime,
  inferModelType,
  startProgressTimer,
  startTrickleTimer,
} from "../../../../../src/workflow/lib/progress-estimator";
import {
  buildPaintModelApiParams,
  getPaintModelMatchScore,
  normalizeRepaintScope,
  readPaintModelSchema,
  type PaintTarget,
  type PaintTask,
} from "../../../../../src/workflow/lib/paint-model";
import { normalizePayloadArrays } from "../../../../../src/lib/schemaToForm";
import { existsSync, readFileSync } from "fs";
import { basename } from "path";

const IMAGE_ENHANCER_MODELS = new Set(["slim", "medium", "thick"]);
const IMAGE_ENHANCER_SCALES = new Set(["2x", "3x", "4x"]);
const BACKGROUND_REMOVER_MODELS = new Set([
  "isnet_quint8",
  "isnet_fp16",
  "isnet",
]);

export const paintDef: NodeTypeDefinition = {
  type: "free-tool/paint",
  category: "free-tool",
  label: "Image Edit",
  inputs: [
    {
      key: "input",
      label: "Image",
      dataType: "image",
      required: true,
      description:
        "Upload an image or connect an extracted frame, then choose an edit mode.",
    },
  ],
  outputs: [
    {
      key: "output",
      label: "Output",
      dataType: "url",
      required: true,
    },
  ],
  params: [],
};

export class PaintHandler extends BaseNodeHandler {
  constructor() {
    super(paintDef);
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const input = String(ctx.inputs.input ?? ctx.params.input ?? "");
    const workingImage = String(ctx.params.__workingImage ?? "");
    const source =
      workingImage || input || String(ctx.params.__sourceImage ?? "");
    const savedSource = String(ctx.params.__sourceImage ?? "");
    const savedSelectionMatchesSource = Boolean(
      savedSource && source && savedSource === source,
    );
    const reference = savedSelectionMatchesSource
      ? String(ctx.params.__paintedImage ?? source)
      : source;
    const mask = savedSelectionMatchesSource
      ? String(ctx.params.__maskImage ?? "")
      : "";
    const bbox = savedSelectionMatchesSource
      ? String(ctx.params.__maskBbox ?? "")
      : "";
    const task = String(ctx.params.__paintTask ?? "repaint") as PaintTask;
    const prompt =
      task === "expand"
        ? String(ctx.params.__expandPrompt ?? ctx.params.__editPrompt ?? "")
        : String(ctx.params.__editPrompt ?? "");
    const repaintScope = normalizeRepaintScope(ctx.params.__repaintScope);
    const paintTarget = "image" as PaintTarget;
    const paintModelId = String(ctx.params.__paintModelId ?? "");
    const selectionMode = String(
      ctx.params.__selectionMode ?? ctx.params.__regionMode ?? "paint",
    );
    const expandRatio = String(ctx.params.__expandRatio ?? "16:9");
    const requiresRegion =
      task === "erase" ||
      task === "cutout" ||
      task === "region" ||
      (task === "repaint" && repaintScope === "region");
    const supportsModelTarget = task === "repaint" || task === "expand";

    if (!source) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: "No input image provided.",
      };
    }

    if (task === "remove-bg") {
      const model = String(ctx.params.model ?? "");
      const result = await executeFreeToolInRenderer({
        nodeType: "free-tool/background-remover",
        workflowId: ctx.workflowId,
        nodeId: ctx.nodeId,
        inputs: { input: source },
        params: {
          model: BACKGROUND_REMOVER_MODELS.has(model) ? model : "isnet_fp16",
        },
      });
      const output = String(
        result.resultPath ??
          (result.outputs?.output as string | undefined) ??
          "",
      );
      return {
        ...result,
        outputs: { output },
        resultPath: output,
        resultMetadata: {
          ...(result.resultMetadata ?? {}),
          output,
          resultUrl: output,
          resultUrls: output ? [output] : [],
          source,
          task,
        },
      };
    }

    if (task === "enhance") {
      const model = String(ctx.params.model ?? "");
      const scale = String(ctx.params.scale ?? "");
      return executeFreeToolInRenderer({
        nodeType: "free-tool/image-enhancer",
        workflowId: ctx.workflowId,
        nodeId: ctx.nodeId,
        inputs: { input: source },
        params: {
          model: IMAGE_ENHANCER_MODELS.has(model) ? model : "slim",
          scale: IMAGE_ENHANCER_SCALES.has(scale) ? scale : "2x",
        },
      });
    }

    if (task === "face-enhance") {
      return executeFreeToolInRenderer({
        nodeType: "free-tool/face-enhancer",
        workflowId: ctx.workflowId,
        nodeId: ctx.nodeId,
        inputs: { input: source },
        params: {},
      });
    }

    if (requiresRegion && !mask) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: "No saved region. Select a region before running the workflow.",
      };
    }

    if (task === "cutout") {
      const result = await executeFreeToolInRenderer({
        nodeType: "free-tool/image-cutout",
        workflowId: ctx.workflowId,
        nodeId: ctx.nodeId,
        inputs: { input: source, mask_image: mask },
        params: {},
      });
      const output = String(
        result.resultPath ??
          (result.outputs?.output as string | undefined) ??
          "",
      );
      return {
        ...result,
        outputs: { output },
        resultPath: output,
        resultMetadata: {
          ...(result.resultMetadata ?? {}),
          output,
          resultUrl: output,
          resultUrls: output ? [output] : [],
          source,
          mask,
          bbox,
          task,
          selectionMode,
        },
      };
    }

    if (supportsModelTarget) {
      if (!paintModelId) {
        return {
          status: "error",
          outputs: {},
          durationMs: Date.now() - start,
          cost: 0,
          error: "No paint model selected.",
        };
      }

      const selectedModel = getModelById(paintModelId);
      if (!selectedModel) {
        return {
          status: "error",
          outputs: {},
          durationMs: Date.now() - start,
          cost: 0,
          error:
            "Selected model is not available in the local model cache. Choose a supported model from the list before running.",
        };
      }

      let modelSchema = readPaintModelSchema(
        ctx.params.__paintModelInputSchema,
      );
      if (modelSchema.length === 0) {
        modelSchema = selectedModel.inputSchema ?? [];
      }
      const matchModel: Pick<Model, "model_id" | "name" | "type"> = {
        model_id: selectedModel.modelId,
        name: selectedModel.displayName,
        type: selectedModel.category,
      };
      if (
        modelSchema.length === 0 ||
        getPaintModelMatchScore(matchModel, modelSchema, task, paintTarget) <= 0
      ) {
        return {
          status: "error",
          outputs: {},
          durationMs: Date.now() - start,
          cost: 0,
          error:
            "Selected model does not support this paint function. Choose a compatible model from the list.",
        };
      }
      const apiParams = buildPaintModelApiParams({
        params: ctx.params,
        schema: modelSchema,
        task,
        source,
        mask,
        prompt,
        reference,
        expandRatio,
        repaintScope,
        selectionMode,
      });
      const resolvedParams = await this.uploadLocalAssets(
        normalizePayloadArrays(apiParams, []),
      );
      const avgMs = await getAvgExecutionTime(paintModelId);
      const stopTimer = avgMs
        ? startProgressTimer(
            avgMs,
            (pct, msg) => ctx.onProgress(pct, msg),
            paintModelId,
          )
        : startTrickleTimer(
            inferModelType(paintModelId),
            (pct, msg) => ctx.onProgress(pct, msg),
            paintModelId,
          );

      try {
        const client = getWaveSpeedClient();
        const result = await client.run(paintModelId, resolvedParams, {
          signal: ctx.abortSignal,
        });
        stopTimer();
        ctx.onProgress(100, "Done");

        const resultUrls = this.normalizeRunOutputs(result.outputs);
        const outputUrl = resultUrls[0] ?? "";
        const cost = selectedModel.costPerRun ?? 0;

        return {
          status: "success",
          outputs: { output: outputUrl },
          resultPath: outputUrl,
          resultMetadata: {
            output: outputUrl,
            resultUrl: outputUrl,
            resultUrls,
            source,
            mask,
            prompt,
            reference,
            bbox,
            task,
            selectionMode,
            expandRatio,
            repaintScope,
            paintTarget,
            modelId: paintModelId,
            raw: result,
          },
          durationMs: Date.now() - start,
          cost,
        };
      } catch (error) {
        stopTimer();
        return {
          status: "error",
          outputs: {},
          durationMs: Date.now() - start,
          cost: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (task === "erase") {
      const result = await executeFreeToolInRenderer({
        nodeType: "free-tool/image-eraser",
        workflowId: ctx.workflowId,
        nodeId: ctx.nodeId,
        inputs: { input: source, mask_image: mask },
        params: {},
      });
      const output = String(
        result.resultPath ??
          (result.outputs?.output as string | undefined) ??
          "",
      );
      return {
        ...result,
        outputs: { output },
        resultPath: output,
        resultMetadata: {
          ...(result.resultMetadata ?? {}),
          output,
          resultUrl: output,
          resultUrls: output ? [output] : [],
          source,
          mask,
          bbox,
          task,
          selectionMode,
        },
      };
    }

    ctx.onProgress(100, "Frame edit output ready.");
    const outputMask = requiresRegion ? mask : "";
    const outputBbox = requiresRegion ? bbox : "";
    const output = task === "region" ? outputMask : source;
    const resultUrls = [output].filter(Boolean);
    return {
      status: "success",
      outputs: { output },
      resultPath: output,
      resultMetadata: {
        output,
        mask: outputMask,
        prompt,
        reference,
        bbox: outputBbox,
        task,
        selectionMode,
        expandRatio,
        repaintScope,
        resultUrl: output,
        resultUrls,
      },
      durationMs: Date.now() - start,
      cost: 0,
    };
  }

  private normalizeRunOutput(value: unknown): string {
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { url?: unknown }).url === "string"
    ) {
      return (value as { url: string }).url;
    }
    return value == null ? "" : String(value);
  }

  private normalizeRunOutputs(outputs: unknown): string[] {
    return Array.isArray(outputs)
      ? outputs
          .map((output) => this.normalizeRunOutput(output))
          .filter((url) => url && url !== "[object Object]")
      : [];
  }

  private async uploadLocalAssets(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const out = { ...params };
    const client = getWaveSpeedClient();
    const uploadOne = async (url: string): Promise<string> => {
      if (!/^local-asset:\/\//i.test(url)) return url;
      const localPath = decodeURIComponent(
        url.replace(/^local-asset:\/\//i, ""),
      );
      if (!existsSync(localPath)) {
        throw new Error(`Local file not found: ${localPath}`);
      }
      const buffer = readFileSync(localPath);
      const filename = basename(localPath);
      const blob = new Blob([buffer]);
      const file = new File([blob], filename);
      return client.uploadFile(file, filename);
    };

    for (const [key, value] of Object.entries(out)) {
      if (typeof value === "string" && /^local-asset:\/\//i.test(value)) {
        out[key] = await uploadOne(value);
      } else if (Array.isArray(value)) {
        const hasLocal = value.some(
          (item) => typeof item === "string" && /^local-asset:\/\//i.test(item),
        );
        if (hasLocal) {
          out[key] = await Promise.all(
            value.map((item) =>
              typeof item === "string" && /^local-asset:\/\//i.test(item)
                ? uploadOne(item)
                : item,
            ),
          );
        }
      }
    }

    return out;
  }
}
