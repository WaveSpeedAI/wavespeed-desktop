/**
 * WorkflowResultsPanel — hidable right panel listing workflow results
 * in reversed execution order (most recently executed first).
 * Resizable width via drag on the left edge (like the left nodes panel).
 */
import { useMemo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "../../stores/ui.store";
import { useExecutionStore } from "../../stores/execution.store";
import { useWorkflowStore } from "../../stores/workflow.store";
import { topologicalLevels } from "../../lib/topological";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getOutputItemType, decodeDataText } from "../../lib/outputDisplay";
import { PanelRightClose } from "lucide-react";

/** Node id + display title (node label + model name for API nodes) + latest result urls, ordered by reversed execution order */
function useOrderedResultNodes(): Array<{
  nodeId: string;
  label: string;
  status: string;
  urls: string[];
}> {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const lastResults = useExecutionStore((s) => s.lastResults);
  const nodeStatuses = useExecutionStore((s) => s.nodeStatuses);
  const runSessions = useExecutionStore((s) => s.runSessions);

  return useMemo(() => {
    const nodeIds = nodes.map((n) => n.id);
    const idToDisplayLabel: Record<string, string> = {};
    for (const n of nodes) {
      const rawTitle = (n.data?.label as string)?.trim();
      const nodeType = n.data?.nodeType as string | undefined;
      const params = (n.data?.params ?? {}) as Record<string, unknown>;
      const modelId = params.modelId as string | undefined;
      if (nodeType === "ai-task/run" && modelId) {
        // Avoid duplicating when node label was already set to the model id/name
        idToDisplayLabel[n.id] =
          rawTitle && rawTitle !== modelId
            ? `${rawTitle} · ${modelId}`
            : modelId;
      } else {
        idToDisplayLabel[n.id] = rawTitle || nodeType || n.id.slice(0, 8);
      }
    }

    // Execution order (reversed = most recent first)
    let orderedIds: string[];
    const latestSession = runSessions[0];
    if (latestSession?.nodeIds?.length) {
      orderedIds = [...latestSession.nodeIds].reverse();
    } else {
      const simpleEdges = edges.map((e) => ({
        sourceNodeId: e.source,
        targetNodeId: e.target,
      }));
      const levels = topologicalLevels(nodeIds, simpleEdges);
      const execOrder = levels.flat();
      orderedIds = [...execOrder].reverse();
    }

    const withResults = orderedIds.filter((id) => {
      const arr = lastResults[id];
      return Array.isArray(arr) && arr.length > 0 && arr[0].urls?.length;
    });

    return withResults.map((nodeId) => {
      const arr = lastResults[nodeId] ?? [];
      const latest = arr[0];
      const urls = latest?.urls ?? [];
      const status = nodeStatuses[nodeId] ?? "idle";
      return {
        nodeId,
        label: idToDisplayLabel[nodeId] ?? nodeId.slice(0, 8),
        status,
        urls,
      };
    });
  }, [nodes, edges, lastResults, nodeStatuses, runSessions]);
}

export function WorkflowResultsPanel() {
  const { t } = useTranslation();
  const width = useUIStore((s) => s.workflowResultsPanelWidth);
  const setWorkflowResultsPanelWidth = useUIStore(
    (s) => s.setWorkflowResultsPanelWidth,
  );
  const toggleWorkflowResultsPanel = useUIStore(
    (s) => s.toggleWorkflowResultsPanel,
  );
  const selectNode = useUIStore((s) => s.selectNode);
  const openPreview = useUIStore((s) => s.openPreview);
  const ordered = useOrderedResultNodes();
  const [dragging, setDragging] = useState(false);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: MouseEvent) => {
        setWorkflowResultsPanelWidth(startWidth + (startX - ev.clientX));
      };
      const onUp = () => {
        setDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [width, setWorkflowResultsPanelWidth],
  );

  return (
    <div
      className="flex-shrink-0 border-l border-border bg-card flex flex-col min-h-0 relative"
      style={{ width, minWidth: 0 }}
    >
      {/* Resize handle on left edge — drag to adjust width */}
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onResizeStart}
        className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors ${dragging ? "bg-primary" : "hover:bg-primary/50"}`}
      />
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">
          {t("workflow.workflowResults", "Workflow Results")}
        </h3>
        <button
          onClick={toggleWorkflowResultsPanel}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title={t("workflow.closeResultsPanel", "Close panel")}
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      {/* List: reversed execution order */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-2">
          {ordered.length === 0 && (
            <p className="text-muted-foreground text-sm py-6 text-center px-2">
              {t(
                "workflow.noResultsYet",
                "No results yet. Run the workflow to see outputs here.",
              )}
            </p>
          )}
          {ordered.map(({ nodeId, label, status, urls }) => (
            <div
              key={nodeId}
              className="rounded-lg border border-border bg-background overflow-hidden"
            >
              <button
                type="button"
                onClick={() => selectNode(nodeId)}
                className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-accent/50 transition-colors"
              >
                <span className="text-xs font-medium text-foreground min-w-0 break-words">
                  {label}
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded shrink-0
                    ${
                      status === "running"
                        ? "bg-blue-500/20 text-blue-400"
                        : status === "confirmed"
                          ? "bg-green-500/20 text-green-400"
                          : status === "error"
                            ? "bg-red-500/20 text-red-400"
                            : "bg-muted text-muted-foreground"
                    }`}
                >
                  {status === "running"
                    ? t("workflow.running", "Running")
                    : status === "confirmed"
                      ? t("workflow.done", "Done")
                      : status === "error"
                        ? t("workflow.error", "Error")
                        : t("workflow.idle", "Idle")}
                </span>
              </button>
              {urls.length > 0 && (
                <div className="px-2 pb-2 flex gap-1.5 flex-wrap">
                  {urls.slice(0, 3).map((url, ui) => {
                    const type = getOutputItemType(url);
                    if (type === "image") {
                      return (
                        <button
                          key={ui}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openPreview(url, urls);
                          }}
                          className="flex-1 min-w-[60px] max-w-[100px] rounded border border-border overflow-hidden bg-muted/30 hover:ring-2 hover:ring-primary/40 transition-all"
                        >
                          <img
                            src={url}
                            alt=""
                            className="w-full aspect-square object-cover"
                          />
                        </button>
                      );
                    }
                    if (type === "video") {
                      return (
                        <button
                          key={ui}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openPreview(url);
                          }}
                          className="flex-1 min-w-[60px] max-w-[100px] rounded border border-border overflow-hidden bg-black/20 hover:ring-2 hover:ring-primary/40 transition-all relative"
                        >
                          <video
                            src={url}
                            className="w-full aspect-square object-cover"
                          />
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-6 h-6 rounded-full bg-black/50 flex items-center justify-center">
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="white"
                              >
                                <polygon points="5,3 19,12 5,21" />
                              </svg>
                            </div>
                          </div>
                        </button>
                      );
                    }
                    if (type === "text") {
                      const text = url.startsWith("data:text/")
                        ? decodeDataText(url)
                        : url;
                      const short =
                        text.length > 80 ? text.slice(0, 80) + "…" : text;
                      return (
                        <div
                          key={ui}
                          className="flex-1 min-w-0 rounded border border-border bg-muted/50 p-1.5 text-[10px] text-foreground/90 whitespace-pre-wrap break-words line-clamp-3"
                        >
                          {short}
                        </div>
                      );
                    }
                    return (
                      <button
                        key={ui}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPreview(url);
                        }}
                        className="flex-1 min-w-[60px] max-w-[100px] rounded border border-border bg-muted/30 p-2 text-[10px] text-muted-foreground truncate hover:bg-accent transition-colors"
                      >
                        {url.startsWith("data:")
                          ? "Data"
                          : url.split("/").pop()?.split("?")[0] || "File"}
                      </button>
                    );
                  })}
                  {urls.length > 3 && (
                    <span className="text-[10px] text-muted-foreground self-center">
                      +{urls.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
