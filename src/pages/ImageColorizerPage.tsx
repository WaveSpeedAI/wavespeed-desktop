import { useCallback, useContext, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageResetContext } from "@/components/layout/PageResetContext";
import { ProcessingProgress } from "@/components/shared/ProcessingProgress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import { useMultiPhaseProgress } from "@/hooks/useMultiPhaseProgress";
import {
  type ColorizeMode,
  useImageColorizerWorker,
} from "@/hooks/useImageColorizerWorker";
import { generateFreeToolFilename } from "@/stores/assetsStore";
import {
  ArrowLeft,
  Download,
  Loader2,
  Palette,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PHASES = [
  { id: "download", labelKey: "freeTools.progress.downloading", weight: 0.35 },
  { id: "process", labelKey: "freeTools.progress.processing", weight: 0.65 },
];

const MODE_OPTIONS: ColorizeMode[] = [
  "ai",
  "natural",
  "vintage",
  "vivid",
  "portrait",
];

export function ImageColorizerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { resetPage } = useContext(PageResetContext);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragCounterRef = useRef(0);

  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [originalBlob, setOriginalBlob] = useState<Blob | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [imageSize, setImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [mode, setMode] = useState<ColorizeMode>("ai");
  const [strength, setStrength] = useState(78);
  const [saturation, setSaturation] = useState(100);
  const [preserveContrast, setPreserveContrast] = useState(true);
  const [downloadFormat, setDownloadFormat] = useState<"png" | "jpeg" | "webp">(
    "png",
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showBackWarning, setShowBackWarning] = useState(false);

  const {
    progress,
    startPhase,
    updatePhase,
    reset: resetProgress,
    resetAndStart,
    complete: completeAllPhases,
  } = useMultiPhaseProgress({ phases: PHASES });

  const { colorize, dispose, retryWorker, hasFailed } = useImageColorizerWorker(
    {
      onPhase: (phase) => {
        if (phase === "download") {
          startPhase("download");
        } else {
          startPhase("process");
        }
      },
      onProgress: (phase, progressValue, detail) => {
        const phaseId = phase === "download" ? "download" : "process";
        updatePhase(phaseId, progressValue, detail);
      },
      onError: (err) => {
        setError(err);
        setIsProcessing(false);
      },
    },
  );

  const clearResult = useCallback(() => {
    if (resultImage) URL.revokeObjectURL(resultImage);
    setResultImage(null);
    setResultBlob(null);
  }, [resultImage]);

  const handleBack = useCallback(() => {
    if (isProcessing) {
      setShowBackWarning(true);
      return;
    }
    dispose();
    resetPage(location.pathname);
    navigate("/free-tools");
  }, [dispose, isProcessing, location.pathname, navigate, resetPage]);

  const handleConfirmBack = useCallback(() => {
    setShowBackWarning(false);
    dispose();
    resetPage(location.pathname);
    navigate("/free-tools");
  }, [dispose, location.pathname, navigate, resetPage]);

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;

      setError(null);
      setOriginalBlob(file);
      clearResult();
      resetProgress();

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setOriginalImage(dataUrl);
        const img = new Image();
        img.onload = () => {
          setImageSize({ width: img.width, height: img.height });
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    },
    [clearResult, resetProgress],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);
      if (isProcessing) return;

      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect, isProcessing],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const drawResultToCanvas = useCallback(
    async (blob: Blob) => {
      const canvas = resultCanvasRef.current;
      if (!canvas) return;

      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            if (downloadFormat === "jpeg") {
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            ctx.drawImage(img, 0, 0);
          }
          URL.revokeObjectURL(url);
          resolve();
        };
        img.src = url;
      });
    },
    [downloadFormat],
  );

  const handleColorize = async () => {
    if (!originalBlob) return;

    setIsProcessing(true);
    setError(null);
    clearResult();
    resetAndStart(mode === "ai" ? "download" : "process");

    try {
      const blob = await colorize(originalBlob, {
        mode,
        strength,
        saturation,
        preserveContrast,
      });
      const url = URL.createObjectURL(blob);
      setResultBlob(blob);
      setResultImage(url);
      await drawResultToCanvas(blob);
      completeAllPhases();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!resultBlob) return;

    const canvas = resultCanvasRef.current;
    const link = document.createElement("a");

    if (canvas) {
      const mimeType = `image/${downloadFormat}`;
      const quality = downloadFormat === "png" ? undefined : 0.95;
      link.href = canvas.toDataURL(mimeType, quality);
    } else if (resultImage) {
      link.href = resultImage;
    } else {
      return;
    }

    link.download = generateFreeToolFilename("image-colorizer", downloadFormat);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRetry = useCallback(() => {
    setError(null);
    retryWorker();
  }, [retryWorker]);

  return (
    <div
      className="relative p-8"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {isDragging && originalImage && (
        <div className="absolute inset-0 z-50 m-4 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80 backdrop-blur-sm">
          <div className="text-center">
            <Upload className="mx-auto mb-2 h-12 w-12 text-primary" />
            <p className="text-lg font-medium">
              {t("freeTools.imageColorizer.selectImage", "Select an image")}
            </p>
          </div>
        </div>
      )}

      <div className="mb-8 flex items-center gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {t("freeTools.imageColorizer.title", "Image Colorizer")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t(
              "freeTools.imageColorizer.description",
              "Add color to black-and-white photos locally for free",
            )}
          </p>
        </div>
      </div>

      {!originalImage && (
        <Card
          className={cn(
            "cursor-pointer border-2 border-dashed transition-colors animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-primary/50",
          )}
          style={{ animationDelay: "80ms" }}
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
        >
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 rounded-full bg-muted p-4">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium">
              {t("freeTools.imageColorizer.selectImage", "Select an image")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t(
                "freeTools.imageColorizer.supportedFormats",
                "PNG, JPG, WebP, BMP, and other browser-supported images",
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {originalImage && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Upload className="mr-2 h-4 w-4" />
              {t("freeTools.imageColorizer.selectImage", "Select Image")}
            </Button>

            <Select
              value={mode}
              onValueChange={(value) => setMode(value as ColorizeMode)}
              disabled={isProcessing}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {t(
                      `freeTools.imageColorizer.modes.${item}`,
                      item.charAt(0).toUpperCase() + item.slice(1),
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex w-48 items-center gap-3 rounded-lg bg-muted p-2">
              <Label className="min-w-16 text-xs">
                {t("freeTools.imageColorizer.strength", "Strength")}
              </Label>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[strength]}
                onValueChange={([value]) => setStrength(value)}
                disabled={isProcessing}
              />
              <span className="w-8 text-right text-xs text-muted-foreground">
                {strength}%
              </span>
            </div>

            <div className="flex w-52 items-center gap-3 rounded-lg bg-muted p-2">
              <Label className="min-w-16 text-xs">
                {t("freeTools.imageColorizer.saturation", "Saturation")}
              </Label>
              <Slider
                min={0}
                max={160}
                step={1}
                value={[saturation]}
                onValueChange={([value]) => setSaturation(value)}
                disabled={isProcessing}
              />
              <span className="w-8 text-right text-xs text-muted-foreground">
                {saturation}%
              </span>
            </div>

            <div className="flex items-center gap-2 rounded-lg bg-muted p-2">
              <Switch
                id="image-colorizer-contrast-toggle"
                checked={preserveContrast}
                onCheckedChange={setPreserveContrast}
                disabled={isProcessing}
              />
              <Label
                htmlFor="image-colorizer-contrast-toggle"
                className="whitespace-nowrap text-xs"
              >
                {t(
                  "freeTools.imageColorizer.preserveContrast",
                  "Preserve contrast",
                )}
              </Label>
            </div>

            <Select
              value={downloadFormat}
              onValueChange={(value) =>
                setDownloadFormat(value as "png" | "jpeg" | "webp")
              }
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="png">PNG</SelectItem>
                <SelectItem value="jpeg">JPEG</SelectItem>
                <SelectItem value="webp">WebP</SelectItem>
              </SelectContent>
            </Select>

            <Button
              onClick={handleColorize}
              disabled={isProcessing || !originalBlob}
              className="gradient-bg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("freeTools.imageColorizer.colorizing", "Colorizing...")}
                </>
              ) : (
                <>
                  <Palette className="mr-2 h-4 w-4" />
                  {resultImage
                    ? t("freeTools.imageColorizer.recolorize", "Recolorize")
                    : t("freeTools.imageColorizer.colorize", "Colorize")}
                </>
              )}
            </Button>
          </div>

          {isProcessing && (
            <ProcessingProgress
              progress={progress}
              showPhases={true}
              showOverall={true}
              showEta={true}
            />
          )}

          {error && !isProcessing && (
            <div className="flex items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/10 p-4">
              <span className="text-sm text-destructive">{error}</span>
              {hasFailed() && (
                <Button variant="outline" size="sm" onClick={handleRetry}>
                  {t("common.retry")}
                </Button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {t("freeTools.imageColorizer.original", "Original")}
                  </span>
                  <div className="flex items-center gap-3">
                    {imageSize && (
                      <span className="text-xs text-muted-foreground">
                        {imageSize.width} x {imageSize.height}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isProcessing}
                      className="h-8 px-2 text-xs"
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      {t("freeTools.imageColorizer.replace", "Replace")}
                    </Button>
                  </div>
                </div>
                <div className="relative rounded-lg bg-muted">
                  <img
                    src={originalImage}
                    alt="Original"
                    className="max-h-[70vh] w-full cursor-pointer object-contain transition-opacity hover:opacity-90"
                    onClick={() => setPreviewImage(originalImage)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {t("freeTools.imageColorizer.result", "Result")}
                  </span>
                  {resultImage && imageSize && (
                    <span className="text-xs text-muted-foreground">
                      {imageSize.width} x {imageSize.height}
                    </span>
                  )}
                </div>
                <div className="relative flex min-h-[200px] items-center justify-center rounded-lg bg-muted">
                  {resultImage ? (
                    <img
                      src={resultImage}
                      alt="Colorized"
                      className="max-h-[70vh] w-full cursor-pointer object-contain transition-opacity hover:opacity-90"
                      onClick={() => setPreviewImage(resultImage)}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                      {isProcessing ? (
                        <>
                          <Loader2 className="mb-2 h-8 w-8 animate-spin" />
                          <span className="text-sm">
                            {t(
                              "freeTools.imageColorizer.colorizing",
                              "Colorizing...",
                            )}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm">—</span>
                      )}
                    </div>
                  )}
                </div>
                {resultImage && (
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {t("freeTools.imageColorizer.ready", "Ready to save")}
                      </p>
                      <p className="text-xs uppercase text-muted-foreground">
                        {downloadFormat}
                      </p>
                    </div>
                    <Button onClick={handleDownload} className="shrink-0">
                      <Download className="mr-2 h-4 w-4" />
                      {t("common.download")}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelect(file);
          e.target.value = "";
        }}
      />

      <canvas ref={resultCanvasRef} className="hidden" />

      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden">
          <DialogTitle className="sr-only">
            {t("freeTools.imageColorizer.preview", "Preview")}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 z-10 bg-background/80"
            onClick={() => setPreviewImage(null)}
          >
            <X className="h-4 w-4" />
          </Button>
          {previewImage && (
            <img
              src={previewImage}
              alt="Preview"
              className="max-h-[95vh] max-w-[95vw] object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={showBackWarning} onOpenChange={setShowBackWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("freeTools.backWarning.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("freeTools.backWarning.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("freeTools.backWarning.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmBack}>
              {t("freeTools.backWarning.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
