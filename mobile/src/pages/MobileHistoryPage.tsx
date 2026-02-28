import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getMediaTypeFromUrl, isHttpUrl } from "@mobile/lib/mediaUtils";
import { apiClient } from "@/api/client";
import { useApiKeyStore } from "@/stores/apiKeyStore";
import { useTemplateStore } from "@/stores/templateStore";
import { usePredictionInputsStore } from "@mobile/stores/predictionInputsStore";
import type { HistoryItem } from "@/types/prediction";
import { OutputDisplay } from "@/components/playground/OutputDisplay";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
// ScrollArea removed – native div scroll for reliable infinite-scroll
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  BookmarkPlus,
  Trash2,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AudioPlayer } from "@/components/shared/AudioPlayer";
import { useToast } from "@/hooks/useToast";
import { getPlatformService } from "@mobile/platform";

// Extended history item that might include inputs from API
interface ExtendedHistoryItem extends HistoryItem {
  inputs?: Record<string, unknown>;
  input?: Record<string, unknown>;
}

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
      videoRef.current.currentTime = 0.1;
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
        preload="auto"
        onLoadedData={(e) => {
          const video = e.currentTarget;
          video.currentTime = 0.1; // Seek to first frame for preview
          setIsLoaded(true);
        }}
        onError={() => setHasError(true)}
      />
    </div>
  );
}

// Proxy image component - fetches images via Capacitor HTTP to bypass CORS
function ProxyImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadImage = async () => {
      try {
        const platform = getPlatformService();
        const result = await platform.fetchImageAsDataUrl(src);
        if (mounted) {
          if (result) {
            setDataUrl(result);
          } else {
            setHasError(true);
          }
          setIsLoading(false);
        }
      } catch {
        if (mounted) {
          setHasError(true);
          setIsLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      mounted = false;
    };
  }, [src]);

  if (isLoading) {
    return (
      <div
        className={cn("flex items-center justify-center bg-muted", className)}
      >
        <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (hasError || !dataUrl) {
    return (
      <div
        className={cn("flex items-center justify-center bg-muted", className)}
      >
        <Image className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  return <img src={dataUrl} alt={alt} className={className} />;
}

export function MobileHistoryPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { isLoading: isLoadingApiKey, isValidated } = useApiKeyStore();
  const { templates, saveTemplate, loadTemplates } = useTemplateStore();
  const {
    get: getLocalInputs,
    getArchived,
    load: loadPredictionInputs,
    isLoaded: inputsLoaded,
  } = usePredictionInputsStore();
  const [items, setItems] = useState<ExtendedHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const contentRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const dialogTouchStartX = useRef(0);
  const dialogTouchStartY = useRef(0);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedItem, setSelectedItem] = useState<ExtendedHistoryItem | null>(
    null,
  );
  const [copiedId, setCopiedId] = useState(false);
  const [loadPreviews, setLoadPreviews] = useState(true);

  // Save template state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [nameError, setNameError] = useState("");

  // Delete functionality state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirmItem, setDeleteConfirmItem] =
    useState<ExtendedHistoryItem | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Long press handling
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const longPressTriggered = useRef(false);
  const [isFetchingInputs, setIsFetchingInputs] = useState(false);

  // Check for duplicate template name
  const checkDuplicateName = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        setNameError("");
        return false;
      }
      const isDuplicate = templates.some(
        (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (isDuplicate) {
        setNameError(t("history.saveTemplate.duplicateName"));
        return true;
      }
      setNameError("");
      return false;
    },
    [templates, t],
  );

  // Load templates and prediction inputs on mount
  useEffect(() => {
    loadTemplates();
    if (!inputsLoaded) {
      loadPredictionInputs();
    }
  }, [loadTemplates, inputsLoaded, loadPredictionInputs]);

  const handleCopyId = async (id: string) => {
    await navigator.clipboard.writeText(id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleDelete = async (item: ExtendedHistoryItem) => {
    setIsDeleting(true);
    try {
      await apiClient.deletePrediction(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setTotal((prev) => prev - 1);
      setDeleteConfirmItem(null);
      setSelectedItem(null);
      toast({
        title: t("history.deleted"),
        description: item.model,
      });
    } catch (err) {
      toast({
        title: t("history.deleteFailed"),
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    try {
      await apiClient.deletePredictions(Array.from(selectedIds));
      setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
      setTotal((prev) => prev - selectedIds.size);
      const count = selectedIds.size;
      setSelectedIds(new Set());
      setIsSelectMode(false);
      setBulkDeleteConfirm(false);
      toast({
        title: t("history.deletedBulk"),
        description: t("history.deletedBulkDesc", { count }),
      });
    } catch (err) {
      toast({
        title: t("history.deleteFailed"),
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
    setIsSelectMode(false);
  };

  // Long press handlers
  const handleLongPressStart = (item: ExtendedHistoryItem) => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      if (!isSelectMode && statusFilter !== "archived") {
        setIsSelectMode(true);
        setSelectedIds(new Set([item.id]));
      }
    }, 500); // 500ms for long press
  };

  const handleLongPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleCardClick = (item: ExtendedHistoryItem) => {
    // If long press was triggered, don't handle click
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }

    if (isSelectMode) {
      handleToggleSelect(item.id);
    } else {
      setSelectedItem(item);
    }
  };

  // Bulk download handler
  const handleBulkDownload = async () => {
    if (selectedIds.size === 0) return;
    setIsDownloading(true);

    const platform = getPlatformService();
    let successCount = 0;
    let failCount = 0;

    for (const id of selectedIds) {
      const item = items.find((i) => i.id === id);
      if (!item?.outputs?.[0] || typeof item.outputs[0] !== "string") continue;

      const url = item.outputs[0];
      if (!url.startsWith("http")) continue;

      // Extract file extension from URL
      const urlPath = new URL(url).pathname;
      const ext = urlPath.split(".").pop() || "png";
      const filename = `wavespeed_${item.id.slice(-8)}.${ext}`;

      try {
        const result = await platform.downloadFile(url, filename);
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    setIsDownloading(false);
    setSelectedIds(new Set());
    setIsSelectMode(false);

    if (successCount > 0) {
      toast({
        title: t("history.downloadComplete"),
        description: t("history.downloadCompleteDesc", { count: successCount }),
      });
    }
    if (failCount > 0) {
      toast({
        title: t("history.downloadFailed"),
        description: t("history.downloadFailedDesc", { count: failCount }),
        variant: "destructive",
      });
    }
  };

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

  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize) || 1;

  const fetchHistory = useCallback(async () => {
    if (!isValidated) return;
    setIsLoading(true);
    setError(null);

    try {
      // Handle archived filter - show from local storage
      if (statusFilter === "archived") {
        const archivedEntries = getArchived();
        const archivedItems: ExtendedHistoryItem[] = archivedEntries.map(
          (entry) => ({
            id: entry.predictionId,
            model: entry.modelId,
            status: "completed" as const,
            outputs: [],
            created_at: entry.createdAt,
            inputs: entry.inputs,
          }),
        );
        setItems(archivedItems);
        setTotal(archivedItems.length);
        return;
      }

      const filters =
        statusFilter !== "all"
          ? { status: statusFilter as "completed" | "failed" }
          : undefined;

      const response = await apiClient.getHistory(page, pageSize, filters);
      setItems((response.items || []) as ExtendedHistoryItem[]);
      setTotal(response.total || 0);
    } catch (err) {
      console.error("History fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch history");
    } finally {
      setIsLoading(false);
    }
  }, [isValidated, page, statusFilter, getArchived]);

  // Load when page or filter changes
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Reset page when filter changes
  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  // Swipe to change page
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      const dy = e.changedTouches[0].clientY - touchStartY.current;
      // Only trigger if horizontal swipe is dominant and > 80px
      if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0 && page < totalPages) {
          setPage((p) => p + 1);
        } else if (dx > 0 && page > 1) {
          setPage((p) => p - 1);
        }
      }
    },
    [page, totalPages],
  );

  // Swipe in detail dialog to navigate between items
  const handleDialogTouchStart = useCallback((e: React.TouchEvent) => {
    dialogTouchStartX.current = e.touches[0].clientX;
    dialogTouchStartY.current = e.touches[0].clientY;
  }, []);

  const handleDialogTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const dx = e.changedTouches[0].clientX - dialogTouchStartX.current;
      const dy = e.changedTouches[0].clientY - dialogTouchStartY.current;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) {
          navigateHistory("next");
        } else {
          navigateHistory("prev");
        }
      }
    },
    [navigateHistory],
  );

  const getStatusBadge = (status: string, isArchived?: boolean) => {
    // Show archived badge if item is from archived filter
    if (isArchived) {
      return <Badge variant="secondary">{t("history.status.archived")}</Badge>;
    }
    switch (status) {
      case "completed":
        return <Badge variant="success">{t("history.status.completed")}</Badge>;
      case "failed":
        return (
          <Badge variant="destructive">{t("history.status.failed")}</Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getOutputType = (
    output: unknown,
  ): "image" | "video" | "audio" | "url" | "json" | "text" => {
    if (typeof output === "object" && output !== null) {
      return "json";
    }
    if (typeof output === "string") {
      const mediaType = getMediaTypeFromUrl(output);
      if (mediaType === "image") return "image";
      if (mediaType === "video") return "video";
      if (mediaType === "audio") return "audio";
      if (isHttpUrl(output)) return "url";
    }
    return "text";
  };

  const getPreviewIcon = (item: ExtendedHistoryItem) => {
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
  };

  // Get inputs from history item (check local storage first, then API response)
  const getItemInputs = (
    item: ExtendedHistoryItem,
  ): { inputs: Record<string, unknown>; modelName: string } | null => {
    console.log(
      "[MobileHistoryPage] Looking up inputs for prediction:",
      item.id,
    );

    // First check local storage (from predictions made in this app)
    const localEntry = getLocalInputs(item.id);
    console.log("[MobileHistoryPage] Local storage entry:", localEntry);

    if (
      localEntry &&
      localEntry.inputs &&
      Object.keys(localEntry.inputs).length > 0
    ) {
      console.log("[MobileHistoryPage] Found inputs in local storage");
      return { inputs: localEntry.inputs, modelName: localEntry.modelName };
    }
    // Then check API response (might return as 'inputs' or 'input')
    if (
      item.inputs &&
      typeof item.inputs === "object" &&
      Object.keys(item.inputs).length > 0
    ) {
      console.log(
        "[MobileHistoryPage] Found inputs in API response (inputs field)",
      );
      return { inputs: item.inputs, modelName: item.model };
    }
    if (
      item.input &&
      typeof item.input === "object" &&
      Object.keys(item.input).length > 0
    ) {
      console.log(
        "[MobileHistoryPage] Found inputs in API response (input field)",
      );
      return { inputs: item.input, modelName: item.model };
    }
    console.log("[MobileHistoryPage] No inputs found");
    return null;
  };

  // Check if inputs are available for a history item
  const hasInputsAvailable = (item: ExtendedHistoryItem): boolean => {
    // Check local storage
    const localEntry = getLocalInputs(item.id);
    if (
      localEntry &&
      localEntry.inputs &&
      Object.keys(localEntry.inputs).length > 0
    ) {
      return true;
    }
    // Check API response
    if (
      item.inputs &&
      typeof item.inputs === "object" &&
      Object.keys(item.inputs).length > 0
    ) {
      return true;
    }
    if (
      item.input &&
      typeof item.input === "object" &&
      Object.keys(item.input).length > 0
    ) {
      return true;
    }
    return false;
  };

  // Handle save as template - tries local storage first, then API
  const handleSaveAsTemplate = async () => {
    if (!selectedItem) return;

    // Wait for inputs store to load
    if (!inputsLoaded) {
      toast({
        title: t("common.loading"),
        description: t("common.loading"),
        variant: "default",
      });
      return;
    }

    // First try local storage
    let inputData = getItemInputs(selectedItem);

    // If not found locally, try fetching from API
    if (!inputData) {
      console.log("[MobileHistoryPage] No local inputs, trying API...");
      setIsFetchingInputs(true);
      try {
        const details = await apiClient.getPredictionDetails(selectedItem.id);
        console.log("[MobileHistoryPage] API response:", details);

        // Check if API returned inputs
        const apiInputs = (details as { input?: Record<string, unknown> })
          .input;
        if (
          apiInputs &&
          typeof apiInputs === "object" &&
          Object.keys(apiInputs).length > 0
        ) {
          console.log("[MobileHistoryPage] Found inputs from API");
          inputData = { inputs: apiInputs, modelName: selectedItem.model };

          // Update the selected item with the fetched inputs
          setSelectedItem((prev) =>
            prev ? { ...prev, input: apiInputs } : null,
          );
        }
      } catch (err) {
        console.error("[MobileHistoryPage] Failed to fetch from API:", err);
      } finally {
        setIsFetchingInputs(false);
      }
    }

    if (!inputData) {
      toast({
        title: t("history.saveTemplate.noInputsTitle"),
        description: t("history.saveTemplate.noInputsDesc"),
        variant: "destructive",
      });
      return;
    }

    // Generate default template name
    const modelName =
      inputData.modelName.split("/").pop() || inputData.modelName;
    const dateStr = new Date(selectedItem.created_at).toLocaleDateString();
    setTemplateName(`${modelName} - ${dateStr}`);
    setShowSaveDialog(true);
  };

  const handleConfirmSave = async () => {
    if (!selectedItem || !templateName.trim()) return;

    const inputData = getItemInputs(selectedItem);
    if (!inputData) return;

    // Check for duplicate template name
    if (checkDuplicateName(templateName)) {
      return;
    }

    setIsSaving(true);
    try {
      // Use model from local storage if available (more reliable than API's model field)
      saveTemplate(
        templateName.trim(),
        selectedItem.model,
        inputData.modelName,
        inputData.inputs,
      );

      toast({
        title: t("history.saveTemplate.success"),
        description: t("history.saveTemplate.successDesc"),
      });

      setShowSaveDialog(false);
      setTemplateName("");
      setNameError("");
    } catch (err) {
      toast({
        title: t("history.saveTemplate.error"),
        description:
          err instanceof Error ? err.message : "Failed to save template",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Show loading state while API key is being loaded from storage
  if (isLoadingApiKey) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col relative overflow-hidden">
      {/* Dynamic Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-cyan-500/5" />
      <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-primary/10 to-transparent rounded-full blur-3xl animate-pulse" />
      <div
        className="absolute bottom-0 left-0 w-80 h-80 bg-gradient-to-tr from-cyan-500/10 to-transparent rounded-full blur-3xl animate-pulse"
        style={{ animationDelay: "1s" }}
      />

      {/* Header */}
      <div className="page-header px-4 py-3 relative z-10">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              {t("history.title")}
            </h1>
            <p className="text-muted-foreground text-xs mt-0.5">
              {t("history.description")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSelectMode ? (
              <>
                {selectedIds.size > 0 && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBulkDownload}
                      disabled={isDownloading}
                    >
                      {isDownloading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setBulkDeleteConfirm(true)}
                      disabled={isDownloading}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      {selectedIds.size}
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearSelection}
                  disabled={isDownloading}
                >
                  {t("history.selectionDone")}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchHistory()}
                disabled={isLoading}
              >
                <RefreshCw
                  className={cn("h-4 w-4", isLoading && "animate-spin")}
                />
              </Button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value);
            }}
          >
            <SelectTrigger className="flex-1 h-9">
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
              <SelectItem value="archived">
                {t("history.status.archived")}
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
          >
            {loadPreviews ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div
        className="flex-1 overflow-auto relative z-10"
        ref={contentRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="px-4 py-4">
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
            <div className="text-center py-8">
              <Clock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">
                {t("history.noHistory")}
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {items.map((item) => {
                  const PreviewIcon = getPreviewIcon(item);
                  const hasPreview = item.outputs && item.outputs.length > 0;

                  return (
                    <Card
                      key={item.id}
                      className={cn(
                        "overflow-hidden cursor-pointer card-elevated border-transparent hover:border-primary/20 active:scale-[0.98] transition-transform relative select-none",
                        isSelectMode &&
                          selectedIds.has(item.id) &&
                          "ring-2 ring-primary",
                      )}
                      onClick={() => handleCardClick(item)}
                      onTouchStart={() => handleLongPressStart(item)}
                      onTouchEnd={handleLongPressEnd}
                      onTouchCancel={handleLongPressEnd}
                      onMouseDown={() => handleLongPressStart(item)}
                      onMouseUp={handleLongPressEnd}
                      onMouseLeave={handleLongPressEnd}
                    >
                      {/* Preview */}
                      <div className="aspect-square bg-muted relative">
                        {isSelectMode && (
                          <div className="absolute top-1.5 left-1.5 z-10">
                            <Checkbox
                              checked={selectedIds.has(item.id)}
                              onClick={(e) => e.stopPropagation()}
                              onCheckedChange={() =>
                                handleToggleSelect(item.id)
                              }
                            />
                          </div>
                        )}
                        {loadPreviews &&
                        hasPreview &&
                        typeof item.outputs![0] === "string" &&
                        item.outputs![0].match(/\.(jpg|jpeg|png|gif|webp)/i) ? (
                          <ProxyImage
                            src={item.outputs![0]}
                            alt="Preview"
                            className="w-full h-full object-cover"
                          />
                        ) : loadPreviews &&
                          hasPreview &&
                          typeof item.outputs![0] === "string" &&
                          item.outputs![0].match(/\.(mp4|webm|mov)/i) ? (
                          <VideoPreview
                            src={item.outputs![0]}
                            enabled={loadPreviews}
                          />
                        ) : loadPreviews &&
                          hasPreview &&
                          typeof item.outputs![0] === "string" &&
                          item.outputs![0].match(
                            /\.(mp3|wav|ogg|flac|aac|m4a|wma)/i,
                          ) ? (
                          <div className="w-full h-full flex items-center justify-center p-3">
                            <AudioPlayer src={item.outputs![0]} compact />
                          </div>
                        ) : hasPreview &&
                          typeof item.outputs![0] === "object" ? (
                          <div className="w-full h-full flex flex-col items-center justify-center p-3 gap-1">
                            <FileJson className="h-6 w-6 text-muted-foreground shrink-0" />
                            <pre className="text-[10px] text-muted-foreground overflow-hidden text-ellipsis w-full text-center line-clamp-3">
                              {JSON.stringify(item.outputs![0], null, 0).slice(
                                0,
                                100,
                              )}
                            </pre>
                          </div>
                        ) : hasPreview &&
                          typeof item.outputs![0] === "string" &&
                          !item.outputs![0].startsWith("http") ? (
                          <div className="w-full h-full flex flex-col items-center justify-center p-3 gap-1">
                            <FileText className="h-6 w-6 text-muted-foreground shrink-0" />
                            <p className="text-[10px] text-muted-foreground overflow-hidden text-ellipsis w-full text-center line-clamp-3">
                              {item.outputs![0].slice(0, 150)}
                            </p>
                          </div>
                        ) : hasPreview &&
                          typeof item.outputs![0] === "string" &&
                          item.outputs![0].startsWith("http") ? (
                          <div className="w-full h-full flex flex-col items-center justify-center p-3 gap-1">
                            <Link className="h-6 w-6 text-muted-foreground shrink-0" />
                            <p className="text-[10px] text-muted-foreground overflow-hidden text-ellipsis w-full text-center line-clamp-2 break-all">
                              {item.outputs![0]}
                            </p>
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <PreviewIcon className="h-10 w-10 text-muted-foreground" />
                          </div>
                        )}
                        <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
                          {/* Indicator for items with locally stored inputs */}
                          {inputsLoaded && hasInputsAvailable(item) && (
                            <div
                              className="bg-primary/90 rounded-full p-1"
                              title={t("history.hasInputs")}
                            >
                              <BookmarkPlus className="h-3 w-3 text-primary-foreground" />
                            </div>
                          )}
                          {getStatusBadge(
                            item.status,
                            statusFilter === "archived",
                          )}
                        </div>
                      </div>

                      <CardContent className="p-2">
                        <p className="font-medium text-xs truncate">
                          {item.model.split("/").pop()}
                        </p>
                        <div className="flex items-center justify-between mt-0.5 text-[10px] text-muted-foreground">
                          <span>
                            {new Date(item.created_at).toLocaleDateString()}
                          </span>
                          {item.execution_time && (
                            <span>
                              {(item.execution_time / 1000).toFixed(1)}s
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              {/* Pagination */}
              <div className="flex items-center justify-center gap-3 pt-4 pb-6">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0"
                  disabled={page <= 1 || isLoading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground min-w-[80px] text-center">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0"
                  disabled={page >= totalPages || isLoading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Detail Dialog */}
      <Dialog
        open={!!selectedItem && !showSaveDialog}
        onOpenChange={(open) => !open && setSelectedItem(null)}
      >
        <DialogContent className="max-w-[95vw] max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader className="flex flex-row items-center justify-between">
            <div>
              <DialogTitle className="text-base flex items-center gap-2">
                {t("history.generationDetails")}
                {items.length > 1 && (
                  <span className="text-sm font-normal text-muted-foreground">
                    (
                    {items.findIndex((item) => item.id === selectedItem?.id) +
                      1}
                    /{items.length})
                  </span>
                )}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t("history.generationDetails")}
              </DialogDescription>
            </div>
            {statusFilter !== "archived" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() =>
                  selectedItem && setDeleteConfirmItem(selectedItem)
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </DialogHeader>
          {selectedItem && (
            <div
              className="flex-1 overflow-y-auto space-y-4"
              onTouchStart={handleDialogTouchStart}
              onTouchEnd={handleDialogTouchEnd}
            >
              {/* Navigation buttons for switching between items */}
              {items.length > 1 && (
                <div className="flex items-center justify-center gap-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => navigateHistory("prev")}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {items.findIndex((item) => item.id === selectedItem?.id) +
                      1}{" "}
                    / {items.length}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => navigateHistory("next")}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {/* Preview using OutputDisplay */}
              {selectedItem.outputs && selectedItem.outputs.length > 0 && (
                <div className="h-[250px]">
                  <OutputDisplay
                    prediction={{
                      id: selectedItem.id,
                      model: selectedItem.model,
                      status: selectedItem.status,
                      outputs: selectedItem.outputs,
                      has_nsfw_contents: selectedItem.has_nsfw_contents,
                      timings: selectedItem.execution_time
                        ? { inference: selectedItem.execution_time }
                        : undefined,
                    }}
                    outputs={selectedItem.outputs}
                    error={null}
                    isLoading={false}
                    modelId={selectedItem.model}
                    hideGameButton
                  />
                </div>
              )}

              {/* Details */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("history.model")}
                  </p>
                  <p className="font-medium text-xs truncate">
                    {selectedItem.model}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("history.status.all").replace("All ", "")}
                  </p>
                  <div>{getStatusBadge(selectedItem.status)}</div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("history.created")}
                  </p>
                  <p className="font-medium text-xs">
                    {formatDate(selectedItem.created_at)}
                  </p>
                </div>
                {selectedItem.execution_time && (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("history.executionTime")}
                    </p>
                    <p className="font-medium text-xs">
                      {(selectedItem.execution_time / 1000).toFixed(2)}s
                    </p>
                  </div>
                )}
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">
                    {t("history.predictionId")}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-[10px] bg-muted px-2 py-1 rounded flex-1 truncate">
                      {selectedItem.id}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => handleCopyId(selectedItem.id)}
                    >
                      {copiedId ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Save as Template Button */}
              {selectedItem.status === "completed" && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleSaveAsTemplate}
                  disabled={isFetchingInputs}
                >
                  {isFetchingInputs ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <BookmarkPlus className="mr-2 h-4 w-4" />
                  )}
                  {isFetchingInputs
                    ? t("common.loading")
                    : t("history.saveTemplate.button")}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Save Template Dialog */}
      <Dialog
        open={showSaveDialog}
        onOpenChange={(open) => {
          setShowSaveDialog(open);
          if (!open) {
            setNameError("");
          }
        }}
      >
        <DialogContent className="max-w-[90vw]">
          <DialogHeader>
            <DialogTitle>{t("history.saveTemplate.dialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("history.saveTemplate.namePlaceholder")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="template-name">
                {t("history.saveTemplate.nameLabel")}
              </Label>
              <Input
                id="template-name"
                value={templateName}
                onChange={(e) => {
                  setTemplateName(e.target.value);
                  checkDuplicateName(e.target.value);
                }}
                placeholder={t("history.saveTemplate.namePlaceholder")}
                className={nameError ? "border-destructive" : ""}
                autoFocus
              />
              {nameError && (
                <p className="text-sm text-destructive">{nameError}</p>
              )}
            </div>
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowSaveDialog(false)}
              disabled={isSaving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              className="flex-1"
              onClick={handleConfirmSave}
              disabled={isSaving || !templateName.trim() || !!nameError}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("common.save")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single Delete Confirmation */}
      <AlertDialog
        open={!!deleteConfirmItem}
        onOpenChange={(open) => !open && setDeleteConfirmItem(null)}
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
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={bulkDeleteConfirm} onOpenChange={setBulkDeleteConfirm}>
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
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
