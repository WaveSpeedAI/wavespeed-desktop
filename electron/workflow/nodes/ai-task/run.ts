/**
 * AI Task node — universal node for all WaveSpeed AI models.
 * Uses Desktop's API client instead of improver's WaveSpeedClient.
 */
import {
  BaseNodeHandler,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from "../base";
import type { NodeTypeDefinition } from "../../../../src/workflow/types/node-defs";
import { getWaveSpeedClient } from "../../services/service-locator";
import { getModelById } from "../../services/model-list";
import { normalizePayloadArrays } from "../../../../src/lib/schemaToForm";

export const aiTaskDef: NodeTypeDefinition = {
  type: "ai-task/run",
  category: "ai-task",
  label: "Generate",
  inputs: [],
  outputs: [
    { key: "output", label: "Output", dataType: "url", required: true },
  ],
  params: [
    {
      key: "modelId",
      label: "Model",
      type: "string",
      dataType: "text",
      connectable: false,
      default: "",
    },
  ],
};

export class AITaskHandler extends BaseNodeHandler {
  constructor() {
    super(aiTaskDef);
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const modelId = String(ctx.params.modelId ?? "");

    if (!modelId) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: "No model selected.",
      };
    }

    const apiParams = this.buildApiParams(ctx);
    ctx.onProgress(5, `Running ${modelId}...`);

    try {
      const client = getWaveSpeedClient();
      // Use Desktop's apiClient.run() which handles submit + poll; pass abortSignal so Stop cancels in-flight request/polling
      const result = await client.run(modelId, apiParams, {
        signal: ctx.abortSignal,
      });

      // Normalize first output to URL string (API may return string or { url: "..." })
      const firstOutput =
        Array.isArray(result.outputs) && result.outputs.length > 0
          ? result.outputs[0]
          : null;
      const outputUrl =
        firstOutput == null
          ? ""
          : typeof firstOutput === "object" &&
              firstOutput !== null &&
              typeof (firstOutput as { url?: string }).url === "string"
            ? (firstOutput as { url: string }).url
            : String(firstOutput);

      // Build resultUrls array with same normalization for each item (e.g. z-image/turbo)
      const rawOutputs = Array.isArray(result.outputs) ? result.outputs : [];
      const resultUrls = rawOutputs
        .map((o: unknown) =>
          typeof o === "object" &&
          o !== null &&
          typeof (o as { url?: string }).url === "string"
            ? (o as { url: string }).url
            : String(o),
        )
        .filter((u: string) => u && u !== "[object Object]");

      const model = getModelById(modelId);
      const cost = model?.costPerRun ?? 0;

      return {
        status: "success",
        outputs: { output: outputUrl },
        resultPath: outputUrl,
        resultMetadata: {
          // Store output by handle key so resolveInputs can find it
          output: outputUrl,
          resultUrl: outputUrl,
          resultUrls: resultUrls.length > 0 ? resultUrls : [outputUrl],
          modelId,
          raw: result,
        },
        durationMs: Date.now() - start,
        cost,
      };
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

  estimateCost(params: Record<string, unknown>): number {
    const modelId = String(params.modelId ?? "");
    if (!modelId) return 0;
    const model = getModelById(modelId);
    return model?.costPerRun ?? 0;
  }

  private buildApiParams(ctx: NodeExecutionContext): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    // Internal keys to skip
    const skipKeys = new Set([
      "modelId",
      "__meta",
      "__locks",
      "__nodeWidth",
      "__nodeHeight",
    ]);

    // First, fill in schema defaults so params that the user never touched
    // (but are visible in the UI with their default value) are still sent.
    const meta = ctx.params.__meta as Record<string, unknown> | undefined;
    const schema = (meta?.modelInputSchema ?? []) as Array<{
      name: string;
      default?: unknown;
      enum?: string[];
    }>;
    for (const s of schema) {
      if (skipKeys.has(s.name) || s.name.startsWith("__")) continue;
      if (s.default !== undefined && s.default !== null && s.default !== "") {
        params[s.name] = s.default;
      } else if (s.enum && s.enum.length > 0) {
        // Select/enum fields show the first option by default in the UI
        params[s.name] = s.enum[0];
      }
    }

    // Then overlay with actual user-set params (these take priority)
    for (const [key, value] of Object.entries(ctx.params)) {
      if (skipKeys.has(key) || key.startsWith("__")) continue;
      if (value !== undefined && value !== null && value !== "")
        params[key] = value;
    }
    // Merge resolved inputs (from upstream connections) — these override local params
    for (const [key, value] of Object.entries(ctx.inputs)) {
      if (key.startsWith("__arrayInput_")) {
        // Array input map: merge connected items into the existing param array
        const paramName = key.slice("__arrayInput_".length);
        const indexMap = value as Record<number, string>;
        const existing = Array.isArray(params[paramName])
          ? [...(params[paramName] as unknown[])]
          : [];
        for (const [idx, val] of Object.entries(indexMap)) {
          existing[Number(idx)] = val;
        }
        // Filter out empty/null entries — API expects only valid values
        params[paramName] = existing.filter(
          (v) => v !== undefined && v !== null && v !== "",
        );
      } else if (value !== undefined && value !== null && value !== "") {
        params[key] = Array.isArray(value) ? value : String(value);
      }
    }
    if (typeof params.seed === "number" && params.seed < 0) delete params.seed;
    return normalizePayloadArrays(params, []);
  }
}
