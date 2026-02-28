import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  src: string;
  compact?: boolean;
  className?: string;
}

export function AudioPlayer({
  src,
  compact = false,
  className,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [waveformData, setWaveformData] = useState<number[]>([]);

  // Load waveform data from audio file
  useEffect(() => {
    const loadWaveform = async () => {
      try {
        const response = await fetch(src);
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new (
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext
        )();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Get audio data from first channel
        const rawData = audioBuffer.getChannelData(0);
        const samples = 100; // Number of bars to show
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData: number[] = [];

        for (let i = 0; i < samples; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[i * blockSize + j]);
          }
          filteredData.push(sum / blockSize);
        }

        // Normalize
        const maxVal = Math.max(...filteredData);
        const normalized = filteredData.map((val) => val / maxVal);
        setWaveformData(normalized);

        await audioContext.close();
      } catch (err) {
        console.error("Failed to load waveform:", err);
        // Generate fallback waveform
        const fallback = Array.from(
          { length: 100 },
          (_, i) => 0.3 + Math.sin(i * 0.2) * 0.3 + Math.random() * 0.2,
        );
        setWaveformData(fallback);
      }
    };

    loadWaveform();
  }, [src]);

  // Draw static waveform
  const drawStaticWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const barWidth = width / waveformData.length;
    const gap = 1;

    ctx.clearRect(0, 0, width, height);

    // Get CSS color from theme
    const computedStyle = getComputedStyle(canvas);
    const primaryColor =
      computedStyle.getPropertyValue("--primary").trim() || "221.2 83.2% 53.3%";

    waveformData.forEach((value, index) => {
      const barHeight = value * height * 0.85;
      const x = index * barWidth;
      const y = (height - barHeight) / 2;

      ctx.fillStyle = `hsl(${primaryColor} / 0.4)`;
      ctx.fillRect(x + gap / 2, y, barWidth - gap, barHeight);
    });
  }, [waveformData]);

  // Draw waveform when data is loaded or when paused
  useEffect(() => {
    if (!isPlaying && waveformData.length > 0) {
      drawStaticWaveform();
    }
  }, [isPlaying, waveformData, drawStaticWaveform]);

  // Initialize audio context and analyser
  const initAudioContext = useCallback(() => {
    if (audioContextRef.current || !audioRef.current) return;

    const audioContext = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    )();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    const source = audioContext.createMediaElementSource(audioRef.current);
    source.connect(analyser);
    analyser.connect(audioContext.destination);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    sourceRef.current = source;
  }, []);

  // Draw animated waveform
  const drawAnimatedWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const barWidth = (width / bufferLength) * 2.5;

    ctx.clearRect(0, 0, width * dpr, height * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);

    // Get CSS color from theme
    const computedStyle = getComputedStyle(canvas);
    const primaryColor =
      computedStyle.getPropertyValue("--primary").trim() || "221.2 83.2% 53.3%";

    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * height * 0.9;

      ctx.fillStyle = `hsl(${primaryColor})`;
      ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);

      x += barWidth;
    }

    ctx.restore();

    if (isPlaying) {
      animationRef.current = requestAnimationFrame(drawAnimatedWaveform);
    }
  }, [isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      cancelAnimationFrame(animationRef.current);
      drawStaticWaveform();
    };
    const handlePlay = () => {
      initAudioContext();
      setIsPlaying(true);
    };
    const handlePause = () => {
      setIsPlaying(false);
      cancelAnimationFrame(animationRef.current);
      drawStaticWaveform();
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      cancelAnimationFrame(animationRef.current);
    };
  }, [initAudioContext, drawStaticWaveform]);

  // Start/stop animation when playing state changes
  useEffect(() => {
    if (isPlaying && analyserRef.current) {
      drawAnimatedWaveform();
    } else {
      cancelAnimationFrame(animationRef.current);
    }
  }, [isPlaying, drawAnimatedWaveform]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (!isPlaying) {
        drawStaticWaveform();
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isPlaying, drawStaticWaveform]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  };

  const handleSeek = (value: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.currentTime = value[0];
    setCurrentTime(value[0]);
  };

  const handleVolumeChange = (value: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;

    const newVolume = value[0];
    audio.volume = newVolume;
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isMuted) {
      audio.volume = volume || 1;
      setIsMuted(false);
    } else {
      audio.volume = 0;
      setIsMuted(true);
    }
  };

  const formatTime = (time: number) => {
    if (!isFinite(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 w-full", className)}>
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          crossOrigin="anonymous"
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={togglePlay}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <div className="flex-1 relative h-8">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full opacity-50"
            style={{ width: "100%", height: "100%" }}
          />
          <Slider
            value={[currentTime]}
            max={duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="relative z-10"
          />
        </div>
        <span className="text-xs text-muted-foreground w-10 text-right shrink-0">
          {formatTime(currentTime)}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 p-6 w-full max-w-lg mx-auto",
        className,
      )}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        crossOrigin="anonymous"
      />

      {/* Waveform visualization */}
      <div className="w-full h-24 rounded-lg bg-muted/50 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      {/* Progress */}
      <div className="w-full space-y-2">
        <Slider
          value={[currentTime]}
          max={duration || 100}
          step={0.1}
          onValueChange={handleSeek}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <Button
          size="icon"
          variant="outline"
          className="h-14 w-14 rounded-full"
          onClick={togglePlay}
        >
          {isPlaying ? (
            <Pause className="h-6 w-6" />
          ) : (
            <Play className="h-6 w-6 ml-0.5" />
          )}
        </Button>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2 w-full max-w-[200px]">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={toggleMute}
        >
          {isMuted ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </Button>
        <Slider
          value={[isMuted ? 0 : volume]}
          max={1}
          step={0.01}
          onValueChange={handleVolumeChange}
          className="flex-1"
        />
      </div>
    </div>
  );
}
