/**
 * Main Storyboard page — cinematic AI video storyboard editor.
 *
 * Layout modes:
 * - No project: full-screen chat (onboarding experience)
 * - Has project: split layout — resizable left panel, canvas center, editor right
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { useStoryboardStore } from "./stores/storyboard.store";
import { useAgentActivityStore } from "./stores/agent-activity.store";
import { TopBar } from "./components/TopBar";
import { LeftPanel } from "./components/LeftPanel";
import { FlowCanvas } from "./components/FlowCanvas";
import { RightPanel } from "./components/RightPanel";
import { ChatBar } from "./components/ChatBar";
import { AgentActivityPanel } from "./components/AgentActivityPanel";
import { VideoPreview } from "./components/VideoPreview";
import { STORAGE_KEY_LLM } from "./components/LlmSettings";
import { cn } from "@/lib/utils";
import { MessageSquare, Layers, Terminal } from "lucide-react";

type LeftTab = "chat" | "assets" | "activity";

const LEFT_MIN = 280;
const LEFT_MAX = 600;
const LEFT_DEFAULT = 360;

export function StoryboardPage() {
  const setLlmConfig = useStoryboardStore((s) => s.setLlmConfig);
  const project = useStoryboardStore((s) => s.project);
  const selectedShotId = useStoryboardStore((s) => s.selectedShotId);
  const selectedCharacterId = useStoryboardStore((s) => s.selectedCharacterId);
  const selectedSceneId = useStoryboardStore((s) => s.selectedSceneId);
  const isAgentWorking = useStoryboardStore((s) => s.isAgentWorking);
  const agentPhases = useAgentActivityStore((s) => s.phases);
  const [showPreview, setShowPreview] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("chat");
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const isDragging = useRef(false);

  // Restore LLM config from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_LLM);
      if (saved) setLlmConfig(JSON.parse(saved));
    } catch { /* ignore */ }
  }, [setLlmConfig]);

  // Auto-switch to activity tab when agent starts
  useEffect(() => {
    if (isAgentWorking && agentPhases.length > 0 && leftTab === "assets") {
      setLeftTab("activity");
    }
  }, [isAgentWorking, agentPhases.length, leftTab]);

  // ── Drag resize handler ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = leftWidth;

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = ev.clientX - startX;
      setLeftWidth(Math.max(LEFT_MIN, Math.min(LEFT_MAX, startWidth + delta)));
    };
    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [leftWidth]);

  const hasSelection = !!selectedShotId || !!selectedCharacterId || !!selectedSceneId;
  const hasProject = !!project && project.status !== "idle";

  const characters = useStoryboardStore((s) => s.characters);
  const scenes = useStoryboardStore((s) => s.scenes);
  const assetCount = characters.length + scenes.length;

  // ── No project: full-screen chat ──
  if (!hasProject) {
    return (
      <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
        <TopBar onPreview={() => {}} />
        <div className="flex-1 flex items-center justify-center min-h-0">
          <div className="w-full max-w-2xl h-full flex flex-col">
            <ChatBar />
          </div>
        </div>
      </div>
    );
  }

  // ── Has project: split layout ──
  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      <TopBar onPreview={() => setShowPreview(true)} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel: tabbed + resizable */}
        <div
          className="flex flex-col shrink-0 bg-card/30 overflow-hidden"
          style={{ width: leftWidth }}
        >
          {/* Tab bar */}
          <div className="flex border-b shrink-0">
            <TabButton
              active={leftTab === "chat"}
              onClick={() => setLeftTab("chat")}
              icon={<MessageSquare className="h-3.5 w-3.5" />}
              label="对话"
            />
            <TabButton
              active={leftTab === "assets"}
              onClick={() => setLeftTab("assets")}
              icon={<Layers className="h-3.5 w-3.5" />}
              label="资产"
              badge={assetCount > 0 ? assetCount : undefined}
            />
            <TabButton
              active={leftTab === "activity"}
              onClick={() => setLeftTab("activity")}
              icon={<Terminal className="h-3.5 w-3.5" />}
              label="日志"
              pulse={isAgentWorking}
            />
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {leftTab === "chat" && <ChatBar />}
            {leftTab === "assets" && <LeftPanel />}
            {leftTab === "activity" && <AgentActivityPanel />}
          </div>
        </div>

        {/* Drag handle */}
        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors relative group"
          onMouseDown={handleMouseDown}
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
        </div>

        {/* Center: Flow Canvas */}
        <FlowCanvas />

        {/* Right: Editor */}
        {hasSelection && (
          <div className="w-80 border-l flex flex-col shrink-0 overflow-hidden bg-card/50">
            <RightPanel />
          </div>
        )}
      </div>
      {showPreview && <VideoPreview onClose={() => setShowPreview(false)} />}
    </div>
  );
}

/* ── Tab Button ────────────────────────────────────────── */

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
  pulse,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  pulse?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-all relative",
        active
          ? "text-primary border-b-2 border-primary bg-primary/5"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
      )}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="text-[9px] bg-muted rounded-full px-1.5 py-0.5 font-mono">
          {badge}
        </span>
      )}
      {pulse && (
        <span className="absolute top-1.5 right-3 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
      )}
    </button>
  );
}
