/**
 * SubgraphBreadcrumb — shows navigation path when editing inside a Group.
 * Displays: "主工作流 / GroupName" with click-to-navigate and ESC to exit.
 */
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "../../stores/ui.store";
import { useWorkflowStore } from "../../stores/workflow.store";
import { ChevronRight, ArrowLeft } from "lucide-react";

export function SubgraphBreadcrumb() {
  const { t } = useTranslation();
  const editingGroupId = useUIStore((s) => s.editingGroupId);
  const exitGroupEdit = useUIStore((s) => s.exitGroupEdit);
  const nodes = useWorkflowStore((s) => s.nodes);

  const groupNode = nodes.find((n) => n.id === editingGroupId);
  const groupLabel = groupNode
    ? String(groupNode.data?.label || t("workflow.group", "Group"))
    : t("workflow.group", "Group");
  const groupShortId = editingGroupId?.slice(0, 8) ?? "";

  // ESC to exit subgraph editing — but NOT if a popover/picker is open
  useEffect(() => {
    if (!editingGroupId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Skip if an input is focused (alias editing, etc.)
        const active = document.activeElement;
        if (
          active &&
          (active.tagName === "INPUT" || active.tagName === "TEXTAREA")
        )
          return;
        // Skip if the SubgraphToolbar picker is open — it handles its own ESC
        if (document.body.hasAttribute("data-subgraph-picker-open")) return;
        e.preventDefault();
        e.stopPropagation();
        exitGroupEdit();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [editingGroupId, exitGroupEdit]);

  const handleExitClick = useCallback(() => {
    exitGroupEdit();
  }, [exitGroupEdit]);

  if (!editingGroupId) return null;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-background/90 backdrop-blur-md border border-border shadow-lg">
      <button
        onClick={handleExitClick}
        className="text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {t("workflow.mainWorkflow", "Main Workflow")}
      </button>
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
      <span className="text-[12px] font-semibold text-cyan-500">
        {groupLabel}
      </span>
      <span className="text-[10px] text-muted-foreground/50 ml-0.5">
        #{groupShortId}
      </span>
      <button
        onClick={handleExitClick}
        className="ml-2 px-2.5 py-1 rounded-md bg-cyan-500 hover:bg-cyan-600 text-white transition-colors flex items-center gap-1 shadow-sm"
        title={t("workflow.exitSubgraph", "Exit subgraph (ESC)")}
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span className="text-[11px] font-medium">{t("workflow.back", "Back")}</span>
      </button>
    </div>
  );
}
