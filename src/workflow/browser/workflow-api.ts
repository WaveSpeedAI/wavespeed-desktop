/**
 * Workflow API implementation for browser (no Electron).
 * Persists workflows in localStorage and serves static node definitions.
 * Execution, cost, history, and file storage are not supported in browser.
 */
import * as storage from "./workflow-storage";
import { BROWSER_NODE_DEFINITIONS } from "./node-definitions";
import type {
  CreateWorkflowInput,
  SaveWorkflowInput,
} from "@/workflow/types/ipc";
import type { Workflow } from "@/workflow/types/workflow";
import type { BudgetConfig, ApiKeyConfig } from "@/workflow/types/ipc";
import type { NodeExecutionRecord } from "@/workflow/types/execution";

const NOT_AVAILABLE =
  "Not available in browser (run in Electron for full workflow features).";

const listeners = new Map<string, Set<(args: unknown) => void>>();

function emit(channel: string, args: unknown): void {
  listeners.get(channel)?.forEach((cb) => cb(args));
}

async function handleInvoke(channel: string, args?: unknown): Promise<unknown> {
  switch (channel) {
    case "registry:get-all":
      return BROWSER_NODE_DEFINITIONS;

    case "workflow:create": {
      const input = args as CreateWorkflowInput;
      return storage.createWorkflow(input.name);
    }
    case "workflow:save": {
      const input = args as SaveWorkflowInput;
      storage.updateWorkflow(
        input.id,
        input.name,
        { nodes: input.nodes, edges: input.edges },
        input.status,
      );
      return undefined;
    }
    case "workflow:load": {
      const { id } = args as { id: string };
      const wf = storage.getWorkflowById(id);
      if (!wf) throw new Error(`Workflow ${id} not found`);
      return wf;
    }
    case "workflow:list":
      return storage.listWorkflows();
    case "workflow:rename": {
      const { id, name } = args as { id: string; name: string };
      storage.renameWorkflow(id, name);
      const wf = storage.getWorkflowById(id);
      return { finalName: wf?.name ?? name };
    }
    case "workflow:delete": {
      const { id } = args as { id: string };
      storage.deleteWorkflow(id);
      return undefined;
    }
    case "workflow:duplicate": {
      const { id } = args as { id: string };
      return storage.duplicateWorkflow(id);
    }

    case "cost:estimate":
      return { totalEstimated: 0, breakdown: [], withinBudget: true };
    case "cost:get-budget":
      return { perExecutionLimit: 100, dailyLimit: 100 } as BudgetConfig;
    case "cost:set-budget":
      return undefined;
    case "cost:get-daily-spend":
      return 0;

    case "history:list": {
      const { nodeId } = args as { nodeId: string };
      return [] as NodeExecutionRecord[];
    }
    case "history:set-current":
    case "history:star":
    case "history:score":
    case "history:delete":
    case "history:delete-all":
      return undefined;

    case "settings:get-api-keys":
      try {
        const raw =
          typeof window !== "undefined"
            ? localStorage.getItem("wavespeed_api_key")
            : null;
        return { wavespeedKey: raw ?? "" } as ApiKeyConfig;
      } catch {
        return {} as ApiKeyConfig;
      }
    case "settings:set-api-keys":
      return undefined;

    case "models:sync":
      return undefined;
    case "models:list":
      return [];
    case "models:search":
      return [];
    case "models:get-schema":
      return null;

    case "execution:run-all":
    case "execution:run-node":
    case "execution:continue-from":
    case "execution:retry":
    case "execution:cancel":
      return Promise.reject(new Error(`Execution ${NOT_AVAILABLE}`));

    default:
      if (
        channel.startsWith("storage:") ||
        channel.startsWith("upload:") ||
        channel.startsWith("free-tool:")
      ) {
        return Promise.reject(new Error(NOT_AVAILABLE));
      }
      return Promise.reject(new Error(`Unknown channel: ${channel}`));
  }
}

export const browserWorkflowAPI = {
  invoke(channel: string, args?: unknown): Promise<unknown> {
    return Promise.resolve(handleInvoke(channel, args));
  },

  on(channel: string, callback: (...a: unknown[]) => void): void {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(callback as (args: unknown) => void);
  },

  removeListener(channel: string, _callback: (...a: unknown[]) => void): void {
    listeners.delete(channel);
  },
};
