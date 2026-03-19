/**
 * IteratorNodeContainer — ReactFlow custom node for the Iterator container.
 *
 * Exposed params appear as "capsule" handles on the left/right border:
 *   [●──param name──●]
 *
 * IN capsules (left border):
 *   Left dot  = external target (outside nodes connect here)
 *   Right dot = internal source (auto-connected to child node input)
 *
 * OUT capsules (right border):
 *   Left dot  = internal target (auto-connected from child node output)
 *   Right dot = external source (outside nodes connect from here)
 *
 * When a param is exposed via the picker, an internal edge is auto-created
 * between the capsule's inner handle and the child node's corresponding handle.
 */
import React, {
  memo,
  useCallback,
  useRef,
  useState,
  useMemo,
  useEffect,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Handle,
  Position,
  useReactFlow,
  useUpdateNodeInternals,
  type NodeProps,
} from "reactflow";
import { useWorkflowStore } from "../../../stores/workflow.store";
import { useUIStore } from "../../../stores/ui.store";
import { useExecutionStore } from "../../../stores/execution.store";
import type { PortDefinition } from "@/workflow/types/node-defs";
import type { NodeStatus } from "@/workflow/types/execution";
import type { ExposedParam } from "@/workflow/types/workflow";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ChevronDown, ChevronUp, Pencil, FolderInput } from "lucide-react";
import { ImportWorkflowDialog } from "../ImportWorkflowDialog";
import { Button } from "@/components/ui/button";

/* ── constants ─────────────────────────────────────────────────────── */

const MIN_ITERATOR_WIDTH = 600;
const MIN_ITERATOR_HEIGHT = 400;
const CHILD_PADDING = 40;
const TITLE_BAR_HEIGHT = 40;
const CAPSULE_HEIGHT = 28;
const CAPSULE_GAP = 6;
const CAPSULE_TOP_OFFSET = TITLE_BAR_HEIGHT + 12;
const HANDLE_DOT = 10;
const CAPSULE_LABEL_WIDTH = 110; // fixed width for capsule label area

/* ── types ─────────────────────────────────────────────────────────── */

export interface IteratorNodeData {
  nodeType: string;
  label: string;
  params: Record<string, unknown>;
  childNodeIds?: string[];
  inputDefinitions?: PortDefinition[];
  outputDefinitions?: PortDefinition[];
  paramDefinitions?: unknown[];
}

/* ── Capsule handle style helpers ──────────────────────────────────── */

const dotStyle = (
  connected: boolean,
  side: "input" | "output" = "input",
): React.CSSProperties => ({
  width: HANDLE_DOT,
  height: HANDLE_DOT,
  borderRadius: "50%",
  border: "2px solid hsl(188 95% 43%)",
  background:
    side === "output"
      ? "hsl(188 95% 43%)"
      : connected
        ? "hsl(188 95% 43%)"
        : "hsl(var(--card))",
  minWidth: HANDLE_DOT,
  minHeight: HANDLE_DOT,
  position: "relative" as const,
  top: "auto",
  left: "auto",
  right: "auto",
  bottom: "auto",
  transform: "none",
  zIndex: 40,
});

/* ── main component ────────────────────────────────────────────────── */

function IteratorNodeContainerComponent({
  id,
  data,
  selected,
}: NodeProps<IteratorNodeData>) {
  const { t } = useTranslation();
  const nodeRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const updateNodeParams = useWorkflowStore((s) => s.updateNodeParams);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const workflowId = useWorkflowStore((s) => s.workflowId);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const edges = useWorkflowStore((s) => s.edges);
  const status = useExecutionStore(
    (s) => s.nodeStatuses[id] ?? "idle",
  ) as NodeStatus;
  const progress = useExecutionStore((s) => s.progressMap[id]);
  const errorMessage = useExecutionStore((s) => s.errorMessages[id]);
  const { runNode, cancelNode, retryNode, continueFrom } = useExecutionStore();
  const running = status === "running";

  const collapsed =
    (data.params?.__nodeCollapsed as boolean | undefined) ?? false;
  const shortId = id.slice(0, 8);

  const inputDefs = useMemo(() => {
    // Reconstruct from exposedInputs params (source of truth) to be resilient
    // against data.inputDefinitions being reset by other state updates
    try {
      const raw = data.params?.exposedInputs;
      const list: ExposedParam[] =
        typeof raw === "string"
          ? JSON.parse(raw)
          : Array.isArray(raw)
            ? raw
            : [];
      return list.map((ep): PortDefinition => {
        if (ep.alias) {
          return {
            key: ep.namespacedKey,
            label: ep.alias,
            dataType: ep.dataType,
            required: false,
          };
        }
        const readableParam = ep.paramKey
          .split("_")
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        // Use node label (or short ID) for disambiguation
        const nodeLabel = ep.subNodeLabel || ep.subNodeId.slice(0, 6);
        const shortLabel = nodeLabel.includes("/")
          ? nodeLabel.split("/").pop()!
          : nodeLabel;
        return {
          key: ep.namespacedKey,
          label: `${readableParam} · ${shortLabel}`,
          dataType: ep.dataType,
          required: false,
        };
      });
    } catch {
      return data.inputDefinitions ?? [];
    }
  }, [data.params?.exposedInputs, data.inputDefinitions]);

  const outputDefs = useMemo(() => {
    try {
      const raw = data.params?.exposedOutputs;
      const list: ExposedParam[] =
        typeof raw === "string"
          ? JSON.parse(raw)
          : Array.isArray(raw)
            ? raw
            : [];
      return list.map((ep): PortDefinition => {
        if (ep.alias) {
          return {
            key: ep.namespacedKey,
            label: ep.alias,
            dataType: ep.dataType,
            required: false,
          };
        }
        const readableParam = ep.paramKey
          .split("_")
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        const nodeLabel = ep.subNodeLabel || ep.subNodeId.slice(0, 6);
        const shortLabel = nodeLabel.includes("/")
          ? nodeLabel.split("/").pop()!
          : nodeLabel;
        return {
          key: ep.namespacedKey,
          label: `${readableParam} · ${shortLabel}`,
          dataType: ep.dataType,
          required: false,
        };
      });
    } catch {
      return data.outputDefinitions ?? [];
    }
  }, [data.params?.exposedOutputs, data.outputDefinitions]);
  const childNodeIds = data.childNodeIds ?? [];
  const hasChildren = childNodeIds.length > 0;

  /* ── Force ReactFlow to recalculate handle positions when ports change ── */
  const portFingerprint = useMemo(
    () =>
      inputDefs.map((d) => d.key).join(",") +
      "|" +
      outputDefs.map((d) => d.key).join(","),
    [inputDefs, outputDefs],
  );
  useEffect(() => {
    // After new handles render, tell ReactFlow to update its internal handle cache
    requestAnimationFrame(() => updateNodeInternals(id));
  }, [portFingerprint, id, updateNodeInternals]);

  /* ── Collapse toggle ───────────────────────────────────────────── */
  const setCollapsed = useCallback(
    (value: boolean) => {
      updateNodeParams(id, { ...data.params, __nodeCollapsed: value });
      // Hide/show child nodes when collapsing/expanding
      const childIds = data.childNodeIds ?? [];
      if (childIds.length > 0) {
        setNodes((nds) =>
          nds.map((n) =>
            childIds.includes(n.id) ? { ...n, hidden: value } : n,
          ),
        );
      }
    },
    [id, data.params, data.childNodeIds, updateNodeParams, setNodes],
  );
  const toggleCollapsed = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setCollapsed(!collapsed);
    },
    [collapsed, setCollapsed],
  );

  /* ── Effective size ─────────────────────────────────────────────── */
  const COMPACT_WIDTH = 320;
  const maxCapsules = Math.max(inputDefs.length, outputDefs.length);

  /* ── Sync child hidden state with collapsed ────────────────────── */
  useEffect(() => {
    const childIds = data.childNodeIds ?? [];
    if (childIds.length === 0) return;
    setNodes((nds) =>
      nds.map((n) =>
        childIds.includes(n.id) ? { ...n, hidden: collapsed } : n,
      ),
    );
  }, [collapsed, data.childNodeIds, setNodes]);

  /* ── Auto-expand: observe child DOM size changes ───────────────── */
  useEffect(() => {
    if (collapsed || childNodeIds.length === 0) return;
    const updateBB = useWorkflowStore.getState().updateBoundingBox;
    const observer = new ResizeObserver(() => {
      updateBB(id);
    });
    for (const cid of childNodeIds) {
      const el = document.querySelector(
        `[data-id="${cid}"]`,
      ) as HTMLElement | null;
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [id, childNodeIds, collapsed]);

  /* ── Actions ───────────────────────────────────────────────────── */
  const onRun = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (running) cancelNode(workflowId ?? "", id);
      else runNode(workflowId ?? "", id);
    },
    [running, workflowId, id, runNode, cancelNode],
  );

  const onRunFromHere = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      continueFrom(workflowId ?? "", id);
    },
    [workflowId, id, continueFrom],
  );

  const onDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      removeNode(id);
    },
    [removeNode, id],
  );

  /* ── Inline name editing ───────────────────────────────────────── */
  const startEditingName = useCallback(() => {
    setNameValue(data.label || "");
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  }, [data.label]);

  const commitName = useCallback(() => {
    setEditingName(false);
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== data.label) {
      updateNodeData(id, { label: trimmed });
    }
  }, [nameValue, data.label, id, updateNodeData]);

  const cancelEditingName = useCallback(() => {
    setEditingName(false);
  }, []);

  /* ── Capsule vertical position ─────────────────────────────────── */
  const getCapsuleTop = (index: number) =>
    CAPSULE_TOP_OFFSET + index * (CAPSULE_HEIGHT + CAPSULE_GAP);

  /* ── Exposed param lookup — maps namespacedKey → ExposedParam for tooltip info ── */
  const exposedParamMap = useMemo(() => {
    const map = new Map<string, ExposedParam>();
    for (const key of ["exposedInputs", "exposedOutputs"] as const) {
      try {
        const raw = data.params?.[key];
        const list: ExposedParam[] =
          typeof raw === "string"
            ? JSON.parse(raw)
            : Array.isArray(raw)
              ? raw
              : [];
        for (const ep of list) map.set(ep.namespacedKey, ep);
      } catch {
        /* ignore */
      }
    }
    return map;
  }, [data.params]);

  /* ── Check if a handle has a connected edge ────────────────────── */
  const isHandleConnected = useCallback(
    (handleId: string, type: "source" | "target") =>
      edges.some((e) =>
        type === "source"
          ? e.source === id && e.sourceHandle === handleId
          : e.target === id && e.targetHandle === handleId,
      ),
    [edges, id],
  );

  /* ── Drop target hint ────────────────────────────────────────────── */
  const dropTarget = useUIStore((s) => s.iteratorDropTarget);
  const isAdoptTarget =
    dropTarget?.iteratorId === id && dropTarget.mode === "adopt";
  const isReleaseTarget =
    dropTarget?.iteratorId === id && dropTarget.mode === "release";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
      }}
      className="relative"
    >
      {/* Invisible hover extension above */}
      <div className="absolute -top-10 left-0 right-0 h-10" />

      {/* ── Hover toolbar ──────────────────────────────────────── */}
      {hovered && (
        <div className="absolute -top-9 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1">
          {running ? (
            <button
              onClick={onRun}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-medium shadow-lg backdrop-blur-sm bg-red-500 text-white hover:bg-red-600 transition-all"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              {t("workflow.stop", "Stop")}
            </button>
          ) : (
            <>
              <button
                onClick={onRun}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-medium shadow-lg backdrop-blur-sm bg-blue-500 text-white hover:bg-blue-600 transition-all whitespace-nowrap"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <polygon points="6,3 20,12 6,21" />
                </svg>
                {t("workflow.run", "Run")}
              </button>
              <button
                onClick={onRunFromHere}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-medium shadow-lg backdrop-blur-sm bg-green-600 text-white hover:bg-green-700 transition-all whitespace-nowrap"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <polygon points="4,4 14,12 4,20" />
                  <polygon points="12,4 22,12 12,20" />
                </svg>
                {t("workflow.runFromHere", "Run from here")}
              </button>
              <button
                onClick={onDelete}
                className="flex items-center justify-center w-8 h-8 rounded-full shadow-lg backdrop-blur-sm bg-[hsl(var(--muted))] text-muted-foreground hover:bg-red-500/20 hover:text-red-400 transition-all"
                title={t("workflow.delete", "Delete")}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Main container ─────────────────────────────────────── */}
      <div
        ref={nodeRef}
        className={`
          relative rounded-xl overflow-visible
          text-[hsl(var(--card-foreground))]
          transition-all duration-200
          ${isAdoptTarget || isReleaseTarget ? "animate-group-breathe" : ""}
          ${isAdoptTarget ? "border-[3px] border-solid border-blue-400 shadow-[0_0_30px_rgba(59,130,246,.4)] bg-blue-500/8" : ""}
          ${isReleaseTarget ? "border-[3px] border-solid border-orange-400 shadow-[0_0_30px_rgba(251,146,60,.4)] bg-orange-500/8" : ""}
          ${!isAdoptTarget && !isReleaseTarget ? "border border-solid bg-[hsl(var(--card))]" : ""}
          ${!isAdoptTarget && !isReleaseTarget && running ? "border-blue-500 animate-pulse-subtle" : ""}
          ${!isAdoptTarget && !isReleaseTarget && !running && selected ? "border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,.25)] ring-1 ring-cyan-500/30" : ""}
          ${!isAdoptTarget && !isReleaseTarget && !running && !selected && status === "confirmed" ? "border-green-500/70" : ""}
          ${!isAdoptTarget && !isReleaseTarget && !running && !selected && status === "unconfirmed" ? "border-orange-500/70" : ""}
          ${!isAdoptTarget && !isReleaseTarget && !running && !selected && status === "error" ? "border-red-500/70" : ""}
          ${!isAdoptTarget && !isReleaseTarget && !running && !selected && (status === "idle" || !status) ? (hovered ? "border-cyan-500/40 shadow-lg" : "border-[hsl(var(--muted-foreground)/0.3)]") : ""}
        `}
        style={{
          width: COMPACT_WIDTH,
          ...(collapsed
            ? { height: TITLE_BAR_HEIGHT, overflow: "hidden" }
            : {}),
          fontSize: 13,
        }}
      >
        {/* ── Title bar ──────────────────────────────────────── */}
        <div
          className={`flex items-center gap-1.5 px-3 select-none rounded-t-xl border-b border-[hsl(var(--border)/0.5)]
            ${running ? "bg-blue-500/10" : status === "confirmed" ? "bg-green-500/8" : status === "error" ? "bg-red-500/8" : "bg-[hsl(var(--card)/0.6)]"}`}
          style={{ height: TITLE_BAR_HEIGHT }}
        >
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${running ? "bg-blue-500 animate-pulse" : status === "confirmed" ? "bg-green-500" : status === "error" ? "bg-red-500" : status === "unconfirmed" ? "bg-orange-500" : "bg-[hsl(var(--muted-foreground))] opacity-30"}`}
          />
          <button
            type="button"
            onClick={toggleCollapsed}
            className="nodrag nopan flex-shrink-0 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            title={
              collapsed
                ? t("workflow.expandNode", "Expand")
                : t("workflow.collapseNode", "Collapse")
            }
          >
            {collapsed ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
          <div className="rounded-md bg-cyan-500/15 p-1 flex-shrink-0">
            <svg
              className="w-3.5 h-3.5 text-cyan-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </div>
          {editingName ? (
            <input
              ref={nameInputRef}
              className="nodrag nopan font-semibold text-[13px] bg-transparent border-b border-cyan-500/50 outline-none px-0 py-0 min-w-[60px] max-w-[140px] text-foreground"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") cancelEditingName();
              }}
              autoFocus
            />
          ) : (
            <span
              className="font-semibold text-[13px] truncate cursor-text"
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEditingName();
              }}
              title={t(
                "workflow.doubleClickToRename",
                "Double-click to rename",
              )}
            >
              {data.label || t("workflow.group", "Group")}
            </span>
          )}
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] opacity-50 font-mono flex-shrink-0">
            {shortId}
          </span>
          {/* Drop target capsule tag */}
          {isAdoptTarget && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/20 text-blue-400 border border-blue-400/30 animate-pulse">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              {t("workflow.dropToAddToGroup", "Release to add to Group")}
            </span>
          )}
          {isReleaseTarget && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/20 text-orange-400 border border-orange-400/30 animate-pulse">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
              {t(
                "workflow.dropToRemoveFromGroup",
                "Release to remove from Group",
              )}
            </span>
          )}
          <div className="flex-1" />
        </div>

        {/* ── Running progress bar ───────────────────────────── */}
        {running && !collapsed && (
          <div className="px-3 py-1.5 bg-blue-500/5">
            <div className="flex items-center gap-2 mb-1">
              <svg
                className="animate-spin flex-shrink-0 text-blue-400"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  strokeDasharray="60"
                  strokeDashoffset="20"
                />
              </svg>
              <span className="text-[11px] text-blue-400 font-medium flex-1">
                {progress?.message || t("workflow.running", "Running...")}
              </span>
              {progress && (
                <span className="text-[10px] text-blue-400/70">
                  {Math.round(progress.progress)}%
                </span>
              )}
            </div>
            <div className="h-1.5 rounded-full bg-blue-500/20 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300 ease-out rounded-full"
                style={{ width: `${progress?.progress ?? 0}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Error details + Retry ──────────────────────────── */}
        {status === "error" && errorMessage && !collapsed && (
          <div className="px-3 py-1.5 bg-red-500/5">
            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <span className="text-red-400 text-[10px] mt-0.5 flex-shrink-0">
                ⚠
              </span>
              <span
                className="text-[10px] text-red-400/90 leading-tight line-clamp-3 break-words flex-1"
                title={errorMessage}
              >
                {errorMessage}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (workflowId) retryNode(workflowId, id);
                }}
                className="text-[10px] text-red-400 font-medium hover:text-red-300 transition-colors flex items-center gap-1 flex-shrink-0 ml-1"
                title={t("workflow.retry", "Retry")}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                {t("workflow.retry", "Retry")}
              </button>
            </div>
          </div>
        )}

        {/* ── Compact body: child summary + action buttons ── */}
        {!collapsed && (
          <div
            className="px-2.5 py-1.5 flex flex-col gap-1"
            style={{
              marginTop:
                maxCapsules > 0
                  ? maxCapsules * (CAPSULE_HEIGHT + CAPSULE_GAP) + 4
                  : 0,
            }}
          >
            {/* Child count summary */}
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-cyan-500/60"
              >
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
              <span>
                {hasChildren
                  ? t("workflow.childNodesCount", "{{count}} child node(s)", {
                      count: childNodeIds.length,
                    })
                  : t("workflow.iteratorEmpty", "No child nodes yet")}
              </span>
            </div>

            {/* Action buttons */}
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  useUIStore.getState().enterGroupEdit(id);
                }}
                className="nodrag nopan flex-1 h-7 text-[10px] gap-1 bg-cyan-500/10 text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/20 hover:border-cyan-500/40"
              >
                <Pencil className="w-2.5 h-2.5" />
                {t("workflow.editSubgraph", "Edit Subgraph")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowImportDialog(true);
                }}
                className="nodrag nopan flex-1 h-7 text-[10px] gap-1"
              >
                <FolderInput className="w-2.5 h-2.5" />
                {t("workflow.importWorkflow", "Import Workflow")}
              </Button>
            </div>
          </div>
        )}

        {/* Import workflow dialog */}
        {showImportDialog && (
          <ImportWorkflowDialog
            groupId={id}
            onClose={() => setShowImportDialog(false)}
          />
        )}

        {/* Collapsed child count */}
        {collapsed && hasChildren && (
          <div className="px-3 py-1 text-[10px] text-muted-foreground/60">
            {t("workflow.childNodesCount", "{{count}} child node(s)", {
              count: childNodeIds.length,
            })}
          </div>
        )}

        {/* Resize handles removed — compact view doesn't need resizing */}
      </div>

      {/* ── LEFT SIDE: exposed input capsules ──────────────────── */}
      {!collapsed &&
        inputDefs.map((port, i) => {
          const top = getCapsuleTop(i);
          const extHandleId = `input-${port.key}`;
          const intHandleId = `input-inner-${port.key}`;
          const extConnected = isHandleConnected(extHandleId, "target");
          const ep = exposedParamMap.get(port.key);
          const tooltipText = ep
            ? `${ep.paramKey
                .split("_")
                .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" ")} — ${ep.subNodeLabel}`
            : port.label;
          return (
            <React.Fragment key={`cap-in-${port.key}`}>
              {/* External target handle — on the left border */}
              <Handle
                type="target"
                position={Position.Left}
                id={extHandleId}
                style={{
                  ...dotStyle(extConnected),
                  position: "absolute",
                  top: top + CAPSULE_HEIGHT / 2,
                  left: -HANDLE_DOT / 2,
                  transform: "translateY(-50%)",
                }}
              />
              {/* Capsule label */}
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <div
                    className="absolute pointer-events-auto flex items-center"
                    style={{
                      top: top,
                      left: HANDLE_DOT,
                      width: CAPSULE_LABEL_WIDTH,
                      height: CAPSULE_HEIGHT,
                      zIndex: 45,
                    }}
                  >
                    <div
                      className="rounded-full bg-[hsl(var(--card))] border border-cyan-500/40 px-2.5 flex items-center w-full"
                      style={{ height: CAPSULE_HEIGHT - 4 }}
                    >
                      <span className="text-[11px] text-foreground font-medium whitespace-nowrap select-none truncate">
                        {port.label}
                      </span>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {tooltipText}
                </TooltipContent>
              </Tooltip>
              {/* Internal source handle — hidden but kept for auto-edge wiring */}
              <Handle
                type="source"
                position={Position.Right}
                id={intHandleId}
                style={{
                  position: "absolute",
                  top: top + CAPSULE_HEIGHT / 2,
                  left: HANDLE_DOT + CAPSULE_LABEL_WIDTH + 4,
                  transform: "translateY(-50%)",
                  width: 1,
                  height: 1,
                  opacity: 0,
                  pointerEvents: "none",
                }}
              />
            </React.Fragment>
          );
        })}

      {/* ── RIGHT SIDE: exposed output capsules ──────────────────── */}
      {!collapsed &&
        outputDefs.map((port, i) => {
          const top = getCapsuleTop(i);
          const intHandleId = `output-inner-${port.key}`;
          const extHandleId = `output-${port.key}`;
          const extConnected = isHandleConnected(extHandleId, "source");
          const ep = exposedParamMap.get(port.key);
          const tooltipText = ep
            ? `${ep.paramKey
                .split("_")
                .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" ")} — ${ep.subNodeLabel}`
            : port.label;
          // Compute left-based positions so ReactFlow handle lookup is reliable
          const capsuleLabelLeft =
            COMPACT_WIDTH - HANDLE_DOT - CAPSULE_LABEL_WIDTH;
          const extHandleLeft = COMPACT_WIDTH - HANDLE_DOT / 2;
          return (
            <React.Fragment key={`cap-out-${port.key}`}>
              {/* Internal target handle — hidden but kept for auto-edge wiring */}
              <Handle
                type="target"
                position={Position.Left}
                id={intHandleId}
                style={{
                  position: "absolute",
                  top: top + CAPSULE_HEIGHT / 2,
                  left: capsuleLabelLeft - HANDLE_DOT - 4,
                  transform: "translateY(-50%)",
                  width: 1,
                  height: 1,
                  opacity: 0,
                  pointerEvents: "none",
                }}
              />
              {/* Capsule label */}
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <div
                    className="absolute pointer-events-auto flex items-center justify-end"
                    style={{
                      top: top,
                      left: capsuleLabelLeft,
                      width: CAPSULE_LABEL_WIDTH,
                      height: CAPSULE_HEIGHT,
                      zIndex: 45,
                    }}
                  >
                    <div
                      className="rounded-full bg-[hsl(var(--card))] border border-cyan-500/40 px-2.5 flex items-center justify-end w-full"
                      style={{ height: CAPSULE_HEIGHT - 4 }}
                    >
                      <span className="text-[11px] text-foreground font-medium whitespace-nowrap select-none truncate text-right">
                        {port.label}
                      </span>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {tooltipText}
                </TooltipContent>
              </Tooltip>
              {/* External source handle — on the right border */}
              <Handle
                type="source"
                position={Position.Right}
                id={extHandleId}
                style={{
                  ...dotStyle(extConnected, "output"),
                  position: "absolute",
                  top: top + CAPSULE_HEIGHT / 2,
                  left: extHandleLeft,
                  transform: "translateY(-50%)",
                }}
              />
            </React.Fragment>
          );
        })}

      {/* ── External "+" button — right side ── */}
      {(hovered || selected) && (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="nodrag nopan absolute z-40 flex items-center justify-center w-6 h-6 rounded-full shadow-lg backdrop-blur-sm bg-cyan-500 text-white hover:bg-cyan-600 hover:scale-110 transition-all duration-150"
              style={{
                top: 15,
                right: -12,
              }}
              onClick={(e) => {
                e.stopPropagation();
                const rect = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                window.dispatchEvent(
                  new CustomEvent("workflow:open-add-node-menu", {
                    detail: {
                      x: rect.right,
                      y: rect.top + rect.height / 2,
                      sourceNodeId: id,
                      side: "right",
                    },
                  }),
                );
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {t("workflow.addDownstreamNode", "Add Downstream Node")}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export default memo(IteratorNodeContainerComponent);
export { MIN_ITERATOR_WIDTH, MIN_ITERATOR_HEIGHT, CHILD_PADDING };
