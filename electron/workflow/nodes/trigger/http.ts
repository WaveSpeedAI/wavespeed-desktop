/**
 * HTTP Trigger — declares the API input schema for a workflow.
 *
 * This node does NOT start a server itself. Instead, a global HTTP server
 * service routes incoming requests to workflows that contain an HTTP Trigger.
 *
 * The user configures "output fields" — each field becomes an output port
 * on the canvas that can be connected to downstream nodes. When a request
 * arrives, the server extracts the matching JSON body fields and injects
 * them as this node's outputs.
 *
 * Example:
 *   outputFields = [
 *     { "key": "image", "label": "Image", "type": "url" },
 *     { "key": "prompt", "label": "Prompt", "type": "text" }
 *   ]
 *
 *   POST /api/workflows/{id}/run
 *   { "image": "https://...", "prompt": "a cat" }
 *
 *   → output port "image" = "https://..."
 *   → output port "prompt" = "a cat"
 */
import {
  BaseNodeHandler,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from "../base";
import type {
  NodeTypeDefinition,
  PortDefinition,
  PortDataType,
} from "../../../../src/workflow/types/node-defs";
import type { TriggerHandler, TriggerMode } from "./base";

export interface OutputFieldConfig {
  key: string;
  label: string;
  type: PortDataType;
}

export function parseOutputFields(raw: unknown): OutputFieldConfig[] {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as OutputFieldConfig[];
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw as OutputFieldConfig[];
  return [];
}

export function buildHttpOutputDefs(
  fields: OutputFieldConfig[],
): PortDefinition[] {
  return fields.map((f) => ({
    key: f.key,
    label: f.label || f.key,
    dataType: f.type || "any",
    required: true,
  }));
}

export const httpTriggerDef: NodeTypeDefinition = {
  type: "trigger/http",
  category: "trigger",
  label: "HTTP Trigger",
  inputs: [],
  outputs: [], // Dynamic — built from outputFields
  params: [
    {
      key: "port",
      label: "Port",
      type: "number",
      dataType: "text",
      connectable: false,
      default: 3100,
      description: "HTTP server port number.",
    },
    {
      key: "outputFields",
      label: "Output Fields",
      type: "textarea",
      dataType: "text",
      connectable: false,
      default:
        '[{"key":"image","label":"Image","type":"url"},{"key":"prompt","label":"Prompt","type":"text"}]',
      description:
        "Define API input fields. Each field becomes an output port.",
    },
  ],
};

export class HttpTriggerHandler
  extends BaseNodeHandler
  implements TriggerHandler
{
  readonly triggerMode: TriggerMode = "single";

  constructor() {
    super(httpTriggerDef);
  }

  /**
   * Extract values from the injected request body (__triggerValue)
   * and output them on the corresponding ports.
   */
  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const fields = parseOutputFields(ctx.params.outputFields);
    const body = (ctx.params.__triggerValue ?? {}) as Record<string, unknown>;

    if (fields.length === 0) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: "No output fields configured.",
      };
    }

    const outputs: Record<string, unknown> = {};
    for (const field of fields) {
      const value = body[field.key];
      if (value !== undefined && value !== null && value !== "") {
        outputs[field.key] =
          typeof value === "string" ? value : JSON.stringify(value);
      }
    }

    if (Object.keys(outputs).length === 0) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error: `No matching fields in request body. Expected: ${fields.map((f) => f.key).join(", ")}`,
      };
    }

    const resultMetadata: Record<string, unknown> = { ...outputs };

    return {
      status: "success",
      outputs,
      resultMetadata,
      durationMs: Date.now() - start,
      cost: 0,
    };
  }
}
