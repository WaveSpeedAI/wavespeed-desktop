/**
 * GroupIONode — virtual proxy nodes shown in subgraph editing mode.
 *
 * Inspired by ComfyUI's IO rail concept but with our own twist:
 * A vertical accent line runs through all port dots, creating a
 * "connector strip" feel. Port labels float beside the line.
 * A small direction indicator sits at the top. No card background —
 * the node is intentionally minimal so it doesn't compete with
 * real child nodes on the canvas.
 *
 * Group Input:  labels on LEFT, line + handles on RIGHT → source
 * Group Output: handles on LEFT ← line, labels on RIGHT
 */
import { memo, useMemo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { useTranslation } from "react-i18next";
import type { ExposedParam } from "@/workflow/types/workflow";

const DOT = 10;
const PORT_SPACING = 32;
const HEADER_HEIGHT = 28;
const LINE_EXTEND = 20; // how far the line extends beyond first/last port

export interface GroupIONodeData {
  direction: "input" | "output";
  exposedParams: ExposedParam[];
  groupId: string;
}

function GroupIONodeComponent({ data }: NodeProps<GroupIONodeData>) {
  const { t } = useTranslation();
  const { direction, exposedParams } = data;
  const isInput = direction === "input";

  const ports = useMemo(
    () =>
      exposedParams.map((ep) => {
        if (ep.alias) {
          return { key: ep.namespacedKey, label: ep.alias, ep };
        }
        const label = ep.paramKey
          .split("_")
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        return { key: ep.namespacedKey, label, ep };
      }),
    [exposedParams],
  );

  if (ports.length === 0) return null;

  // Total height of the port area
  const totalPortHeight = ports.length * PORT_SPACING;
  // The vertical line position (x offset within the node)
  const lineX = isInput ? 130 : 10;

  return (
    <div
      className="relative"
      style={{
        width: 150,
        height: HEADER_HEIGHT + totalPortHeight + LINE_EXTEND + 8,
      }}
    >
      {/* Direction label at top */}
      <div
        className={`absolute text-[9px] font-bold uppercase tracking-widest select-none ${
          isInput ? "text-cyan-400/70 right-2" : "text-emerald-400/70 left-4"
        }`}
        style={{ top: 4 }}
      >
        {isInput
          ? t("workflow.groupInput", "Group Input")
          : t("workflow.groupOutput", "Group Output")}
      </div>

      {/* Vertical accent line — extends above first port and below last port */}
      <div
        className={`absolute w-[2px] rounded-full ${
          isInput
            ? "bg-gradient-to-b from-cyan-400/10 via-cyan-500/40 to-cyan-400/10"
            : "bg-gradient-to-b from-emerald-400/10 via-emerald-500/40 to-emerald-400/10"
        }`}
        style={{
          left: lineX + DOT / 2 - 1,
          top: HEADER_HEIGHT + PORT_SPACING / 2 - LINE_EXTEND,
          height: totalPortHeight - PORT_SPACING + LINE_EXTEND * 2,
        }}
      />

      {/* Port rows */}
      {ports.map((port, i) => {
        const y = HEADER_HEIGHT + i * PORT_SPACING + PORT_SPACING / 2;

        return isInput ? (
          <div key={port.key}>
            {/* Label on the left side */}
            <span
              className="absolute text-[11px] text-foreground/70 font-medium select-none truncate text-right"
              style={{
                right: 150 - lineX + 8,
                top: y - 7,
                maxWidth: lineX - 16,
              }}
            >
              {port.label}
            </span>
            {/* Handle dot on the line */}
            <Handle
              type="source"
              position={Position.Right}
              id={`group-io-${port.key}`}
              style={{
                width: DOT,
                height: DOT,
                borderRadius: "50%",
                border: "2px solid hsl(var(--primary))",
                background: "hsl(var(--primary))",
                position: "absolute",
                left: lineX,
                top: y,
                transform: "translate(-50%, -50%)",
              }}
            />
          </div>
        ) : (
          <div key={port.key}>
            {/* Handle dot on the line */}
            <Handle
              type="target"
              position={Position.Left}
              id={`group-io-${port.key}`}
              style={{
                width: DOT,
                height: DOT,
                borderRadius: "50%",
                border: "2px solid hsl(var(--primary))",
                background: "hsl(var(--primary))",
                position: "absolute",
                left: lineX,
                top: y,
                transform: "translate(-50%, -50%)",
              }}
            />
            {/* Label on the right side */}
            <span
              className="absolute text-[11px] text-foreground/70 font-medium select-none truncate"
              style={{
                left: lineX + 14,
                top: y - 7,
                maxWidth: 150 - lineX - 20,
              }}
            >
              {port.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export const GroupIONode = memo(GroupIONodeComponent);
