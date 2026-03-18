/**
 * Workflow data types — core domain models for workflow persistence and graph structure.
 */

import type { PortDataType } from "./node-defs";

export type WorkflowStatus = "draft" | "ready" | "archived";

export interface Workflow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  graphDefinition: GraphDefinition;
  status: WorkflowStatus;
}

export interface GraphDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowNode {
  id: string;
  workflowId: string;
  nodeType: string;
  position: { x: number; y: number };
  params: Record<string, unknown>;
  currentOutputId: string | null;
  parentNodeId?: string | null;
}

export interface WorkflowEdge {
  id: string;
  workflowId: string;
  sourceNodeId: string;
  sourceOutputKey: string;
  targetNodeId: string;
  targetInputKey: string;
  connectionType?: "port" | "parameter";
  targetParamType?: string;
  isInternal?: boolean;
}

export interface ExposedParam {
  subNodeId: string;
  subNodeLabel: string;
  paramKey: string;
  namespacedKey: string;
  direction: "input" | "output";
  dataType: PortDataType;
  alias?: string;
}
