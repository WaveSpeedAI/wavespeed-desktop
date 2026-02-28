/**
 * Cost IPC handlers — budget management and cost estimation.
 */
import { ipcMain } from "electron";
import { CostService } from "../engine/cost";
import { NodeRegistry } from "../nodes/registry";
import { getNodesByWorkflowId } from "../db/node.repo";
import { getDailySpend } from "../db/budget.repo";
import type {
  BudgetConfig,
  CostEstimate,
} from "../../../src/workflow/types/ipc";

let costService: CostService | null = null;
let registry: NodeRegistry | null = null;

export function setCostDeps(cost: CostService, reg: NodeRegistry): void {
  costService = cost;
  registry = reg;
}

export function registerCostIpc(): void {
  ipcMain.handle(
    "cost:estimate",
    async (
      _event,
      args: { workflowId: string; nodeIds: string[] },
    ): Promise<CostEstimate> => {
      if (!costService || !registry)
        throw new Error("Cost service not initialized");
      const nodes = getNodesByWorkflowId(args.workflowId);
      const nodeTypes = new Map(nodes.map((n) => [n.id, n.nodeType]));
      const costByNodeId = new Map<string, number>();
      for (const n of nodes) {
        const handler = registry.getHandler(n.nodeType);
        if (handler) {
          // Must estimate per node (not per nodeType), because same type may use different modelId/cost.
          costByNodeId.set(n.id, handler.estimateCost(n.params));
        }
      }
      return costService.estimate(args.nodeIds, nodeTypes, costByNodeId);
    },
  );

  ipcMain.handle("cost:get-budget", async (): Promise<BudgetConfig> => {
    if (!costService) throw new Error("Cost service not initialized");
    return costService.getBudget();
  });

  ipcMain.handle("cost:set-budget", async (_event, config: BudgetConfig) => {
    if (!costService) throw new Error("Cost service not initialized");
    costService.setBudget(config);
  });

  ipcMain.handle("cost:get-daily-spend", async (): Promise<number> => {
    return getDailySpend();
  });
}
