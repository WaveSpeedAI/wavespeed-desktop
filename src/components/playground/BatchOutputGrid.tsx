import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Download,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { AudioPlayer } from "@/components/shared/AudioPlayer";
import {
  useAssetsStore,
  detectAssetType,
  generateDownloadFilename,
} from "@/stores/assetsStore";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import type { BatchResult, BatchQueueItem } from "@/types/batch";

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

interface BatchOutputGridProps {
  results: BatchResult[];
  modelId?: string;
  onClear: () => void;
  className?: string;
  isRunning?: boolean;
  totalCount?: number;
  queue?: BatchQueueItem[];
}

function isUrl(str: string): boolean {
  return str.startsWith("http://") || str.startsWith("https://");
}

function getUrlExtension(url: string): string | null {
  try {
    // For custom protocols like local-asset://, new URL() misparses the path as hostname.
    // Decode and use regex fallback for these.
    if (/^local-asset:\/\//i.test(url)) {
      const decoded = decodeURIComponent(url);
      const match = decoded.match(/\.([a-z0-9]+)(?:\?.*)?$/i);
      return match ? match[1].toLowerCase() : null;
    }
    // Parse URL and get pathname (ignoring query params)
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    // Get the last segment and extract extension
    const lastSegment = pathname.split("/").pop() || "";
    const match = lastSegment.match(/\.([a-z0-9]+)$/);
    return match ? match[1] : null;
  } catch {
    // Fallback for invalid URLs
    const match = url.match(/\.([a-z0-9]+)(?:\?.*)?$/i);
    return match ? match[1].toLowerCase() : null;
  }
}

function isImageUrl(url: string): boolean {
  if (!isUrl(url)) return false;
  const ext = getUrlExtension(url);
  return (
    ext !== null &&
    ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"].includes(ext)
  );
}

function isVideoUrl(url: string): boolean {
  if (!isUrl(url)) return false;
  const ext = getUrlExtension(url);
  return (
    ext !== null &&
    ["mp4", "webm", "mov", "avi", "mkv", "ogv", "m4v"].includes(ext)
  );
}

function isAudioUrl(url: string): boolean {
  if (!isUrl(url)) return false;
  const ext = getUrlExtension(url);
  return (
    ext !== null &&
    ["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus"].includes(ext)
  );
}

export function BatchOutputGrid({
  results,
  modelId,
  onClear,
  className,
  isRunning,
  totalCount,
  queue,
}: BatchOutputGridProps) {
  const { t } = useTranslation();
  const [selectedResult, setSelectedResult] = useState<BatchResult | null>(
    null,
  );
  const [savedIndexes, setSavedIndexes] = useState<Set<number>>(new Set());
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const autoSavedIndexesRef = useRef<Set<number>>(new Set());
  const prevRunningRef = useRef(false);

  const { saveAsset, settings, hasAssetForPrediction } = useAssetsStore();

  const completedResults = results.filter((r) => !r.error);
  const completedCount = completedResults.length;
  const failedCount = results.filter((r) => r.error).length;
  const total = totalCount || results.length;
  const progress =
    total > 0 ? ((completedCount + failedCount) / total) * 100 : 0;

  // Auto-save results silently as they complete (no toast during batch)
  useEffect(() => {
    if (!settings.autoSaveAssets || !modelId) return;

    const saveNewResults = async () => {
      for (const result of results) {
        if (autoSavedIndexesRef.current.has(result.index)) continue;
        if (result.error || result.outputs.length === 0) continue;

        if (
          result.prediction?.id &&
          hasAssetForPrediction(result.prediction.id)
        ) {
          autoSavedIndexesRef.current.add(result.index);
          setSavedIndexes((prev) => new Set(prev).add(result.index));
          continue;
        }

        autoSavedIndexesRef.current.add(result.index);

        for (
          let outputIndex = 0;
          outputIndex < result.outputs.length;
          outputIndex++
        ) {
          const output = result.outputs[outputIndex];
          if (typeof output !== "string") continue;

          const assetType = detectAssetType(output);
          if (!assetType) continue;

          try {
            const saveResult = await saveAsset(output, assetType, {
              modelId,
              predictionId: result.prediction?.id,
              originalUrl: output,
              resultIndex: outputIndex,
            });
            if (saveResult) {
              setSavedIndexes((prev) => new Set(prev).add(result.index));
            }
          } catch (err) {
            console.error("Failed to auto-save batch asset:", err);
          }
        }
      }
    };

    saveNewResults();
  }, [
    results,
    modelId,
    settings.autoSaveAssets,
    saveAsset,
    hasAssetForPrediction,
  ]);

  // Show toast only when batch completes (isRunning: true → false)
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = !!isRunning;

    if (!wasRunning || isRunning) return;
    if (!settings.autoSaveAssets) return;
    if (savedIndexes.size === 0) return;

    toast({
      description: t("playground.autoSaved"),
      duration: 2000,
    });
  }, [isRunning, settings.autoSaveAssets, savedIndexes.size, t]);

  // Reset auto-saved tracking when results are cleared
  useEffect(() => {
    if (results.length === 0) {
      autoSavedIndexesRef.current = new Set();
      setSavedIndexes(new Set());
    }
  }, [results.length]);

  // Check if truly running in Electron (not web polyfill)
  const isElectron = navigator.userAgent.toLowerCase().includes("electron");

  const handleDownload = async (
    url: string,
    predictionId?: string,
    resultIndex: number = 0,
  ) => {
    const filename = generateDownloadFilename({
      modelId,
      url,
      predictionId,
      resultIndex,
    });

    // Use Electron API if available (desktop)
    if (isElectron && window.electronAPI?.downloadFile) {
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

    // Web mode: fetch as blob and trigger download
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Download failed:", err);
      window.open(url, "_blank");
    }
  };

  const handleDownloadAll = async () => {
    // Collect all URLs with their metadata
    const downloads: { url: string; predictionId?: string; index: number }[] =
      [];
    for (const result of results) {
      if (result.error) continue;
      for (let i = 0; i < result.outputs.length; i++) {
        const output = result.outputs[i];
        if (typeof output === "string" && isUrl(output)) {
          downloads.push({
            url: output,
            predictionId: result.prediction?.id,
            index: downloads.length,
          });
        }
      }
    }

    if (downloads.length === 0) return;

    toast({
      description: `Downloading ${downloads.length} files...`,
      duration: 2000,
    });

    // Download all with small delay between each
    for (const { url, predictionId, index } of downloads) {
      await handleDownload(url, predictionId, index);
      // Small delay to prevent overwhelming the browser
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    toast({
      description: `Downloaded ${downloads.length} files`,
      duration: 2000,
    });
  };

  const handleCopy = async (url: string, index: number) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  // Get successful results for navigation
  const successfulResults = results
    .filter((r) => !r.error)
    .sort((a, b) => a.index - b.index);

  // Navigate to previous/next result (with loop support)
  const navigateResult = useCallback(
    (direction: "prev" | "next") => {
      if (!selectedResult || successfulResults.length <= 1) return;

      const currentIdx = successfulResults.findIndex(
        (r) => r.index === selectedResult.index,
      );
      if (currentIdx === -1) return;

      let newIdx: number;
      if (direction === "prev") {
        newIdx =
          currentIdx === 0 ? successfulResults.length - 1 : currentIdx - 1;
      } else {
        newIdx =
          currentIdx === successfulResults.length - 1 ? 0 : currentIdx + 1;
      }

      setSelectedResult(successfulResults[newIdx]);
    },
    [selectedResult, successfulResults],
  );

  // Keyboard navigation for detail dialog
  useEffect(() => {
    if (!selectedResult) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigateResult("prev");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateResult("next");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedResult, navigateResult]);

  // Flatten results: each media output gets its own grid card
  const gridItems = useMemo(() => {
    const items: Array<{
      key: string;
      batchIndex: number;
      outputIndex: number;
      result: BatchResult | null;
      mediaUrl: string | null;
      mediaType: "image" | "video" | "audio" | null;
      isPending: boolean;
      hasError: boolean;
      seed?: unknown;
      timing?: number;
    }> = [];

    for (let index = 0; index < total; index++) {
      const result = results.find((r) => r.index === index);
      const queueItem = queue?.find((q) => q.index === index);
      const seed = result?.input?.seed ?? queueItem?.input?.seed;

      if (!result) {
        items.push({
          key: `p-${index}`,
          batchIndex: index,
          outputIndex: 0,
          result: null,
          mediaUrl: null,
          mediaType: null,
          isPending: true,
          hasError: false,
          seed,
        });
      } else if (result.error) {
        items.push({
          key: `e-${index}`,
          batchIndex: index,
          outputIndex: 0,
          result,
          mediaUrl: null,
          mediaType: null,
          isPending: false,
          hasError: true,
          seed,
          timing: result.timing,
        });
      } else {
        let mediaCount = 0;
        for (let oi = 0; oi < result.outputs.length; oi++) {
          const output = result.outputs[oi];
          if (typeof output === "string") {
            let mt: "image" | "video" | "audio" | null = null;
            if (isImageUrl(output)) mt = "image";
            else if (isVideoUrl(output)) mt = "video";
            else if (isAudioUrl(output)) mt = "audio";
            if (mt) {
              items.push({
                key: `r-${index}-${oi}`,
                batchIndex: index,
                outputIndex: oi,
                result,
                mediaUrl: output,
                mediaType: mt,
                isPending: false,
                hasError: false,
                seed,
                timing: result.timing,
              });
              mediaCount++;
            }
          }
        }
        if (mediaCount === 0) {
          items.push({
            key: `r-${index}-0`,
            batchIndex: index,
            outputIndex: 0,
            result,
            mediaUrl: null,
            mediaType: null,
            isPending: false,
            hasError: false,
            seed,
            timing: result.timing,
          });
        }
      }
    }
    return items;
  }, [results, queue, total]);

  const gridCount = gridItems.length || total;

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between rounded-xl border border-border/70 bg-background/70 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            {isRunning && <Loader2 className="h-4 w-4 animate-spin" />}
            <span className="hidden md:inline">
              {t("playground.batch.results")}
            </span>{" "}
            ({completedCount + failedCount}/{total})
          </h3>
          <div className="hidden md:flex items-center gap-2 text-xs">
            {completedCount > 0 && (
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-3 w-3" />
                {completedCount}
              </span>
            )}
            {failedCount > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <XCircle className="h-3 w-3" />
                {failedCount}
              </span>
            )}
          </div>
          {isRunning && (
            <Progress value={progress} className="h-2 w-16 md:w-24" />
          )}
        </div>
        <div className="flex items-center gap-1 md:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadAll}
            disabled={completedCount === 0 || isRunning}
            className="text-xs md:text-sm"
          >
            <Download className="h-3 w-3 md:mr-1" />
            <span className="hidden md:inline">
              {t("playground.batch.downloadAll")}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={isRunning}
            className="text-xs md:text-sm"
          >
            <span className="hidden md:inline">
              {t("playground.batch.clearResults")}
            </span>
            <span className="md:hidden">Clear</span>
          </Button>
        </div>
      </div>
      {/* Results Grid - flattened: each media output gets its own card */}
      <ScrollArea className="flex-1">
        <div
          className={cn(
            "grid gap-4 p-1",
            gridCount <= 2 && "grid-cols-1 sm:grid-cols-2",
            gridCount === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
            gridCount === 4 && "grid-cols-2 lg:grid-cols-4",
            gridCount > 4 && "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
          )}
        >
          {gridItems.map((item, gridIndex) => (
            <div
              key={item.key}
              onClick={() =>
                item.result && !item.hasError && setSelectedResult(item.result)
              }
              className={cn(
                "relative overflow-hidden rounded-xl border border-border/70 bg-card/80 transition-all",
                item.isPending
                  ? "cursor-default"
                  : item.hasError
                    ? "border-destructive/50 opacity-75 cursor-default"
                    : "cursor-pointer hover:border-primary/40 hover:shadow-md",
                item.result &&
                  savedIndexes.has(item.result.index) &&
                  "ring-1 ring-green-500/50 shadow-sm",
              )}
            >
              {/* Thumbnail */}
              <div className="aspect-square bg-muted/70 flex items-center justify-center">
                {item.isPending && isRunning ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : item.isPending ? (
                  <div className="w-full h-full bg-muted/50" />
                ) : item.hasError ? (
                  <div className="flex flex-col items-center gap-1 text-destructive p-2">
                    <XCircle className="h-6 w-6" />
                    <span className="text-xs text-center line-clamp-2">
                      {item.result?.error}
                    </span>
                  </div>
                ) : item.mediaType === "image" && item.mediaUrl ? (
                  <img
                    src={item.mediaUrl}
                    alt={`Result ${gridIndex + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : item.mediaType === "video" && item.mediaUrl ? (
                  <video
                    src={item.mediaUrl}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    preload="auto"
                    onLoadedData={(e) => {
                      e.currentTarget.currentTime = 0.1;
                    }}
                  />
                ) : item.mediaType === "audio" ? (
                  <div className="text-muted-foreground text-xs">Audio</div>
                ) : (
                  <div className="text-muted-foreground text-xs">Output</div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-border/60 bg-background/70 p-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">#{gridIndex + 1}</span>
                  {item.seed !== undefined && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {String(item.seed)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {item.result && !item.hasError && item.timing && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1 py-0"
                    >
                      {(item.timing / 1000).toFixed(1)}s
                    </Badge>
                  )}
                  {item.result && !item.hasError && (
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                  )}
                </div>
              </div>

              {/* Saved indicator */}
              {item.result && savedIndexes.has(item.result.index) && (
                <div className="absolute top-1 right-1">
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1 py-0 bg-green-500/80 text-white"
                  >
                    {t("playground.batch.saved")}
                  </Badge>
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Detail Dialog */}
      <Dialog
        open={!!selectedResult}
        onOpenChange={() => setSelectedResult(null)}
      >
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden border-border/70 p-0">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              {t("playground.batch.result")} #
              {selectedResult?.index !== undefined
                ? selectedResult.index + 1
                : ""}
              {successfulResults.length > 1 && (
                <span className="text-sm font-normal text-muted-foreground">
                  (
                  {successfulResults.findIndex(
                    (r) => r.index === selectedResult?.index,
                  ) + 1}
                  /{successfulResults.length})
                </span>
              )}
            </DialogTitle>
          </div>
          {selectedResult && (
            <div className="flex-1 overflow-auto relative">
              {/* Navigation buttons on sides */}
              {successfulResults.length > 1 && (
                <>
                  <Button
                    size="icon"
                    variant="secondary"
                    onClick={() => navigateResult("prev")}
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full opacity-80 hover:opacity-100 active:bg-black/60"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    onClick={() => navigateResult("next")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full opacity-80 hover:opacity-100 active:bg-black/60"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </>
              )}
              <div className="space-y-4 p-6">
                {selectedResult.outputs.map((output, outputIndex) => {
                  const isObject =
                    typeof output === "object" && output !== null;
                  const outputStr = isObject
                    ? JSON.stringify(output, null, 2)
                    : String(output);
                  const isImage = !isObject && isImageUrl(outputStr);
                  const isVideo = !isObject && isVideoUrl(outputStr);
                  const isAudio = !isObject && isAudioUrl(outputStr);

                  return (
                    <div key={outputIndex} className="space-y-2">
                      {/* Media content */}
                      <div className="relative">
                        {isImage && (
                          <img
                            src={outputStr}
                            alt={`Output ${outputIndex + 1}`}
                            className="max-w-full rounded-lg"
                          />
                        )}
                        {isVideo && (
                          <video
                            src={outputStr}
                            controls
                            playsInline
                            preload="auto"
                            className="max-w-full rounded-lg"
                          />
                        )}
                        {isAudio && <AudioPlayer src={outputStr} />}
                        {isObject && (
                          <pre className="p-4 bg-muted rounded-lg text-sm overflow-auto max-h-96">
                            {outputStr}
                          </pre>
                        )}
                        {!isImage && !isVideo && !isAudio && !isObject && (
                          <p className="text-sm break-all">{outputStr}</p>
                        )}
                      </div>

                      {/* Actions - always visible below content */}
                      {!isObject && (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleDownload(
                                outputStr,
                                selectedResult.prediction?.id,
                                outputIndex,
                              )
                            }
                          >
                            <Download className="h-4 w-4 mr-2" />
                            {t("common.download")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleCopy(
                                outputStr,
                                selectedResult.index * 100 + outputIndex,
                              )
                            }
                          >
                            {copiedIndex ===
                            selectedResult.index * 100 + outputIndex ? (
                              <Check className="h-4 w-4 mr-2" />
                            ) : (
                              <Copy className="h-4 w-4 mr-2" />
                            )}
                            {copiedIndex ===
                            selectedResult.index * 100 + outputIndex
                              ? "Copied!"
                              : t("common.copy")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => window.open(outputStr, "_blank")}
                          >
                            <ExternalLink className="h-4 w-4 mr-2" />
                            {t("common.openInBrowser")}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Input details */}
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    {t("playground.batch.inputDetails")}
                  </summary>
                  <pre className="mt-2 p-3 bg-muted rounded-lg text-xs overflow-auto max-h-48">
                    {JSON.stringify(selectedResult.input, null, 2)}
                  </pre>
                </details>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
