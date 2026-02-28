import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAudioConverterWorker } from "@mobile/hooks/useAudioConverterWorker";
import { useMobileDownload } from "@mobile/hooks/useMobileDownload";
import { formatFileSize, formatDuration } from "@mobile/lib/ffmpegFormats";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Upload,
  Download,
  Loader2,
  FileAudio,
  X,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Lightweight audio formats (Web Audio API + lamejs)
const AUDIO_FORMATS = [
  { id: "mp3", label: "MP3", ext: "mp3", mimeType: "audio/mpeg" },
  { id: "wav", label: "WAV", ext: "wav", mimeType: "audio/wav" },
];

const AUDIO_BITRATES = [
  { id: "128", label: "128 kbps", value: 128 },
  { id: "192", label: "192 kbps (Recommended)", value: 192 },
  { id: "256", label: "256 kbps", value: 256 },
  { id: "320", label: "320 kbps (High Quality)", value: 320 },
];

export function AudioConverterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { downloadBlob } = useMobileDownload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null);
  const [convertedBlob, setConvertedBlob] = useState<Blob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outputFormat, setOutputFormat] = useState<"mp3" | "wav">("mp3");
  const [bitrate, setBitrate] = useState(192);
  const [error, setError] = useState<string | null>(null);

  const { convert } = useAudioConverterWorker({
    onProgress: (progressValue) => {
      setProgress(progressValue);
    },
    onError: (err) => {
      console.error("Worker error:", err);
      setError(err);
      setIsProcessing(false);
    },
  });

  const handleFileSelect = useCallback(
    (file: File) => {
      // Only accept MP3 and WAV files
      if (!file.name.match(/\.(mp3|wav)$/i)) {
        setError(
          t(
            "freeTools.audioConverter.invalidFile",
            "Please select an MP3 or WAV file",
          ),
        );
        return;
      }

      // Clean up previous URLs
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (convertedUrl) URL.revokeObjectURL(convertedUrl);

      const url = URL.createObjectURL(file);
      setAudioFile(file);
      setAudioUrl(url);
      setConvertedUrl(null);
      setConvertedBlob(null);
      setError(null);
      setProgress(0);

      // Get duration from audio element
      const audio = new Audio(url);
      audio.addEventListener("loadedmetadata", () => {
        setAudioDuration(audio.duration);
      });
    },
    [audioUrl, convertedUrl, t],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (isProcessing) return;
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect, isProcessing],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
      e.target.value = "";
    },
    [handleFileSelect],
  );

  const clearInput = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    if (convertedUrl) URL.revokeObjectURL(convertedUrl);
    setAudioFile(null);
    setAudioUrl(null);
    setAudioDuration(null);
    setConvertedUrl(null);
    setConvertedBlob(null);
    setError(null);
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [audioUrl, convertedUrl]);

  const handleConvert = async () => {
    if (!audioFile) return;

    setIsProcessing(true);
    setError(null);
    setConvertedUrl(null);
    setConvertedBlob(null);
    setProgress(0);

    const format = AUDIO_FORMATS.find((f) => f.id === outputFormat);
    if (!format) return;

    try {
      const arrayBuffer = await audioFile.arrayBuffer();

      const result = await convert(
        arrayBuffer,
        audioFile.name,
        outputFormat,
        bitrate,
      );

      const blob = new Blob([result.data], { type: format.mimeType });
      const url = URL.createObjectURL(blob);

      setConvertedBlob(blob);
      setConvertedUrl(url);
      setProgress(100);
    } catch (err) {
      console.error("Conversion failed:", err);
      setError(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!convertedBlob || !audioFile) return;

    const format = AUDIO_FORMATS.find((f) => f.id === outputFormat);
    const filename = audioFile.name.replace(
      /\.[^.]+$/,
      `.${format?.ext || outputFormat}`,
    );

    await downloadBlob(convertedBlob, filename);
  };

  const selectedFormat = AUDIO_FORMATS.find((f) => f.id === outputFormat);

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/free-tools")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">
            {t("freeTools.audioConverter.title")}
          </h1>
          <p className="text-muted-foreground text-xs">
            {t("freeTools.audioConverter.description")}
          </p>
        </div>
      </div>

      {/* Input Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            {t("freeTools.audioConverter.inputAudio", "Input Audio")}
          </CardTitle>
          <CardDescription className="text-xs">
            {t(
              "freeTools.audioConverter.supportedFormats",
              "MP3 ↔ WAV conversion",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!audioFile ? (
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                "hover:border-primary hover:bg-primary/5",
              )}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <FileAudio className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-1">
                {t(
                  "freeTools.audioConverter.selectAudio",
                  "Click or drag MP3/WAV file here",
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <FileAudio className="h-8 w-8 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {audioFile.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(audioFile.size)} •{" "}
                      {formatDuration(audioDuration || 0)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={clearInput}
                  className="flex-shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {audioUrl && (
                <audio
                  ref={audioRef}
                  src={audioUrl}
                  controls
                  className="w-full h-10"
                />
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.wav,audio/mpeg,audio/wav"
            className="hidden"
            onChange={handleInputChange}
          />
        </CardContent>
      </Card>

      {/* Settings */}
      {audioFile && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {t("common.settings", "Settings")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  {t("freeTools.audioConverter.outputFormat", "Output Format")}
                </label>
                <Select
                  value={outputFormat}
                  onValueChange={(v) => setOutputFormat(v as "mp3" | "wav")}
                  disabled={isProcessing}
                >
                  <SelectTrigger className="h-9">
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
              </div>

              {outputFormat === "mp3" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    {t("freeTools.audioConverter.bitrate", "Bitrate")}
                  </label>
                  <Select
                    value={String(bitrate)}
                    onValueChange={(v) => setBitrate(Number(v))}
                    disabled={isProcessing}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUDIO_BITRATES.map((br) => (
                        <SelectItem key={br.id} value={String(br.value)}>
                          {br.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <Button
              className="w-full"
              onClick={handleConvert}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("freeTools.audioConverter.converting", "Converting...")}
                </>
              ) : (
                t("freeTools.audioConverter.convert", "Convert Audio")
              )}
            </Button>

            {isProcessing && (
              <div className="space-y-2">
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-center text-muted-foreground">
                  {progress}%
                </p>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {convertedUrl && convertedBlob && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4" />
              {t("freeTools.audioConverter.result", "Result")}
            </CardTitle>
            <CardDescription className="text-xs">
              {selectedFormat?.label} • {formatFileSize(convertedBlob.size)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <audio src={convertedUrl} controls className="w-full h-10" />
            <Button className="w-full" onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              {t("common.download", "Download")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
