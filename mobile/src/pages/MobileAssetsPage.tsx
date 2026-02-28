import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "@/api/client";
import { useApiKeyStore } from "@/stores/apiKeyStore";
import type { HistoryItem } from "@/types/prediction";
import { getPlatformService } from "@mobile/platform";
import {
  Loader2,
  RefreshCw,
  Download,
  ImageOff,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i;
const PAGE_SIZE = 20;

interface AssetImage {
  url: string;
  model: string;
  createdAt: string;
  predictionId: string;
}

// Unique key for an image (url + predictionId + index in case of duplicates)
function imageKey(image: AssetImage, idx: number) {
  return `${image.predictionId}-${idx}`;
}

// Extract image URLs from completed history items
function extractImages(items: HistoryItem[]): AssetImage[] {
  const images: AssetImage[] = [];
  for (const item of items) {
    if (item.status !== "completed" || !item.outputs) continue;
    for (const output of item.outputs) {
      if (typeof output === "string" && IMAGE_EXTENSIONS.test(output)) {
        images.push({
          url: output,
          model: item.model,
          createdAt: item.created_at,
          predictionId: item.id,
        });
      }
    }
  }
  return images;
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
      <div className={`flex items-center justify-center bg-muted ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (hasError || !dataUrl) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className}`}>
        <ImageOff className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }

  return <img src={dataUrl} alt={alt} className={className} loading="lazy" />;
}

export function MobileAssetsPage() {
  const { t } = useTranslation();
  const { isValidated } = useApiKeyStore();
  const { toast } = useToast();

  const [images, setImages] = useState<AssetImage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedImage, setSelectedImage] = useState<AssetImage | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Select mode
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    new Set(),
  );
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const longPressTriggered = useRef(false);

  // Page-level swipe refs
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  // Dialog-level swipe refs
  const dialogTouchStartX = useRef(0);
  const dialogTouchStartY = useRef(0);

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  const fetchAssets = useCallback(async () => {
    if (!isValidated) return;
    setIsLoading(true);

    try {
      const now = new Date();
      const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

      const response = await apiClient.getHistory(page, PAGE_SIZE, {
        status: "completed",
        created_after: yearAgo.toISOString(),
        created_before: now.toISOString(),
      });

      setImages(extractImages(response.items || []));
      setTotal(response.total || 0);
    } catch (err) {
      console.error("Assets fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [isValidated, page]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  // Clear select mode when page changes
  useEffect(() => {
    setIsSelectMode(false);
    setSelectedIndices(new Set());
  }, [page]);

  // Navigate between images in detail dialog
  const navigateImage = useCallback(
    (direction: "prev" | "next") => {
      if (!selectedImage || images.length <= 1) return;
      const currentIdx = images.findIndex(
        (img) =>
          img.url === selectedImage.url &&
          img.predictionId === selectedImage.predictionId,
      );
      if (currentIdx === -1) return;

      let newIdx: number;
      if (direction === "prev") {
        newIdx = currentIdx === 0 ? images.length - 1 : currentIdx - 1;
      } else {
        newIdx = currentIdx === images.length - 1 ? 0 : currentIdx + 1;
      }
      setSelectedImage(images[newIdx]);
    },
    [selectedImage, images],
  );

  // Long press handlers
  const handleLongPressStart = (idx: number) => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      if (!isSelectMode) {
        setIsSelectMode(true);
        setSelectedIndices(new Set([idx]));
      }
    }, 500);
  };

  const handleLongPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleImageClick = (idx: number) => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }

    if (isSelectMode) {
      handleToggleSelect(idx);
    } else {
      setSelectedImage(images[idx]);
    }
  };

  const handleToggleSelect = (idx: number) => {
    setSelectedIndices((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(idx)) {
        newSet.delete(idx);
      } else {
        newSet.add(idx);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedIndices.size === images.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(images.map((_, i) => i)));
    }
  };

  const handleClearSelection = () => {
    setSelectedIndices(new Set());
    setIsSelectMode(false);
  };

  // Bulk download
  const handleBulkDownload = async () => {
    if (selectedIndices.size === 0) return;
    setIsDownloading(true);

    const platform = getPlatformService();
    let successCount = 0;
    let failCount = 0;

    for (const idx of selectedIndices) {
      const image = images[idx];
      if (!image) continue;

      const ext = image.url.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || "png";
      const filename = `${image.model.replace(/\//g, "_")}_${image.predictionId}_${idx}.${ext}`;

      try {
        const result = await platform.downloadFile(image.url, filename);
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
    setSelectedIndices(new Set());
    setIsSelectMode(false);

    if (successCount > 0) {
      toast({
        title: t("history.downloadComplete", "Download complete"),
        description: t("history.downloadCompleteDesc", { count: successCount }),
      });
    }
    if (failCount > 0) {
      toast({
        title: t("history.downloadFailed", "Download failed"),
        description: t("history.downloadFailedDesc", { count: failCount }),
        variant: "destructive",
      });
    }
  };

  // Single download
  const handleDownload = async (image: AssetImage) => {
    setIsDownloading(true);
    try {
      const platform = getPlatformService();
      const ext = image.url.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || "png";
      const filename = `${image.model.replace(/\//g, "_")}_${image.predictionId}.${ext}`;
      const result = await platform.downloadFile(image.url, filename);
      if (result.success) {
        toast({ title: t("common.downloaded", "Downloaded") });
      } else {
        toast({
          title: result.error || t("common.error", "Error"),
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: t("common.error", "Error"), variant: "destructive" });
    } finally {
      setIsDownloading(false);
    }
  };

  // Swipe to change page
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      const dy = e.changedTouches[0].clientY - touchStartY.current;
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

  // Swipe in detail dialog to navigate between images
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
          navigateImage("next");
        } else {
          navigateImage("prev");
        }
      }
    },
    [navigateImage],
  );

  const selectedIdx = selectedImage
    ? images.findIndex(
        (img) =>
          img.url === selectedImage.url &&
          img.predictionId === selectedImage.predictionId,
      )
    : -1;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="text-lg font-semibold">{t("nav.assets")}</h1>
        <div className="flex items-center gap-2">
          {isSelectMode ? (
            <>
              {selectedIndices.size > 0 && (
                <>
                  <Button variant="outline" size="sm" onClick={handleSelectAll}>
                    {selectedIndices.size === images.length
                      ? t("common.deselectAll", "Deselect All")
                      : t("common.selectAll", "Select All")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBulkDownload}
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Download className="h-4 w-4 mr-1" />
                        {selectedIndices.size}
                      </>
                    )}
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearSelection}
                disabled={isDownloading}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPage(1);
                fetchAssets();
              }}
              disabled={isLoading}
            >
              <RefreshCw
                className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
              />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div
        className="flex-1 overflow-auto p-2"
        onTouchStart={isSelectMode ? undefined : handleTouchStart}
        onTouchEnd={isSelectMode ? undefined : handleTouchEnd}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : images.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <ImageOff className="h-10 w-10 mb-2" />
            <p className="text-sm">{t("assets.empty", "No images yet")}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1">
              {images.map((image, idx) => (
                <div
                  key={imageKey(image, idx)}
                  className={cn(
                    "aspect-square relative cursor-pointer rounded overflow-hidden select-none",
                    isSelectMode &&
                      selectedIndices.has(idx) &&
                      "ring-2 ring-primary",
                  )}
                  onClick={() => handleImageClick(idx)}
                  onTouchStart={() => handleLongPressStart(idx)}
                  onTouchEnd={handleLongPressEnd}
                  onTouchCancel={handleLongPressEnd}
                >
                  {isSelectMode && (
                    <div className="absolute top-1.5 left-1.5 z-10">
                      <Checkbox
                        checked={selectedIndices.has(idx)}
                        onClick={(e) => e.stopPropagation()}
                        onCheckedChange={() => handleToggleSelect(idx)}
                      />
                    </div>
                  )}
                  <ProxyImage
                    src={image.url}
                    alt={image.model}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>

            {/* Pagination - always visible */}
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

      {/* Preview Dialog with navigation */}
      <Dialog
        open={!!selectedImage}
        onOpenChange={(open) => !open && setSelectedImage(null)}
      >
        <DialogContent className="max-w-[95vw] max-h-[90vh] p-2">
          {selectedImage && (
            <div
              className="flex flex-col gap-2"
              onTouchStart={handleDialogTouchStart}
              onTouchEnd={handleDialogTouchEnd}
            >
              {/* Navigation buttons */}
              {images.length > 1 && (
                <div className="flex items-center justify-center gap-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => navigateImage("prev")}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {selectedIdx + 1} / {images.length}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => navigateImage("next")}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}

              <ProxyImage
                src={selectedImage.url}
                alt={selectedImage.model}
                className="w-full max-h-[65vh] object-contain rounded"
              />
              <div className="flex items-center justify-between px-1">
                <div className="text-xs text-muted-foreground truncate flex-1 mr-2">
                  {selectedImage.model}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDownload(selectedImage)}
                  disabled={isDownloading}
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
