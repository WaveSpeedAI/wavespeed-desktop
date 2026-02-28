/**
 * Select node — select one value from an array by index (0-based).
 * Input can be an array (from Concat or other nodes) or a single value (treated as [value]).
 */
import {
  BaseNodeHandler,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from "../base";
import type { NodeTypeDefinition } from "../../../../src/workflow/types/node-defs";

export const selectDef: NodeTypeDefinition = {
  type: "processing/select",
  category: "processing",
  label: "Select",
  inputs: [{ key: "input", label: "Array", dataType: "any", required: true }],
  outputs: [{ key: "output", label: "Value", dataType: "any", required: true }],
  params: [
    {
      key: "index",
      label: "Index",
      type: "number",
      default: 0,
      connectable: false,
      validation: { min: 0, step: 1 },
    },
  ],
};

export class SelectHandler extends BaseNodeHandler {
  constructor() {
    super(selectDef);
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const raw = ctx.inputs.input ?? ctx.params.input;
    let arr: string[];
    if (Array.isArray(raw)) {
      arr = raw
        .filter((x): x is string => x !== undefined && x !== null)
        .map(String);
    } else if (raw !== undefined && raw !== null && raw !== "") {
      const s = String(raw).trim();
      if (s.includes(",")) {
        arr = s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      } else {
        arr = [s];
      }
    } else {
      arr = [];
    }
    const index = Math.floor(Number(ctx.params.index ?? 0));
    if (index < 0 || index >= arr.length) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: `Index ${index} is out of range. Array has ${arr.length} item(s) (valid indices: 0–${Math.max(0, arr.length - 1)}).`,
      };
    }
    const value = arr[index];
    return {
      status: "success",
      outputs: { output: value },
      resultPath: value,
      resultMetadata: {
        output: value,
        resultUrl: value,
        resultUrls: [value],
        index,
        arrayLength: arr.length,
      },
      durationMs: Date.now() - start,
      cost: 0,
    };
  }
}
