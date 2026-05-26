/**
 * NodeBodyContent — the inner body rendering of a CustomNode.
 *
 * Extracted from CustomNode to keep each file under 1000 lines.
 * Renders: ML hint, media upload, text input, AI task form,
 * schema params, input ports, segment picker, defParams,
 * inline preview, and results panel.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { useWorkflowStore } from "../../../stores/workflow.store";
import { useExecutionStore } from "../../../stores/execution.store";
import {
  SegmentPointPicker,
  type SegmentPoint,
} from "../../SegmentPointPicker";
import {
  MousePointer2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Camera,
  ExternalLink,
  FolderOpen,
  Link,
  Loader2,
  SkipBack,
  SkipForward,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getSingleImageFromValues } from "@/lib/schemaToForm";
import { convertDesktopModel } from "../../../lib/model-converter";
import type {
  ParamDefinition,
  PortDefinition,
  ModelParamSchema,
  WaveSpeedModel,
} from "@/workflow/types/node-defs";
import type { NodeStatus } from "@/workflow/types/execution";
import { ResultsPanel } from "../../panels/ResultsPanel";
import { FormField } from "@/components/playground/FormField";
import { ModelSelector } from "@/components/playground/ModelSelector";
import type { FormFieldConfig } from "@/lib/schemaToForm";
import type { Model } from "@/types/model";
import { workflowClient } from "@/api/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  type CustomNodeData,
  ML_FREE_TOOLS,
  inputCls,
  paramDefToFormFieldConfig,
  portToFormFieldConfig,
} from "./CustomNodeTypes";
import { HandleAnchor } from "./CustomNodeHandleAnchor";
import {
  Row,
  LinkedBadge,
  ConnectedInputControl,
  Tip,
  Inline3DViewer,
} from "./CustomNodePrimitives";
import {
  ParamRow,
  MediaRow,
  LoraRow,
  JsonRow,
  DefParamControl,
  InputPortControl,
} from "./CustomNodeParamControls";
import {
  MediaUploadBody,
  TextInputBody,
  DirectoryImportBody,
} from "./CustomNodeInputBodies";
import { DynamicFieldsEditor, type FieldConfig } from "./DynamicFieldsEditor";

function formatClockTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00.000";
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = clamped - mins * 60;
  return `${mins}:${secs.toFixed(3).padStart(6, "0")}`;
}

function formatPreciseSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0.000";
  return Math.max(0, seconds).toFixed(3);
}

function frameMime(format: string): string {
  if (format === "jpg" || format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function roundedSeconds(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(3));
}

function summarizeMediaUrl(url: string): Record<string, unknown> {
  if (!url) return { kind: "empty" };
  if (/^local-asset:\/\//i.test(url)) {
    try {
      const decoded = decodeURIComponent(url.replace(/^local-asset:\/\//i, ""));
      return {
        kind: "local-asset",
        file: decoded.split(/[/\\]/).pop() || decoded,
      };
    } catch {
      return { kind: "local-asset", file: "decode-failed" };
    }
  }
  if (/^data:/i.test(url)) return { kind: "data-url" };
  if (/^blob:/i.test(url)) return { kind: "blob-url" };
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      return { kind: parsed.protocol.replace(":", ""), host: parsed.host };
    } catch {
      return { kind: "http-url" };
    }
  }
  return { kind: "other", prefix: url.slice(0, 40) };
}

function serializeTimeRanges(ranges: TimeRanges): Array<[number, number]> {
  const output: Array<[number, number]> = [];
  for (let i = 0; i < ranges.length; i += 1) {
    output.push([
      Number(ranges.start(i).toFixed(3)),
      Number(ranges.end(i).toFixed(3)),
    ]);
  }
  return output;
}

function extractFrameDebug(event: string, payload: Record<string, unknown>) {
  try {
    if (localStorage.getItem("wavespeed_extract_frame_debug") !== "1") return;
  } catch {
    return;
  }
  console.info(`[ExtractFrame] ${event} ${JSON.stringify(payload)}`);
}

const EXTRACT_FRAME_SKIP_SECONDS = 5;
const EXTRACT_FRAME_FRAME_STEP_SECONDS = 1 / 30;

function ExtractFrameTooltipButton({
  label,
  children,
  className,
  disabled,
  onClick,
  variant = "ghost",
  size = "icon",
}: {
  label: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
}) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant={variant}
            size={size}
            className={className}
            onClick={onClick}
            disabled={disabled}
          >
            {children}
            <span className="sr-only">{label}</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function ExtractFrameScrubber({
  nodeId,
  params,
  videoUrl,
  ensureWorkflowId,
  onParamChange,
}: {
  nodeId: string;
  params: Record<string, unknown>;
  videoUrl: string;
  ensureWorkflowId: () => Promise<string | null | undefined>;
  onParamChange: (updates: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(Number(params.time ?? 0) || 0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const paramsRef = useRef(params);
  const isSeekingRef = useRef(false);
  const shouldPauseAfterSeekRef = useRef(false);
  const seekCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTimeUpdateLogRef = useRef(0);
  const format = String(params.format ?? "png").toLowerCase();

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const debugVideoEvent = useCallback(
    (
      event: string,
      video: HTMLVideoElement,
      extra: Record<string, unknown> = {},
    ) => {
      extractFrameDebug(event, {
        nodeId,
        video: summarizeMediaUrl(video.currentSrc || video.src),
        videoTime: roundedSeconds(video.currentTime),
        stateTime: roundedSeconds(currentTime),
        paramsTime: roundedSeconds(Number(paramsRef.current.time ?? 0)),
        duration: roundedSeconds(video.duration),
        durationState: roundedSeconds(duration),
        paused: video.paused,
        seeking: video.seeking,
        seekingRef: isSeekingRef.current,
        readyState: video.readyState,
        networkState: video.networkState,
        seekable: serializeTimeRanges(video.seekable),
        buffered: serializeTimeRanges(video.buffered),
        error: video.error
          ? { code: video.error.code, message: video.error.message }
          : null,
        ...extra,
      });
    },
    [currentTime, duration, nodeId],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    setError("");
    extractFrameDebug("video-url", {
      nodeId,
      video: summarizeMediaUrl(videoUrl),
      paramsTime: roundedSeconds(Number(paramsRef.current.time ?? 0)),
    });
  }, [nodeId, videoUrl]);

  const updateTimeParam = useCallback(
    (time: number) => {
      const nextTime = Number(time.toFixed(3));
      extractFrameDebug("params-time-update", {
        nodeId,
        from: roundedSeconds(Number(paramsRef.current.time ?? 0)),
        to: nextTime,
      });
      onParamChange({ ...paramsRef.current, time: nextTime });
    },
    [nodeId, onParamChange],
  );

  const commitTime = useCallback(
    (time: number) => {
      const nextTime = Math.max(0, Math.min(time, duration || time));
      extractFrameDebug("commit-time", {
        nodeId,
        input: roundedSeconds(time),
        nextTime: roundedSeconds(nextTime),
        durationState: roundedSeconds(duration),
      });
      setCurrentTime(nextTime);
      updateTimeParam(nextTime);
    },
    [duration, nodeId, updateTimeParam],
  );

  const clearSeekCommitTimer = useCallback(() => {
    if (!seekCommitTimerRef.current) return;
    clearTimeout(seekCommitTimerRef.current);
    seekCommitTimerRef.current = null;
  }, []);

  const scheduleSeekCommitFallback = useCallback(
    (time: number) => {
      clearSeekCommitTimer();
      seekCommitTimerRef.current = setTimeout(() => {
        const video = videoRef.current;
        const settledTime = video ? video.currentTime : time;
        if (video && shouldPauseAfterSeekRef.current && !video.paused) {
          video.pause();
        }
        shouldPauseAfterSeekRef.current = false;
        isSeekingRef.current = false;
        extractFrameDebug("seek-fallback-commit", {
          nodeId,
          requested: roundedSeconds(time),
          settledTime: roundedSeconds(settledTime),
        });
        commitTime(settledTime);
      }, 500);
    },
    [clearSeekCommitTimer, commitTime, nodeId],
  );

  useEffect(() => {
    return () => clearSeekCommitTimer();
  }, [clearSeekCommitTimer]);

  const seekTo = useCallback(
    (time: number) => {
      const video = videoRef.current;
      const nextTime = Math.max(0, Math.min(time, duration || time));
      extractFrameDebug("button-seek", {
        nodeId,
        requested: roundedSeconds(time),
        nextTime: roundedSeconds(nextTime),
        beforeVideoTime: video ? roundedSeconds(video.currentTime) : null,
      });
      setCurrentTime(nextTime);
      if (video && Number.isFinite(nextTime)) {
        shouldPauseAfterSeekRef.current = true;
        isSeekingRef.current = true;
        if (!video.paused) video.pause();
        video.currentTime = nextTime;
        scheduleSeekCommitFallback(nextTime);
        debugVideoEvent("button-seek-after-set", video, {
          requested: roundedSeconds(time),
          nextTime: roundedSeconds(nextTime),
        });
      } else {
        commitTime(nextTime);
      }
    },
    [commitTime, debugVideoEvent, duration, nodeId, scheduleSeekCommitFallback],
  );

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;

    try {
      debugVideoEvent("capture-start", video);
      setIsSaving(true);
      setError("");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to create canvas context.");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error("Capture failed.")),
          frameMime(format),
          0.95,
        );
      });
      const wfId = await ensureWorkflowId();
      if (!wfId) throw new Error("Workflow not saved yet.");
      const { storageIpc } = await import("../../../ipc/ipc-client");
      const arrBuf = await blob.arrayBuffer();
      const ext = format === "jpg" || format === "jpeg" ? "jpg" : format;
      const captureTime = Number(video.currentTime.toFixed(3));
      const frameStamp = String(captureTime).replace(".", "-");
      const outputDir = String(paramsRef.current.outputDir ?? "").trim();
      const fileName = `extracted-frame-${frameStamp}-${Date.now()}.${ext}`;
      const localPath = await storageIpc.saveNodeOutput(
        wfId,
        nodeId,
        "extracted-frame",
        ext,
        arrBuf,
      );
      const exportPath = outputDir
        ? await storageIpc.saveFileToDirectory(outputDir, fileName, arrBuf)
        : "";
      const url = `local-asset://${encodeURIComponent(localPath)}`;
      extractFrameDebug("capture-saved", {
        nodeId,
        captureTime,
        preview: summarizeMediaUrl(url),
        outputDir,
        exportPath: exportPath ? summarizeMediaUrl(exportPath) : null,
      });
      const nextParams = { ...paramsRef.current };
      delete nextParams.__previewFrame;
      onParamChange({
        ...nextParams,
        time: captureTime,
      });
      useExecutionStore.setState((state) => {
        const existing = state.lastResults[nodeId] ?? [];
        return {
          lastResults: {
            ...state.lastResults,
            [nodeId]: [
              {
                urls: [url],
                time: new Date().toISOString(),
                cost: 0,
                durationMs: 0,
              },
              ...existing,
            ].slice(0, 50),
          },
          selectedOutputIndex: {
            ...state.selectedOutputIndex,
            [nodeId]: 0,
          },
          nodeStatuses: {
            ...state.nodeStatuses,
            [nodeId]: "confirmed",
          },
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      extractFrameDebug("capture-error", {
        nodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSaving(false);
    }
  }, [debugVideoEvent, ensureWorkflowId, format, nodeId, onParamChange]);

  if (!videoUrl) {
    return (
      <div className="mx-3 my-1 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        {t(
          "workflow.extractFrame.needVideo",
          "Connect or upload a video to scrub and choose a frame.",
        )}
      </div>
    );
  }

  return (
    <div
      className="nodrag nopan mx-3 my-1 space-y-2 rounded-lg border border-border bg-muted/20 p-2"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="relative overflow-hidden rounded-md border border-border bg-black">
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          preload="metadata"
          className="nodrag nopan h-auto max-h-[260px] w-full object-contain"
          onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            const d = Number.isFinite(video.duration) ? video.duration : 0;
            setDuration(d);
            const requested = Number(params.time ?? 0);
            const next = Number.isFinite(requested)
              ? Math.min(Math.max(0, requested), d || requested)
              : 0;
            setCurrentTime(next);
            if (next > 0) video.currentTime = next;
            debugVideoEvent("loadedmetadata", video, {
              requested: roundedSeconds(requested),
              next: roundedSeconds(next),
            });
          }}
          onTimeUpdate={(e) => {
            setCurrentTime(e.currentTarget.currentTime);
            const now = Date.now();
            if (now - lastTimeUpdateLogRef.current > 750) {
              lastTimeUpdateLogRef.current = now;
              debugVideoEvent("timeupdate", e.currentTarget);
            }
          }}
          onSeeking={(e) => {
            const video = e.currentTarget;
            isSeekingRef.current = true;
            shouldPauseAfterSeekRef.current = true;
            setCurrentTime(video.currentTime);
            if (!video.paused) video.pause();
            scheduleSeekCommitFallback(video.currentTime);
            debugVideoEvent("seeking", video);
          }}
          onSeeked={(e) => {
            clearSeekCommitTimer();
            if (shouldPauseAfterSeekRef.current && !e.currentTarget.paused) {
              e.currentTarget.pause();
            }
            shouldPauseAfterSeekRef.current = false;
            isSeekingRef.current = false;
            debugVideoEvent("seeked-before-commit", e.currentTarget);
            commitTime(e.currentTarget.currentTime);
          }}
          onPlay={(e) => {
            debugVideoEvent("play", e.currentTarget);
          }}
          onPlaying={(e) => {
            debugVideoEvent("playing", e.currentTarget);
          }}
          onPause={(e) => {
            debugVideoEvent("pause", e.currentTarget, {
              willCommit: !isSeekingRef.current,
            });
            if (isSeekingRef.current) return;
            commitTime(e.currentTarget.currentTime);
          }}
          onEnded={(e) => {
            debugVideoEvent("ended", e.currentTarget);
            commitTime(e.currentTarget.currentTime);
          }}
          onWaiting={(e) => {
            debugVideoEvent("waiting", e.currentTarget);
          }}
          onStalled={(e) => {
            debugVideoEvent("stalled", e.currentTarget);
          }}
          onSuspend={(e) => {
            debugVideoEvent("suspend", e.currentTarget);
          }}
          onError={() => {
            const video = videoRef.current;
            if (video) debugVideoEvent("video-error", video);
            setError(
              t(
                "workflow.extractFrame.loadFailed",
                "Could not load this video preview.",
              ),
            );
          }}
        />
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="inline-flex min-w-0 justify-self-start whitespace-nowrap rounded-md border border-border bg-background/80 px-2.5 py-1.5 text-[10px] text-muted-foreground">
          <span className="tabular-nums">
            {formatPreciseSeconds(currentTime)}
          </span>
          <span className="mx-1 text-muted-foreground/60">/</span>
          <span className="tabular-nums">{formatPreciseSeconds(duration)}</span>
        </div>
        <div className="flex items-center gap-0.5 justify-self-center rounded-md border border-border bg-background/70 p-0.5">
          <ExtractFrameTooltipButton
            label={t("workflow.extractFrame.previousFrame", "Previous frame")}
            className="h-6 w-6"
            onClick={() =>
              seekTo(currentTime - EXTRACT_FRAME_FRAME_STEP_SECONDS)
            }
            disabled={!duration}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </ExtractFrameTooltipButton>
          <ExtractFrameTooltipButton
            label={t("workflow.extractFrame.backFive", "Back 5 seconds")}
            className="h-6 w-6"
            onClick={() => seekTo(currentTime - EXTRACT_FRAME_SKIP_SECONDS)}
            disabled={!duration}
          >
            <SkipBack className="h-3.5 w-3.5" />
          </ExtractFrameTooltipButton>
          <ExtractFrameTooltipButton
            label={t("workflow.extractFrame.forwardFive", "Forward 5 seconds")}
            className="h-6 w-6"
            onClick={() => seekTo(currentTime + EXTRACT_FRAME_SKIP_SECONDS)}
            disabled={!duration}
          >
            <SkipForward className="h-3.5 w-3.5" />
          </ExtractFrameTooltipButton>
          <ExtractFrameTooltipButton
            label={t("workflow.extractFrame.nextFrame", "Next frame")}
            className="h-6 w-6"
            onClick={() =>
              seekTo(currentTime + EXTRACT_FRAME_FRAME_STEP_SECONDS)
            }
            disabled={!duration}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </ExtractFrameTooltipButton>
        </div>
        <div className="justify-self-end">
          <ExtractFrameTooltipButton
            label={t(
              "workflow.extractFrame.captureResult",
              "Capture the selected frame to Results",
            )}
            size="sm"
            className="h-8 gap-1.5 px-3"
            onClick={handleCapture}
            disabled={isSaving || !duration}
            variant="default"
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
            <span className="text-xs">
              {t("workflow.extractFrame.capture", "Capture")}
            </span>
          </ExtractFrameTooltipButton>
        </div>
      </div>

      {error && <p className="text-[10px] text-red-400">{error}</p>}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

function ExtractFrameVideoInput({
  nodeId,
  value,
  ensureWorkflowId,
  onChange,
}: {
  nodeId: string;
  value: unknown;
  ensureWorkflowId: () => Promise<string | null | undefined>;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [showUrl, setShowUrl] = useState(() => {
    const initial = String(value ?? "").trim();
    return Boolean(initial && !/^local-asset:\/\//i.test(initial));
  });
  const urlInputRef = useRef<HTMLInputElement>(null);
  const textVal = String(value ?? "");
  const isRemoteUrl = Boolean(textVal && !/^local-asset:\/\//i.test(textVal));
  const displayName = useMemo(() => {
    if (!textVal) return "";
    try {
      const decoded = /^local-asset:\/\//i.test(textVal)
        ? decodeURIComponent(textVal.replace(/^local-asset:\/\//i, ""))
        : textVal;
      return decoded.split(/[/\\]/).pop() || decoded;
    } catch {
      return textVal;
    }
  }, [textVal]);

  const handleFile = useCallback(
    async (file: File) => {
      try {
        setUploading(true);
        const wfId = await ensureWorkflowId();
        if (!wfId) throw new Error("Workflow not saved yet.");
        const { storageIpc } = await import("../../../ipc/ipc-client");
        const data = await file.arrayBuffer();
        const localPath = await storageIpc.saveUploadedFile(
          wfId,
          nodeId,
          file.name,
          data,
        );
        onChange(`local-asset://${encodeURIComponent(localPath)}`);
        setShowUrl(false);
      } catch (error) {
        console.error("Extract frame video upload failed:", error);
      } finally {
        setUploading(false);
      }
    },
    [ensureWorkflowId, nodeId, onChange],
  );

  return (
    <div
      className="nodrag nopan w-full space-y-2"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <div className="group relative min-w-0 flex-1">
          <label
            className={`flex min-h-[38px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border bg-background px-3 py-2 transition-all duration-200 hover:border-primary/50 hover:bg-muted/30 hover:shadow-sm ${
              uploading ? "animate-pulse" : ""
            } ${textVal ? "pr-9" : ""}`}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate text-xs text-muted-foreground">
              {displayName || t("workflow.mediaUpload.clickUpload", "点击上传")}
            </span>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.currentTarget.value = "";
              }}
            />
          </label>
          {textVal && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-all hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onChange("");
                    setShowUrl(false);
                  }}
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">
                    {t("workflow.extractFrame.clearVideo", "Clear video")}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {t("workflow.extractFrame.clearVideo", "Clear video")}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-[38px] w-[38px] flex-shrink-0"
              onClick={() => {
                setShowUrl((visible) => !visible);
                window.setTimeout(() => {
                  urlInputRef.current?.focus();
                  urlInputRef.current?.select();
                }, 0);
              }}
            >
              <Link className="h-4 w-4" />
              <span className="sr-only">
                {t("workflow.extractFrame.useUrl", "Use URL")}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {t("workflow.extractFrame.useUrl", "Use URL")}
          </TooltipContent>
        </Tooltip>
      </div>
      {(showUrl || isRemoteUrl) && (
        <input
          ref={urlInputRef}
          type="text"
          value={isRemoteUrl ? textVal : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t(
            "workflow.mediaUpload.urlPlaceholder",
            "或输入 URL...",
          )}
          className={`${inputCls} w-full`}
        />
      )}
    </div>
  );
}

function ExtractFrameOutputDirectory({
  value,
  ensureWorkflowId,
  onChange,
}: {
  value: unknown;
  ensureWorkflowId: () => Promise<string | null | undefined>;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const textVal = String(value ?? "");
  const [expanded, setExpanded] = useState(Boolean(textVal.trim()));
  const [selectingDir, setSelectingDir] = useState(false);
  const [openingDir, setOpeningDir] = useState(false);

  const fallbackHint = t(
    "workflow.extractFrame.localExportOffHint",
    "Not set: no extra local export",
  );
  const hasCustomDir = Boolean(textVal.trim());

  const handlePickDirectory = async () => {
    try {
      setSelectingDir(true);
      const result = await window.electronAPI?.selectDirectory?.();
      if (result?.success && result.path) {
        onChange(result.path);
        setExpanded(true);
      }
    } catch (error) {
      console.error("Select extract frame output directory failed:", error);
    } finally {
      setSelectingDir(false);
    }
  };

  const handleOpenDirectory = async () => {
    try {
      setOpeningDir(true);
      const dir = textVal.trim();
      if (dir) {
        await window.electronAPI?.openFileLocation?.(dir);
        return;
      }
      return;
    } catch (error) {
      console.error("Open extract frame output directory failed:", error);
    } finally {
      setOpeningDir(false);
    }
  };

  return (
    <div className="px-3 py-1.5 nodrag" onClick={(e) => e.stopPropagation()}>
      <div
        className={`rounded-lg border transition-colors ${
          expanded || hasCustomDir
            ? "border-primary/30 bg-primary/5"
            : "border-dashed border-border bg-muted/20 hover:border-primary/30 hover:bg-muted/30"
        }`}
      >
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${
                hasCustomDir
                  ? "bg-primary/15 text-primary"
                  : "bg-background text-muted-foreground"
              }`}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-foreground">
                {t(
                  "workflow.extractFrame.saveToLocalFolder",
                  "Save to Local Folder",
                )}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {hasCustomDir
                  ? textVal
                  : t(
                      "workflow.extractFrame.localExportOff",
                      "Local export is off",
                    )}
              </span>
            </span>
          </span>
          <span
            className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] ${
              hasCustomDir
                ? "bg-primary/10 text-primary"
                : "bg-background text-muted-foreground"
            }`}
          >
            {hasCustomDir
              ? t("workflow.extractFrame.customFolder", "Custom")
              : t("workflow.extractFrame.exportOff", "Off")}
            <ChevronDown
              className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${
                expanded ? "rotate-180" : ""
              }`}
            />
          </span>
        </button>
        {expanded && (
          <div className="space-y-1 border-t border-border/70 px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={textVal}
                onChange={(e) => onChange(e.target.value)}
                placeholder={t(
                  "workflow.nodeDefs.output/file.params.outputDir.placeholder",
                  "Choose a folder to export a local copy",
                )}
                className={`${inputCls} flex-1`}
              />
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={handlePickDirectory}
                  >
                    {selectingDir ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FolderOpen className="h-3.5 w-3.5" />
                    )}
                    <span className="sr-only">
                      {t("workflow.selectDirectory", "Select directory")}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {t("workflow.selectDirectory", "Select directory")}
                </TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={handleOpenDirectory}
                    disabled={!textVal.trim()}
                  >
                    {openingDir ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3.5 w-3.5" />
                    )}
                    <span className="sr-only">
                      {textVal.trim()
                        ? t("workflow.openFolder", "Open folder")
                        : t(
                            "workflow.extractFrame.noFolderToOpen",
                            "No folder set",
                          )}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {textVal.trim()
                    ? t("workflow.openFolder", "Open folder")
                    : t(
                        "workflow.extractFrame.noFolderToOpen",
                        "No folder set",
                      )}
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="truncate text-[10px] text-muted-foreground">
              {textVal || fallbackHint}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export interface CustomNodeBodyProps {
  id: string;
  data: CustomNodeData;
  status: NodeStatus;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    targetHandle?: string | null;
  }>;
  connectedSet: Set<string>;
  inputDefs: PortDefinition[];
  paramDefs: ParamDefinition[];
  isAITask: boolean;
  isPreviewNode: boolean;
  currentModelId: string;
  currentModel: Model | undefined;
  storeModels: Model[];
  getModelById: (id: string) => Model | undefined;
  usePlaygroundForm: boolean;
  visibleFormFields: FormFieldConfig[];
  hiddenFormFields: FormFieldConfig[];
  enabledHiddenFields: Set<string>;
  setEnabledHiddenFields: Dispatch<SetStateAction<Set<string>>>;
  orderedVisibleParams: ModelParamSchema[];
  optionalParams: ModelParamSchema[];
  showOptional: boolean;
  setShowOptional: Dispatch<SetStateAction<boolean>>;
  formValues: Record<string, unknown>;
  resultGroups: unknown[];
  setParam: (key: string, value: unknown) => void;
  updateNodeParams: (nodeId: string, params: Record<string, unknown>) => void;
  openPreview: (src: string) => void;
  handleInlineSelectModel: (model: WaveSpeedModel) => void;
  handleWorkflowUploadFile: (file: File) => Promise<string>;
  localizeInputLabel: (key: string, fallback: string) => string;
  localizeParamLabel: (key: string, fallback: string) => string;
  localizeParamDescription: (
    key: string,
    fallback?: string,
  ) => string | undefined;
  segmentPointPickerOpen: boolean;
  setSegmentPointPickerOpen: Dispatch<SetStateAction<boolean>>;
  ensureWorkflowId: () => Promise<string | null | undefined>;
  inlineInputPreviewUrl: string;
  inlinePreviewIsImage: boolean;
  inlinePreviewIsVideo: boolean;
  inlinePreviewIsAudio: boolean;
  inlinePreviewIs3D: boolean;
  resultsExpanded: boolean;
  setResultsExpanded: Dispatch<SetStateAction<boolean>>;
  collapsed?: boolean;
}

export function CustomNodeBody(props: CustomNodeBodyProps) {
  const {
    id,
    data,
    status,
    edges,
    connectedSet,
    inputDefs,
    paramDefs,
    isAITask,
    isPreviewNode,
    currentModelId,
    currentModel,
    storeModels,
    getModelById,
    usePlaygroundForm,
    visibleFormFields,
    hiddenFormFields,
    enabledHiddenFields,
    setEnabledHiddenFields,
    orderedVisibleParams,
    optionalParams,
    showOptional,
    setShowOptional,
    formValues,
    resultGroups,
    setParam,
    updateNodeParams,
    openPreview,
    handleInlineSelectModel,
    handleWorkflowUploadFile,
    localizeInputLabel,
    localizeParamLabel,
    localizeParamDescription,
    segmentPointPickerOpen,
    setSegmentPointPickerOpen,
    ensureWorkflowId,
    inlineInputPreviewUrl,
    inlinePreviewIsImage,
    inlinePreviewIsVideo,
    inlinePreviewIsAudio,
    inlinePreviewIs3D,
    resultsExpanded,
    setResultsExpanded,
    collapsed = false,
  } = props;
  const { t } = useTranslation();
  const allNodes = useWorkflowStore((s) => s.nodes);
  const allLastResults = useExecutionStore((s) => s.lastResults);
  const selectedOutputIndex = useExecutionStore((s) => s.selectedOutputIndex);

  const extractFrameVideoUrl = useMemo(() => {
    if (data.nodeType !== "free-tool/extract-frame") return "";
    const localInput = String(data.params.input ?? "");
    if (localInput.trim()) return localInput;

    const edge = edges.find(
      (e) => e.target === id && e.targetHandle === "input-input",
    );
    if (!edge) return "";

    const selectedIndex = selectedOutputIndex[edge.source] ?? 0;
    const latest = allLastResults[edge.source]?.[selectedIndex]?.urls?.[0];
    if (latest) return latest;

    const sourceNode = allNodes.find((n) => n.id === edge.source);
    const sourceParams = sourceNode?.data?.params as
      | Record<string, unknown>
      | undefined;
    return String(
      sourceParams?.uploadedUrl ??
        sourceParams?.output ??
        sourceParams?.input ??
        "",
    );
  }, [
    allLastResults,
    allNodes,
    data.nodeType,
    data.params.input,
    edges,
    id,
    selectedOutputIndex,
  ]);

  /** CDN upload via workflowClient so workflow requests use the correct X-Client-Name header. */
  const handleCdnUpload = async (file: File): Promise<string> => {
    return workflowClient.uploadFile(file);
  };

  /* ── Collapsed: only connected rows in same order as expanded ── */
  if (collapsed) {
    return (
      <div className="px-1">
        {data.nodeType === "input/media-upload" &&
          inputDefs.map((inp) => {
            const hid = `input-${inp.key}`;
            if (!connectedSet.has(hid)) return null;
            return (
              <Row key={inp.key}>
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="text-xs whitespace-nowrap flex-shrink-0 text-green-400 font-semibold">
                    <HandleAnchor id={hid} type="target" connected media />
                    {localizeInputLabel(inp.key, inp.label)}
                  </span>
                  <ConnectedInputControl
                    nodeId={id}
                    handleId={hid}
                    edges={edges}
                    nodes={useWorkflowStore.getState().nodes}
                    onPreview={openPreview}
                  />
                </div>
              </Row>
            );
          })}
        {isAITask && (
          <div
            className="nodrag px-3 mb-1"
            onClick={(e) => e.stopPropagation()}
          >
            <ModelSelector
              models={storeModels}
              value={currentModelId || undefined}
              onChange={(modelId) => {
                const storeModel = getModelById(modelId);
                if (!storeModel) return;
                handleInlineSelectModel(convertDesktopModel(storeModel));
              }}
            />
          </div>
        )}
        {isAITask &&
          usePlaygroundForm &&
          visibleFormFields.map((field) => {
            const hid = `param-${field.name}`;
            if (!connectedSet.has(hid)) return null;
            const isMediaField =
              field.type === "file" ||
              field.type === "file-array" ||
              /image|video|audio|mask/i.test(field.name);
            return (
              <Row key={field.name}>
                <div className="flex flex-col gap-1 w-full">
                  <div className="flex items-center">
                    <span className="text-sm font-medium leading-none">
                      <HandleAnchor
                        id={hid}
                        type="target"
                        connected
                        media={isMediaField}
                      />
                      {field.label || field.name}
                      {field.required && (
                        <span className="ml-0.5 text-destructive">*</span>
                      )}
                    </span>
                  </div>
                  {isMediaField ? (
                    <ConnectedInputControl
                      nodeId={id}
                      handleId={hid}
                      edges={edges}
                      nodes={useWorkflowStore.getState().nodes}
                      onPreview={openPreview}
                    />
                  ) : (
                    <LinkedBadge
                      nodeId={id}
                      handleId={hid}
                      edges={edges}
                      nodes={useWorkflowStore.getState().nodes}
                      onDisconnect={() => {
                        const edge = edges.find(
                          (e) => e.target === id && e.targetHandle === hid,
                        );
                        if (edge)
                          useWorkflowStore.getState().removeEdge(edge.id);
                      }}
                    />
                  )}
                </div>
              </Row>
            );
          })}
        {isAITask &&
          usePlaygroundForm &&
          hiddenFormFields.map((field) => {
            const hid = `param-${field.name}`;
            if (!connectedSet.has(hid)) return null;
            const isMediaField =
              field.type === "file" ||
              field.type === "file-array" ||
              /image|video|audio|mask/i.test(field.name);
            return (
              <Row key={field.name}>
                <div className="flex flex-col gap-1 w-full">
                  <div className="flex items-center">
                    <span className="text-sm font-medium leading-none">
                      <HandleAnchor
                        id={hid}
                        type="target"
                        connected
                        media={isMediaField}
                      />
                      {field.label || field.name}
                    </span>
                  </div>
                  {isMediaField ? (
                    <ConnectedInputControl
                      nodeId={id}
                      handleId={hid}
                      edges={edges}
                      nodes={useWorkflowStore.getState().nodes}
                      onPreview={openPreview}
                    />
                  ) : (
                    <LinkedBadge
                      nodeId={id}
                      handleId={hid}
                      edges={edges}
                      nodes={useWorkflowStore.getState().nodes}
                      onDisconnect={() => {
                        const edge = edges.find(
                          (e) => e.target === id && e.targetHandle === hid,
                        );
                        if (edge)
                          useWorkflowStore.getState().removeEdge(edge.id);
                      }}
                    />
                  )}
                </div>
              </Row>
            );
          })}
        {data.nodeType !== "input/media-upload" &&
          data.nodeType !== "input/text-input" &&
          inputDefs.map((inp) => {
            const hid = `input-${inp.key}`;
            if (!connectedSet.has(hid)) return null;
            return (
              <Row key={inp.key}>
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="text-xs whitespace-nowrap flex-shrink-0 text-green-400 font-semibold">
                    <HandleAnchor id={hid} type="target" connected media />
                    {localizeInputLabel(inp.key, inp.label)}
                    {inp.required && <span className="text-red-400"> *</span>}
                  </span>
                  <ConnectedInputControl
                    nodeId={id}
                    handleId={hid}
                    edges={edges}
                    nodes={useWorkflowStore.getState().nodes}
                    onPreview={openPreview}
                  />
                </div>
              </Row>
            );
          })}
        {/* HTTP Response: dynamic input handles in collapsed mode */}
        {data.nodeType === "output/http-response" &&
          (
            (data.inputDefinitions ?? []) as Array<{
              key: string;
              label: string;
              required?: boolean;
            }>
          ).map((inp) => {
            const hid = `input-${inp.key}`;
            if (!connectedSet.has(hid)) return null;
            return (
              <Row key={inp.key}>
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="text-xs whitespace-nowrap flex-shrink-0 text-green-400 font-semibold">
                    <HandleAnchor id={hid} type="target" connected media />
                    {inp.label || inp.key}
                  </span>
                  <ConnectedInputControl
                    nodeId={id}
                    handleId={hid}
                    edges={edges}
                    nodes={useWorkflowStore.getState().nodes}
                    onPreview={openPreview}
                  />
                </div>
              </Row>
            );
          })}
        {data.nodeType !== "input/media-upload" &&
          data.nodeType !== "input/text-input" &&
          paramDefs.map((p) => {
            const hid = `param-${p.key}`;
            const canConnect =
              p.connectable !== false && p.dataType !== undefined;
            if (!canConnect || !connectedSet.has(hid)) return null;
            return (
              <Row key={p.key}>
                <div className="flex flex-col gap-1 w-full">
                  <div className="flex items-center">
                    <span className="text-sm font-medium leading-none">
                      <HandleAnchor id={hid} type="target" connected />
                      {localizeParamLabel(p.key, p.label)}
                    </span>
                  </div>
                  <LinkedBadge
                    nodeId={id}
                    handleId={hid}
                    edges={edges}
                    nodes={useWorkflowStore.getState().nodes}
                    onDisconnect={() => {
                      const edge = edges.find(
                        (e) => e.target === id && e.targetHandle === hid,
                      );
                      if (edge) useWorkflowStore.getState().removeEdge(edge.id);
                    }}
                  />
                </div>
              </Row>
            );
          })}
      </div>
    );
  }

  return (
    <div className="px-1 space-y-px">
      {/* Free-tool ML model download hint */}
      {status === "idle" &&
        resultGroups.length === 0 &&
        ML_FREE_TOOLS.has(data.nodeType) && (
          <div className="mx-3 mb-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <svg
              className="flex-shrink-0 text-amber-400"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="text-[10px] text-amber-400/90 leading-tight">
              {t(
                "workflow.freeToolModelHint",
                "First run will auto-download the AI model, please wait",
              )}
            </span>
          </div>
        )}

      {/* Trigger node hint — explains repeated triggering */}
      {(data.nodeType === "trigger/http" ||
        data.nodeType === "trigger/directory") && (
        <div className="mx-3 mb-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <svg
            className="flex-shrink-0 text-blue-400"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span className="text-[10px] text-blue-400/90 leading-tight">
            {t(
              "workflow.triggerHint",
              "This trigger will repeatedly run the downstream workflow each time it fires",
            )}
          </span>
        </div>
      )}

      {/* Media Upload node — special UI */}
      {data.nodeType === "input/media-upload" && (
        <>
          {inputDefs.map((inp) => {
            const hid = `input-${inp.key}`;
            const conn = connectedSet.has(hid);
            return (
              <Row key={inp.key}>
                <div className="flex items-center justify-between gap-2 w-full">
                  <span
                    className={`text-xs whitespace-nowrap flex-shrink-0 ${conn ? "text-green-400 font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}
                  >
                    <HandleAnchor
                      id={hid}
                      type="target"
                      connected={conn}
                      media
                    />
                    {localizeInputLabel(inp.key, inp.label)}
                  </span>
                  {conn && (
                    <ConnectedInputControl
                      nodeId={id}
                      handleId={hid}
                      edges={edges}
                      nodes={useWorkflowStore.getState().nodes}
                      onPreview={openPreview}
                    />
                  )}
                </div>
              </Row>
            );
          })}
          {!connectedSet.has("input-media") && (
            <MediaUploadBody
              params={data.params}
              onBatchChange={(updates) => {
                updateNodeParams(id, { ...data.params, ...updates });
              }}
              onPreview={openPreview}
            />
          )}
        </>
      )}

      {/* Text Input node — special UI */}
      {data.nodeType === "input/text-input" && (
        <TextInputBody
          params={data.params}
          onParamChange={(updates) => {
            updateNodeParams(id, { ...data.params, ...updates });
          }}
        />
      )}

      {/* Directory Trigger node — reuse directory picker UI */}
      {data.nodeType === "trigger/directory" && (
        <DirectoryImportBody
          params={data.params}
          onParamChange={(updates) => {
            updateNodeParams(id, { ...data.params, ...updates });
          }}
        />
      )}

      {/* HTTP Trigger — port + dynamic output fields editor */}
      {data.nodeType === "trigger/http" && (
        <>
          <div
            className="px-3 py-1 nodrag"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground">
                {t("workflow.port", "Port")}
              </Label>
              <Input
                type="number"
                value={Number(data.params.port ?? 3100)}
                onChange={(e) => setParam("port", Number(e.target.value))}
                className="w-20 h-8 text-xs text-right"
              />
            </div>
          </div>
          <DynamicFieldsEditor
            direction="output"
            fields={(() => {
              try {
                const raw = data.params.outputFields;
                return typeof raw === "string"
                  ? JSON.parse(raw)
                  : Array.isArray(raw)
                    ? raw
                    : [];
              } catch {
                return [];
              }
            })()}
            onChange={(fields: FieldConfig[]) => {
              // Get old fields to detect key renames
              let oldFields: FieldConfig[] = [];
              try {
                const raw = data.params.outputFields;
                oldFields =
                  typeof raw === "string"
                    ? JSON.parse(raw)
                    : Array.isArray(raw)
                      ? raw
                      : [];
              } catch {
                /* ignore */
              }

              // Detect renamed keys and update edge sourceHandles
              const { edges: currentEdges } = useWorkflowStore.getState();
              let updatedEdges = currentEdges;
              let edgesChanged = false;
              for (
                let i = 0;
                i < Math.min(oldFields.length, fields.length);
                i++
              ) {
                const oldKey = oldFields[i]?.key;
                const newKey = fields[i]?.key;
                if (oldKey && newKey && oldKey !== newKey) {
                  updatedEdges = updatedEdges.map((e) => {
                    if (e.source === id && e.sourceHandle === oldKey) {
                      edgesChanged = true;
                      return { ...e, sourceHandle: newKey };
                    }
                    return e;
                  });
                }
              }

              if (edgesChanged) {
                useWorkflowStore.setState({ edges: updatedEdges });
              }
              // Also update outputDefinitions to match the new fields
              const newOutputDefs = fields.map((f: FieldConfig) => ({
                key: f.key,
                label: f.label || f.key,
                dataType: f.type || "any",
                required: true,
              }));
              updateNodeParams(id, {
                ...data.params,
                outputFields: JSON.stringify(fields),
              });
              useWorkflowStore.setState((s) => ({
                nodes: s.nodes.map((n) =>
                  n.id === id
                    ? {
                        ...n,
                        data: { ...n.data, outputDefinitions: newOutputDefs },
                      }
                    : n,
                ),
              }));
            }}
            renderHandle={(fieldKey) => (
              <HandleAnchor id={fieldKey} type="source" connected={false} />
            )}
          />
        </>
      )}

      {/* HTTP Response — dynamic input fields editor + statusCode */}
      {data.nodeType === "output/http-response" && (
        <>
          {/* Dynamic input port rows — each responseField becomes a connectable input */}
          {(() => {
            const dynInputDefs = (data.inputDefinitions ?? []) as Array<{
              key: string;
              label: string;
              dataType?: string;
              required?: boolean;
            }>;
            // Only show dynamic inputs for http-response (not the static inputDefs)
            if (dynInputDefs.length > 0) {
              return dynInputDefs.map((inp) => {
                const hid = `input-${inp.key}`;
                const conn = connectedSet.has(hid);
                return (
                  <Row key={inp.key}>
                    <div className="flex items-center justify-between gap-2 w-full">
                      <span
                        className={`text-xs whitespace-nowrap flex-shrink-0 ${conn ? "text-green-400 font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}
                      >
                        <HandleAnchor
                          id={hid}
                          type="target"
                          connected={conn}
                          media
                        />
                        {inp.label || inp.key}
                        {inp.required && (
                          <span className="text-red-400"> *</span>
                        )}
                      </span>
                      {conn && (
                        <ConnectedInputControl
                          nodeId={id}
                          handleId={hid}
                          edges={edges}
                          nodes={useWorkflowStore.getState().nodes}
                          onPreview={openPreview}
                        />
                      )}
                    </div>
                  </Row>
                );
              });
            }
            return null;
          })()}
          <DynamicFieldsEditor
            direction="input"
            fields={(() => {
              try {
                const raw = data.params.responseFields;
                return typeof raw === "string"
                  ? JSON.parse(raw)
                  : Array.isArray(raw)
                    ? raw
                    : [];
              } catch {
                return [];
              }
            })()}
            onChange={(fields: FieldConfig[]) => {
              // Get old fields to detect key renames
              let oldFields: FieldConfig[] = [];
              try {
                const raw = data.params.responseFields;
                oldFields =
                  typeof raw === "string"
                    ? JSON.parse(raw)
                    : Array.isArray(raw)
                      ? raw
                      : [];
              } catch {
                /* ignore */
              }

              // Detect renamed keys (same index, different key) and update edge handles
              const { edges: currentEdges } = useWorkflowStore.getState();
              let updatedEdges = currentEdges;
              let edgesChanged = false;
              for (
                let i = 0;
                i < Math.min(oldFields.length, fields.length);
                i++
              ) {
                const oldKey = oldFields[i]?.key;
                const newKey = fields[i]?.key;
                if (oldKey && newKey && oldKey !== newKey) {
                  const oldHandle = `input-${oldKey}`;
                  const newHandle = `input-${newKey}`;
                  updatedEdges = updatedEdges.map((e) => {
                    if (e.target === id && e.targetHandle === oldHandle) {
                      edgesChanged = true;
                      return { ...e, targetHandle: newHandle };
                    }
                    return e;
                  });
                }
              }

              // Update params + edges together
              if (edgesChanged) {
                useWorkflowStore.setState({ edges: updatedEdges });
              }
              // Also update inputDefinitions to match the new fields
              const newInputDefs = fields.map((f: FieldConfig) => ({
                key: f.key,
                label: f.label || f.key,
                dataType: f.type || "any",
                required: true,
              }));
              updateNodeParams(id, {
                ...data.params,
                responseFields: JSON.stringify(fields),
              });
              // Update node data inputDefinitions directly
              useWorkflowStore.setState((s) => ({
                nodes: s.nodes.map((n) =>
                  n.id === id
                    ? {
                        ...n,
                        data: { ...n.data, inputDefinitions: newInputDefs },
                      }
                    : n,
                ),
              }));
            }}
          />
        </>
      )}

      {isAITask && (
        <div className="nodrag px-3 mb-1" onClick={(e) => e.stopPropagation()}>
          <ModelSelector
            models={storeModels}
            value={currentModelId || undefined}
            onChange={(modelId) => {
              const storeModel = getModelById(modelId);
              if (!storeModel) return;
              handleInlineSelectModel(convertDesktopModel(storeModel));
            }}
          />
        </div>
      )}

      {/* AI Task: reuse Playground form (FormField) when model is loaded */}
      {usePlaygroundForm && (
        <>
          {visibleFormFields.map((field) => {
            const hid = `param-${field.name}`;
            const conn = connectedSet.has(hid);
            const isMediaField =
              field.type === "file" ||
              field.type === "file-array" ||
              /image|video|audio|mask/i.test(field.name);
            return (
              <Row key={field.name}>
                {conn ? (
                  <div className="flex flex-col gap-1 w-full">
                    <div className="flex items-center">
                      <span className="text-sm font-medium leading-none">
                        <HandleAnchor
                          id={hid}
                          type="target"
                          connected={conn}
                          media={isMediaField}
                        />
                        {field.label || field.name}
                        {field.required && (
                          <span className="ml-0.5 text-destructive">*</span>
                        )}
                      </span>
                    </div>
                    {isMediaField ? (
                      <ConnectedInputControl
                        nodeId={id}
                        handleId={hid}
                        edges={edges}
                        nodes={useWorkflowStore.getState().nodes}
                        onPreview={openPreview}
                      />
                    ) : (
                      <LinkedBadge
                        nodeId={id}
                        handleId={hid}
                        edges={edges}
                        nodes={useWorkflowStore.getState().nodes}
                        onDisconnect={() => {
                          const edge = edges.find(
                            (e) => e.target === id && e.targetHandle === hid,
                          );
                          if (edge)
                            useWorkflowStore.getState().removeEdge(edge.id);
                        }}
                      />
                    )}
                  </div>
                ) : (
                  <div
                    className="w-full min-w-0 nodrag"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FormField
                      field={field}
                      value={formValues[field.name]}
                      onChange={(v) => setParam(field.name, v)}
                      modelType={currentModel?.type}
                      imageValue={
                        field.name === "prompt"
                          ? getSingleImageFromValues(formValues)
                          : undefined
                      }
                      formValues={formValues}
                      onUploadFile={handleCdnUpload}
                      handleAnchor={
                        <HandleAnchor
                          id={hid}
                          type="target"
                          connected={conn}
                          media={isMediaField}
                        />
                      }
                    />
                  </div>
                )}
              </Row>
            );
          })}
          {hiddenFormFields.length > 0 && (
            <div className="space-y-2 px-3 py-1">
              {hiddenFormFields.map((field) => {
                const isEnabled = enabledHiddenFields.has(field.name);
                return (
                  <div key={field.name} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEnabledHiddenFields((prev) => {
                          const next = new Set(prev);
                          if (next.has(field.name)) {
                            next.delete(field.name);
                            setParam(field.name, undefined);
                          } else next.add(field.name);
                          return next;
                        });
                      }}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium border border-[hsl(var(--border))] bg-[hsl(var(--background))] hover:bg-[hsl(var(--muted))] transition-colors"
                    >
                      <span
                        className={`w-2.5 h-2.5 rounded-full border-2 ${isEnabled ? "bg-primary border-primary" : "border-muted-foreground"}`}
                      />
                      {field.label}
                    </button>
                    {isEnabled && (
                      <div className="pl-2 border-l-2 border-primary/50 ml-1">
                        <FormField
                          field={field}
                          value={formValues[field.name]}
                          onChange={(v) => setParam(field.name, v)}
                          modelType={currentModel?.type}
                          formValues={formValues}
                          onUploadFile={handleCdnUpload}
                          hideLabel
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Fallback: schema-based ParamRow/MediaRow when not using Playground form */}
      {!usePlaygroundForm &&
        orderedVisibleParams.map((p) => {
          const hid = `param-${p.name}`;
          if (p.mediaType && p.fieldType !== "loras") {
            return (
              <MediaRow
                key={p.name}
                nodeId={id}
                schema={p}
                value={data.params[p.name]}
                connected={connectedSet.has(hid)}
                connectedSet={connectedSet}
                edges={edges}
                nodes={useWorkflowStore.getState().nodes}
                onChange={(v) => setParam(p.name, v)}
                onPreview={openPreview}
              />
            );
          }
          if (p.fieldType === "loras") {
            return (
              <LoraRow
                key={p.name}
                schema={p}
                value={data.params[p.name]}
                onChange={(v) => setParam(p.name, v)}
              />
            );
          }
          if (p.fieldType === "json") {
            return (
              <JsonRow
                key={p.name}
                nodeId={id}
                schema={p}
                value={data.params[p.name]}
                connected={connectedSet.has(hid)}
                edges={edges}
                nodes={useWorkflowStore.getState().nodes}
                onChange={(v) => setParam(p.name, v)}
              />
            );
          }
          return (
            <ParamRow
              key={p.name}
              nodeId={id}
              schema={p}
              value={data.params[p.name]}
              connected={connectedSet.has(hid)}
              edges={edges}
              nodes={useWorkflowStore.getState().nodes}
              onDisconnect={() => {
                const edge = edges.find(
                  (e) => e.target === id && e.targetHandle === hid,
                );
                if (edge) useWorkflowStore.getState().removeEdge(edge.id);
              }}
              onChange={(v) => setParam(p.name, v)}
              optimizerSettings={
                (data.params.__optimizerSettings as Record<string, unknown>) ??
                {}
              }
              onOptimizerSettingsChange={(v) =>
                setParam("__optimizerSettings", v)
              }
            />
          );
        })}

      {!usePlaygroundForm && optionalParams.length > 0 && (
        <>
          <div className="px-3 py-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowOptional(!showOptional);
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <span className="text-[8px]">{showOptional ? "▼" : "▶"}</span>
              {showOptional
                ? t("workflow.hide", "Hide")
                : t("workflow.show", "Show")}{" "}
              {optionalParams.length} {t("workflow.optional", "optional")}
            </button>
          </div>
          {showOptional &&
            optionalParams.map((p) => {
              const hid = `param-${p.name}`;
              return (
                <ParamRow
                  key={p.name}
                  nodeId={id}
                  schema={p}
                  value={data.params[p.name]}
                  connected={connectedSet.has(hid)}
                  edges={edges}
                  nodes={useWorkflowStore.getState().nodes}
                  onDisconnect={() => {
                    const edge = edges.find(
                      (e) => e.target === id && e.targetHandle === hid,
                    );
                    if (edge) useWorkflowStore.getState().removeEdge(edge.id);
                  }}
                  onChange={(v) => setParam(p.name, v)}
                  optimizerSettings={
                    (data.params.__optimizerSettings as Record<
                      string,
                      unknown
                    >) ?? {}
                  }
                  onOptimizerSettingsChange={(v) =>
                    setParam("__optimizerSettings", v)
                  }
                />
              );
            })}
        </>
      )}

      {inputDefs.map((inp) => {
        if (data.nodeType === "input/media-upload") return null;
        if (data.nodeType === "output/http-response") return null;
        const hid = `input-${inp.key}`;
        const conn = connectedSet.has(hid);
        const portFieldConfig = portToFormFieldConfig(inp, data.nodeType);
        const useFormFieldForPort =
          portFieldConfig != null &&
          !conn &&
          !(data.nodeType === "free-tool/extract-frame" && inp.key === "input");
        if (
          data.nodeType === "free-tool/extract-frame" &&
          inp.key === "input"
        ) {
          const inputHint =
            inp.description ??
            t(
              "workflow.extractFrame.videoHint",
              "Upload a video or connect one from an upstream node, then scrub the preview to choose a frame.",
            );
          return (
            <Row key={inp.key}>
              <div className="w-full min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center text-sm font-medium leading-none ${
                      conn ? "text-green-400" : "text-foreground"
                    }`}
                  >
                    <HandleAnchor
                      id={hid}
                      type="target"
                      connected={conn}
                      media
                    />
                    {localizeInputLabel(inp.key, inp.label)}
                    {inp.required && (
                      <span className="ml-0.5 text-red-400">*</span>
                    )}
                  </span>
                </div>
                {conn ? (
                  <ConnectedInputControl
                    nodeId={id}
                    handleId={hid}
                    edges={edges}
                    nodes={useWorkflowStore.getState().nodes}
                    onPreview={openPreview}
                    showPreview={false}
                  />
                ) : (
                  <ExtractFrameVideoInput
                    nodeId={id}
                    value={data.params[inp.key]}
                    ensureWorkflowId={ensureWorkflowId}
                    onChange={(v) => setParam(inp.key, v)}
                  />
                )}
                <p className="text-xs text-muted-foreground">{inputHint}</p>
              </div>
            </Row>
          );
        }
        if (!isPreviewNode) {
          return (
            <Row key={inp.key}>
              <div className="flex items-center justify-between gap-2 w-full">
                <span
                  className={`text-xs whitespace-nowrap flex-shrink-0 ${conn ? "text-green-400 font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}
                >
                  <HandleAnchor id={hid} type="target" connected={conn} media />
                  {localizeInputLabel(inp.key, inp.label)}
                  {inp.required && <span className="text-red-400"> *</span>}
                </span>
                {conn ? (
                  <ConnectedInputControl
                    nodeId={id}
                    handleId={hid}
                    edges={edges}
                    nodes={useWorkflowStore.getState().nodes}
                    onPreview={openPreview}
                  />
                ) : useFormFieldForPort ? (
                  <div
                    className="flex-1 min-w-0 nodrag"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FormField
                      field={portFieldConfig}
                      value={formValues[inp.key]}
                      onChange={(v) => setParam(inp.key, v)}
                      formValues={formValues}
                      hideLabel
                      onUploadFile={
                        portFieldConfig.type === "file"
                          ? handleWorkflowUploadFile
                          : undefined
                      }
                    />
                  </div>
                ) : data.nodeType === "free-tool/extract-frame" &&
                  inp.key === "input" ? (
                  <div className="flex-1 min-w-0">
                    <ExtractFrameVideoInput
                      nodeId={id}
                      value={data.params[inp.key]}
                      ensureWorkflowId={ensureWorkflowId}
                      onChange={(v) => setParam(inp.key, v)}
                    />
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <InputPortControl
                      nodeId={id}
                      port={inp}
                      value={data.params[inp.key]}
                      onChange={(v) => setParam(inp.key, v)}
                      onPreview={openPreview}
                      referenceImageUrl={
                        data.nodeType === "free-tool/image-eraser" &&
                        inp.key === "mask_image"
                          ? String(data.params.input ?? "")
                          : undefined
                      }
                      showDrawMaskButton={
                        data.nodeType === "free-tool/image-eraser" &&
                        inp.key === "mask_image"
                      }
                      showPreview={
                        !(
                          data.nodeType === "free-tool/extract-frame" &&
                          inp.key === "input"
                        )
                      }
                    />
                  </div>
                )}
              </div>
            </Row>
          );
        }

        return (
          <Row key={inp.key}>
            <div className="w-full min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-xs ${conn ? "text-green-400 font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}
                >
                  <HandleAnchor id={hid} type="target" connected={conn} media />
                  {localizeInputLabel(inp.key, inp.label)}
                  {inp.required && <span className="text-red-400"> *</span>}
                </span>
              </div>
              {conn ? (
                <ConnectedInputControl
                  nodeId={id}
                  handleId={hid}
                  edges={edges}
                  nodes={useWorkflowStore.getState().nodes}
                  onPreview={openPreview}
                  showPreview={false}
                />
              ) : useFormFieldForPort ? (
                <div
                  className="w-full min-w-0 nodrag"
                  onClick={(e) => e.stopPropagation()}
                >
                  <FormField
                    field={portFieldConfig}
                    value={formValues[inp.key]}
                    onChange={(v) => setParam(inp.key, v)}
                    formValues={formValues}
                    hideLabel
                    onUploadFile={
                      portFieldConfig.type === "file"
                        ? handleWorkflowUploadFile
                        : undefined
                    }
                  />
                </div>
              ) : (
                <InputPortControl
                  nodeId={id}
                  port={inp}
                  value={data.params[inp.key]}
                  onChange={(v) => setParam(inp.key, v)}
                  onPreview={openPreview}
                  referenceImageUrl={
                    data.nodeType === "free-tool/image-eraser" &&
                    inp.key === "mask_image"
                      ? String(data.params.input ?? "")
                      : undefined
                  }
                  showDrawMaskButton={
                    data.nodeType === "free-tool/image-eraser" &&
                    inp.key === "mask_image"
                  }
                  showPreview={false}
                />
              )}
            </div>
          </Row>
        );
      })}

      {data.nodeType === "free-tool/extract-frame" && (
        <ExtractFrameScrubber
          nodeId={id}
          params={data.params}
          videoUrl={extractFrameVideoUrl}
          ensureWorkflowId={ensureWorkflowId}
          onParamChange={(updates) => updateNodeParams(id, updates)}
        />
      )}

      {/* Segment Anything: Pick points by clicking */}
      {data.nodeType === "free-tool/segment-anything" && (
        <div className="px-3 py-1">
          <div className="flex items-center justify-between gap-2 w-full">
            <span className="text-xs text-[hsl(var(--muted-foreground))] flex-shrink-0">
              {t("workflow.pointsLabel")}
            </span>
            <button
              type="button"
              title={
                String(data.params.input ?? "").trim()
                  ? t("workflow.pickPoints")
                  : t("workflow.pickPointsNeedInput")
              }
              disabled={!String(data.params.input ?? "").trim()}
              onClick={(e) => {
                e.stopPropagation();
                if (String(data.params.input ?? "").trim())
                  setSegmentPointPickerOpen(true);
              }}
              className={`nodrag flex-shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md border border-[hsl(var(--border))] text-xs transition-colors ${
                String(data.params.input ?? "").trim()
                  ? "cursor-pointer bg-blue-500/15 text-blue-400 hover:bg-blue-500/25"
                  : "cursor-not-allowed opacity-50"
              }`}
            >
              <MousePointer2 className="h-4 w-4" />
              {t("workflow.pickPoints")}
              {(() => {
                try {
                  const pts = data.params.__segmentPoints as string | undefined;
                  if (!pts) return null;
                  const arr = JSON.parse(pts) as SegmentPoint[];
                  return Array.isArray(arr) && arr.length > 0 ? (
                    <span className="text-[10px] opacity-75">
                      ({arr.length})
                    </span>
                  ) : null;
                } catch {
                  return null;
                }
              })()}
            </button>
          </div>
          {segmentPointPickerOpen && String(data.params.input ?? "").trim() && (
            <SegmentPointPicker
              referenceImageUrl={String(data.params.input)}
              onComplete={async (points: SegmentPoint[], maskBlob?: Blob) => {
                const newParams: Record<string, unknown> = {
                  ...data.params,
                  __segmentPoints: JSON.stringify(points),
                };
                if (maskBlob) {
                  try {
                    const wfId = await ensureWorkflowId();
                    if (wfId) {
                      const { storageIpc } =
                        await import("../../../ipc/ipc-client");
                      const arrBuf = await maskBlob.arrayBuffer();
                      const localPath = await storageIpc.saveUploadedFile(
                        wfId,
                        id,
                        "segment-mask.png",
                        arrBuf,
                      );
                      newParams.__previewMask = `local-asset://${encodeURIComponent(localPath)}`;
                    }
                  } catch (e) {
                    console.error("Failed to save segment mask:", e);
                  }
                }
                updateNodeParams(id, newParams);
                setSegmentPointPickerOpen(false);
              }}
              onClose={() => setSegmentPointPickerOpen(false)}
            />
          )}
        </div>
      )}

      {/* defParams */}
      {data.nodeType !== "input/media-upload" &&
        data.nodeType !== "input/text-input" &&
        data.nodeType !== "trigger/directory" &&
        paramDefs.map((p) => {
          // Skip fields managed by DynamicFieldsEditor
          if (
            data.nodeType === "trigger/http" &&
            (p.key === "outputFields" || p.key === "port")
          )
            return null;
          if (
            data.nodeType === "output/http-response" &&
            (p.key === "responseFields" || p.key === "statusCode")
          )
            return null;
          if (data.nodeType === "free-tool/extract-frame" && p.key === "time")
            return null;
          if (
            data.nodeType === "free-tool/extract-frame" &&
            p.key === "outputDir"
          ) {
            return (
              <ExtractFrameOutputDirectory
                key={p.key}
                value={data.params[p.key]}
                ensureWorkflowId={ensureWorkflowId}
                onChange={(v) => setParam(p.key, v)}
              />
            );
          }
          const hid = `param-${p.key}`;
          const canConnect =
            p.connectable !== false && p.dataType !== undefined;
          const conn = canConnect ? connectedSet.has(hid) : false;
          const fieldConfig = paramDefToFormFieldConfig(p, data.nodeType);

          if (fieldConfig) {
            if (!canConnect) {
              // Compact inline layout for file export's filename & format.
              const inlineParam =
                data.nodeType === "output/file" &&
                (p.key === "filename" || p.key === "format");
              return (
                <div
                  key={p.key}
                  className="px-3 py-1 nodrag"
                  onClick={(e) => e.stopPropagation()}
                >
                  {inlineParam ? (
                    <div className="flex items-center gap-4">
                      <Label className="text-xs flex-shrink-0 w-[110px]">
                        {fieldConfig.label}
                      </Label>
                      <div className="flex-1 min-w-0 [&_input]:h-7 [&_input]:text-xs [&_button[role=combobox]]:h-7 [&_button[role=combobox]]:text-xs">
                        <FormField
                          field={fieldConfig}
                          value={formValues[p.key]}
                          onChange={(v) => setParam(p.key, v)}
                          formValues={formValues}
                          onUploadFile={handleCdnUpload}
                          hideLabel
                        />
                      </div>
                    </div>
                  ) : (
                    <FormField
                      field={fieldConfig}
                      value={formValues[p.key]}
                      onChange={(v) => setParam(p.key, v)}
                      formValues={formValues}
                      onUploadFile={handleCdnUpload}
                    />
                  )}
                </div>
              );
            }
            return (
              <Row key={p.key}>
                {conn ? (
                  <div className="flex flex-col gap-1 w-full">
                    <div className="flex items-center">
                      <span className="text-sm font-medium leading-none">
                        <HandleAnchor id={hid} type="target" connected={conn} />
                        {localizeParamLabel(p.key, p.label)}
                      </span>
                    </div>
                    <LinkedBadge
                      nodeId={id}
                      handleId={hid}
                      edges={edges}
                      nodes={useWorkflowStore.getState().nodes}
                      onDisconnect={() => {
                        const edge = edges.find(
                          (e) => e.target === id && e.targetHandle === hid,
                        );
                        if (edge)
                          useWorkflowStore.getState().removeEdge(edge.id);
                      }}
                    />
                  </div>
                ) : (
                  <div
                    className="w-full min-w-0 nodrag"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FormField
                      field={fieldConfig}
                      value={formValues[p.key]}
                      onChange={(v) => setParam(p.key, v)}
                      formValues={formValues}
                      onUploadFile={handleCdnUpload}
                      handleAnchor={
                        <HandleAnchor id={hid} type="target" connected={conn} />
                      }
                    />
                  </div>
                )}
              </Row>
            );
          }

          if (!canConnect) {
            // Output Directory: stack label above control so hint text has full width
            if (data.nodeType === "output/file" && p.key === "outputDir") {
              return (
                <div key={p.key} className="px-3 py-1">
                  <div className="flex items-center gap-2 w-full">
                    <span className="text-xs text-[hsl(var(--muted-foreground))] flex-shrink-0">
                      {localizeParamLabel(p.key, p.label)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <DefParamControl
                        nodeId={id}
                        param={p}
                        value={data.params[p.key]}
                        onChange={(v) => setParam(p.key, v)}
                      />
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={p.key} className="px-3 py-1">
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="text-xs text-[hsl(var(--muted-foreground))] flex-shrink-0">
                    {localizeParamLabel(p.key, p.label)}
                    {localizeParamDescription(p.key, p.description) && (
                      <Tip
                        text={String(
                          localizeParamDescription(p.key, p.description),
                        )}
                      />
                    )}
                  </span>
                  <DefParamControl
                    nodeId={id}
                    param={p}
                    value={data.params[p.key]}
                    onChange={(v) => setParam(p.key, v)}
                  />
                </div>
              </div>
            );
          }

          return (
            <Row key={p.key}>
              <div className="flex items-center justify-between gap-2 w-full">
                <span className="text-xs text-[hsl(var(--muted-foreground))] flex-shrink-0">
                  <HandleAnchor id={hid} type="target" connected={conn} />
                  {localizeParamLabel(p.key, p.label)}
                  {localizeParamDescription(p.key, p.description) && (
                    <Tip
                      text={String(
                        localizeParamDescription(p.key, p.description),
                      )}
                    />
                  )}
                </span>
                {conn ? (
                  <LinkedBadge
                    nodeId={id}
                    handleId={hid}
                    edges={edges}
                    nodes={useWorkflowStore.getState().nodes}
                    onDisconnect={() => {
                      const edge = edges.find(
                        (e) => e.target === id && e.targetHandle === hid,
                      );
                      if (edge) useWorkflowStore.getState().removeEdge(edge.id);
                    }}
                  />
                ) : (
                  <DefParamControl
                    nodeId={id}
                    param={p}
                    value={data.params[p.key]}
                    onChange={(v) => setParam(p.key, v)}
                  />
                )}
              </div>
            </Row>
          );
        })}

      {/* Unified input preview area */}
      {isPreviewNode && inlineInputPreviewUrl && (
        <div className="px-3 pb-2">
          <div className="mt-1" onClick={(e) => e.stopPropagation()}>
            {inlinePreviewIsImage && (
              <img
                src={inlineInputPreviewUrl}
                alt=""
                onClick={(e) => {
                  e.stopPropagation();
                  openPreview(inlineInputPreviewUrl);
                }}
                className="w-full max-h-[4096px] rounded-lg border border-[hsl(var(--border))] object-contain cursor-pointer hover:ring-2 hover:ring-blue-500/40 transition-shadow bg-black/5"
              />
            )}
            {inlinePreviewIsVideo && (
              <video
                src={inlineInputPreviewUrl}
                controls
                className="w-full max-h-[4096px] rounded-lg border border-[hsl(var(--border))] object-contain"
              />
            )}
            {inlinePreviewIsAudio && (
              <audio
                src={inlineInputPreviewUrl}
                controls
                className="w-full max-h-10 rounded-lg border border-[hsl(var(--border))]"
              />
            )}
            {inlinePreviewIs3D && (
              <Inline3DViewer
                src={inlineInputPreviewUrl}
                onClick={() => openPreview(inlineInputPreviewUrl)}
              />
            )}
          </div>
        </div>
      )}

      {/* Results — at bottom of card, collapsed by default */}
      {data.nodeType !== "annotation" && (
        <div className="nodrag nowheel min-h-0 flex flex-col flex-1 mt-2 border-t border-border/50 py-2 select-text">
          <button
            type="button"
            onClick={() => setResultsExpanded((prev) => !prev)}
            className="flex items-center gap-1.5 w-full text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {resultsExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{t("workflow.results", "Results")}</span>
            {resultGroups.length > 0 && (
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary tabular-nums">
                {resultGroups.length}
              </span>
            )}
          </button>
          {resultsExpanded && (
            <div className="min-h-0 flex flex-col flex-1">
              <ResultsPanel embeddedInNode nodeId={id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
