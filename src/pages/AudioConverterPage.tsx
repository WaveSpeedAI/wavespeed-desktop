import { useState, useRef, useCallback, useContext } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { PageResetContext } from "@/components/layout/PageResetContext";
import { useTranslation } from "react-i18next";
import { useFFmpegWorker } from "@/hooks/useFFmpegWorker";
import { useMultiPhaseProgress } from "@/hooks/useMultiPhaseProgress";
import { ProcessingProgress } from "@/components/shared/ProcessingProgress";
import {
  AUDIO_FORMATS,
  AUDIO_BITRATES,
  getAudioFormat,
  formatDuration,
} from "@/lib/ffmpegFormats";
import { formatBytes } from "@/types/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  ArrowLeft,
  Upload,
  Download,
  Loader2,
  FileAudio,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Phase configuration for audio converter
const PHASES = [
  { id: "download", labelKey: "freeTools.ffmpeg.loading", weight: 0.1 },
  { id: "process", labelKey: "freeTools.ffmpeg.converting", weight: 0.9 },
];

export function AudioConverterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { resetPage } = useContext(PageResetContext);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const dragCounterRef = useRef(0);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null);
  const [convertedBlob, setConvertedBlob] = useState<Blob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [outputFormat, setOutputFormat] = useState("mp3");
  const [bitrate, setBitrate] = useState("192k");
  const [error, setError] = useState<string | null>(null);
  const [showBackWarning, setShowBackWarning] = useState(false);

  // Multi-phase progress tracking
  const {
    progress,
    startPhase,
    updatePhase,
    reset: resetProgress,
    resetAndStart,
    complete: completeAllPhases,
  } = useMultiPhaseProgress({ phases: PHASES });

  const { convert, hasFailed, retryWorker } = useFFmpegWorker({
    onPhase: (phase) => {
      if (phase === "download") {
        startPhase("download");
      } else if (phase === "process") {
        startPhase("process");
      }
    },
    onProgress: (phase, progressValue, detail) => {
      const phaseId = phase === "download" ? "download" : "process";
      updatePhase(phaseId, progressValue, detail);
    },
    onError: (err) => {
      console.error("Worker error:", err);
      setError(err);
      setIsProcessing(false);
      resetProgress();
    },
  });

  const handleRetry = useCallback(() => {
    setError(null);
    retryWorker();
  }, [retryWorker]);

  const handleBack = useCallback(() => {
    if (isProcessing) {
      setShowBackWarning(true);
    } else {
      resetPage(location.pathname);
      navigate("/free-tools");
    }
  }, [isProcessing, resetPage, location.pathname, navigate]);

  const handleConfirmBack = useCallback(() => {
    setShowBackWarning(false);
    resetPage(location.pathname);
    navigate("/free-tools");
  }, [resetPage, location.pathname, navigate]);

  const handleFileSelect = useCallback(
    (file: File) => {
      if (
        !file.type.startsWith("audio/") &&
        !file.name.match(/\.(mp3|m4a|ogg|wav|flac|aac|wma)$/i)
      ) {
        return;
      }

      setError(null);
      // Clean up previous URLs
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (convertedUrl) URL.revokeObjectURL(convertedUrl);

      const url = URL.createObjectURL(file);
      setAudioFile(file);
      setAudioUrl(url);
      setConvertedUrl(null);
      setConvertedBlob(null);
      resetProgress();

      // Get duration from audio element
      const audio = new Audio(url);
      audio.addEventListener("loadedmetadata", () => {
        setAudioDuration(audio.duration);
      });
    },
    [audioUrl, convertedUrl, resetProgress],
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
    if (dragCounterRef.current === 1) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleConvert = async () => {
    if (!audioFile) return;

    setIsProcessing(true);
    setError(null);
    setConvertedUrl(null);
    setConvertedBlob(null);
    resetAndStart("download");

    const format = getAudioFormat(outputFormat);
    if (!format) return;

    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await audioFile.arrayBuffer();

      // Convert using FFmpeg worker
      const result = await convert(
        arrayBuffer,
        audioFile.name,
        outputFormat,
        format.ext,
        {
          audioCodec: format.codec,
          audioBitrate: bitrate,
        },
      );

      // Create blob and URL
      const blob = new Blob([result.data], { type: format.mimeType });
      const url = URL.createObjectURL(blob);

      setConvertedBlob(blob);
      setConvertedUrl(url);
      completeAllPhases();
    } catch (err) {
      console.error("Conversion failed:", err);
      setError(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!convertedUrl || !convertedBlob || !audioFile) return;

    const format = getAudioFormat(outputFormat);
    const filename = audioFile.name.replace(
      /\.[^.]+$/,
      `.${format?.ext || outputFormat}`,
    );

    const link = document.createElement("a");
    link.href = convertedUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const selectedFormat = getAudioFormat(outputFormat);

  return (
    <div
      className="p-8 relative"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* Drag overlay */}
      {isDragging && audioFile && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary rounded-lg m-4">
          <div className="text-center">
            <Upload className="h-12 w-12 text-primary mx-auto mb-2" />
            <p className="text-lg font-medium">
              {t("freeTools.audioConverter.dropToReplace")}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {t("freeTools.audioConverter.title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("freeTools.audioConverter.description")}
          </p>
        </div>
      </div>

      {/* Upload area */}
      {!audioFile && (
        <Card
          className={cn(
            "border-2 border-dashed cursor-pointer transition-colors",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-primary/50",
          )}
          onClick={() => fileInputRef.current?.click()}
        >
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium">
              {t("freeTools.audioConverter.selectAudio")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("freeTools.audioConverter.orDragDrop")}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t("freeTools.audioConverter.supportedFormats")}
            </p>
          </CardContent>
        </Card>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.ogg,.wav,.flac,.aac,.wma"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelect(file);
          e.target.value = "";
        }}
      />

      {/* Audio preview and controls */}
      {audioFile && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Upload className="h-4 w-4 mr-2" />
              {t("freeTools.audioConverter.selectAudio")}
            </Button>

            <Select
              value={outputFormat}
              onValueChange={setOutputFormat}
              disabled={isProcessing}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUDIO_FORMATS.map((format) => (
                  <SelectItem key={format.id} value={format.id}>
                    {format.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedFormat &&
              selectedFormat.id !== "flac" &&
              selectedFormat.id !== "wav" && (
                <Select
                  value={bitrate}
                  onValueChange={setBitrate}
                  disabled={isProcessing}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIO_BITRATES.map((br) => (
                      <SelectItem key={br.id} value={br.value}>
                        {br.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

            <Button
              onClick={handleConvert}
              disabled={isProcessing}
              className="gradient-bg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("freeTools.audioConverter.converting")}
                </>
              ) : (
                <>
                  <FileAudio className="h-4 w-4 mr-2" />
                  {t("freeTools.audioConverter.convert")}
                </>
              )}
            </Button>

            {convertedUrl && (
              <Button variant="outline" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                {t("common.download")}
              </Button>
            )}
          </div>

          {/* Progress display */}
          <ProcessingProgress
            progress={progress}
            showPhases={true}
            showOverall={true}
            showEta={true}
          />

          {/* Error with retry button */}
          {error && hasFailed() && !isProcessing && (
            <div className="flex items-center justify-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <span className="text-sm text-destructive">{error}</span>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("common.retry")}
              </Button>
            </div>
          )}

          {/* Side by side audio preview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Original audio */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">
                    {t("freeTools.audioConverter.original")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(audioFile.size)} •{" "}
                    {formatDuration(audioDuration || 0)}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground mb-2 truncate">
                  {audioFile.name}
                </div>
                <audio
                  ref={audioRef}
                  src={audioUrl || undefined}
                  className="w-full"
                  controls
                />
              </CardContent>
            </Card>

            {/* Converted audio */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">
                    {t("freeTools.audioConverter.converted")}
                  </span>
                  {convertedBlob && (
                    <span className="text-xs text-green-600 dark:text-green-400">
                      {formatBytes(convertedBlob.size)}
                    </span>
                  )}
                </div>
                {convertedUrl ? (
                  <>
                    <div className="text-sm text-muted-foreground mb-2">
                      {selectedFormat?.label}
                    </div>
                    <audio src={convertedUrl} className="w-full" controls />
                  </>
                ) : (
                  <div className="h-[54px] bg-muted rounded-lg flex items-center justify-center">
                    <div className="text-center text-muted-foreground text-sm">
                      <FileAudio className="h-5 w-5 mx-auto mb-1 opacity-30" />
                      <span>
                        {selectedFormat?.label} • {bitrate}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Back Warning Dialog */}
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
