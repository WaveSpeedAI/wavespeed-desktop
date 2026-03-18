/**
 * FlowCanvas — Detroit: Become Human inspired flowchart (v3.0).
 *
 * Uses the app's design tokens (bg-card, border, text-foreground, etc.)
 * so it works correctly in both light and dark mode.
 *
 * Layout: vertical flow per beat, horizontal shot strips per scene,
 * connected by SVG paths with glow effects.
 */
import { useRef, useState, useCallback, useMemo } from "react";
import { useStoryboardStore } from "../stores/storyboard.store";
import { cn } from "@/lib/utils";
import {
  Play,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Camera,
  Clock,
  RefreshCw,
  Star,
  Loader2,
  Check,
  X as XIcon,
  MapPin,
  ChevronRight,
  Pencil,
  Link,
  Pause,
} from "lucide-react";
import type { Shot } from "../types/shot";
import type { Character, Scene } from "../types/project";

/* ── Execution path label config ───────────────────────── */

const PATH_LABELS: Record<string, { text: string; color: string }> = {
  P1: { text: "P1", color: "text-blue-500 bg-blue-500/10 border-blue-500/20" },
  P2: { text: "P2", color: "text-violet-500 bg-violet-500/10 border-violet-500/20" },
  P3: { text: "P3", color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
  P4: { text: "P4", color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
  P5: { text: "P5", color: "text-rose-500 bg-rose-500/10 border-rose-500/20" },
};

/* ── Scene color palette (works in both light/dark) ──── */

const SCENE_COLORS = [
  { accent: "hsl(217, 91%, 60%)", label: "text-blue-600 dark:text-blue-400" },
  { accent: "hsl(160, 84%, 39%)", label: "text-emerald-600 dark:text-emerald-400" },
  { accent: "hsl(263, 70%, 50%)", label: "text-violet-600 dark:text-violet-400" },
  { accent: "hsl(38, 92%, 50%)", label: "text-amber-600 dark:text-amber-400" },
  { accent: "hsl(0, 84%, 60%)", label: "text-rose-600 dark:text-rose-400" },
  { accent: "hsl(186, 94%, 42%)", label: "text-cyan-600 dark:text-cyan-400" },
];

/* ── Shot status visual mapping ──────────────────────── */

const STATUS_RING: Record<string, string> = {
  pending:    "border-muted-foreground/20",
  generating: "border-primary animate-pulse-subtle",
  done:       "border-emerald-500/50 dark:border-emerald-400/50",
  failed:     "border-destructive/50",
  dirty:      "border-amber-500/50 dark:border-amber-400/50",
};

const STATUS_BG: Record<string, string> = {
  pending:    "bg-muted/30",
  generating: "bg-primary/5",
  done:       "bg-emerald-500/5 dark:bg-emerald-400/5",
  failed:     "bg-destructive/5",
  dirty:      "bg-amber-500/5 dark:bg-amber-400/5",
};

/* ── Main Component ────────────────────────────────────── */

export function FlowCanvas() {
  const shots = useStoryboardStore((s) => s.shots);
  const characters = useStoryboardStore((s) => s.characters);
  const scenes = useStoryboardStore((s) => s.scenes);
  const beats = useStoryboardStore((s) => s.beats);
  const selectedShotId = useStoryboardStore((s) => s.selectedShotId);
  const selectShot = useStoryboardStore((s) => s.selectShot);
  const regenerateFirstFrame = useStoryboardStore((s) => s.regenerateFirstFrame);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const sorted = useMemo(
    () => [...shots].sort((a, b) => a.sequence_number - b.sequence_number),
    [shots],
  );

  // Build structure: Beat → Scene → Shots
  const structure = useMemo(() => {
    const beatMap = new Map<string, Map<string, Shot[]>>();
    for (const shot of sorted) {
      if (!beatMap.has(shot.beat_id)) beatMap.set(shot.beat_id, new Map());
      const sceneMap = beatMap.get(shot.beat_id)!;
      if (!sceneMap.has(shot.scene_id)) sceneMap.set(shot.scene_id, []);
      sceneMap.get(shot.scene_id)!.push(shot);
    }
    return beatMap;
  }, [sorted]);

  // Scene color mapping
  const sceneColorMap = useMemo(() => {
    const map = new Map<string, number>();
    scenes.forEach((s, i) => map.set(s.scene_id, i % SCENE_COLORS.length));
    return map;
  }, [scenes]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      setScale((s) => Math.max(0.5, Math.min(1.5, s + delta)));
    }
  }, []);

  // Stats
  const totalDuration = sorted.reduce((sum, s) => sum + s.duration_seconds, 0);
  const pendingCount = sorted.filter((s) => s.generation_status === "pending" || s.generation_status === "dirty").length;
  const doneCount = sorted.filter((s) => s.generation_status === "done").length;

  /* ── Empty state ─────────────────────────────────────── */

  if (sorted.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md px-6">
          <div className="w-20 h-20 rounded-2xl gradient-bg/10 border border-primary/20 flex items-center justify-center mx-auto bg-primary/5">
            <Play className="h-8 w-8 text-primary/40" />
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-1">开始创作你的故事</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              在下方输入故事描述，AI 会自动生成角色、场景和分镜。
              <br />
              支持中英文输入，描述越详细效果越好。
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 text-[10px] text-muted-foreground/60">
            <span className="px-2 py-1 rounded-full bg-muted/50">🎬 "一个赛博朋克城市的追逐戏"</span>
            <span className="px-2 py-1 rounded-full bg-muted/50">🌊 "海边日落的浪漫故事"</span>
            <span className="px-2 py-1 rounded-full bg-muted/50">⚔️ "古代武侠对决"</span>
          </div>
        </div>
      </div>
    );
  }

  /* ── Timeline with content ───────────────────────────── */

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-card/30 shrink-0">
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          <span>{sorted.length} 镜头</span>
          <span className="text-muted-foreground/30">·</span>
          <span>{totalDuration.toFixed(1)}s</span>
          {pendingCount > 0 && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span className="text-amber-600 dark:text-amber-400">{pendingCount} 待生成</span>
            </>
          )}
          {doneCount > 0 && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span className="text-emerald-600 dark:text-emerald-400">{doneCount} 完成</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setScale((s) => Math.max(0.5, s - 0.1))} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="text-[10px] text-muted-foreground w-8 text-center font-mono">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(1.5, s + 0.1))} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setScale(1)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ml-0.5">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable canvas */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        onWheel={handleWheel}
      >
        <div
          className="p-5 min-w-max"
          style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          {Array.from(structure.entries()).map(([beatId, sceneMap]) => {
            const beat = beats.find((b) => b.beat_id === beatId);
            return (
              <div key={beatId} className="mb-6">
                {/* Beat header */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-px w-8 bg-border" />
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {beat?.type ?? "beat"} {beat?.time_range ? `(${beat.time_range})` : ""}
                  </span>
                  {beat?.audience_feeling && (
                    <span className="text-[9px] text-muted-foreground/60">{beat.audience_feeling}</span>
                  )}
                  <div className="h-px flex-1 bg-border" />
                </div>

                {/* Scene lanes */}
                <div className="space-y-3">
                  {Array.from(sceneMap.entries()).map(([sceneId, sceneShots]) => {
                    const scene = scenes.find((s) => s.scene_id === sceneId);
                    const colorIdx = sceneColorMap.get(sceneId) ?? 0;
                    const color = SCENE_COLORS[colorIdx];

                    return (
                      <div
                        key={sceneId}
                        className="rounded-xl border bg-card/40 overflow-hidden"
                        style={{ borderLeftWidth: 3, borderLeftColor: color.accent }}
                      >
                        {/* Scene label */}
                        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-muted/20">
                          <MapPin className={cn("h-3 w-3", color.label)} />
                          <span className={cn("text-[10px] font-medium", color.label)}>
                            {scene?.name || "未知场景"}
                          </span>
                          {scene && (
                            <span className="text-[9px] text-muted-foreground/60 ml-1">
                              {scene.key_light_mood} · {scene.weather_state}
                            </span>
                          )}
                          <span className="text-[9px] text-muted-foreground/40 ml-auto">
                            {sceneShots.length} 镜头
                          </span>
                        </div>

                        {/* Shot strip */}
                        <div className="flex items-center gap-1 px-3 py-3 overflow-x-auto">
                          {sceneShots.map((shot, idx) => {
                            const isFrameChain = shot.scene_type === "A";

                            return (
                              <div key={shot.shot_id} className="flex items-center shrink-0">
                                <ShotCard
                                  shot={shot}
                                  characters={characters}
                                  isSelected={selectedShotId === shot.shot_id}
                                  onClick={() => selectShot(shot.shot_id)}
                                  onRegenerate={() => regenerateFirstFrame(shot.shot_id)}
                                />
                                {idx < sceneShots.length - 1 && (
                                  <div className="flex items-center mx-0.5 shrink-0">
                                    {isFrameChain ? (
                                      <Link className="h-3 w-3 text-blue-500/60" />
                                    ) : (
                                      <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom timeline ruler */}
      <TimelineRuler shots={sorted} selectedShotId={selectedShotId} onSelectShot={selectShot} />
    </div>
  );
}

/* ── Shot Card ─────────────────────────────────────────── */

function ShotCard({
  shot,
  characters,
  isSelected,
  onClick,
  onRegenerate,
}: {
  shot: Shot;
  characters: Character[];
  isSelected: boolean;
  onClick: () => void;
  onRegenerate: () => void;
}) {
  const [showOverlay, setShowOverlay] = useState(false);
  const shotChars = characters.filter((c) =>
    shot.subjects.some((s) => s.character_id === c.character_id),
  );
  const statusRing = STATUS_RING[shot.generation_status] ?? STATUS_RING.pending;
  const statusBg = STATUS_BG[shot.generation_status] ?? STATUS_BG.pending;

  return (
    <>
      <div
        className={cn(
          "relative w-40 rounded-lg border-2 cursor-pointer transition-all duration-200 group overflow-hidden",
          statusRing, statusBg,
          isSelected && "ring-2 ring-primary border-primary/50 scale-[1.03] shadow-lg",
          "hover:shadow-md hover:scale-[1.02]",
        )}
      >
        {/* Thumbnail — 16:9 */}
        <div className="relative w-full aspect-video bg-muted/50 overflow-hidden">
          {shot.generated_assets.first_frame ? (
            <img
              src={shot.generated_assets.first_frame}
              alt={`Shot #${shot.sequence_number}`}
              className="w-full h-full object-cover"
            />
          ) : shot.generated_assets.video_url ? (
            <video
              src={shot.generated_assets.video_url}
              preload="metadata"
              muted
              playsInline
              className="w-full h-full object-cover"
              onLoadedData={(e) => { (e.target as HTMLVideoElement).currentTime = 0.5; }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Camera className="h-5 w-5 text-muted-foreground/30" />
            </div>
          )}

          {/* Sequence badge */}
          <div className="absolute top-1 left-1 bg-background/80 backdrop-blur-sm rounded px-1.5 py-0.5 text-[9px] font-mono font-bold">
            {String(shot.sequence_number).padStart(2, "0")}
          </div>

          {/* Duration */}
          <div className="absolute bottom-1 right-1 bg-background/80 backdrop-blur-sm rounded px-1 py-0.5 text-[9px] font-mono text-muted-foreground flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />{shot.duration_seconds}s
          </div>

          {/* High narrative value */}
          {shot.narrative_value === "high" && (
            <Star className="absolute top-1 right-1 h-3 w-3 text-amber-500 fill-amber-500" />
          )}

          {/* Status overlays */}
          {shot.generation_status === "generating" && (
            <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
            </div>
          )}
          {shot.generation_status === "done" && (
            <Check className="absolute bottom-1 left-1 h-3 w-3 text-emerald-500" />
          )}
          {shot.generation_status === "failed" && (
            <XIcon className="absolute bottom-1 left-1 h-3 w-3 text-destructive" />
          )}

          {/* Hover actions */}
          <div className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            {shot.generated_assets.video_url && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowOverlay(true); }}
                className="p-1.5 rounded-full bg-primary/20 hover:bg-primary/30 text-primary transition-colors"
                title="播放视频"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onClick(); }}
              className="p-1.5 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
              title="编辑镜头"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onRegenerate(); }}
              className="p-1.5 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
              title="重新生成首帧"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Info */}
        <div className="px-2 py-1.5" onClick={onClick}>
          <div className="flex items-center gap-1 mb-0.5">
            <p className="text-[10px] text-foreground/80 line-clamp-2 leading-tight flex-1">
              {shot.visual_poetry || shot.tension_moment || shot.subjects[0]?.action || "atmosphere"}
            </p>
            {shot.execution_plan && PATH_LABELS[shot.execution_plan.path] && (
              <span className={cn(
                "text-[8px] font-mono px-1 py-0.5 rounded border shrink-0",
                PATH_LABELS[shot.execution_plan.path].color,
              )}>
                {PATH_LABELS[shot.execution_plan.path].text}
              </span>
            )}
          </div>
          {shotChars.length > 0 && (
            <p className="text-[9px] text-muted-foreground truncate mt-0.5">
              {shotChars.map((c) => c.name).join(" · ")}
            </p>
          )}
          {shot.is_atmosphere && (
            <span className="text-[8px] text-amber-600 dark:text-amber-400 font-mono">🌿 氛围</span>
          )}
        </div>
      </div>

      {/* Video preview overlay */}
      {showOverlay && shot.generated_assets.video_url && (
        <ShotVideoOverlay
          videoUrl={shot.generated_assets.video_url}
          shotNumber={shot.sequence_number}
          duration={shot.duration_seconds}
          onClose={() => setShowOverlay(false)}
        />
      )}
    </>
  );
}

/* ── Shot Video Overlay ─────────────────────────────────── */

function ShotVideoOverlay({
  videoUrl,
  shotNumber,
  duration: shotDuration,
  onClose,
}: {
  videoUrl: string;
  shotNumber: number;
  duration: number;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  const formatTime = (t: number) => {
    const s = Math.floor(t);
    const ms = Math.floor((t % 1) * 10);
    return `${s}.${ms}s`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-w-2xl w-full mx-4 rounded-xl overflow-hidden bg-card shadow-2xl border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-card">
          <div className="flex items-center gap-2">
            <Camera className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold">镜头 #{String(shotNumber).padStart(2, "0")}</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              目标 {shotDuration}s
              {videoDuration > 0 && ` · 实际 ${formatTime(videoDuration)}`}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Video */}
        <div className="relative bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            autoPlay
            className="w-full aspect-video"
            onTimeUpdate={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
            onLoadedMetadata={() => videoRef.current && setVideoDuration(videoRef.current.duration)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onClick={() => {
              if (videoRef.current?.paused) videoRef.current.play();
              else videoRef.current?.pause();
            }}
            style={{ cursor: "pointer" }}
          />
        </div>

        {/* Controls */}
        <div className="px-4 py-2 border-t bg-card flex items-center gap-3">
          <button
            onClick={() => {
              if (videoRef.current?.paused) videoRef.current.play();
              else videoRef.current?.pause();
            }}
            className="p-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>

          {/* Progress bar */}
          <div
            className="flex-1 h-1.5 bg-muted rounded-full cursor-pointer overflow-hidden"
            onClick={(e) => {
              if (!videoRef.current || !videoDuration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              videoRef.current.currentTime = ratio * videoDuration;
            }}
          >
            <div
              className="h-full bg-primary rounded-full transition-[width] duration-100"
              style={{ width: videoDuration > 0 ? `${(currentTime / videoDuration) * 100}%` : "0%" }}
            />
          </div>

          <span className="text-[10px] font-mono text-muted-foreground w-16 text-right">
            {formatTime(currentTime)} / {formatTime(videoDuration)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Timeline Ruler ────────────────────────────────────── */

function TimelineRuler({
  shots,
  selectedShotId,
  onSelectShot,
}: {
  shots: Shot[];
  selectedShotId: string | null;
  onSelectShot: (id: string) => void;
}) {
  const totalDuration = shots.reduce((sum, s) => sum + s.duration_seconds, 0) || 1;

  const statusColor: Record<string, string> = {
    pending: "bg-muted-foreground/20",
    generating: "bg-primary/60 animate-pulse",
    done: "bg-emerald-500/60 dark:bg-emerald-400/60",
    failed: "bg-destructive/60",
    dirty: "bg-amber-500/60 dark:bg-amber-400/60",
  };

  return (
    <div className="flex items-center gap-px px-3 py-1.5 border-t bg-card/30 shrink-0">
      {shots.map((shot) => {
        const widthPercent = (shot.duration_seconds / totalDuration) * 100;
        return (
          <button
            key={shot.shot_id}
            onClick={() => onSelectShot(shot.shot_id)}
            className={cn(
              "h-2 rounded-sm transition-all hover:h-3 cursor-pointer",
              statusColor[shot.generation_status] || "bg-muted-foreground/20",
              selectedShotId === shot.shot_id && "ring-1 ring-primary h-3",
            )}
            style={{ width: `${Math.max(widthPercent, 2)}%` }}
            title={`#${shot.sequence_number} · ${shot.duration_seconds}s`}
          />
        );
      })}
    </div>
  );
}
