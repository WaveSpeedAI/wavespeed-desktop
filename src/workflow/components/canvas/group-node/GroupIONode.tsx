/**
 * GroupIONode — card-style proxy nodes for subgraph editing mode.
 *
 * Each IO node is a draggable card with:
 *   - Distinctive gradient accent strip + tinted background
 *   - Built-in parameter picker (Configure button expands inline config)
 *   - Per-param rename & remove buttons on hover
 *   - Properly positioned ReactFlow handles for edge connections
 *
 * Group Input:  source handles on RIGHT → feeds data into child nodes
 * Group Output: target handles on LEFT  → collects data from child nodes
 *
 * These nodes are draggable but cannot be deleted or created from the palette.
 */
import { memo, useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from "reactflow";
import { useTranslation } from "react-i18next";
import { useWorkflowStore } from "../../../stores/workflow.store";
import type { ExposedParam } from "@/workflow/types/workflow";
import type { PortDefinition } from "@/workflow/types/node-defs";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  ChevronDown,
  ChevronRight,
  Settings2,
  ArrowRightFromLine,
  ArrowLeftToLine,
  Pencil,
  Trash2,
  Check,
} from "lucide-react";

/* ── constants ─────────────────────────────────────────────────────── */

const HANDLE_SIZE = 12;
const PORT_ROW_HEIGHT = 42;
const HEADER_HEIGHT = 44;
const ACCENT_STRIP_HEIGHT = 3;
const NODE_WIDTH = 260;
const NODE_WIDTH_OUTPUT = 280;
/** Border width (2px each side) */
const BORDER_W = 2;

/* ── types ─────────────────────────────────────────────────────────── */

export interface GroupIONodeData {
  direction: "input" | "output";
  exposedParams: ExposedParam[];
  groupId: string;
}

/* ── Data type color dot ───────────────────────────────────────────── */

const DATA_TYPE_COLORS: Record<string, string> = {
  image: "bg-blue-400",
  video: "bg-purple-400",
  audio: "bg-amber-400",
  text: "bg-slate-400",
  any: "bg-gray-400",
};

function DataTypeDot({ dataType }: { dataType?: string }) {
  const color = DATA_TYPE_COLORS[dataType ?? "any"] ?? DATA_TYPE_COLORS.any;
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full ${color} flex-shrink-0 opacity-60`}
    />
  );
}

/* ── Inline param picker ───────────────────────────────────────────── */

function InlineParamPicker({
  groupId,
  direction,
}: {
  groupId: string;
  direction: "input" | "output";
}) {
  const { t } = useTranslation();
  const nodes = useWorkflowStore((s) => s.nodes);
  const exposeParam = useWorkflowStore((s) => s.exposeParam);
  const unexposeParam = useWorkflowStore((s) => s.unexposeParam);

  const groupNode = nodes.find((n) => n.id === groupId);
  const groupParams = (groupNode?.data?.params ?? {}) as Record<
    string,
    unknown
  >;
  const childNodes = nodes.filter((n) => n.parentNode === groupId);

  const exposedList: ExposedParam[] = useMemo(() => {
    const key = direction === "input" ? "exposedInputs" : "exposedOutputs";
    try {
      const raw = groupParams[key];
      return typeof raw === "string"
        ? JSON.parse(raw)
        : Array.isArray(raw)
          ? raw
          : [];
    } catch {
      return [];
    }
  }, [groupParams, direction]);

  const isExposed = useCallback(
    (subNodeId: string, paramKey: string) =>
      exposedList.some(
        (p) => p.subNodeId === subNodeId && p.paramKey === paramKey,
      ),
    [exposedList],
  );

  const handleToggle = useCallback(
    (
      subNodeId: string,
      subNodeLabel: string,
      paramKey: string,
      dataType: string,
    ) => {
      if (isExposed(subNodeId, paramKey)) {
        const ep = exposedList.find(
          (p) => p.subNodeId === subNodeId && p.paramKey === paramKey,
        );
        if (ep) unexposeParam(groupId, ep.namespacedKey, direction);
      } else {
        exposeParam(groupId, {
          subNodeId,
          subNodeLabel,
          paramKey,
          namespacedKey: `${subNodeId}.${paramKey}`,
          direction,
          dataType: dataType as ExposedParam["dataType"],
        });
      }
    },
    [isExposed, exposedList, exposeParam, unexposeParam, groupId, direction],
  );

  const isInput = direction === "input";

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(),
  );
  const toggleSection = useCallback((nodeId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId);
      return next;
    });
  }, []);

  return (
    <div className="nodrag nopan overflow-y-auto px-2 py-2 space-y-1 max-h-[50vh]">
      {childNodes.length === 0 ? (
        <p className="text-[10px] text-muted-foreground px-1 py-3 text-center">
          {t(
            "workflow.noChildNodes",
            "Add child nodes first to expose their parameters",
          )}
        </p>
      ) : (
        childNodes.map((child) => {
          const fullLabel = String(child.data?.label ?? child.id.slice(0, 8));
          const shortId = child.id.slice(0, 6);
          const childInputDefs = (child.data?.inputDefinitions ??
            []) as PortDefinition[];
          const childOutputDefs = (child.data?.outputDefinitions ??
            []) as PortDefinition[];
          const modelSchema = (child.data?.modelInputSchema ?? []) as Array<{
            name: string;
            label?: string;
            type?: string;
            mediaType?: string;
          }>;
          const paramDefs = (child.data?.paramDefinitions ?? []) as Array<{
            key: string;
            label: string;
            dataType?: string;
          }>;

          let items: Array<{ key: string; label: string; dataType: string }>;
          if (direction === "input") {
            const modelItems = modelSchema.map((m) => ({
              key: m.name,
              label:
                m.label ||
                m.name
                  .split("_")
                  .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(" "),
              dataType: m.mediaType ?? m.type ?? "any",
            }));
            const inputPortItems = childInputDefs.map((d) => ({
              key: d.key,
              label: d.label,
              dataType: d.dataType,
            }));
            if (modelItems.length === 0) {
              const visibleParams = paramDefs
                .filter((d) => !d.key.startsWith("__") && d.key !== "modelId")
                .map((d) => ({
                  key: d.key,
                  label: d.label,
                  dataType: d.dataType ?? "any",
                }));
              items = [...visibleParams, ...inputPortItems];
            } else {
              items = [...modelItems, ...inputPortItems];
            }
          } else {
            items = childOutputDefs.map((d) => ({
              key: d.key,
              label: d.label,
              dataType: d.dataType,
            }));
          }
          if (items.length === 0) return null;

          const exposedCount = items.filter((it) =>
            isExposed(child.id, it.key),
          ).length;
          const isCollapsed = collapsedSections.has(child.id);

          return (
            <div
              key={child.id}
              className="rounded-lg overflow-hidden bg-black/[0.06] dark:bg-white/[0.04]"
            >
              <button
                onClick={() => toggleSection(child.id)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                )}
                <span className="text-[10px] font-semibold text-foreground/80 truncate flex-1 text-left">
                  {fullLabel}
                </span>
                {exposedCount > 0 && (
                  <span
                    className={`text-[9px] font-bold px-1.5 rounded-full ${isInput ? "bg-cyan-500/20 text-cyan-400" : "bg-emerald-500/20 text-emerald-400"}`}
                  >
                    {exposedCount}
                  </span>
                )}
                <span className="text-[8px] text-muted-foreground/30 font-mono flex-shrink-0">
                  {shortId}
                </span>
              </button>
              {!isCollapsed && (
                <div className="px-1 pb-1.5 space-y-0.5">
                  {items.map((item) => {
                    const exposed = isExposed(child.id, item.key);
                    return (
                      <button
                        key={`${child.id}-${item.key}`}
                        onClick={() =>
                          handleToggle(
                            child.id,
                            fullLabel,
                            item.key,
                            item.dataType,
                          )
                        }
                        className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[10px] transition-all ${
                          exposed
                            ? `text-foreground ${isInput ? "bg-cyan-500/10" : "bg-emerald-500/10"}`
                            : "text-foreground/40 hover:text-foreground/60 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                        }`}
                      >
                        <div
                          className={`w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center transition-all ${
                            exposed
                              ? isInput
                                ? "bg-cyan-500"
                                : "bg-emerald-500"
                              : "border border-muted-foreground/20"
                          }`}
                        >
                          {exposed && (
                            <Check
                              className="w-2 h-2 text-white"
                              strokeWidth={3}
                            />
                          )}
                        </div>
                        <span
                          className={`flex-1 text-left truncate ${exposed ? "font-medium" : ""}`}
                        >
                          {item.label}
                        </span>
                        <DataTypeDot dataType={item.dataType} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/* ── Main GroupIONode component ─────────────────────────────────────── */

function GroupIONodeComponent({ data, id }: NodeProps<GroupIONodeData>) {
  const { t } = useTranslation();
  const { direction, exposedParams, groupId } = data;
  const isInput = direction === "input";
  const [pickerOpen, setPickerOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const updateNodeInternals = useUpdateNodeInternals();

  const unexposeParam = useWorkflowStore((s) => s.unexposeParam);
  const updateAlias = useWorkflowStore((s) => s.updateExposedParamAlias);
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [aliasValue, setAliasValue] = useState("");
  const [hoveredPort, setHoveredPort] = useState<string | null>(null);

  const accentColor = isInput ? "hsl(188 95% 43%)" : "hsl(160 84% 39%)";

  const ports = useMemo(
    () =>
      exposedParams.map((ep) => {
        const label =
          ep.alias ||
          ep.paramKey
            .split("_")
            .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
        return { key: ep.namespacedKey, label, ep };
      }),
    [exposedParams],
  );

  // Force ReactFlow to recalculate handle positions when ports change
  const portFingerprint = useMemo(
    () => ports.map((p) => p.key).join(","),
    [ports],
  );
  useEffect(() => {
    requestAnimationFrame(() => updateNodeInternals(id));
  }, [portFingerprint, id, updateNodeInternals]);

  // Signal picker open state so SubgraphBreadcrumb ESC doesn't fire
  useEffect(() => {
    if (pickerOpen)
      document.body.setAttribute("data-subgraph-picker-open", "true");
    else document.body.removeAttribute("data-subgraph-picker-open");
    return () => {
      document.body.removeAttribute("data-subgraph-picker-open");
    };
  }, [pickerOpen]);

  // Click outside to close picker
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
      setPickerOpen(false);
    };
    const timer = setTimeout(
      () => document.addEventListener("mousedown", handler, true),
      0,
    );
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler, true);
    };
  }, [pickerOpen]);

  // ESC to close picker
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        setPickerOpen(false);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [pickerOpen]);

  const startAliasEdit = useCallback((nk: string, currentAlias: string) => {
    setEditingAlias(nk);
    setAliasValue(currentAlias);
  }, []);

  const commitAlias = useCallback(() => {
    if (editingAlias) {
      updateAlias(groupId, editingAlias, direction, aliasValue.trim());
      setEditingAlias(null);
    }
  }, [editingAlias, aliasValue, groupId, direction, updateAlias]);

  const handleRemoveParam = useCallback(
    (nk: string) => {
      unexposeParam(groupId, nk, direction);
    },
    [unexposeParam, groupId, direction],
  );

  /* Compute handle Y positions — handles are placed absolutely on the outer wrapper
     so ReactFlow can measure them correctly relative to the node root.
     Offset: accent strip (3px) + border (2px) + header height + row offset */
  const getHandleY = (index: number) =>
    ACCENT_STRIP_HEIGHT +
    BORDER_W +
    HEADER_HEIGHT +
    index * PORT_ROW_HEIGHT +
    PORT_ROW_HEIGHT / 2;

  return (
    <div
      ref={cardRef}
      className="relative"
      style={{ width: isInput ? NODE_WIDTH : NODE_WIDTH_OUTPUT }}
    >
      {/* ── Handles — absolutely positioned on the outer wrapper ── */}
      {ports.map((port, i) => (
        <Handle
          key={`handle-${port.key}`}
          type={isInput ? "source" : "target"}
          position={isInput ? Position.Right : Position.Left}
          id={`group-io-${port.key}`}
          style={{
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            borderRadius: "50%",
            border: `2px solid ${accentColor}`,
            background: accentColor,
            position: "absolute",
            top: getHandleY(i),
            ...(isInput
              ? { right: -(HANDLE_SIZE / 2) }
              : { left: -(HANDLE_SIZE / 2) }),
            transform: "translateY(-50%)",
            zIndex: 10,
          }}
        />
      ))}

      {/* ── Card body — fully opaque bg-card, no grid bleed-through ── */}
      <div
        className={`
          rounded-xl overflow-hidden
          border-2 transition-shadow duration-200
          bg-[hsl(var(--card))]
          ${
            isInput
              ? "border-cyan-500/40 shadow-[0_2px_20px_rgba(6,182,212,0.08)] hover:shadow-[0_4px_28px_rgba(6,182,212,0.15)] hover:border-cyan-500/60"
              : "border-emerald-500/40 shadow-[0_2px_20px_rgba(16,185,129,0.08)] hover:shadow-[0_4px_28px_rgba(16,185,129,0.15)] hover:border-emerald-500/60"
          }
        `}
      >
        {/* ── Top accent strip ── */}
        <div
          className={
            isInput
              ? "bg-gradient-to-r from-cyan-500 to-cyan-400"
              : "bg-gradient-to-r from-emerald-500 to-emerald-400"
          }
          style={{ height: ACCENT_STRIP_HEIGHT }}
        />

        {/* ── Header — tinted overlay on top of opaque card bg ── */}
        <div
          className="flex items-center gap-2 px-3 select-none"
          style={{
            height: HEADER_HEIGHT,
            background: isInput
              ? "linear-gradient(to bottom, rgba(6,182,212,0.13), rgba(6,182,212,0.04))"
              : "linear-gradient(to bottom, rgba(16,185,129,0.13), rgba(16,185,129,0.04))",
          }}
        >
          <div
            className={`rounded-md p-1 flex-shrink-0 ${isInput ? "bg-cyan-500/15" : "bg-emerald-500/15"}`}
          >
            {isInput ? (
              <ArrowRightFromLine
                className="w-3.5 h-3.5 text-cyan-400"
                strokeWidth={2.5}
              />
            ) : (
              <ArrowLeftToLine
                className="w-3.5 h-3.5 text-emerald-400"
                strokeWidth={2.5}
              />
            )}
          </div>

          <span
            className={`text-[12px] font-bold tracking-wide flex-1 min-w-0 truncate ${isInput ? "text-cyan-500 dark:text-cyan-400" : "text-emerald-600 dark:text-emerald-400"}`}
          >
            {isInput
              ? t("workflow.groupInput", "Group Input")
              : t("workflow.groupOutput", "Group Output")}
          </span>

          {ports.length > 0 && (
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${isInput ? "bg-cyan-500/15 text-cyan-500 dark:text-cyan-400" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"}`}
            >
              {ports.length}
            </span>
          )}

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                className={`
                  nodrag nopan flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-all flex-shrink-0
                  ${
                    pickerOpen
                      ? isInput
                        ? "bg-cyan-500 border-cyan-500 text-white"
                        : "bg-emerald-500 border-emerald-500 text-white"
                      : isInput
                        ? "bg-cyan-500 border-cyan-500 text-white hover:bg-cyan-600 hover:border-cyan-600"
                        : "bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600 hover:border-emerald-600"
                  }
                `}
                onClick={(e) => {
                  e.stopPropagation();
                  setPickerOpen(!pickerOpen);
                }}
              >
                <Settings2 className="w-3 h-3" />
                <span>
                  {pickerOpen
                    ? t("workflow.done", "Done")
                    : t("workflow.configure", "Configure")}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {t("workflow.configureParams", "Configure parameters")}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* ── Separator line between header and ports ── */}
        {(ports.length > 0 || pickerOpen) && (
          <div
            className={`mx-2 h-px ${isInput ? "bg-cyan-500/15" : "bg-emerald-500/15"}`}
          />
        )}

        {/* ── Port list ───────────────────────────────────────── */}
        {ports.length === 0 && !pickerOpen ? (
          <div className="flex items-center justify-center py-5 px-3">
            <button
              className={`
                nodrag nopan flex items-center gap-1.5 text-[11px] font-medium px-4 py-2 rounded-lg
                border border-dashed transition-all
                ${
                  isInput
                    ? "border-cyan-500/30 text-cyan-500/70 dark:text-cyan-400/70 hover:border-cyan-500/50 hover:text-cyan-500 dark:hover:text-cyan-400 hover:bg-cyan-500/5"
                    : "border-emerald-500/30 text-emerald-600/70 dark:text-emerald-400/70 hover:border-emerald-500/50 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-500/5"
                }
              `}
              onClick={(e) => {
                e.stopPropagation();
                setPickerOpen(true);
              }}
            >
              <Settings2 className="w-3.5 h-3.5" />
              {isInput
                ? t("workflow.addInputs", "Add Inputs")
                : t("workflow.addOutputs", "Add Outputs")}
            </button>
          </div>
        ) : ports.length > 0 ? (
          <div className="py-1">
            {ports.map((port) => {
              const isEditing = editingAlias === port.ep.namespacedKey;
              const isHovered = hoveredPort === port.key;

              return (
                <div
                  key={port.key}
                  className={`
                    relative flex items-center transition-colors
                    ${
                      isHovered
                        ? isInput
                          ? "bg-cyan-500/[0.06]"
                          : "bg-emerald-500/[0.06]"
                        : ""
                    }
                  `}
                  style={{ height: PORT_ROW_HEIGHT }}
                  onMouseEnter={() => setHoveredPort(port.key)}
                  onMouseLeave={() => setHoveredPort(null)}
                >
                  {/* Active indicator bar */}
                  <div
                    className={`absolute top-1 bottom-1 w-[2px] rounded-full transition-opacity ${
                      isHovered
                        ? isInput
                          ? "bg-cyan-500/60 opacity-100"
                          : "bg-emerald-500/60 opacity-100"
                        : "opacity-0"
                    } ${isInput ? "left-0" : "right-0"}`}
                  />

                  <div
                    className={`flex items-center gap-1.5 flex-1 min-w-0 px-3 ${isInput ? "" : "flex-row-reverse"}`}
                  >
                    <DataTypeDot dataType={port.ep.dataType} />

                    {isEditing ? (
                      <input
                        className="nodrag nopan flex-1 min-w-0 text-[11px] bg-transparent border-b border-foreground/20 focus:border-cyan-500 outline-none py-0.5 text-foreground"
                        value={aliasValue}
                        onChange={(e) => setAliasValue(e.target.value)}
                        onBlur={commitAlias}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitAlias();
                          if (e.key === "Escape") {
                            e.stopPropagation();
                            setEditingAlias(null);
                          }
                        }}
                        placeholder={port.ep.paramKey}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span
                        className={`flex-1 min-w-0 text-[11px] font-medium truncate text-foreground/80 ${isInput ? "text-left" : "text-right"}`}
                      >
                        {port.label}
                      </span>
                    )}

                    {/* Action buttons — always visible */}
                    {!isEditing && (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <button
                              className="nodrag nopan w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                startAliasEdit(
                                  port.ep.namespacedKey,
                                  port.ep.alias ?? "",
                                );
                              }}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {t("workflow.rename", "Rename")}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <button
                              className="nodrag nopan w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveParam(port.ep.namespacedKey);
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            className="bg-red-500 text-white"
                          >
                            {t("workflow.removeParam", "Remove")}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* ── Inline picker ───────────────────────────────────── */}
        {pickerOpen && (
          <div
            className={`border-t ${isInput ? "border-cyan-500/15" : "border-emerald-500/15"}`}
          >
            <InlineParamPicker groupId={groupId} direction={direction} />
          </div>
        )}

        {/* Bottom padding when ports visible */}
        {ports.length > 0 && !pickerOpen && <div className="h-1" />}
      </div>
    </div>
  );
}

export const GroupIONode = memo(GroupIONodeComponent);
