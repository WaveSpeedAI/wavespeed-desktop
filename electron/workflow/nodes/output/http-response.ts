/**
 * HTTP Response — declares what the workflow returns to the HTTP caller.
 *
 * Pairs with HTTP Trigger. The user configures "response fields" — each
 * field becomes an input port. Connect upstream outputs to these ports.
 * After workflow execution, the HTTP server reads this node's collected
 * inputs and sends them as the JSON response body.
 *
 * Example:
 *   responseFields = [{ "key": "result", "label": "Result", "type": "url" }]
 *
 *   → input port "result" receives the final image URL from upstream
 *   → HTTP response: { "result": "https://cdn.../output.png" }
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

export interface ResponseFieldConfig {
  key: string;
  label: string;
  type: PortDataType;
}

export function parseResponseFields(raw: unknown): ResponseFieldConfig[] {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ResponseFieldConfig[];
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw as ResponseFieldConfig[];
  return [];
}

export function buildHttpResponseInputDefs(
  fields: ResponseFieldConfig[],
): PortDefinition[] {
  return fields.map((f) => ({
    key: f.key,
    label: f.label || f.key,
    dataType: f.type || "any",
    required: true,
  }));
}

export const httpResponseDef: NodeTypeDefinition = {
  type: "output/http-response",
  category: "output",
  label: "HTTP Response",
  inputs: [], // Dynamic — built from responseFields
  outputs: [],
  params: [
    {
      key: "responseFields",
      label: "Response Fields",
      type: "textarea",
      dataType: "text",
      connectable: false,
      default: '[{"key":"image","label":"Image","type":"text"}]',
      description:
        "Define API response fields. Each field becomes an input port.",
    },
  ],
};

export class HttpResponseHandler extends BaseNodeHandler {
  constructor() {
    super(httpResponseDef);
  }

  /**
   * Collect all input values and package them as the response body.
   * The HTTP server reads resultMetadata.__httpResponseBody after execution.
   */
  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const fields = parseResponseFields(ctx.params.responseFields);

    const responseBody: Record<string, unknown> = {};
    for (const field of fields) {
      const value = ctx.inputs[field.key];
      if (value !== undefined && value !== null) {
        responseBody[field.key] = value;
      }
    }

    // Fallback: if no fields matched, include all inputs directly
    if (
      Object.keys(responseBody).length === 0 &&
      Object.keys(ctx.inputs).length > 0
    ) {
      for (const [k, v] of Object.entries(ctx.inputs)) {
        if (v !== undefined && v !== null) {
          responseBody[k] = v;
        }
      }
    }

    return {
      status: "success",
      outputs: responseBody,
      resultMetadata: {
        ...responseBody,
        __httpResponseBody: responseBody,
      },
      durationMs: Date.now() - start,
      cost: 0,
    };
  }
}
