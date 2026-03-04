/**
 * VideoPreview — full assembled video player with timeline scrubber.
 * Uses ffmpegMerge to concatenate all shot videos into one playable blob.
 * Shows per-shot markers on the timeline for quick navigation.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { useStoryboardStore } from "../stores/storyboard.store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Play,
  Pause,
  Download,
  Loader2,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";

interface VideoPreviewProps {
  onClose: () => void;
}

export function VideoPreview({ onClose }: VideoPreviewProps) {
  const shots = useStoryboardStore((s) => s.shots);
  const project = useStoryboardStore((s) => s.project);
  const assembledVideoUrl = useStoryboardStore((s) => s.assembledVideoUrl);
  const isAssembling = useStoryboardStore((s) => s.isAssembling);
  const assembleError = useStoryboardStore((s) => s.assembleError);
  const assembleAllShots = useStoryboardStore((s) => s.assembleAllShots);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const doneShots = shots
    .filter((s) => s.generation_status === "done" && s.generated_assets.video_path)
    .sort((a, b) => a.sequence_number - b.sequence_number);

  // Auto-assemble on mount if not already assembled
  useEffect(() => {
    if (!assembledVideoUrl && !isAssembling && doneShots.length >= 2) {
      assembleAllShots();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Video event handlers
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) setDuration(videoRef.current.duration);
  }, []);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    videoRef.current.currentTime = ratio * duration;
  }, [duration]);

  const handleExport = useCallback(() => {
    if (!assembledVideoUrl) return;
    const a = document.createElement("a");
    a.href = assembledVideoUrl;
    a.download = `${project?.name || "storyboard"}_final.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [assembledVideoUrl, project?.name]);

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  // Build shot markers for timeline
  const totalShotDuration = doneShots.reduce((sum, s) => sum + s.duration, 0) || 1;
  const shotMarkers = doneShots.reduce<{ id: string; seq: number; startPct: number; widthPct: number }[]>(
    (acc, shot) => {
      const prevEnd = acc.length > 0 ? acc[acc.length - 1].startPct + acc[acc.length - 1].widthPct : 0;
      acc.push({
        id: shot.shot_id,
        seq: shot.sequence_number,
        startPct: prevEnd,
        widthPct: (shot.duration / totalShotDuration) * 100,
      });
      return acc;
    }, [],
  );

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header — with safe padding-right to avoid Electron window controls */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0 pr-36">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-3 gap-1.5 text-xs"
            onClick={onClose}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回编辑
          </Button>
          <div className="h-4 w-px bg-border" />
          <Play className="h-3.5 w-3.5 text-primary" />
          <span className="text-sm font-semibold">{project?.name || "视频预览"}</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {doneShots.length} 镜头 · {totalShotDuration}s
          </span>
        </div>
        <div className="flex items-center gap-2">
          {assembledVideoUrl && (
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1.5" onClick={handleExport}>
              <Download className="h-3 w-3" /> 导出完整视频
            </Button>
          )}
        </div>
      </div>

      {/* Video area */}
      <div className="flex-1 flex items-center justify-center p-4 min-h-0">
        {isAssembling ? (
          <div className="text-center space-y-3">
            <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">正在组装视频...</p>
            <p className="text-[10px] text-muted-foreground/60">使用 FFmpeg 拼接 {doneShots.length} 个镜头</p>
          </div>
        ) : assembleError ? (
          <div className="text-center space-y-3 max-w-md">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
            <p className="text-sm text-destructive">组装失败</p>
            <p className="text-[10px] text-muted-foreground">{assembleError}</p>
            <Button size="sm" variant="outline" onClick={assembleAllShots}>重试</Button>
          </div>
        ) : assembledVideoUrl ? (
          <video
            ref={videoRef}
            src={assembledVideoUrl}
            className="max-h-full max-w-full rounded-lg shadow-2xl"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            muted={isMuted}
            onClick={togglePlay}
            style={{ cursor: "pointer" }}
          />
        ) : doneShots.length < 2 ? (
          <div className="text-center space-y-3">
            <AlertCircle className="h-10 w-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">至少需要 2 个已完成的镜头才能组装</p>
          </div>
        ) : (
          <div className="text-center space-y-3">
            <Button onClick={assembleAllShots}>开始组装</Button>
          </div>
        )}
      </div>

      {/* Controls bar */}
      {assembledVideoUrl && (
        <div className="border-t bg-card/80 backdrop-blur px-4 py-3 space-y-2 shrink-0">
          {/* Timeline scrubber with shot markers */}
          <div className="relative h-6 cursor-pointer group" onClick={handleSeek}>
            {/* Shot markers background */}
            <div className="absolute inset-x-0 top-1 h-4 flex gap-px rounded overflow-hidden">
              {shotMarkers.map((marker, i) => (
                <div
                  key={marker.id}
                  className={cn(
                    "h-full transition-opacity",
                    i % 2 === 0 ? "bg-primary/15" : "bg-primary/8",
                  )}
                  style={{ width: `${marker.widthPct}%` }}
                  title={`镜头 #${marker.seq}`}
                />
              ))}
            </div>
            {/* Progress bar */}
            <div className="absolute inset-x-0 top-2 h-2 bg-muted/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-[width] duration-100"
                style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : "0%" }}
              />
            </div>
            {/* Playhead */}
            {duration > 0 && (
              <div
                className="absolute top-0 h-6 w-0.5 bg-primary rounded-full shadow-sm"
                style={{ left: `${(currentTime / duration) * 100}%` }}
              />
            )}
          </div>

          {/* Buttons row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={() => { if (videoRef.current) videoRef.current.currentTime = 0; }} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <SkipBack className="h-3.5 w-3.5" />
              </button>
              <button onClick={togglePlay} className="p-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button onClick={() => { if (videoRef.current) videoRef.current.currentTime = duration; }} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <SkipForward className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] font-mono text-muted-foreground ml-2">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setIsMuted(!isMuted)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => videoRef.current?.requestFullscreen()} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
