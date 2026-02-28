/**
 * Custom edge component — color-coded by execution status.
 * Rewritten with Tailwind classes.
 */
import { useState } from "react";
import {
  getBezierPath,
  type EdgeProps,
  EdgeLabelRenderer,
  BaseEdge,
} from "reactflow";
import { useExecutionStore } from "../../stores/execution.store";
import { useWorkflowStore } from "../../stores/workflow.store";
import type { EdgeStatus } from "@/workflow/types/execution";

export function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  selected,
  source,
  target: _target,
}: EdgeProps) {
  const status = useExecutionStore(
    (s) => s.edgeStatuses[id] ?? "no-data",
  ) as EdgeStatus;
  const sourceNodeStatus = useExecutionStore(
    (s) => s.nodeStatuses[source] ?? "idle",
  );
  const removeEdge = useWorkflowStore((s) => s.removeEdge);
  const [isHovered, setIsHovered] = useState(false);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Default: visible blue-tinted line that fits the dark theme
  let edgeColor = "#6b7fa8";
  let edgeOpacity = 1.0;
  if (sourceNodeStatus === "running") edgeColor = "#60a5fa";
  else if (sourceNodeStatus === "confirmed" && status === "has-data")
    edgeColor = "#4ade80";
  else if (sourceNodeStatus === "unconfirmed") edgeColor = "#fb923c";
  else if (status === "no-data") edgeOpacity = 0.7;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: selected
            ? "hsl(var(--primary))"
            : isHovered
              ? "hsl(var(--muted-foreground))"
              : edgeColor,
          strokeWidth: selected ? 3 : 2,
          opacity: edgeOpacity,
          transition: "stroke 0.3s ease, opacity 0.3s ease",
        }}
      />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ cursor: "pointer" }}
      />
      {(isHovered || selected) && (
        <EdgeLabelRenderer>
          <div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeEdge(id);
              }}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-red-500/60 bg-background text-red-400 text-xs hover:bg-red-500 hover:text-white hover:border-red-500 transition-colors shadow-md"
              title="Delete connection"
            >
              ✕
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
