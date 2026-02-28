/**
 * Execution control toolbar — Run All, Cancel. Includes daily budget display.
 * Execution runs in browser only (runAllInBrowser).
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useWorkflowStore } from "../../stores/workflow.store";
import { useExecutionStore } from "../../stores/execution.store";
import { useUIStore } from "../../stores/ui.store";
import { costIpc } from "../../ipc/ipc-client";

export function ExecutionToolbar() {
  const workflowId = useWorkflowStore((s) => s.workflowId);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const selectedNodeId = useUIStore((s) => s.selectedNodeId);
  const { runAllInBrowser, runNode, cancelNode, activeExecutions } =
    useExecutionStore();
  const isRunning = activeExecutions.size > 0;

  const [dailySpend, setDailySpend] = useState<number>(0);
  const [dailyLimit, setDailyLimit] = useState<number>(100);

  useEffect(() => {
    if (!workflowId) return;
    costIpc
      .getDailySpend()
      .then(setDailySpend)
      .catch(() => {});
    costIpc
      .getBudget()
      .then((b) => setDailyLimit(b.dailyLimit))
      .catch(() => {});
  }, [workflowId]);

  useEffect(() => {
    if (!isRunning && workflowId) {
      costIpc
        .getDailySpend()
        .then(setDailySpend)
        .catch(() => {});
    }
  }, [isRunning, workflowId]);

  const spendPercent = dailyLimit > 0 ? (dailySpend / dailyLimit) * 100 : 0;
  const spendColor =
    spendPercent > 80
      ? "text-red-400"
      : spendPercent > 50
        ? "text-orange-400"
        : "text-green-400";

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-card">
      <Button
        variant="outline"
        size="sm"
        disabled={nodes.length === 0}
        onClick={() => {
          const browserNodes = nodes.map((n) => ({
            id: n.id,
            data: {
              nodeType: n.data?.nodeType ?? "",
              params: {
                ...(n.data?.params ?? {}),
                __meta: { modelInputSchema: n.data?.modelInputSchema ?? [] },
              },
              label: n.data?.label,
            },
          }));
          const browserEdges = edges.map((e) => ({
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? undefined,
            targetHandle: e.targetHandle ?? undefined,
          }));
          runAllInBrowser(browserNodes, browserEdges);
        }}
      >
        ▶ Run All
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={nodes.length === 0 || !selectedNodeId}
        onClick={() =>
          selectedNodeId && runNode(workflowId ?? "", selectedNodeId)
        }
      >
        ▶ Run Node
      </Button>
      {isRunning && selectedNodeId && (
        <Button
          variant="destructive"
          size="sm"
          onClick={() =>
            workflowId &&
            selectedNodeId &&
            cancelNode(workflowId, selectedNodeId)
          }
        >
          ⏹ Cancel
        </Button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Daily budget */}
      {workflowId && (
        <span
          className={`text-[11px] px-2 py-0.5 rounded bg-[hsl(var(--muted))] ${spendColor}`}
        >
          Daily: ${dailySpend.toFixed(2)} / ${dailyLimit.toFixed(0)}
        </span>
      )}
    </div>
  );
}
