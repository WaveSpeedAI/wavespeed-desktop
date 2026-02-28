/**
 * MonitorSidePanel — right-side panel for run history.
 * Styled to match the NodePalette (left sidebar) for visual consistency.
 */
import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight, X, ChevronsUpDown } from "lucide-react";
import {
  useExecutionStore,
  type RunSession,
} from "../../stores/execution.store";
import { useUIStore } from "../../stores/ui.store";
import { historyIpc } from "../../ipc/ipc-client";
import { getOutputItemType, decodeDataText } from "../../lib/outputDisplay";
import { cn } from "@/lib/utils";
import type {
  NodeStatus,
  NodeExecutionRecord,
} from "@/workflow/types/execution";

/* ── Output Preview ───────────────────────────────────────────────── */

function OutputPreview({
  urls,
  durationMs,
  cost,
  label = "Output",
}: {
  urls: string[];
  durationMs?: number | null;
  cost?: number;
  label?: string;
}) {
  const openPreview = useUIStore((s) => s.openPreview);
  const validItems = urls.filter(
    (u): u is string => u != null && typeof u === "string",
  );
  if (validItems.length === 0) return null;

  return (
    <div className="text-[10px]">
      <div className="text-[9px] text-green-400 font-semibold uppercase tracking-wider mb-1">
        {label}
      </div>
      {(durationMs != null || (cost != null && cost !== undefined)) && (
        <div className="flex items-center gap-3 py-0.5 text-muted-foreground mb-1">
          {durationMs != null && (
            <span>⏱ {(durationMs / 1000).toFixed(1)}s</span>
          )}
          {cost != null && cost !== undefined && (
            <span>💰 ${Number(cost).toFixed(4)}</span>
          )}
        </div>
      )}
      <div className="flex gap-1.5 flex-wrap">
        {validItems.map((item, i) => {
          const type = getOutputItemType(item);
          if (type === "text") {
            const displayText = item.startsWith("data:text/")
              ? decodeDataText(item)
              : item;
            return (
              <div
                key={i}
                className="w-full rounded border border-border/50 bg-muted/10 p-2 max-h-[120px] overflow-y-auto"
              >
                <pre className="text-[9px] text-foreground/80 whitespace-pre-wrap break-words font-sans">
                  {displayText}
                </pre>
              </div>
            );
          }
          if (type === "image") {
            return (
              <div
                key={i}
                className="relative group flex-1 min-w-[60px] max-w-[100px]"
              >
                <img
                  src={item}
                  alt=""
                  onClick={() =>
                    openPreview(
                      item,
                      validItems.filter(
                        (u) => getOutputItemType(u) === "image",
                      ),
                    )
                  }
                  className="w-full h-16 rounded border border-border/50 object-cover cursor-pointer hover:ring-1 hover:ring-primary/50 bg-black/10"
                />
              </div>
            );
          }
          if (type === "video") {
            return (
              <div
                key={i}
                className="relative flex-1 min-w-[60px] max-w-[100px] rounded border border-border/50 overflow-hidden bg-black/10"
              >
                <video
                  src={item}
                  preload="metadata"
                  className="w-full h-16 object-cover"
                  onClick={() => openPreview(item)}
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-5 h-5 rounded-full bg-black/50 flex items-center justify-center">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="white">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  </div>
                </div>
              </div>
            );
          }
          if (type === "audio") {
            return (
              <div
                key={i}
                className="flex-1 min-w-[100px] rounded border border-border/50 bg-muted/10 p-1"
              >
                <audio src={item} controls className="w-full h-6" />
              </div>
            );
          }
          if (type === "3d") {
            return (
              <div
                key={i}
                className="flex-1 min-w-[60px] rounded border border-border/50 bg-muted/10 p-2 text-center cursor-pointer hover:bg-muted/20"
                onClick={() => openPreview(item)}
              >
                <span className="text-xs">🧊 3D</span>
              </div>
            );
          }
          return (
            <a
              key={i}
              href={item}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] text-blue-400 hover:underline truncate max-w-[160px] block"
            >
              {item.startsWith("data:")
                ? "Data"
                : item.split("/").pop() || "File"}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function LastResultOutput({ nodeId }: { nodeId: string }) {
  const lastResults = useExecutionStore((s) => s.lastResults[nodeId] ?? []);
  const latest = lastResults[0];
  if (!latest?.urls?.length) return null;
  return (
    <OutputPreview
      urls={latest.urls}
      durationMs={latest.durationMs}
      cost={latest.cost}
      label="Output (latest run)"
    />
  );
}

/* ── Main Panel ───────────────────────────────────────────────────── */

export function MonitorSidePanel({
  workflowId,
}: {
  workflowId?: string | null;
}) {
  const runSessions = useExecutionStore((s) => s.runSessions);
  const nodeStatuses = useExecutionStore((s) => s.nodeStatuses);
  const progressMap = useExecutionStore((s) => s.progressMap);
  const errorMessages = useExecutionStore((s) => s.errorMessages);
  const cancelAll = useExecutionStore((s) => s.cancelAll);
  const togglePanel = useUIStore((s) => s.toggleWorkflowResultsPanel);
  const width = useUIStore((s) => s.workflowResultsPanelWidth);
  const setSidebarWidth = useUIStore((s) => s.setWorkflowResultsPanelWidth);
  const [dragging, setDragging] = useState(false);

  const byWorkflow = workflowId
    ? runSessions.filter((s) => s.workflowId === workflowId)
    : runSessions;
  const fullRunsOnly = byWorkflow.filter((s) => s.scope === "full" || !s.scope);
  const filteredSessions =
    fullRunsOnly.length > 0
      ? fullRunsOnly
      : byWorkflow.filter((s) => s.scope === "full" || !s.scope);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: MouseEvent) =>
        setSidebarWidth(startWidth + (startX - ev.clientX));
      const onUp = () => {
        setDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [width, setSidebarWidth],
  );

  return (
    <div
      className="bg-background/95 backdrop-blur flex flex-col relative overflow-hidden h-full rounded-xl border border-border shadow-xl"
      style={{ width, minWidth: 0 }}
    >
      {/* ── header ── */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-border/70 shrink-0">
        <span className="font-semibold text-[13px] text-foreground">
          History
        </span>
        <button
          onClick={togglePanel}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── session list ── */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {filteredSessions.length === 0 ? (
          <div className="px-3 py-6 text-xs text-muted-foreground/60 text-center">
            No runs yet
          </div>
        ) : (
          <div className="space-y-1">
            {filteredSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                nodeStatuses={nodeStatuses}
                progressMap={progressMap}
                errorMessages={errorMessages}
                onCancel={() => cancelAll(session.workflowId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── resize handle ── */}
      <div
        onMouseDown={onResizeStart}
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors",
          dragging ? "bg-primary" : "hover:bg-primary/50",
        )}
      />
    </div>
  );
}

/* ── Session Card ─────────────────────────────────────────────────── */

function SessionCard({
  session,
  nodeStatuses,
  progressMap,
  errorMessages,
  onCancel,
}: {
  session: RunSession;
  nodeStatuses: Record<string, NodeStatus>;
  progressMap: Record<string, { progress: number; message?: string }>;
  errorMessages: Record<string, string>;
  onCancel: () => void;
}) {
  const [collapsed, setCollapsed] = useState(session.status !== "running");
  /** Signal to expand/collapse all node rows within this session */
  const [nodeExpandSignal, setNodeExpandSignal] = useState(0);
  const nodesAllExpanded = nodeExpandSignal % 2 === 1;
  const { nodeIds, nodeLabels, nodeResults, nodeCosts, status } = session;
  const total = nodeIds.length;
  const completed = Object.values(nodeResults).filter(
    (v) => v === "done",
  ).length;
  const errors = Object.values(nodeResults).filter((v) => v === "error").length;
  const pct = total > 0 ? Math.round(((completed + errors) / total) * 100) : 0;
  const totalCost = Object.values(nodeCosts).reduce((sum, c) => sum + c, 0);

  const statusColor =
    status === "running"
      ? "text-blue-400"
      : status === "completed"
        ? "text-green-400"
        : status === "error"
          ? "text-orange-400"
          : "text-muted-foreground";
  const statusLabel =
    status === "running"
      ? "Running"
      : status === "completed"
        ? "Completed"
        : status === "error"
          ? "Has errors"
          : "Cancelled";

  const elapsed = Math.round(
    (Date.now() - new Date(session.startedAt).getTime()) / 1000,
  );
  const elapsedStr =
    elapsed >= 60
      ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
      : `${elapsed}s`;

  return (
    <div className="rounded-lg overflow-hidden border border-border/40 bg-card mb-0.5">
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer hover:bg-muted/60 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="text-muted-foreground/80 w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">
          {collapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </span>
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full flex-shrink-0",
            status === "running"
              ? "bg-blue-500 animate-pulse"
              : status === "completed"
                ? "bg-green-500"
                : status === "error"
                  ? "bg-orange-500"
                  : "bg-muted-foreground",
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium truncate text-foreground/90">
            {session.workflowName}
          </div>
          <div className="text-[9px] text-muted-foreground/70">
            {new Date(session.startedAt).toLocaleTimeString()}
            <span className="text-muted-foreground/60 ml-2">
              {elapsedStr} ago
            </span>
            {totalCost > 0 && (
              <span className="text-amber-400/70 ml-1">
                💰 ${totalCost.toFixed(4)}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (collapsed) setCollapsed(false);
            setNodeExpandSignal((s) => s + 1);
          }}
          className="rounded-md p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground transition-colors flex-shrink-0"
          title={nodesAllExpanded ? "Collapse all nodes" : "Expand all nodes"}
        >
          <ChevronsUpDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Status + controls */}
      <div className="flex items-center gap-2 px-2.5 pb-1.5">
        <span className={cn("text-[9px] font-medium", statusColor)}>
          {statusLabel}
        </span>
        <span className="text-[9px] text-muted-foreground/50">
          {completed + errors}/{total}
        </span>
        <div className="flex-1" />
        {status === "running" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="text-[9px] px-2 py-0.5 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Stop
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="px-2.5 pb-1.5">
            <div className="h-1 rounded-full bg-muted/50 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  errors > 0
                    ? "bg-orange-500"
                    : status === "completed"
                      ? "bg-green-500"
                      : "bg-blue-500",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <div className="px-1.5 pb-1.5 space-y-px">
            {nodeIds.map((nodeId) => (
              <NodeRow
                key={nodeId}
                nodeId={nodeId}
                label={nodeLabels[nodeId] || nodeId.slice(0, 8)}
                sessionResult={nodeResults[nodeId]}
                isSessionRunning={status === "running"}
                liveStatus={nodeStatuses[nodeId]}
                progress={progressMap[nodeId]}
                errorMessage={errorMessages[nodeId]}
                expandSignal={nodeExpandSignal}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Node Row ─────────────────────────────────────────────────────── */

function NodeRow({
  nodeId,
  label,
  sessionResult,
  isSessionRunning,
  liveStatus,
  progress,
  errorMessage,
  expandSignal,
}: {
  nodeId: string;
  label: string;
  sessionResult: "running" | "done" | "error";
  isSessionRunning: boolean;
  liveStatus?: NodeStatus;
  progress?: { progress: number; message?: string };
  errorMessage?: string;
  expandSignal: number;
}) {
  const [expanded, setExpanded] = useState(false);

  // React to expand/collapse all signal from parent SessionCard
  useEffect(() => {
    if (expandSignal === 0) return;
    setExpanded(expandSignal % 2 === 1);
  }, [expandSignal]);
  const [record, setRecord] = useState<NodeExecutionRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const lastResults = useExecutionStore((s) => s.lastResults[nodeId] ?? []);
  const hasLastResult =
    lastResults.length > 0 && (lastResults[0].urls?.length ?? 0) > 0;
  const isLiveRunning = isSessionRunning && liveStatus === "running";
  const isDone = sessionResult === "done" || sessionResult === "error";
  const displayError =
    errorMessage ??
    ((record?.resultMetadata as Record<string, unknown> | undefined)?.error as
      | string
      | undefined);

  useEffect(() => {
    if (!expanded || !isDone || record) return;
    setLoading(true);
    historyIpc
      .list(nodeId)
      .then((records) => {
        if (records?.length) setRecord(records[0]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [expanded, isDone, nodeId, record]);

  return (
    <div className="rounded overflow-hidden">
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors rounded-lg",
          expanded ? "bg-muted/60" : "hover:bg-muted/40",
        )}
        onClick={() => isDone && setExpanded(!expanded)}
      >
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full flex-shrink-0",
            isLiveRunning
              ? "bg-blue-500 animate-pulse"
              : sessionResult === "done"
                ? "bg-green-500"
                : sessionResult === "error"
                  ? "bg-red-500"
                  : "bg-muted-foreground/20",
          )}
        />
        <span className="text-[10px] truncate flex-1 min-w-0 text-foreground/80">
          {label}
        </span>
        {isLiveRunning && progress && (
          <span className="text-[9px] text-blue-400">
            {Math.round(progress.progress)}%
          </span>
        )}
        {isLiveRunning && !progress && (
          <span className="text-[9px] text-blue-400 animate-pulse">...</span>
        )}
        {!isLiveRunning && sessionResult === "done" && (
          <span className="text-[9px] text-green-400/80">done</span>
        )}
        {!isLiveRunning && sessionResult === "error" && (
          <span className="text-[9px] text-red-400/80">error</span>
        )}
        {isDone && (
          <span className="text-muted-foreground/60 ml-0.5 flex-shrink-0">
            {expanded ? (
              <ChevronDown className="w-2.5 h-2.5" />
            ) : (
              <ChevronRight className="w-2.5 h-2.5" />
            )}
          </span>
        )}
      </div>

      {sessionResult === "error" && errorMessage && (
        <div
          className="mx-2 mt-0.5 mb-1 px-2 py-1 rounded border border-red-500/20 bg-red-500/5 text-[9px] text-red-400/80 leading-tight break-words line-clamp-2"
          title={errorMessage}
        >
          {errorMessage}
        </div>
      )}

      {expanded && (
        <div className="mx-1.5 mb-1 rounded border border-border/40 bg-background overflow-hidden">
          {loading && (
            <div className="p-2 text-[9px] text-muted-foreground/60 animate-pulse text-center">
              Loading...
            </div>
          )}
          {!loading && record && (
            <NodeIODetail record={record} liveErrorMessage={errorMessage} />
          )}
          {!loading && !record && (
            <div className="p-2 text-[9px] text-muted-foreground/60">
              {sessionResult === "error" ? (
                <div>
                  <div className="text-[9px] text-red-400 font-semibold uppercase tracking-wider mb-1">
                    Error
                  </div>
                  <div className="text-red-400/80 whitespace-pre-wrap break-words p-1.5 rounded bg-red-500/5">
                    {displayError || "Execution failed."}
                  </div>
                </div>
              ) : hasLastResult ? (
                <LastResultOutput nodeId={nodeId} />
              ) : (
                <div className="text-center">No data</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Node I/O Detail ──────────────────────────────────────────────── */

function NodeIODetail({
  record,
  liveErrorMessage,
}: {
  record: NodeExecutionRecord;
  liveErrorMessage?: string;
}) {
  const meta = record.resultMetadata as Record<string, unknown> | null;
  const resultUrls =
    (meta?.resultUrls as string[]) ??
    (record.resultPath ? [record.resultPath] : []);
  const error = liveErrorMessage ?? (meta?.error as string | undefined);
  const modelId = meta?.modelId as string | undefined;
  const raw = meta?.raw as Record<string, unknown> | undefined;

  return (
    <div className="text-[10px]">
      <div className="flex items-center gap-2 px-2.5 py-1 bg-muted/20 border-b border-border/30 text-muted-foreground/70 text-[9px]">
        {record.durationMs != null && (
          <span>⏱ {(record.durationMs / 1000).toFixed(1)}s</span>
        )}
        <span>💰 ${record.cost.toFixed(4)}</span>
        {modelId && <span className="truncate">{modelId}</span>}
      </div>
      {resultUrls.length > 0 && (
        <div className="px-2.5 py-1.5">
          <OutputPreview urls={resultUrls} label="Output" />
        </div>
      )}
      {error && (
        <div className="px-2.5 pb-1.5">
          <div className="text-[9px] text-red-400 font-semibold uppercase tracking-wider mb-0.5">
            Error
          </div>
          <div className="text-red-400/80 p-1.5 rounded bg-red-500/5 leading-tight whitespace-pre-wrap break-words max-h-[150px] overflow-y-auto">
            {error}
          </div>
        </div>
      )}
      {raw && (
        <div className="px-2.5 pb-1.5 border-t border-border/30 pt-1.5">
          <div className="text-[9px] text-blue-400 font-semibold uppercase tracking-wider mb-0.5">
            Input
          </div>
          <pre className="text-[8px] text-foreground/50 font-mono bg-muted/10 rounded p-1.5 overflow-x-auto max-h-[100px] overflow-y-auto whitespace-pre-wrap break-all">
            {JSON.stringify(raw, null, 2).slice(0, 800)}
          </pre>
        </div>
      )}
    </div>
  );
}
