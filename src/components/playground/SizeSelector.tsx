import { useState, useEffect, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, Lock, Unlock } from "lucide-react";

// Compact aspect ratio icon
function AspectIcon({ ratio }: { ratio: string }) {
  const getDimensions = () => {
    switch (ratio) {
      case "1:1":
        return { w: 10, h: 10 };
      case "16:9":
        return { w: 12, h: 7 };
      case "9:16":
        return { w: 7, h: 12 };
      case "4:3":
        return { w: 12, h: 9 };
      case "3:4":
        return { w: 9, h: 12 };
      case "3:2":
        return { w: 12, h: 8 };
      case "2:3":
        return { w: 8, h: 12 };
      default:
        return { w: 10, h: 10 };
    }
  };
  const { w, h } = getDimensions();
  return (
    <div
      className="border border-current rounded-[1px]"
      style={{ width: w, height: h }}
    />
  );
}

interface SizeSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  min?: number; // minimum dimension value from schema
  max?: number; // maximum dimension value from schema
  step?: number; // dimension step from schema
}

// 1K presets (~1 megapixel total, similar to 1024×1024)
const PRESETS_1K = [
  { label: "1:1", width: 1024, height: 1024 }, // 1,048,576 px
  { label: "16:9", width: 1280, height: 720 }, // 921,600 px (HD)
  { label: "9:16", width: 720, height: 1280 }, // 921,600 px
  { label: "4:3", width: 1152, height: 864 }, // 995,328 px
  { label: "3:4", width: 864, height: 1152 }, // 995,328 px
  { label: "3:2", width: 1216, height: 832 }, // 1,011,712 px
  { label: "2:3", width: 832, height: 1216 }, // 1,011,712 px
];

// 2K presets (~4 megapixels total, similar to 2048×2048)
const PRESETS_2K = [
  { label: "1:1", width: 2048, height: 2048 }, // 4,194,304 px
  { label: "16:9", width: 2560, height: 1440 }, // 3,686,400 px (QHD/2K)
  { label: "9:16", width: 1440, height: 2560 }, // 3,686,400 px
  { label: "4:3", width: 2304, height: 1728 }, // 3,981,312 px
  { label: "3:4", width: 1728, height: 2304 }, // 3,981,312 px
  { label: "3:2", width: 2432, height: 1664 }, // 4,046,848 px
  { label: "2:3", width: 1664, height: 2432 }, // 4,046,848 px
];

// Generate presets based on min/max range
// For each aspect ratio, prefer 2K if it fits, otherwise use 1K
function generatePresets(min: number, max: number) {
  const presets: { label: string; width: number; height: number }[] = [];

  for (let i = 0; i < PRESETS_1K.length; i++) {
    const preset1k = PRESETS_1K[i];
    const preset2k = PRESETS_2K[i];

    // Try 2K first
    if (
      preset2k.width >= min &&
      preset2k.width <= max &&
      preset2k.height >= min &&
      preset2k.height <= max
    ) {
      presets.push(preset2k);
    } else if (
      preset1k.width >= min &&
      preset1k.width <= max &&
      preset1k.height >= min &&
      preset1k.height <= max
    ) {
      // Fall back to 1K
      presets.push(preset1k);
    }
  }

  return presets;
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function formatRatio(width: number, height: number): string {
  const divisor = greatestCommonDivisor(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function alignToStep(value: number, step: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value / step) * step;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeDimension(
  value: number,
  min: number,
  max: number,
  step: number,
) {
  return clamp(alignToStep(value, step), min, max);
}

function getDimensionCandidates(min: number, max: number, step: number) {
  const candidates = new Set<number>([min, max]);
  const firstSteppedValue = Math.ceil(min / step) * step;

  for (let value = firstSteppedValue; value <= max; value += step) {
    candidates.add(value);
  }

  return Array.from(candidates).sort((a, b) => a - b);
}

function getRatioError(width: number, height: number, ratio: number) {
  if (height <= 0 || ratio <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(width / height - ratio) / ratio;
}

function fitLockedSize({
  changed,
  value,
  ratio,
  min,
  max,
  step,
}: {
  changed: "width" | "height";
  value: number;
  ratio: number;
  min: number;
  max: number;
  step: number;
}) {
  const requested = Number.isFinite(value) ? value : min;
  const target = clamp(requested, min, max);
  const candidates = getDimensionCandidates(min, max, step);
  const range = Math.max(1, max - min);
  let best:
    | {
        width: number;
        height: number;
        score: number;
      }
    | undefined;

  for (const candidate of candidates) {
    const derived = changed === "width" ? candidate / ratio : candidate * ratio;
    const paired = normalizeDimension(derived, min, max, step);
    const nextWidth = changed === "width" ? candidate : paired;
    const nextHeight = changed === "height" ? candidate : paired;
    const ratioError = getRatioError(nextWidth, nextHeight, ratio);
    const inputDistance = Math.abs(candidate - target) / range;
    const score = ratioError * 10 + inputDistance;

    if (!best || score < best.score) {
      best = { width: nextWidth, height: nextHeight, score };
    }
  }

  return (
    best ?? {
      width: normalizeDimension(value, min, max, step),
      height: normalizeDimension(value / ratio, min, max, step),
    }
  );
}

export function SizeSelector({
  value,
  onChange,
  disabled,
  min = 256,
  max = 1536,
  step = 1,
}: SizeSelectorProps) {
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [widthInput, setWidthInput] = useState("1024");
  const [heightInput, setHeightInput] = useState("1024");
  const [isRatioLocked, setIsRatioLocked] = useState(false);
  const [lockedRatio, setLockedRatio] = useState(1);
  const [selectedRatio, setSelectedRatio] = useState<string | null>(null);
  const [swapRotation, setSwapRotation] = useState(0);
  const effectiveStep = Math.max(1, step);

  // Parse value into width/height
  // Supports formats: "W*H" (e.g. "2048*2048"), single number string "2048", or number 2048
  useEffect(() => {
    if (value) {
      const str = String(value);
      const parts = str.split("*");
      if (parts.length === 2) {
        const w = parseInt(parts[0], 10);
        const h = parseInt(parts[1], 10);
        if (!isNaN(w) && !isNaN(h)) {
          setWidth(w);
          setHeight(h);
          setWidthInput(String(w));
          setHeightInput(String(h));
        }
      } else if (parts.length === 1) {
        // Single number: treat as both width and height (square)
        const n = parseInt(parts[0], 10);
        if (!isNaN(n) && n > 0) {
          setWidth(n);
          setHeight(n);
          setWidthInput(String(n));
          setHeightInput(String(n));
          // Normalize to "W*H" format so the rest of the form stays consistent
          onChange(`${n}*${n}`);
        }
      }
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitSize = useCallback(
    (w: number, h: number, options?: { updateLockedRatio?: boolean }) => {
      setWidth(w);
      setHeight(h);
      setWidthInput(String(w));
      setHeightInput(String(h));
      if (options?.updateLockedRatio && h > 0) {
        setLockedRatio(w / h);
      }
      onChange(`${w}*${h}`);
    },
    [onChange],
  );

  const handleWidthChange = (w: number) => {
    if (isRatioLocked) {
      const next = fitLockedSize({
        changed: "width",
        value: w,
        ratio: lockedRatio,
        min,
        max,
        step: effectiveStep,
      });
      commitSize(next.width, next.height);
      return;
    }

    setSelectedRatio(null);
    commitSize(w, height);
  };

  const handleHeightChange = (h: number) => {
    if (isRatioLocked) {
      const next = fitLockedSize({
        changed: "height",
        value: h,
        ratio: lockedRatio,
        min,
        max,
        step: effectiveStep,
      });
      commitSize(next.width, next.height);
      return;
    }

    setSelectedRatio(null);
    commitSize(width, h);
  };

  const handlePreset = (w: number, h: number) => {
    setSelectedRatio(formatRatio(w, h));
    commitSize(w, h, { updateLockedRatio: isRatioLocked });
  };

  const handleSwap = useCallback(() => {
    setSelectedRatio(formatRatio(height, width));
    commitSize(height, width, { updateLockedRatio: isRatioLocked });
    setSwapRotation((r) => r + 180);
  }, [width, height, isRatioLocked, commitSize]);

  const toggleRatioLock = () => {
    if (isRatioLocked) {
      setIsRatioLocked(false);
      return;
    }
    setLockedRatio(width / height);
    setIsRatioLocked(true);
  };

  // Generate presets based on min/max range
  const availablePresets = useMemo(() => generatePresets(min, max), [min, max]);

  const ratioLabel = formatRatio(width, height);
  const lockedRatioLabel = selectedRatio ?? ratioLabel;
  const isCurrentPreset = (w: number, h: number) => {
    const presetRatio = formatRatio(w, h);
    return selectedRatio
      ? selectedRatio === presetRatio
      : width === w && height === h;
  };

  return (
    <div className="space-y-3">
      {/* Preset buttons */}
      <div className="flex flex-wrap gap-1.5">
        {availablePresets.map((preset) => (
          <Button
            key={`${preset.width}x${preset.height}`}
            type="button"
            variant={
              isCurrentPreset(preset.width, preset.height)
                ? "default"
                : "outline"
            }
            size="sm"
            onClick={() => handlePreset(preset.width, preset.height)}
            disabled={disabled}
            className="h-6 px-1.5 gap-1 text-xs"
            title={`${preset.width}×${preset.height}`}
          >
            <AspectIcon ratio={preset.label} />
            {preset.label}
          </Button>
        ))}
      </div>

      {/* Custom size inputs */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">Width</Label>
          <Input
            type="number"
            value={widthInput}
            onChange={(e) => {
              const next = e.target.value;
              setWidthInput(next);
              if (next === "") return;
              const parsed = parseInt(next, 10);
              if (Number.isNaN(parsed)) return;
              if (parsed >= min && parsed <= max) handleWidthChange(parsed);
            }}
            onBlur={() => {
              if (widthInput === "") {
                handleWidthChange(min);
                return;
              }
              const parsed = Number(widthInput);
              if (Number.isFinite(parsed)) {
                handleWidthChange(
                  isRatioLocked
                    ? parsed
                    : normalizeDimension(parsed, min, max, effectiveStep),
                );
              } else {
                handleWidthChange(width);
              }
            }}
            min={min}
            max={max}
            step={effectiveStep}
            disabled={disabled}
            className="h-9"
          />
        </div>

        <div className="mt-5 flex items-center gap-1">
          <Button
            type="button"
            variant={isRatioLocked ? "default" : "ghost"}
            size="icon"
            onClick={toggleRatioLock}
            disabled={disabled}
            className="h-9 w-9"
            title={
              isRatioLocked
                ? `Unlock aspect ratio (${lockedRatioLabel})`
                : `Lock aspect ratio (${ratioLabel})`
            }
          >
            {isRatioLocked ? (
              <Lock className="h-4 w-4" />
            ) : (
              <Unlock className="h-4 w-4" />
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleSwap}
            disabled={disabled}
            className="h-9 w-9"
            title="Swap width and height"
          >
            <ArrowLeftRight
              className="h-4 w-4 transition-transform duration-300"
              style={{ transform: `rotate(${swapRotation}deg)` }}
            />
          </Button>
        </div>

        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">Height</Label>
          <Input
            type="number"
            value={heightInput}
            onChange={(e) => {
              const next = e.target.value;
              setHeightInput(next);
              if (next === "") return;
              const parsed = parseInt(next, 10);
              if (Number.isNaN(parsed)) return;
              if (parsed >= min && parsed <= max) handleHeightChange(parsed);
            }}
            onBlur={() => {
              if (heightInput === "") {
                handleHeightChange(min);
                return;
              }
              const parsed = Number(heightInput);
              if (Number.isFinite(parsed)) {
                handleHeightChange(
                  isRatioLocked
                    ? parsed
                    : normalizeDimension(parsed, min, max, effectiveStep),
                );
              } else {
                handleHeightChange(height);
              }
            }}
            min={min}
            max={max}
            step={effectiveStep}
            disabled={disabled}
            className="h-9"
          />
        </div>
      </div>

      {/* Current size and range display */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {width} × {height} px
        </span>
        <span>
          {isRatioLocked ? `${lockedRatioLabel} locked · ` : ""}Range: {min} -{" "}
          {max}
        </span>
      </div>
    </div>
  );
}
