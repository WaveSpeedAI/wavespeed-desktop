/**
 * Node handler interface and base class.
 */
import type { NodeTypeDefinition } from "../../../src/workflow/types/node-defs";

export interface NodeExecutionContext {
  nodeId: string;
  nodeType: string;
  params: Record<string, unknown>;
  inputs: Record<string, unknown>;
  workflowId: string;
  abortSignal: AbortSignal;
  onProgress: (progress: number, message?: string) => void;
}

export interface NodeExecutionResult {
  status: "success" | "error";
  outputs: Record<string, unknown>;
  resultPath?: string;
  resultMetadata?: Record<string, unknown>;
  durationMs: number;
  cost: number;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface NodeHandler {
  execute(context: NodeExecutionContext): Promise<NodeExecutionResult>;
  estimateCost(params: Record<string, unknown>): number;
  validate(params: Record<string, unknown>): ValidationResult;
}

export abstract class BaseNodeHandler implements NodeHandler {
  constructor(public readonly definition: NodeTypeDefinition) {}

  abstract execute(context: NodeExecutionContext): Promise<NodeExecutionResult>;

  estimateCost(_params: Record<string, unknown>): number {
    return this.definition.costPerExecution ?? 0;
  }

  validate(params: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    for (const paramDef of this.definition.params) {
      if (paramDef.validation) {
        const val = params[paramDef.key];
        if (
          paramDef.validation.min !== undefined &&
          typeof val === "number" &&
          val < paramDef.validation.min
        ) {
          errors.push(
            `${paramDef.label}: minimum is ${paramDef.validation.min}`,
          );
        }
        if (
          paramDef.validation.max !== undefined &&
          typeof val === "number" &&
          val > paramDef.validation.max
        ) {
          errors.push(
            `${paramDef.label}: maximum is ${paramDef.validation.max}`,
          );
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }
}
