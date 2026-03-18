/**
 * ImportWorkflowDialog — modal dialog to pick an existing workflow
 * and import its nodes/edges into a Group as a subgraph.
 */
import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { workflowIpc } from "../../ipc/ipc-client";
import { useWorkflowStore } from "../../stores/workflow.store";
import type { WorkflowSummary } from "@/workflow/types/ipc";

interface Props {
  groupId: string;
  onClose: () => void;
}

export function ImportWorkflowDialog({ groupId, onClose }: Props) {
  const { t } = useTranslation();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const currentWorkflowId = useWorkflowStore((s) => s.workflowId);
  const importWorkflowIntoGroup = useWorkflowStore(
    (s) => s.importWorkflowIntoGroup,
  );

  useEffect(() => {
    workflowIpc
      .list()
      .then((list) => {
        // Exclude the current workflow to prevent self-import
        setWorkflows(list.filter((w) => w.id !== currentWorkflowId));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [currentWorkflowId]);

  const handleImport = useCallback(
    async (wfId: string) => {
      setImporting(wfId);
      try {
        await importWorkflowIntoGroup(groupId, wfId);
        onClose();
      } catch (err) {
        console.error("Import failed:", err);
        setImporting(null);
      }
    },
    [groupId, importWorkflowIntoGroup, onClose],
  );

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[hsl(var(--popover))] border border-border rounded-xl shadow-2xl w-[420px] max-h-[500px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <span className="text-[13px] font-semibold text-foreground">
            {t(
              "workflow.importWorkflowAsSubgraph",
              "Import Workflow as Subgraph",
            )}
          </span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted/60"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-[12px] text-muted-foreground">
              {t("common.loading", "Loading...")}
            </div>
          ) : workflows.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-[12px] text-muted-foreground">
              {t(
                "workflow.noWorkflowsToImport",
                "No other workflows available",
              )}
            </div>
          ) : (
            workflows.map((wf) => (
              <button
                key={wf.id}
                disabled={importing !== null}
                onClick={() => handleImport(wf.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  importing === wf.id
                    ? "bg-cyan-500/10 text-cyan-400"
                    : "text-foreground hover:bg-muted/60"
                } disabled:opacity-50`}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="flex-shrink-0 text-muted-foreground"
                >
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium truncate">
                    {wf.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {t("workflow.nodeCountLabel", "{{count}} nodes", {
                      count: wf.nodeCount,
                    })}
                    {" · "}
                    {new Date(wf.updatedAt).toLocaleDateString()}
                  </div>
                </div>
                {importing === wf.id ? (
                  <svg
                    className="animate-spin flex-shrink-0 text-cyan-400"
                    width="14"
                    height="14"
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
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="flex-shrink-0 text-muted-foreground/50"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
