import { useState, useEffect, useRef, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { apiClient } from "@/api/client";
import { useApiKeyStore } from "@/stores/apiKeyStore";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { useModelsStore } from "@/stores/modelsStore";
import { usePredictionInputsStore } from "@/stores/predictionInputsStore";
import { usePageActive } from "@/hooks/usePageActive";
import { useDeferredClose } from "@/hooks/useDeferredClose";
import { normalizeApiInputsToFormValues } from "@/lib/schemaToForm";
import type { HistoryItem } from "@/types/prediction";
import { OutputDisplay } from "@/components/playground/OutputDisplay";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Image,
  Video,
  Music,
  Clock,
  FileText,
  FileJson,
  Link,
  File,
  AlertCircle,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  CheckSquare,
  History,
  Sparkles,
  MoreVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AudioPlayer } from "@/components/shared/AudioPlayer";
import { useInView } from "@/hooks/useInView";
import { toast } from "@/hooks/useToast";

// Video preview component - shows first frame, plays on hover
function VideoPreview({ src, enabled }: { src: string; enabled: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleMouseEnter = () => {
    if (videoRef.current && isLoaded && enabled) {
      videoRef.current.play().catch(() => {
        // Ignore autoplay errors
      });
    }
  };

  const handleMouseLeave = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  // Show placeholder if disabled or error
  if (!enabled || hasError) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Video className="h-12 w-12 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className="w-full h-full relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted z-10">
          <Video className="h-12 w-12 text-muted-foreground" />
        </div>
      )}
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-cover"
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedData={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
      />
    </div>
  );
}

// ── Module-level helpers (stable references, no re-creation) ─────────

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString();
}

function getOutputType(
  output: unknown,
): "image" | "video" | "audio" | "url" | "json" | "text" {
  if (typeof output === "object" && output !== null) return "json";
  if (typeof output === "string") {
    if (output.match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i)) return "image";
    if (output.match(/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i)) return "video";
    if (output.match(/\.(mp3|wav|ogg|flac|aac|m4a|wma)(\?.*)?$/i))
      return "audio";
    if (output.startsWith("http://") || output.startsWith("https://"))
      return "url";
  }
  return "text";
}

function getPreviewIcon(item: HistoryItem) {
  const firstOutput = item.outputs?.[0];
  const type = getOutputType(firstOutput);
  switch (type) {
    case "image":
      return Image;
    case "video":
      return Video;
    case "audio":
      return Music;
    case "url":
      return Link;
    case "json":
      return FileJson;
    case "text":
      return FileText;
    default:
      return File;
  }
}

// ── Memoized HistoryCard (prevents full-list remount on dialog open/close) ──

interface HistoryCardProps {
  item: HistoryItem;
  index: number;
  loadPreviews: boolean;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onSelect: (item: HistoryItem) => void;
  onCustomize: (item: HistoryItem) => void;
  onDelete: (item: HistoryItem) => void;
}

const HistoryCard = memo(function HistoryCard({
  item,
  index,
  loadPreviews,
  isSelectionMode,
  isSelected,
  onToggleSelect,
  onSelect,
  onCustomize,
  onDelete,
}: HistoryCardProps) {
  const { t } = useTranslation();
  const { ref, isInView } = useInView<HTMLDivElement>();
  const PreviewIcon = getPreviewIcon(item);
  const hasPreview = item.outputs && item.outputs.length > 0;
  const firstOutput = item.outputs?.[0];
  const shouldLoad = loadPreviews && isInView;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge variant="success">{t("history.status.completed")}</Badge>;
      case "failed":
        return (
          <Badge variant="destructive">{t("history.status.failed")}</Badge>
        );
      case "processing":
        return (
          <Badge variant="warning">{t("history.status.processing")}</Badge>
        );
      case "created":
        return <Badge variant="info">{t("history.status.created")}</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <Card
      className={cn(
        "group overflow-hidden cursor-pointer rounded-xl border border-border/70 bg-card/80 shadow-sm hover:shadow-md transition-all animate-in fade-in slide-in-from-bottom-2 fill-mode-both",
        isSelected && "ring-2 ring-primary",
      )}
      style={{ animationDelay: `${Math.min(index, 19) * 30}ms` }}
      onClick={() =>
        isSelectionMode ? onToggleSelect(item.id) : onSelect(item)
      }
    >
      {/* Preview */}
      <div ref={ref} className="aspect-square bg-muted relative">
        {isSelectionMode && (
          <div
            className="absolute top-2 left-2 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect(item.id)}
              className="bg-background"
            />
          </div>
        )}
        {shouldLoad &&
        hasPreview &&
        typeof firstOutput === "string" &&
        firstOutput.match(/\.(jpg|jpeg|png|gif|webp)/i) ? (
          <img
            src={firstOutput}
            alt="Preview"
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : shouldLoad &&
          hasPreview &&
          typeof firstOutput === "string" &&
          firstOutput.match(/\.(mp4|webm|mov)/i) ? (
          <VideoPreview src={firstOutput} enabled={shouldLoad} />
        ) : shouldLoad &&
          hasPreview &&
          typeof firstOutput === "string" &&
          firstOutput.match(/\.(mp3|wav|ogg|flac|aac|m4a|wma)/i) ? (
          <div
            className="w-full h-full flex items-center justify-center p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <AudioPlayer src={firstOutput} compact />
          </div>
        ) : shouldLoad && hasPreview && typeof firstOutput === "object" ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-3 gap-1">
            <FileJson className="h-6 w-6 text-muted-foreground shrink-0" />
            <pre className="text-[10px] text-muted-foreground overflow-hidden text-ellipsis w-full text-center line-clamp-3">
              {JSON.stringify(firstOutput, null, 0).slice(0, 100)}
            </pre>
          </div>
        ) : shouldLoad &&
          hasPreview &&
          typeof firstOutput === "string" &&
          !firstOutput.startsWith("http") ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-3 gap-1">
            <FileText className="h-6 w-6 text-muted-foreground shrink-0" />
            <p className="text-[10px] text-muted-foreground overflow-hidden text-ellipsis w-full text-center line-clamp-3">
              {firstOutput.slice(0, 150)}
            </p>
          </div>
        ) : shouldLoad &&
          hasPreview &&
          typeof firstOutput === "string" &&
          firstOutput.startsWith("http") ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-3 gap-1">
            <Link className="h-6 w-6 text-muted-foreground shrink-0" />
            <p className="text-[10px] text-muted-foreground overflow-hidden text-ellipsis w-full text-center line-clamp-2 break-all">
              {firstOutput}
            </p>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <PreviewIcon className="h-10 w-10 text-muted-foreground" />
          </div>
        )}
        <div className="absolute bottom-1.5 right-1.5">
          {getStatusBadge(item.status)}
        </div>

        {/* Always-visible quick actions — top right */}
        {!isSelectionMode && item.status === "completed" && (
          <div className="absolute top-2 right-2 flex gap-1.5 z-10">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCustomize(item);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm text-white text-[10px] font-medium hover:bg-primary transition-colors"
              title={t("history.openInPlayground", "Open in Playground")}
            >
              <Sparkles className="h-3 w-3" />
              {t("common.customize", "Customize")}
            </button>
          </div>
        )}
      </div>

      <CardContent className="p-2.5">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{item.model}</p>
            <p className="mt-0.5 text-xs text-muted-foreground truncate">
              {formatDate(item.created_at)}
            </p>
            {item.execution_time && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {(item.execution_time / 1000).toFixed(2)}s
              </p>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {item.status === "completed" && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onCustomize(item);
                  }}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t("common.customize", "Customize")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item);
                }}
                className="text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
});

export function HistoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isActive = usePageActive("/history");
  const {
    isLoading: isLoadingApiKey,
    isValidated,
    loadApiKey,
    hasAttemptedLoad,
  } = useApiKeyStore();
  const { createTab, findFormValuesByPredictionId } = usePlaygroundStore();
  const { getModelById } = useModelsStore();
  const {
    get: getLocalInputs,
    load: loadPredictionInputs,
    isLoaded: inputsLoaded,
  } = usePredictionInputsStore();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);
  const deferredSelectedItem = useDeferredClose(selectedItem);
  const [copiedId, setCopiedId] = useState(false);
  const [loadPreviews, setLoadPreviews] = useState(true);
  const [deleteConfirmItem, setDeleteConfirmItem] =
    useState<HistoryItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isOpeningPlayground, setIsOpeningPlayground] = useState(false);
  const pageSize = 50;

  const handleCopyId = async (id: string) => {
    await navigator.clipboard.writeText(id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleOpenInPlayground = useCallback(
    async (item: HistoryItem) => {
      const model = getModelById(item.model);
      if (!model) {
        toast({
          title: t("common.error"),
          description: t(
            "history.modelNotAvailable",
            "Model is no longer available",
          ),
          variant: "destructive",
        });
        return;
      }

      // Build a synthetic PredictionResult for output display
      const predictionResult = {
        id: item.id,
        model: item.model,
        status: item.status as any,
        outputs: item.outputs,
        has_nsfw_contents: item.has_nsfw_contents,
        timings: item.execution_time
          ? { inference: item.execution_time }
          : undefined,
      };

      // Try local storage first (saved from previous Playground runs)
      const localEntry = getLocalInputs(item.id);
      if (localEntry?.inputs && Object.keys(localEntry.inputs).length > 0) {
        createTab(model, localEntry.inputs, item.outputs, predictionResult);
        setSelectedItem(null);
        navigate(`/playground/${encodeURIComponent(item.model)}`);
        return;
      }

      // Check Playground tabs' generationHistory (Recent Generations store formValues)
      const historyFormValues = findFormValuesByPredictionId(item.id);
      if (historyFormValues) {
        createTab(model, historyFormValues, item.outputs, predictionResult);
        setSelectedItem(null);
        navigate(`/playground/${encodeURIComponent(item.model)}`);
        return;
      }

      // Check if the history item itself carries inputs from the API list response
      const itemInputs = item.inputs || item.input;
      if (
        itemInputs &&
        typeof itemInputs === "object" &&
        Object.keys(itemInputs).length > 0
      ) {
        createTab(
          model,
          normalizeApiInputsToFormValues(itemInputs as Record<string, unknown>),
          item.outputs,
          predictionResult,
        );
        setSelectedItem(null);
        navigate(`/playground/${encodeURIComponent(item.model)}`);
        return;
      }

      // Fallback: fetch prediction details from API
      setIsOpeningPlayground(true);
      try {
        const details = await apiClient.getPredictionDetails(item.id);
        const apiInput =
          (details as any).input || (details as any).inputs || {};
        createTab(
          model,
          Object.keys(apiInput).length > 0
            ? normalizeApiInputsToFormValues(apiInput)
            : undefined,
          item.outputs,
          predictionResult,
        );
        setSelectedItem(null);
        navigate(`/playground/${encodeURIComponent(item.model)}`);
      } catch {
        createTab(model, undefined, item.outputs, predictionResult);
        setSelectedItem(null);
        navigate(`/playground/${encodeURIComponent(item.model)}`);
      } finally {
        setIsOpeningPlayground(false);
      }
    },
    [
      getModelById,
      getLocalInputs,
      findFormValuesByPredictionId,
      createTab,
      navigate,
      t,
    ],
  );

  // Navigate to previous/next history item (with loop support)
  const navigateHistory = useCallback(
    (direction: "prev" | "next") => {
      if (!selectedItem || items.length <= 1) return;

      const currentIdx = items.findIndex((item) => item.id === selectedItem.id);
      if (currentIdx === -1) return;

      let newIdx: number;
      if (direction === "prev") {
        newIdx = currentIdx === 0 ? items.length - 1 : currentIdx - 1;
      } else {
        newIdx = currentIdx === items.length - 1 ? 0 : currentIdx + 1;
      }

      setSelectedItem(items[newIdx]);
    },
    [selectedItem, items],
  );

  // Keyboard navigation for detail dialog
  useEffect(() => {
    if (!selectedItem || !isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigateHistory("prev");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateHistory("next");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive, selectedItem, navigateHistory]);

  const fetchHistory = useCallback(async () => {
    if (!isValidated) return;

    setIsLoading(true);
    setError(null);

    try {
      const filters =
        statusFilter !== "all"
          ? {
              status: statusFilter as
                | "completed"
                | "failed"
                | "processing"
                | "created",
            }
          : undefined;

      const response = await apiClient.getHistory(page, pageSize, filters);
      setItems(response.items || []);
    } catch (err) {
      console.error("History fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch history");
    } finally {
      setIsLoading(false);
    }
  }, [isValidated, page, pageSize, statusFilter]);

  const handleDelete = useCallback(
    async (item: HistoryItem) => {
      setIsDeleting(true);
      try {
        await apiClient.deletePrediction(item.id);
        setItems((prevItems) =>
          prevItems.filter((existing) => existing.id !== item.id),
        );
        if (selectedItem?.id === item.id) {
          setSelectedItem(null);
        }
        toast({
          title: t("history.deleted"),
        });
      } catch (err) {
        toast({
          title: t("common.error"),
          description:
            err instanceof Error ? err.message : t("history.deleteFailed"),
          variant: "destructive",
        });
      } finally {
        setIsDeleting(false);
        setDeleteConfirmItem(null);
      }
    },
    [selectedItem?.id, t],
  );

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    const idsToDelete = Array.from(selectedIds);
    const idsSet = new Set(idsToDelete);
    try {
      await apiClient.deletePredictions(idsToDelete);
      setItems((prevItems) =>
        prevItems.filter((existing) => !idsSet.has(existing.id)),
      );
      if (selectedItem && idsSet.has(selectedItem.id)) {
        setSelectedItem(null);
      }
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      toast({
        title: t("history.deletedBulk"),
        description: t("history.deletedBulkDesc", {
          count: idsToDelete.length,
        }),
      });
    } catch (err) {
      toast({
        title: t("common.error"),
        description:
          err instanceof Error ? err.message : t("history.deleteFailed"),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setShowBulkDeleteConfirm(false);
    }
  }, [selectedIds, selectedItem, t]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleToggleSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedIds(new Set());
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(items.map((item) => item.id)));
  }, [items]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Load API key and prediction inputs on mount
  useEffect(() => {
    loadApiKey();
    if (!inputsLoaded) loadPredictionInputs();
  }, [loadApiKey, inputsLoaded, loadPredictionInputs]);

  // Only fetch when deps change; skip if data is fresh (< 30s old)
  const lastFetchTimeRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current < 30_000 && items.length > 0) return;
    lastFetchTimeRef.current = now;
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, statusFilter]);

  const maxSelectablePages = 100;

  useEffect(() => {
    if (page > maxSelectablePages) {
      setPage(maxSelectablePages);
    }
  }, [page, maxSelectablePages]);

  // Status badge helper for the detail dialog
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge variant="success">{t("history.status.completed")}</Badge>;
      case "failed":
        return (
          <Badge variant="destructive">{t("history.status.failed")}</Badge>
        );
      case "processing":
        return (
          <Badge variant="warning">{t("history.status.processing")}</Badge>
        );
      case "created":
        return <Badge variant="info">{t("history.status.created")}</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Show loading state while API key is being loaded from storage
  if (isLoadingApiKey || !hasAttemptedLoad) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="page-header px-4 md:px-6 py-4 pt-14 md:pt-4 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex flex-col gap-1.5 md:flex-row md:items-baseline md:gap-3">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              {t("history.title")}
            </h1>
            <p className="text-muted-foreground text-xs md:text-sm">
              {t("history.description")}
            </p>
          </div>
        </div>

        {/* Filters & Actions */}
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-36 rounded-lg border-border/80 bg-background">
              <SelectValue placeholder={t("history.status.all")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("history.status.all")}</SelectItem>
              <SelectItem value="completed">
                {t("history.status.completed")}
              </SelectItem>
              <SelectItem value="failed">
                {t("history.status.failed")}
              </SelectItem>
              <SelectItem value="processing">
                {t("history.status.processing")}
              </SelectItem>
              <SelectItem value="created">
                {t("history.status.created")}
              </SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={loadPreviews ? "default" : "outline"}
            size="sm"
            onClick={() => setLoadPreviews(!loadPreviews)}
            title={
              loadPreviews
                ? t("history.disablePreviews")
                : t("history.loadPreviews")
            }
            className="h-9 rounded-lg"
          >
            {loadPreviews ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
          </Button>
          {isSelectionMode && selectedIds.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowBulkDeleteConfirm(true)}
              disabled={isDeleting}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("history.deleteSelected", { count: selectedIds.size })}
            </Button>
          )}
          <Button
            variant={isSelectionMode ? "default" : "outline"}
            size="sm"
            onClick={handleToggleSelectionMode}
            disabled={isDeleting}
          >
            <CheckSquare className="mr-2 h-4 w-4" />
            {isSelectionMode ? t("history.selectionDone") : t("history.select")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchHistory}
            disabled={isLoading}
          >
            <RefreshCw
              className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")}
            />
            {t("common.refresh")}
          </Button>
          {isSelectionMode && items.length > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                disabled={selectedIds.size === items.length}
              >
                {t("common.selectAll")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearSelection}
                disabled={selectedIds.size === 0}
              >
                {t("common.clear")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {isLoading && items.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              {error.includes("404") ||
              error.includes("page not found") ||
              error.includes("504") ||
              error.includes("timeout") ||
              error.includes("Gateway") ? (
                <>
                  <p className="text-base font-medium">
                    {t("history.notAvailable")}
                  </p>
                  <p className="text-muted-foreground text-sm mt-1">
                    {t("history.notAvailableDesc")}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-destructive text-sm">{error}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={fetchHistory}
                  >
                    {t("errors.tryAgain")}
                  </Button>
                </>
              )}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 animate-in fade-in duration-500">
              <Clock className="mx-auto h-12 w-12 text-muted-foreground/40 mb-4 animate-pulse" />
              <p className="text-muted-foreground text-sm">
                {t("history.noHistory")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {items.map((item, index) => (
                <HistoryCard
                  key={item.id}
                  item={item}
                  index={index}
                  loadPreviews={loadPreviews}
                  isSelectionMode={isSelectionMode}
                  isSelected={selectedIds.has(item.id)}
                  onToggleSelect={handleToggleSelect}
                  onSelect={setSelectedItem}
                  onCustomize={handleOpenInPlayground}
                  onDelete={setDeleteConfirmItem}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Pagination */}
      {maxSelectablePages > 1 && (
        <div className="flex items-center justify-center gap-1.5 py-3 px-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={() => setPage((p) => p - 1)}
            disabled={page === 1 || isLoading}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {(() => {
            const pages: (number | "ellipsis")[] = [];
            const total = Math.min(maxSelectablePages, 99);
            if (total <= 7) {
              for (let i = 1; i <= total; i++) pages.push(i);
            } else {
              pages.push(1);
              if (page > 3) pages.push("ellipsis");
              const start = Math.max(2, page - 1);
              const end = Math.min(total - 1, page + 1);
              for (let i = start; i <= end; i++) pages.push(i);
              if (page < total - 2) pages.push("ellipsis");
              pages.push(total);
            }
            return pages.map((p, i) =>
              p === "ellipsis" ? (
                <span
                  key={`e${i}`}
                  className="w-8 text-center text-xs text-muted-foreground"
                >
                  ···
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === page ? "default" : "ghost"}
                  size="icon"
                  className={cn(
                    "h-8 w-8 rounded-lg text-xs font-medium",
                    p === page && "pointer-events-none",
                  )}
                  onClick={() => setPage(p)}
                  disabled={isLoading}
                >
                  {p}
                </Button>
              ),
            );
          })()}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= maxSelectablePages || isLoading}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog
        open={!!selectedItem}
        onOpenChange={(open) => !open && setSelectedItem(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden border-border/70 flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {t("history.generationDetails")}
              {items.length > 1 && (
                <span className="text-sm font-normal text-muted-foreground">
                  (
                  {items.findIndex(
                    (item) => item.id === deferredSelectedItem?.id,
                  ) + 1}
                  /{items.length})
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {deferredSelectedItem?.model ?? ""}
            </DialogDescription>
          </DialogHeader>
          {deferredSelectedItem && (
            <div className="flex-1 overflow-y-auto space-y-4 relative">
              {/* Navigation buttons on sides */}
              {items.length > 1 && (
                <>
                  <Button
                    size="icon"
                    variant="secondary"
                    onClick={() => navigateHistory("prev")}
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full opacity-80 hover:opacity-100"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    onClick={() => navigateHistory("next")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full opacity-80 hover:opacity-100"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleOpenInPlayground(deferredSelectedItem)}
                  disabled={isOpeningPlayground}
                >
                  {isOpeningPlayground ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  {t("common.customize", "Customize")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteConfirmItem(deferredSelectedItem)}
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  {t("common.delete")}
                </Button>
              </div>
              {/* Preview using OutputDisplay */}
              {deferredSelectedItem.outputs &&
                deferredSelectedItem.outputs.length > 0 && (
                  <div className="h-[400px]">
                    <OutputDisplay
                      prediction={{
                        id: deferredSelectedItem.id,
                        model: deferredSelectedItem.model,
                        status: deferredSelectedItem.status,
                        outputs: deferredSelectedItem.outputs,
                        has_nsfw_contents:
                          deferredSelectedItem.has_nsfw_contents,
                        timings: deferredSelectedItem.execution_time
                          ? { inference: deferredSelectedItem.execution_time }
                          : undefined,
                      }}
                      outputs={deferredSelectedItem.outputs}
                      error={null}
                      isLoading={false}
                    />
                  </div>
                )}

              {/* Details */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">{t("history.model")}</p>
                  <p className="font-medium">{deferredSelectedItem.model}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">
                    {t("history.status.all").replace("All ", "")}
                  </p>
                  <div>{getStatusBadge(deferredSelectedItem.status)}</div>
                </div>
                <div>
                  <p className="text-muted-foreground">
                    {t("history.created")}
                  </p>
                  <p className="font-medium">
                    {formatDate(deferredSelectedItem.created_at)}
                  </p>
                </div>
                {deferredSelectedItem.execution_time && (
                  <div>
                    <p className="text-muted-foreground">
                      {t("history.executionTime")}
                    </p>
                    <p className="font-medium">
                      {(deferredSelectedItem.execution_time / 1000).toFixed(2)}s
                    </p>
                  </div>
                )}
                <div className="col-span-2">
                  <p className="text-muted-foreground">
                    {t("history.predictionId")}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
                      {deferredSelectedItem.id}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleCopyId(deferredSelectedItem.id)}
                    >
                      {copiedId ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteConfirmItem}
        onOpenChange={() => setDeleteConfirmItem(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("history.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("history.deleteConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteConfirmItem && handleDelete(deleteConfirmItem)
              }
              disabled={!deleteConfirmItem || isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showBulkDeleteConfirm}
        onOpenChange={setShowBulkDeleteConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("history.bulkDeleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("history.bulkDeleteConfirmDesc", { count: selectedIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={isDeleting || selectedIds.size === 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {t("history.deleteSelected", { count: selectedIds.size })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
