/**
 * Top bar — project info, mode toggle, generation controls, export, settings.
 */
import { useStoryboardStore } from "../stores/storyboard.store";
import { Button } from "@/components/ui/button";
import { Download, RotateCcw, Clapperboard, Play, Loader2, CheckCircle2, Film } from "lucide-react";
import { ModelSettings } from "./ModelSettings";
import { LlmSettings } from "./LlmSettings";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  idle: { text: "空闲", color: "text-muted-foreground" },
  creating: { text: "创建中", color: "text-primary" },
  ready: { text: "就绪", color: "text-emerald-500 dark:text-emerald-400" },
  generating: { text: "生成中", color: "text-primary" },
  assembling: { text: "组装中", color: "text-violet-500 dark:text-violet-400" },
  done: { text: "完成", color: "text-emerald-500 dark:text-emerald-400" },
};

export function TopBar({ onPreview }: { onPreview?: () => void }) {
  const project = useStoryboardStore((s) => s.project);
  const toggleMode = useStoryboardStore((s) => s.toggleMode);
  const reset = useStoryboardStore((s) => s.reset);
  const startGeneration = useStoryboardStore((s) => s.startGeneration);
  const shots = useStoryboardStore((s) => s.shots);
  const isAgentWorking = useStoryboardStore((s) => s.isAgentWorking);
  const selectedModels = useStoryboardStore((s) => s.selectedModels);
  const setModel = useStoryboardStore((s) => s.setModel);
  const assembledVideoUrl = useStoryboardStore((s) => s.assembledVideoUrl);
  const isAssembling = useStoryboardStore((s) => s.isAssembling);

  const pendingCount = shots.filter(
    (s) => s.generation_status === "pending" || s.generation_status === "dirty",
  ).length;
  const doneCount = shots.filter((s) => s.generation_status === "done").length;
  const totalDuration = shots.reduce((sum, s) => sum + s.duration, 0);
  const statusInfo = STATUS_LABELS[project?.status || "idle"] || STATUS_LABELS.idle;
  const allDone = shots.length > 0 && doneCount === shots.length;

  const handleExport = () => {
    // Collect all generated video URLs
    const videoUrls = shots
      .filter((s) => s.generated_assets.video_path)
      .sort((a, b) => a.sequence_number - b.sequence_number)
      .map((s) => s.generated_assets.video_path!);

    if (videoUrls.length === 0) return;

    // Download each video
    videoUrls.forEach((url, i) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = `shot_${String(i + 1).padStart(2, "0")}.mp4`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  };

  return (
    <div className="h-11 border-b bg-card/80 backdrop-blur flex items-center justify-between px-3 shrink-0">
      {/* Left: project info */}
      <div className="flex items-center gap-3">
        <Clapperboard className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">
          {project?.name || "AI 故事板"}
        </span>
        {project && (
          <>
            <div className="flex items-center gap-1.5">
              {project.status === "done" ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              ) : (
                <div className={cn("h-1.5 w-1.5 rounded-full",
                  project.status === "generating" || project.status === "creating" ? "bg-primary animate-pulse" :
                  project.status === "ready" ? "bg-emerald-500" : "bg-muted-foreground/40"
                )} />
              )}
              <span className={cn("text-[10px] font-medium", statusInfo.color)}>
                {statusInfo.text}
              </span>
            </div>
            {shots.length > 0 && (
              <span className="text-[10px] text-muted-foreground font-mono">
                {shots.length} 镜头 · {totalDuration}s
              </span>
            )}
          </>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1.5">
        <ModelSettings selectedModels={selectedModels} onModelChange={setModel} />
        <LlmSettings />

        {project && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] px-2"
              onClick={toggleMode}
            >
              {project.mode === "lite" ? "轻模式" : "专业模式"}
            </Button>

            {pendingCount > 0 && (
              <Button
                size="sm"
                className="h-7 text-[10px] px-3 gap-1.5"
                onClick={() => startGeneration()}
                disabled={isAgentWorking}
              >
                {isAgentWorking ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                生成 {pendingCount} 镜头
              </Button>
            )}

            {allDone && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] px-3 gap-1.5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                onClick={handleExport}
              >
                <Download className="h-3 w-3" />
                导出 {doneCount} 个视频
              </Button>
            )}

            {!allDone && doneCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[10px] px-2"
                onClick={handleExport}
                title={`导出已完成的 ${doneCount} 个视频`}
              >
                <Download className="h-3 w-3" />
              </Button>
            )}

            {/* Preview assembled video */}
            {(assembledVideoUrl || isAssembling) && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] px-3 gap-1.5"
                onClick={onPreview}
                disabled={isAssembling}
              >
                {isAssembling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Film className="h-3 w-3" />
                )}
                {isAssembling ? "组装中..." : "预览完整视频"}
              </Button>
            )}
          </>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[10px] px-2 text-muted-foreground"
          onClick={reset}
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
