/**
 * Iterator node — now simplified to a Group container.
 *
 * Executes its internal sub-workflow exactly ONCE (no iteration).
 * Batch/repeat logic is handled by Trigger nodes and Run Count at the engine level.
 *
 * This node is purely an organizational/encapsulation tool:
 * - Contains child nodes (sub-workflow)
 * - Routes external inputs to child nodes via exposedInputs
 * - Collects child node outputs via exposedOutputs
 *
 * The type remains "control/iterator" for backward compatibility with
 * existing workflows and frontend components. The label shown in the UI
 * is "Group" (via i18n).
 */
import {
  BaseNodeHandler,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from "../base";
import type { NodeTypeDefinition } from "../../../../src/workflow/types/node-defs";
import type { ExposedParam } from "../../../../src/workflow/types/workflow";
import type { NodeRegistry } from "../registry";
import { getChildNodes } from "../../db/node.repo";
import { getInternalEdges } from "../../db/edge.repo";
import { topologicalLevels } from "../../engine/scheduler";

export const subgraphDef: NodeTypeDefinition = {
  type: "control/iterator",
  category: "control",
  label: "Group",
  inputs: [],
  outputs: [],
  params: [
    // Legacy params kept for backward compat — ignored at runtime
    {
      key: "iterationCount",
      label: "Iteration Count",
      type: "number",
      default: 1,
      validation: { min: 1 },
    },
    {
      key: "iterationMode",
      label: "Iteration Mode",
      type: "string",
      default: "fixed",
    },
    {
      key: "exposedInputs",
      label: "Exposed Inputs",
      type: "string",
      default: "[]",
    },
    {
      key: "exposedOutputs",
      label: "Exposed Outputs",
      type: "string",
      default: "[]",
    },
  ],
};

export class SubgraphNodeHandler extends BaseNodeHandler {
  constructor(private registry: NodeRegistry) {
    super(subgraphDef);
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();

    const exposedInputs = this.parseExposedParams(ctx.params.exposedInputs);
    const exposedOutputs = this.parseExposedParams(ctx.params.exposedOutputs);

    // Load child nodes and internal edges
    const childNodes = getChildNodes(ctx.nodeId);
    const internalEdges = getInternalEdges(ctx.workflowId);

    const childNodeIds = childNodes.map((n) => n.id);
    const childNodeIdSet = new Set(childNodeIds);
    const relevantEdges = internalEdges.filter(
      (e) =>
        childNodeIdSet.has(e.sourceNodeId) &&
        childNodeIdSet.has(e.targetNodeId),
    );

    if (childNodes.length === 0) {
      return {
        status: "success",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
      };
    }

    // Topologically sort child nodes
    const simpleEdges = relevantEdges.map((e) => ({
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
    }));
    const levels = topologicalLevels(childNodeIds, simpleEdges);
    const childNodeMap = new Map(childNodes.map((n) => [n.id, n]));

    // Route external inputs to child nodes
    const inputRouting = new Map<string, Map<string, unknown>>();
    for (const ep of exposedInputs) {
      const externalValue = ctx.inputs[ep.namespacedKey];
      if (externalValue !== undefined) {
        if (!inputRouting.has(ep.subNodeId)) {
          inputRouting.set(ep.subNodeId, new Map());
        }
        inputRouting.get(ep.subNodeId)!.set(ep.paramKey, externalValue);
      }
    }

    // Execute child nodes level by level — single pass, no iteration
    const subNodeOutputs = new Map<string, Record<string, unknown>>();
    let totalCost = 0;

    for (const level of levels) {
      for (const subNodeId of level) {
        const subNode = childNodeMap.get(subNodeId);
        if (!subNode) continue;

        const handler = this.registry.getHandler(subNode.nodeType);
        if (!handler) {
          return {
            status: "error",
            outputs: {},
            durationMs: Date.now() - start,
            cost: totalCost,
            error: `No handler for sub-node type: ${subNode.nodeType} (node: ${subNodeId})`,
          };
        }

        // Build params: base + external inputs
        const subParams: Record<string, unknown> = { ...subNode.params };
        const externalInputs = inputRouting.get(subNodeId);
        if (externalInputs) {
          for (const [paramKey, value] of externalInputs) {
            subParams[paramKey] = value;
          }
        }

        // Resolve internal edge inputs
        const subInputs = this.resolveSubNodeInputs(
          subNodeId,
          relevantEdges,
          subNodeOutputs,
        );

        const subCtx: NodeExecutionContext = {
          nodeId: subNodeId,
          nodeType: subNode.nodeType,
          params: subParams,
          inputs: subInputs,
          workflowId: ctx.workflowId,
          abortSignal: ctx.abortSignal,
          onProgress: (_progress, message) => {
            ctx.onProgress(_progress, message);
          },
        };

        try {
          const result = await handler.execute(subCtx);
          totalCost += result.cost;

          if (result.status === "error") {
            return {
              status: "error",
              outputs: {},
              durationMs: Date.now() - start,
              cost: totalCost,
              error: `Sub-node ${subNodeId} failed: ${result.error || "Unknown error"}`,
            };
          }

          console.log(
            `[Iterator] Sub-node ${subNodeId} (${subNode.nodeType}) outputs:`,
            JSON.stringify(result.outputs).slice(0, 300),
          );
          subNodeOutputs.set(subNodeId, result.outputs);
        } catch (error) {
          return {
            status: "error",
            outputs: {},
            durationMs: Date.now() - start,
            cost: totalCost,
            error: `Sub-node ${subNodeId} threw: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
    }

    // Collect exposed outputs — single values, no array aggregation
    const outputs: Record<string, unknown> = {};
    for (const ep of exposedOutputs) {
      const nodeOutputs = subNodeOutputs.get(ep.subNodeId);
      console.log(
        `[Iterator] Collecting exposedOutput: subNodeId=${ep.subNodeId}, paramKey=${ep.paramKey}, nk=${ep.namespacedKey}, nodeOutputs=`,
        nodeOutputs ? JSON.stringify(nodeOutputs).slice(0, 200) : "null",
      );
      if (nodeOutputs) {
        outputs[`output-${ep.namespacedKey}`] = nodeOutputs[ep.paramKey];
      }
    }
    console.log(
      `[Iterator] Final outputs:`,
      JSON.stringify(outputs).slice(0, 500),
    );

    return {
      status: "success",
      outputs,
      resultMetadata: { ...outputs },
      durationMs: Date.now() - start,
      cost: totalCost,
    };
  }

  private resolveSubNodeInputs(
    subNodeId: string,
    internalEdges: {
      sourceNodeId: string;
      targetNodeId: string;
      sourceOutputKey: string;
      targetInputKey: string;
    }[],
    subNodeOutputs: Map<string, Record<string, unknown>>,
  ): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    const incomingEdges = internalEdges.filter(
      (e) => e.targetNodeId === subNodeId,
    );

    for (const edge of incomingEdges) {
      const sourceOutputs = subNodeOutputs.get(edge.sourceNodeId);
      if (!sourceOutputs) continue;

      const value = sourceOutputs[edge.sourceOutputKey];
      if (value === undefined) continue;

      const targetKey = edge.targetInputKey;
      if (targetKey.startsWith("param-")) {
        inputs[targetKey.slice(6)] = value;
      } else if (targetKey.startsWith("input-")) {
        inputs[targetKey.slice(6)] = value;
      } else {
        inputs[targetKey] = value;
      }
    }

    return inputs;
  }

  private parseExposedParams(value: unknown): ExposedParam[] {
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as ExposedParam[];
      } catch {
        return [];
      }
    }
    if (Array.isArray(value)) return value as ExposedParam[];
    return [];
  }
}
