/**
 * SubgraphToolbar — floating toolbar shown when editing a Group subgraph.
 * Provides IN/OUT parameter configuration with alias support.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useUIStore } from "../../stores/ui.store";
import { useWorkflowStore } from "../../stores/workflow.store";
import type { PortDefinition } from "@/workflow/types/node-defs";
import type { ExposedParam } from "@/workflow/types/workflow";
import { Settings2, ChevronDown, ChevronRight } from "lucide-react";

/* ── Expose-param picker ── */

function SubgraphParamPicker({
  groupId,
  direction,
  onEditingAliasChange,
}: {
  groupId: string;
  direction: "input" | "output";
  onEditingAliasChange: (editing: boolean) => void;
}) {
  const { t } = useTranslation();
  const nodes = useWorkflowStore((s) => s.nodes);
  const exposeParam = useWorkflowStore((s) => s.exposeParam);
  const unexposeParam = useWorkflowStore((s) => s.unexposeParam);
  const updateAlias = useWorkflowStore((s) => s.updateExposedParamAlias);
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [aliasValue, setAliasValue] = useState("");

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

  const getExposedParam = useCallback(
    (subNodeId: string, paramKey: string) =>
      exposedList.find(
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
        const nk = `${subNodeId}.${paramKey}`;
        exposeParam(groupId, {
          subNodeId,
          subNodeLabel,
          paramKey,
          namespacedKey: nk,
          direction,
          dataType: dataType as ExposedParam["dataType"],
        });
      }
    },
    [isExposed, exposedList, exposeParam, unexposeParam, groupId, direction],
  );

  const startAliasEdit = useCallback(
    (nk: string, currentAlias: string) => {
      setEditingAlias(nk);
      setAliasValue(currentAlias);
      onEditingAliasChange(true);
    },
    [onEditingAliasChange],
  );

  const commitAlias = useCallback(() => {
    if (editingAlias) {
      updateAlias(groupId, editingAlias, direction, aliasValue.trim());
      setEditingAlias(null);
      onEditingAliasChange(false);
    }
  }, [
    editingAlias,
    aliasValue,
    groupId,
    direction,
    updateAlias,
    onEditingAliasChange,
  ]);

  const cancelAliasEdit = useCallback(() => {
    setEditingAlias(null);
    setAliasValue("");
    onEditingAliasChange(false);
  }, [onEditingAliasChange]);

  // Accent colors
  const accentDot = direction === "input" ? "bg-cyan-500" : "bg-emerald-500";
  const accentCheck = direction === "input" ? "bg-cyan-500" : "bg-emerald-500";
  const accentText =
    direction === "input" ? "text-cyan-400" : "text-emerald-400";

  // Collapsible node sections
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(),
  );
  const toggleSection = useCallback((nodeId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  return (
    <div className="overflow-y-auto p-2 space-y-1">
      {childNodes.length === 0 ? (
        <p className="text-[11px] text-muted-foreground px-1 py-3 text-center">
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
              className="rounded-lg bg-muted/20 overflow-hidden"
            >
              {/* Collapsible header */}
              <button
                onClick={() => toggleSection(child.id)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-muted/30 transition-colors"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                )}
                <div
                  className={`w-1.5 h-1.5 rounded-full ${accentDot} opacity-60 flex-shrink-0`}
                />
                <span className="text-[11px] font-semibold text-foreground/70 truncate flex-1 text-left">
                  {fullLabel}
                </span>
                {exposedCount > 0 && (
                  <span
                    className={`text-[9px] font-semibold px-1 rounded ${direction === "input" ? "bg-cyan-500/15 text-cyan-400" : "bg-emerald-500/15 text-emerald-400"}`}
                  >
                    {exposedCount}
                  </span>
                )}
                <span className="text-[9px] text-muted-foreground/40 font-mono flex-shrink-0">
                  {shortId}
                </span>
              </button>
              {/* Param list */}
              {!isCollapsed && (
                <div className="px-1 pb-1">
                  {items.map((item) => {
                    const exposed = isExposed(child.id, item.key);
                    const ep = exposed
                      ? getExposedParam(child.id, item.key)
                      : null;
                    const nk = ep?.namespacedKey ?? `${child.id}.${item.key}`;
                    const isEditingThis = editingAlias === nk;

                    return (
                      <div key={`${child.id}-${item.key}`}>
                        <button
                          onClick={() =>
                            handleToggle(
                              child.id,
                              fullLabel,
                              item.key,
                              item.dataType,
                            )
                          }
                          className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[11px] transition-all ${
                            exposed
                              ? "text-foreground bg-[hsl(var(--card))]"
                              : "text-foreground/50 hover:text-foreground/70 hover:bg-[hsl(var(--card)/0.5)]"
                          }`}
                        >
                          <div
                            className={`w-3.5 h-3.5 rounded-[4px] flex-shrink-0 flex items-center justify-center transition-all ${
                              exposed
                                ? `${accentCheck} shadow-sm`
                                : "border border-muted-foreground/20"
                            }`}
                          >
                            {exposed && (
                              <svg
                                width="8"
                                height="8"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="white"
                                strokeWidth="3.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                          <span
                            className={`flex-1 text-left truncate ${exposed ? "font-medium" : ""}`}
                          >
                            {item.label}
                          </span>
                        </button>
                        {exposed && (
                          <div className="ml-7.5 mr-1.5 mb-0.5">
                            {isEditingThis ? (
                              <input
                                className="w-full text-[10px] bg-[hsl(var(--card))] border border-border/60 rounded px-1.5 py-0.5 outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 text-foreground placeholder:text-muted-foreground/40"
                                value={aliasValue}
                                onChange={(e) => setAliasValue(e.target.value)}
                                onBlur={commitAlias}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitAlias();
                                  if (e.key === "Escape") {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    cancelAliasEdit();
                                  }
                                }}
                                placeholder={t(
                                  "workflow.aliasPlaceholder",
                                  "Display name on main graph...",
                                )}
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startAliasEdit(nk, ep?.alias ?? "");
                                }}
                                className={`text-[10px] transition-colors truncate text-left pl-1 ${
                                  ep?.alias
                                    ? `${accentText} font-medium`
                                    : "text-muted-foreground/40 hover:text-muted-foreground/60 italic"
                                }`}
                              >
                                {ep?.alias ||
                                  t("workflow.setAlias", "Set display name...")}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
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

/* ── Main toolbar — owns the picker open/close state and all dismiss logic ── */

export function SubgraphToolbar() {
  const editingGroupId = useUIStore((s) => s.editingGroupId);
  const nodes = useWorkflowStore((s) => s.nodes);
  const [showPicker, setShowPicker] = useState<"input" | "output" | null>(null);
  const [isEditingAlias, setIsEditingAlias] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);

  const groupNode = editingGroupId
    ? nodes.find((n) => n.id === editingGroupId)
    : undefined;
  const inputCount = useMemo(() => {
    try {
      const raw = groupNode?.data?.params?.exposedInputs;
      const list =
        typeof raw === "string"
          ? JSON.parse(raw)
          : Array.isArray(raw)
            ? raw
            : [];
      return list.length;
    } catch {
      return 0;
    }
  }, [groupNode?.data?.params?.exposedInputs]);
  const outputCount = useMemo(() => {
    try {
      const raw = groupNode?.data?.params?.exposedOutputs;
      const list =
        typeof raw === "string"
          ? JSON.parse(raw)
          : Array.isArray(raw)
            ? raw
            : [];
      return list.length;
    } catch {
      return 0;
    }
  }, [groupNode?.data?.params?.exposedOutputs]);

  const closePicker = useCallback(() => {
    setShowPicker(null);
    setIsEditingAlias(false);
  }, []);

  // Signal picker open state via data attribute so SubgraphBreadcrumb can skip ESC
  useEffect(() => {
    if (showPicker) {
      document.body.setAttribute("data-subgraph-picker-open", "true");
    } else {
      document.body.removeAttribute("data-subgraph-picker-open");
    }
    return () => {
      document.body.removeAttribute("data-subgraph-picker-open");
    };
  }, [showPicker]);

  // Click outside: close picker (capture phase so ReactFlow canvas stopPropagation won't block it)
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (portalRef.current?.contains(target)) return;
      closePicker();
    };
    const timer = setTimeout(
      () => document.addEventListener("mousedown", handler, true),
      0,
    );
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler, true);
    };
  }, [showPicker, closePicker]);

  // ESC handling — capture phase, before SubgraphBreadcrumb
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isEditingAlias) return;
      e.stopPropagation();
      e.preventDefault();
      closePicker();
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [showPicker, isEditingAlias, closePicker]);

  if (!editingGroupId) return null;

  return (
    <div
      ref={panelRef}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2"
    >
      {/* Picker popover — above the buttons */}
      {showPicker &&
        createPortal(
          <div
            ref={portalRef}
            className="fixed z-[99999] bg-[hsl(var(--popover))] border border-border/60 rounded-2xl shadow-2xl min-w-[280px] max-w-[340px] max-h-[60vh] overflow-y-auto backdrop-blur-xl"
            style={{ bottom: 60, left: "50%", transform: "translateX(-50%)" }}
          >
            <SubgraphParamPicker
              groupId={editingGroupId}
              direction={showPicker}
              onEditingAliasChange={setIsEditingAlias}
            />
          </div>,
          document.body,
        )}

      {/* Toolbar buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowPicker(showPicker === "input" ? null : "input")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium shadow-lg backdrop-blur-md border transition-all ${
            showPicker === "input"
              ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-400"
              : "bg-background/90 border-border text-foreground hover:border-cyan-500/30 hover:text-cyan-400"
          }`}
        >
          <Settings2 className="w-3.5 h-3.5" />
          <span>IN</span>
          {inputCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-[10px] font-semibold">
              {inputCount}
            </span>
          )}
        </button>
        <button
          onClick={() =>
            setShowPicker(showPicker === "output" ? null : "output")
          }
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium shadow-lg backdrop-blur-md border transition-all ${
            showPicker === "output"
              ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
              : "bg-background/90 border-border text-foreground hover:border-emerald-500/30 hover:text-emerald-400"
          }`}
        >
          <Settings2 className="w-3.5 h-3.5" />
          <span>OUT</span>
          {outputCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-[10px] font-semibold">
              {outputCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
