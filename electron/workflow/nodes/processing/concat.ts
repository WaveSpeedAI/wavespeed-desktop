/**
 * Concat node — concatenate multiple values into one array.
 * Collects value1..value5 (from connections or params), skips empty, outputs array.
 */
import {
  BaseNodeHandler,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from "../base";
import type { NodeTypeDefinition } from "../../../../src/workflow/types/node-defs";

const VALUE_KEYS = ["value1", "value2", "value3", "value4", "value5"];

export const concatDef: NodeTypeDefinition = {
  type: "processing/concat",
  category: "processing",
  label: "Concat",
  inputs: [
    { key: "value1", label: "Value 1", dataType: "any", required: true },
    { key: "value2", label: "Value 2", dataType: "any", required: true },
    { key: "value3", label: "Value 3", dataType: "any", required: false },
    { key: "value4", label: "Value 4", dataType: "any", required: false },
    { key: "value5", label: "Value 5", dataType: "any", required: false },
  ],
  outputs: [{ key: "output", label: "Array", dataType: "any", required: true }],
  params: [],
};

export class ConcatHandler extends BaseNodeHandler {
  constructor() {
    super(concatDef);
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const arr: string[] = [];
    for (const key of VALUE_KEYS) {
      const v = ctx.inputs[key] ?? ctx.params[key];
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item !== undefined && item !== null && item !== "")
            arr.push(String(item));
        }
      } else {
        const s = String(v).trim();
        if (s) arr.push(s);
      }
    }
    if (arr.length === 0) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error:
          "Concat requires at least one non-empty value. Connect inputs or provide values.",
      };
    }
    return {
      status: "success",
      outputs: { output: arr },
      resultPath: arr[0],
      resultMetadata: {
        output: arr,
        resultUrl: arr[0],
        resultUrls: arr,
      },
      durationMs: Date.now() - start,
      cost: 0,
    };
  }
}
