import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMobileDownload } from "@mobile/hooks/useMobileDownload";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Upload,
  Video,
  Download,
  Loader2,
  X,
  FileVideo,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type OutputFormat = "webm" | "mp4";
type VideoCodec = "vp8" | "vp9" | "h264" | "av1";

interface ConversionResult {
  blob: Blob;
  url: string;
  filename: string;
  codec: VideoCodec;
}

export function VideoConverterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { downloadBlob } = useMobileDownload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultVideoRef = useRef<HTMLVideoElement>(null);

  const [inputVideo, setInputVideo] = useState<{
    file: File;
    url: string;
  } | null>(null);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("webm");
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith("video/")) {
        setError(t("freeTools.videoConverter.invalidFile"));
        return;
      }

      // Clean up previous
      if (inputVideo?.url) {
        URL.revokeObjectURL(inputVideo.url);
      }
      if (result?.url) {
        URL.revokeObjectURL(result.url);
      }

      setInputVideo({
        file,
        url: URL.createObjectURL(file),
      });
      setResult(null);
      setError(null);
      setProgress(0);
    },
    [inputVideo, result],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect],
  );

  const clearInput = useCallback(() => {
    if (inputVideo?.url) {
      URL.revokeObjectURL(inputVideo.url);
    }
    if (result?.url) {
      URL.revokeObjectURL(result.url);
    }
    setInputVideo(null);
    setResult(null);
    setError(null);
    setProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [inputVideo, result]);

  const convertVideo = useCallback(async () => {
    if (!inputVideo) return;

    setIsConverting(true);
    setError(null);
    setProgress(0);

    try {
      // Create video element for playback
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;

      // Create canvas for rendering
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;

      // Create audio context for capturing audio
      const audioContext = new AudioContext();
      const audioDestination = audioContext.createMediaStreamDestination();

      // Wait for video metadata
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Failed to load video"));
        video.src = inputVideo.url;
      });

      // Set canvas size to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const duration = video.duration;

      // Try different codecs based on format
      const codecsToTry: { codec: VideoCodec; mimeType: string }[] =
        outputFormat === "webm"
          ? [
              { codec: "vp9", mimeType: "video/webm;codecs=vp9" },
              { codec: "vp8", mimeType: "video/webm;codecs=vp8" },
              { codec: "av1", mimeType: "video/webm;codecs=av01" },
            ]
          : [
              { codec: "h264", mimeType: "video/mp4;codecs=avc1" },
              { codec: "vp9", mimeType: "video/webm;codecs=vp9" },
            ];

      let selectedCodec: VideoCodec | null = null;
      let mimeType: string | null = null;

      for (const { codec, mimeType: mime } of codecsToTry) {
        if (MediaRecorder.isTypeSupported(mime)) {
          selectedCodec = codec;
          mimeType = mime;
          break;
        }
      }

      if (!mimeType || !selectedCodec) {
        throw new Error("No supported video codec found");
      }

      // Create combined stream (video from canvas + audio from video)
      const canvasStream = canvas.captureStream(30);
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks(),
      ]);

      // Create MediaRecorder
      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 5000000,
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      // Connect video audio to recorder
      let audioSourceConnected = false;
      video.onplay = () => {
        if (!audioSourceConnected) {
          try {
            const source = audioContext.createMediaElementSource(video);
            source.connect(audioDestination);
            audioSourceConnected = true;
          } catch {
            // Already connected or no audio
          }
        }
      };

      // Start recording
      recorder.start(100);

      // Draw frames to canvas in real-time
      let animationId: number;
      const drawFrame = () => {
        if (video.readyState >= 2) {
          ctx.drawImage(video, 0, 0);
        }

        // Update progress
        const currentProgress = (video.currentTime / duration) * 100;
        setProgress(Math.min(95, Math.round(currentProgress)));

        if (!video.ended && !video.paused) {
          animationId = requestAnimationFrame(drawFrame);
        }
      };

      // Play video and start drawing
      video.currentTime = 0;
      await video.play();
      drawFrame();

      // Wait for video to end
      await new Promise<void>((resolve) => {
        video.onended = () => {
          cancelAnimationFrame(animationId);
          resolve();
        };
      });

      // Stop recording
      recorder.stop();

      // Wait for recorder to finish
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });

      // Cleanup
      await audioContext.close();
      video.remove();
      canvas.remove();

      // Create result blob
      const resultBlob = new Blob(chunks, { type: mimeType });
      const resultUrl = URL.createObjectURL(resultBlob);

      // Generate filename
      const baseName = inputVideo.file.name.replace(/\.[^/.]+$/, "");
      const ext =
        outputFormat === "mp4" && selectedCodec !== "h264"
          ? "webm"
          : outputFormat;
      const filename = `${baseName}_converted.${ext}`;

      setResult({
        blob: resultBlob,
        url: resultUrl,
        filename,
        codec: selectedCodec,
      });
      setProgress(100);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsConverting(false);
    }
  }, [inputVideo, outputFormat]);

  const downloadResult = useCallback(async () => {
    if (!result) return;
    await downloadBlob(result.blob, result.filename);
  }, [result, downloadBlob]);

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-6">
      {/* Header with back button */}
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
            {t("freeTools.videoConverter.title")}
          </h1>
          <p className="text-muted-foreground text-xs">
            {t("freeTools.videoConverter.description")}
          </p>
        </div>
      </div>

      {/* Input Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t("freeTools.videoConverter.inputVideo")}
          </CardTitle>
          <CardDescription>
            {t("freeTools.videoConverter.selectVideoDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!inputVideo ? (
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                "hover:border-primary hover:bg-primary/5",
              )}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <Video className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-2">
                {t("freeTools.videoConverter.selectVideo")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("freeTools.videoConverter.supportedFormats")}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                <video
                  ref={videoRef}
                  src={inputVideo.url}
                  className="w-full h-full object-contain"
                  controls
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={() => {
                    // Force show first frame on mobile
                    if (
                      videoRef.current &&
                      videoRef.current.currentTime === 0
                    ) {
                      videoRef.current.currentTime = 0.001;
                    }
                  }}
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2"
                  onClick={clearInput}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileVideo className="h-4 w-4" />
                <span>{inputVideo.file.name}</span>
                <span className="text-xs">
                  ({(inputVideo.file.size / 1024 / 1024).toFixed(2)} MB)
                </span>
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleInputChange}
          />
        </CardContent>
      </Card>

      {/* Settings */}
      {inputVideo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("common.settings")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("freeTools.videoConverter.outputFormat")}</Label>
              <Select
                value={outputFormat}
                onValueChange={(v) => setOutputFormat(v as OutputFormat)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="webm">WebM (VP8/VP9)</SelectItem>
                  <SelectItem value="mp4">MP4 (H.264)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full"
              onClick={convertVideo}
              disabled={isConverting}
            >
              {isConverting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("freeTools.videoConverter.converting")}
                </>
              ) : (
                t("freeTools.videoConverter.convert")
              )}
            </Button>

            {isConverting && (
              <div className="space-y-2">
                <Progress value={progress} />
                <p className="text-sm text-center text-muted-foreground">
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
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Download className="h-5 w-5" />
              {t("freeTools.videoConverter.result")}
            </CardTitle>
            <CardDescription>
              {t("freeTools.videoConverter.codecUsed")}:{" "}
              {result.codec.toUpperCase()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="aspect-video bg-black rounded-lg overflow-hidden">
              <video
                ref={resultVideoRef}
                src={result.url}
                className="w-full h-full object-contain"
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={() => {
                  if (
                    resultVideoRef.current &&
                    resultVideoRef.current.currentTime === 0
                  ) {
                    resultVideoRef.current.currentTime = 0.001;
                  }
                }}
              />
            </div>
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground text-center">
                {result.filename} ({(result.blob.size / 1024 / 1024).toFixed(2)}{" "}
                MB)
              </div>
              <Button className="w-full" onClick={downloadResult}>
                <Download className="mr-2 h-4 w-4" />
                {t("common.download")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
