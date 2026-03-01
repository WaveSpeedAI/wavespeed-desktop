import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { PredictionResult } from "@/types/prediction";
import {
  useAssetsStore,
  detectAssetType,
  generateDownloadFilename,
} from "@/stores/assetsStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Download,
  ExternalLink,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  X,
  Save,
  FolderHeart,
  Gamepad2,
  Sparkles,
} from "lucide-react";
import {
  isUrl,
  getUrlExtension,
  isImageUrl,
  isVideoUrl,
  isAudioUrl,
} from "@/lib/mediaUtils";
import { AudioPlayer } from "@/components/shared/AudioPlayer";
import { FlappyBird } from "./FlappyBird";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

// Check if running in Capacitor native environment
const isCapacitorNative = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return !!(window as any).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
};

// Mobile download helper using Capacitor
const mobileDownload = async (
  url: string,
  filename: string,
): Promise<{ success: boolean; error?: string }> => {
  try {
    // Dynamic imports for Capacitor modules (vite-ignore to prevent desktop build errors)
    const { CapacitorHttp } = await import(
      /* @vite-ignore */ "@capacitor/core"
    );
    const { Filesystem, Directory } = await import(
      /* @vite-ignore */ "@capacitor/filesystem"
    );

    // Fetch file using CapacitorHttp (bypasses CORS)
    const response = await CapacitorHttp.get({
      url,
      responseType: "blob",
    });

    if (response.status !== 200) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    // Create Downloads directory
    const directory = "Downloads";
    try {
      await Filesystem.mkdir({
        path: directory,
        directory: Directory.Documents,
        recursive: true,
      });
    } catch {
      // Directory might already exist
    }

    // Save file
    const filePath = `${directory}/${filename}`;
    await Filesystem.writeFile({
      path: filePath,
      data: response.data as string,
      directory: Directory.Documents,
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
};

interface OutputDisplayProps {
  prediction: PredictionResult | null;
  outputs: (string | Record<string, unknown>)[];
  error: string | null;
  isLoading: boolean;
  modelId?: string;
  hideGameButton?: boolean;
  gridLayout?: boolean;
}

export function OutputDisplay({
  prediction,
  outputs,
  error,
  isLoading,
  modelId,
  hideGameButton,
  gridLayout,
}: OutputDisplayProps) {
  const { t } = useTranslation();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const [savedIndexes, setSavedIndexes] = useState<Set<number>>(new Set());
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const autoSavedUrlsRef = useRef<Set<string>>(new Set());
  const prevLoadingRef = useRef(false);

  // Game state
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [showGame, setShowGame] = useState(true);
  const [gameEndedWithResults, setGameEndedWithResults] = useState(false);
  const prevOutputsLengthRef = useRef(0);

  const { settings, loadSettings, saveAsset, hasAssetForPrediction } =
    useAssetsStore();

  // Build list of media outputs for fullscreen navigation
  const mediaOutputs = useMemo(() => {
    return outputs
      .map((output, index) => {
        if (typeof output !== "string") return null;
        const str = String(output);
        if (isImageUrl(str)) return { index, url: str, type: "image" as const };
        if (isVideoUrl(str)) return { index, url: str, type: "video" as const };
        return null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [outputs]);

  const fullscreenMedia =
    fullscreenIndex !== null
      ? (mediaOutputs.find((m) => m.index === fullscreenIndex) ?? null)
      : null;

  // Keyboard navigation for fullscreen preview
  useEffect(() => {
    if (fullscreenIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const curPos = mediaOutputs.findIndex(
          (m) => m.index === fullscreenIndex,
        );
        if (curPos === -1 || mediaOutputs.length <= 1) return;
        const newPos = curPos === 0 ? mediaOutputs.length - 1 : curPos - 1;
        setFullscreenIndex(mediaOutputs[newPos].index);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const curPos = mediaOutputs.findIndex(
          (m) => m.index === fullscreenIndex,
        );
        if (curPos === -1 || mediaOutputs.length <= 1) return;
        const newPos = curPos === mediaOutputs.length - 1 ? 0 : curPos + 1;
        setFullscreenIndex(mediaOutputs[newPos].index);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreenIndex, mediaOutputs]);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Track outputs length for other logic
  useEffect(() => {
    prevOutputsLengthRef.current = outputs.length;
  }, [outputs.length]);

  // Reset game state when outputs are cleared (new run starting)
  useEffect(() => {
    if (outputs.length === 0 && !isLoading && !error) {
      setShowGame(true);
      setIsGameStarted(false);
      setGameEndedWithResults(false);
    }
  }, [outputs.length, isLoading, error]);

  const handleGameStart = useCallback(() => {
    setIsGameStarted(true);
  }, []);

  const handleGameEnd = useCallback(() => {
    // Game ended - don't auto-switch, let user view results via notification
    setGameEndedWithResults(true);
  }, []);

  // Auto-save outputs only when generation completes (isLoading: true → false)
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoading;

    // Only trigger auto-save when loading transitions from true to false
    if (!wasLoading || isLoading) return;
    if (!settings.autoSaveAssets || !modelId || outputs.length === 0) return;
    if (!prediction?.id) return;

    // Find outputs not yet auto-saved
    const unsaved: { output: string; index: number }[] = [];
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i];
      if (typeof output !== "string") continue;
      if (output.startsWith("local-asset://")) continue;
      if (autoSavedUrlsRef.current.has(output)) continue;
      const assetType = detectAssetType(output);
      if (!assetType) continue;
      unsaved.push({ output, index: i });
    }
    if (unsaved.length === 0) return;

    // Mark URLs immediately to prevent duplicate triggers
    for (const { output } of unsaved) {
      autoSavedUrlsRef.current.add(output);
    }

    const saveOutputs = async () => {
      for (const { output, index } of unsaved) {
        try {
          const result = await saveAsset(output, detectAssetType(output)!, {
            modelId,
            predictionId: prediction.id,
            originalUrl: output,
            resultIndex: index,
          });
          if (result) {
            setSavedIndexes((prev) => new Set(prev).add(index));
          }
        } catch (err) {
          console.error("Failed to auto-save asset:", err);
        }
      }
      toast({
        title: t("playground.generationComplete", "Generation complete"),
        description: t("playground.autoSaved"),
        duration: 2000,
      });
    };

    saveOutputs();
  }, [
    isLoading,
    outputs,
    prediction?.id,
    modelId,
    settings.autoSaveAssets,
    saveAsset,
    t,
  ]);

  // Reset saved indexes when outputs change substantially
  useEffect(() => {
    setSavedIndexes(new Set());
  }, [prediction?.id]);

  const handleSaveToAssets = useCallback(
    async (url: string, index: number) => {
      if (!modelId) return;

      const assetType = detectAssetType(url);
      if (!assetType) {
        toast({
          title: t("common.error"),
          description: t("playground.unsupportedFormat"),
          variant: "destructive",
        });
        return;
      }

      setSavingIndex(index);
      try {
        const result = await saveAsset(url, assetType, {
          modelId,
          predictionId: prediction?.id,
          originalUrl: url,
          resultIndex: index,
        });

        if (result) {
          setSavedIndexes((prev) => new Set(prev).add(index));
          toast({
            title: t("playground.savedToAssets"),
            description: t("playground.savedToAssetsDesc"),
          });
        } else {
          toast({
            title: t("common.error"),
            description: t("playground.saveFailed"),
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: t("common.error"),
          description: t("playground.saveFailed"),
          variant: "destructive",
        });
      } finally {
        setSavingIndex(null);
      }
    },
    [modelId, prediction?.id, saveAsset, t],
  );

  const handleDownload = async (url: string, index: number) => {
    const filename = generateDownloadFilename({
      modelId,
      url,
      predictionId: prediction?.id,
      resultIndex: index,
    });

    // Use Electron API if available (desktop)
    if (window.electronAPI?.downloadFile) {
      const result = await window.electronAPI.downloadFile(url, filename);
      if (!result.success && !result.canceled) {
        console.error("Download failed:", result.error);
      }
      return;
    }

    // Use Capacitor if available (mobile native)
    if (isCapacitorNative()) {
      const result = await mobileDownload(url, filename);
      if (result.success) {
        toast({
          title: t("common.success"),
          description: t("freeTools.downloadSuccess"),
        });
      } else {
        console.error("Mobile download failed:", result.error);
        toast({
          title: t("common.error"),
          description: result.error || "Download failed",
          variant: "destructive",
        });
      }
      return;
    }

    // Browser fallback: open in new tab
    window.open(url, "_blank");
  };

  const handleCopy = async (url: string, index: number) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for WebView where clipboard API may be restricted
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
    if (isCapacitorNative()) {
      toast({ title: t("common.copied", "Copied") });
    }
  };

  const handleOpenExternal = async (url: string) => {
    if (isCapacitorNative()) {
      try {
        const { Browser } = await import(
          /* @vite-ignore */ "@capacitor/browser"
        );
        await Browser.open({ url });
      } catch {
        window.open(url, "_blank");
      }
      return;
    }
    window.open(url, "_blank");
  };

  if (error) {
    // Try to parse JSON error for better display
    let errorMessage = error;
    let errorDetails: Record<string, unknown> | null = null;

    try {
      if (error.startsWith("{")) {
        const parsed = JSON.parse(error);
        errorMessage = parsed.message || parsed.error || error;
        errorDetails = parsed;
      }
    } catch {
      // Keep original error string
    }

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 rounded-xl border border-destructive/20 bg-destructive/5 px-6">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <div className="max-w-lg space-y-3 text-center">
          <p className="text-destructive font-medium">{errorMessage}</p>
          {errorDetails && (
            <details className="text-left">
              <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground">
                Show details
              </summary>
              <pre className="mt-2 p-3 bg-muted rounded-lg text-xs overflow-auto max-h-48">
                {JSON.stringify(errorDetails, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }

  // Show game when: no outputs, loading, or user toggled to game view
  const showGameView =
    outputs.length === 0 ||
    isLoading ||
    (showGame && (gameEndedWithResults || isGameStarted));

  if (showGameView) {
    return (
      <div className="relative h-full overflow-hidden rounded-xl border border-border/70 bg-card/50">
        <FlappyBird
          onGameStart={handleGameStart}
          onGameEnd={handleGameEnd}
          isTaskRunning={isLoading}
          taskStatus={t("playground.generating")}
          idleMessage={
            outputs.length === 0 && !isLoading
              ? {
                  title: t("playground.noOutputs"),
                  subtitle: t("playground.configureAndRun"),
                }
              : undefined
          }
          hasResults={outputs.length > 0 && !isLoading}
          onViewResults={() => setShowGame(false)}
          modelId={modelId}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative">
      {/* Outputs - fill remaining space */}
      <div
        className={cn(
          "flex-1 min-h-0",
          outputs.length > 1
            ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-min overflow-auto p-1"
            : "flex flex-col gap-4",
        )}
      >
        {outputs.map((output, index) => {
          const isObject = typeof output === "object" && output !== null;
          const outputStr = isObject
            ? JSON.stringify(output, null, 2)
            : String(output);
          const isImage = !isObject && isImageUrl(outputStr);
          const isVideo = !isObject && isVideoUrl(outputStr);
          const isAudio = !isObject && isAudioUrl(outputStr);
          const copyValue = isObject ? outputStr : outputStr;

          // Multi-output: BatchOutputGrid-style card with thumbnail + footer
          if (outputs.length > 1) {
            return (
              <div
                key={index}
                className={cn(
                  "relative group overflow-hidden rounded-xl border border-border/70 bg-card/80 transition-all cursor-pointer hover:border-primary/40 hover:shadow-md",
                  savedIndexes.has(index) &&
                    "ring-1 ring-green-500/50 shadow-sm",
                )}
                onClick={() => setFullscreenIndex(index)}
              >
                {/* Thumbnail */}
                <div className="aspect-square bg-muted/70 flex items-center justify-center">
                  {isImage && (
                    <img
                      src={outputStr}
                      alt={`Result ${index + 1}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  )}
                  {isVideo && (
                    <video
                      src={outputStr}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      preload="auto"
                      onLoadedData={(e) => {
                        e.currentTarget.currentTime = 0.1;
                      }}
                    />
                  )}
                  {isAudio && (
                    <div className="text-muted-foreground text-xs">Audio</div>
                  )}
                  {!isImage && !isVideo && !isAudio && (
                    <div className="text-muted-foreground text-xs">Output</div>
                  )}
                </div>
                {/* Footer */}
                <div className="flex items-center justify-between border-t border-border/60 bg-background/70 p-2">
                  <span className="text-xs font-medium">#{index + 1}</span>
                  <div className="flex items-center gap-1">
                    {prediction?.timings?.inference && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1 py-0"
                      >
                        {(prediction.timings.inference / 1000).toFixed(1)}s
                      </Badge>
                    )}
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                  </div>
                </div>
                {/* Saved indicator */}
                {savedIndexes.has(index) && (
                  <div className="absolute top-1 right-1">
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1 py-0 bg-green-500/80 text-white"
                    >
                      Saved
                    </Badge>
                  </div>
                )}
              </div>
            );
          }

          // Single output: original full-size display
          return (
            <div
              key={index}
              className="relative group rounded-lg border overflow-hidden bg-muted/30 flex items-center justify-center flex-1 min-h-0"
            >
              <div className="absolute left-2 top-2 z-10">
                <Badge
                  variant="secondary"
                  className="rounded-md bg-background/80 px-2 py-0.5 text-[11px] backdrop-blur"
                >
                  <Sparkles className="mr-1 h-3 w-3" />#{index + 1}
                </Badge>
              </div>
              {isImage && (
                <img
                  src={outputStr}
                  alt={`Output ${index + 1}`}
                  className="max-w-full max-h-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
                  style={{
                    maxWidth: "min(100%, var(--max-w, 100%))",
                    maxHeight: "min(100%, var(--max-h, 100%))",
                  }}
                  loading="lazy"
                  onClick={() => setFullscreenIndex(index)}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    img.style.setProperty(
                      "--max-w",
                      `${img.naturalWidth * 2}px`,
                    );
                    img.style.setProperty(
                      "--max-h",
                      `${img.naturalHeight * 2}px`,
                    );
                  }}
                />
              )}

              {isVideo && (
                <video
                  src={outputStr}
                  controls
                  playsInline
                  className="max-w-full max-h-full object-contain"
                  style={{
                    maxWidth: "min(100%, var(--max-w, 100%))",
                    maxHeight: "min(100%, var(--max-h, 100%))",
                  }}
                  preload="auto"
                  onLoadedData={(e) => {
                    const video = e.currentTarget;
                    video.currentTime = 0.1;
                    video.style.setProperty(
                      "--max-w",
                      `${video.videoWidth * 2}px`,
                    );
                    video.style.setProperty(
                      "--max-h",
                      `${video.videoHeight * 2}px`,
                    );
                  }}
                />
              )}

              {isAudio && <AudioPlayer src={outputStr} />}

              {isObject && (
                <div className="p-4 w-full h-full overflow-auto">
                  <pre className="text-sm font-mono whitespace-pre-wrap break-all">
                    {outputStr}
                  </pre>
                </div>
              )}

              {!isImage && !isVideo && !isAudio && !isObject && (
                <div className="p-4">
                  <p className="text-sm break-all">{outputStr}</p>
                </div>
              )}

              {/* Timing overlay */}
              {prediction?.timings?.inference && (
                <div className="absolute bottom-2 left-2 flex items-center gap-1">
                  <Badge
                    variant="secondary"
                    className="border-0 bg-black/60 text-xs text-white"
                  >
                    {(prediction.timings.inference / 1000).toFixed(2)}s
                  </Badge>
                  {prediction.has_nsfw_contents?.some(Boolean) && (
                    <Badge variant="destructive" className="text-xs">
                      NSFW
                    </Badge>
                  )}
                </div>
              )}

              {/* Actions overlay */}
              <div
                className={cn(
                  "absolute top-2 right-2 flex gap-1 transition-opacity",
                  isCapacitorNative()
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100",
                )}
              >
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-8 w-8 rounded-lg bg-background/90 backdrop-blur"
                  onClick={() => handleCopy(copyValue, index)}
                >
                  {copiedIndex === index ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                {!isObject && (
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 rounded-lg bg-background/90 backdrop-blur"
                    onClick={() => handleOpenExternal(outputStr)}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
                {(isImage || isVideo || isAudio) && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-8 w-8 rounded-lg bg-background/90 backdrop-blur"
                          onClick={() => handleSaveToAssets(outputStr, index)}
                          disabled={
                            savedIndexes.has(index) ||
                            savingIndex === index ||
                            !modelId
                          }
                        >
                          {savedIndexes.has(index) ? (
                            <FolderHeart className="h-4 w-4 text-green-500" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {savedIndexes.has(index)
                          ? t("playground.alreadySaved")
                          : t("playground.saveToAssets")}
                      </TooltipContent>
                    </Tooltip>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-8 w-8 rounded-lg bg-background/90 backdrop-blur"
                      onClick={() => handleDownload(outputStr, index)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Fullscreen Preview Dialog */}
      <Dialog
        open={fullscreenIndex !== null}
        onOpenChange={() => setFullscreenIndex(null)}
      >
        <DialogContent
          className="w-screen h-screen max-w-none max-h-none p-0 border-0 bg-black flex items-center justify-center"
          hideCloseButton
        >
          <DialogTitle className="sr-only">Fullscreen Preview</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-50 text-white hover:bg-white/20 h-10 w-10 [filter:drop-shadow(0_0_2px_rgba(0,0,0,0.8))_drop-shadow(0_0_4px_rgba(0,0,0,0.5))]"
            onClick={() => setFullscreenIndex(null)}
          >
            <X className="h-6 w-6" />
          </Button>
          {/* Navigation arrows */}
          {mediaOutputs.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-4 top-1/2 -translate-y-1/2 z-50 text-white hover:bg-white/20 h-10 w-10 [filter:drop-shadow(0_0_2px_rgba(0,0,0,0.8))_drop-shadow(0_0_4px_rgba(0,0,0,0.5))]"
                onClick={() => {
                  const curPos = mediaOutputs.findIndex(
                    (m) => m.index === fullscreenIndex,
                  );
                  if (curPos === -1) return;
                  const newPos =
                    curPos === 0 ? mediaOutputs.length - 1 : curPos - 1;
                  setFullscreenIndex(mediaOutputs[newPos].index);
                }}
              >
                <span className="text-xl">◀</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-4 top-1/2 -translate-y-1/2 z-50 text-white hover:bg-white/20 h-10 w-10 [filter:drop-shadow(0_0_2px_rgba(0,0,0,0.8))_drop-shadow(0_0_4px_rgba(0,0,0,0.5))]"
                onClick={() => {
                  const curPos = mediaOutputs.findIndex(
                    (m) => m.index === fullscreenIndex,
                  );
                  if (curPos === -1) return;
                  const newPos =
                    curPos === mediaOutputs.length - 1 ? 0 : curPos + 1;
                  setFullscreenIndex(mediaOutputs[newPos].index);
                }}
              >
                <span className="text-xl">▶</span>
              </Button>
            </>
          )}
          {fullscreenMedia?.type === "image" && (
            <img
              src={fullscreenMedia.url}
              alt="Fullscreen preview"
              className="max-w-full max-h-full object-contain"
            />
          )}
          {fullscreenMedia?.type === "video" && (
            <video
              src={fullscreenMedia.url}
              controls
              autoPlay
              className="max-w-full max-h-full object-contain"
            />
          )}
          {/* Counter */}
          {mediaOutputs.length > 1 && fullscreenMedia && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 text-white/80 text-sm [filter:drop-shadow(0_0_2px_rgba(0,0,0,0.8))]">
              {mediaOutputs.findIndex((m) => m.index === fullscreenIndex) + 1} /{" "}
              {mediaOutputs.length}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
