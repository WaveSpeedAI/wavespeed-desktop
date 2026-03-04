/**
 * Agent Activity Panel — real-time visualization of AI agent work.
 * Shows streaming LLM output, phase progression, task status, and token counts.
 */
import { useRef, useEffect, useState } from "react";
import { useAgentActivityStore, type AgentTask, type AgentName } from "../stores/agent-activity.store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Brain,
  Clapperboard,
  Image,
  Film,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Eye,
  EyeOff,
  Terminal,
} from "lucide-react";

const AGENT_META: Record<AgentName, { icon: typeof Brain; label: string; color: string }> = {
  orchestrator: { icon: Brain, label: "主控Agent", color: "text-violet-600 dark:text-violet-400" },
  story: { icon: Clapperboard, label: "创作Agent", color: "text-blue-600 dark:text-blue-400" },
  asset: { icon: Image, label: "资产Agent", color: "text-emerald-600 dark:text-emerald-400" },
  production: { icon: Film, label: "生成Agent", color: "text-orange-600 dark:text-orange-400" },
};

function TaskStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running":
    case "streaming":
      return <Loader2 className="h-3 w-3 animate-spin text-primary" />;
    case "done":
      return <CheckCircle2 className="h-3 w-3 text-emerald-500 dark:text-emerald-400" />;
    case "error":
      return <XCircle className="h-3 w-3 text-destructive" />;
    default:
      return <div className="h-3 w-3 rounded-full bg-muted-foreground/30" />;
  }
}

function elapsed(start: number | null, end: number | null): string {
  if (!start) return "";
  const ms = (end || Date.now()) - start;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StreamingText({ text, isActive }: { text: string; isActive: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [text, isActive]);

  if (!text) return null;

  return (
    <div
      ref={containerRef}
      className="mt-1.5 rounded-md bg-muted/50 border p-2 max-h-48 overflow-y-auto font-mono text-[10px] leading-relaxed"
    >
      <pre className="whitespace-pre-wrap break-words text-emerald-700 dark:text-emerald-300/80">
        {text}
        {isActive && (
          <span className="inline-block w-1.5 h-3 bg-primary animate-pulse ml-0.5 align-middle" />
        )}
      </pre>
      <div ref={endRef} />
    </div>
  );
}

function TaskItem({ task, isExpanded, onToggle }: { task: AgentTask; isExpanded: boolean; onToggle: () => void }) {
  const meta = AGENT_META[task.agent];
  const AgentIcon = meta.icon;
  const isActive = task.status === "running" || task.status === "streaming";

  return (
    <div className={cn(
      "rounded-lg border transition-all duration-300",
      isActive ? "border-primary/30 bg-primary/5 shadow-sm" : "border-border bg-card/50",
      task.status === "done" && "border-emerald-500/20 dark:border-emerald-400/20",
      task.status === "error" && "border-destructive/20 bg-destructive/5",
    )}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-2 text-left hover:bg-muted/50 rounded-lg transition-colors"
      >
        <TaskStatusIcon status={task.status} />
        <AgentIcon className={cn("h-3.5 w-3.5", meta.color)} />
        <span className="text-[11px] flex-1 truncate">{task.label}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {task.tokens > 0 && (
            <span className="text-[9px] text-muted-foreground/50 flex items-center gap-0.5">
              <Zap className="h-2.5 w-2.5" />{task.tokens}
            </span>
          )}
          {task.startedAt && (
            <span className="text-[9px] text-muted-foreground/50">
              {elapsed(task.startedAt, task.completedAt)}
            </span>
          )}
          {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground/40" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
        </div>
      </button>

      {isExpanded && (
        <div className="px-2 pb-2">
          {task.streamingText && <StreamingText text={task.streamingText} isActive={isActive} />}
          {task.result && (
            <div className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400/80 px-1">{task.result}</div>
          )}
          {task.error && (
            <div className="mt-1 text-[10px] text-destructive px-1">❌ {task.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentActivityPanel() {
  const phases = useAgentActivityStore((s) => s.phases);
  const totalTokens = useAgentActivityStore((s) => s.totalTokens);
  const isActive = useAgentActivityStore((s) => s.isActive);
  const panelOpen = useAgentActivityStore((s) => s.panelOpen);
  const togglePanel = useAgentActivityStore((s) => s.togglePanel);

  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  useEffect(() => {
    for (const phase of phases) {
      for (const task of phase.tasks) {
        if ((task.status === "running" || task.status === "streaming") && !expandedTasks.has(task.id)) {
          setExpandedTasks((prev) => new Set(prev).add(task.id));
        }
      }
    }
  }, [phases, expandedTasks]);

  const toggleTask = (taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  if (phases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 p-4">
        <Terminal className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-[11px] text-center">Agent 活动日志</p>
        <p className="text-[9px] text-center mt-1">开始创作后，这里会实时显示 AI 的工作过程</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-semibold">Agent 工作台</span>
          {isActive ? (
            <span className="flex items-center gap-1 text-[9px] text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              运行中
            </span>
          ) : phases.length > 0 ? (
            <span className="flex items-center gap-1 text-[9px] text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              已完成
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {totalTokens > 0 && (
            <span className="text-[9px] text-muted-foreground/50 flex items-center gap-0.5">
              <Zap className="h-2.5 w-2.5" /> {totalTokens} tokens
            </span>
          )}
          <button onClick={togglePanel} className="text-muted-foreground/50 hover:text-muted-foreground">
            {panelOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Content */}
      {panelOpen && (
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-3">
            {phases.map((phase) => (
              <div key={phase.id}>
                <div className="flex items-center gap-2 mb-1.5 px-1">
                  <div className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    phase.status === "running" ? "bg-primary animate-pulse" : phase.status === "done" ? "bg-emerald-500" : "bg-muted-foreground/30",
                  )} />
                  <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    {phase.name}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {phase.tasks.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      isExpanded={expandedTasks.has(task.id)}
                      onToggle={() => toggleTask(task.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
