import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Star, X, Trash2, Loader2 } from "lucide-react";
import {
  useSegmentAnythingWorker,
  type MaskResult,
} from "@/hooks/useSegmentAnythingWorker";
import { cn } from "@/lib/utils";

export interface SegmentPoint {
  point: [number, number];
  label: 0 | 1;
}

interface SegmentPointSelectorProps {
  referenceImageUrl: string;
  initialPoints?: SegmentPoint[];
  initialMaskUrl?: string;
  maxWidth?: number;
  maxHeight?: number;
  className?: string;
  onMaskChange?: (
    points: SegmentPoint[],
    maskBlob?: Blob,
  ) => void | Promise<void>;
  onComplete?: (
    points: SegmentPoint[],
    maskBlob?: Blob,
  ) => void | Promise<void>;
  onClose?: () => void;
}

interface SegmentPointPickerProps {
  referenceImageUrl: string;
  onComplete: (points: SegmentPoint[], maskBlob?: Blob) => void;
  onClose: () => void;
}

const MASK_COLOR = { r: 0, g: 114, b: 189 };
const EMPTY_POINTS: SegmentPoint[] = [];
const clamp = (x: number) => Math.max(0, Math.min(1, x));

function getBestMaskIndex(result: MaskResult): number {
  let bestIdx = 0;
  for (let i = 1; i < result.scores.length; i += 1) {
    if (result.scores[i] > result.scores[bestIdx]) bestIdx = i;
  }
  return bestIdx;
}

function maskResultToBlob(result: MaskResult): Promise<Blob> {
  const bestIdx = getBestMaskIndex(result);
  const pixelCount = result.width * result.height;
  const offset = bestIdx * pixelCount;
  const canvas = document.createElement("canvas");
  canvas.width = result.width;
  canvas.height = result.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Failed to export mask"));

  const imageData = ctx.createImageData(result.width, result.height);
  for (let i = 0; i < pixelCount; i += 1) {
    const value = result.mask[offset + i] === 1 ? 255 : 0;
    const target = i * 4;
    imageData.data[target] = value;
    imageData.data[target + 1] = value;
    imageData.data[target + 2] = value;
    imageData.data[target + 3] = value ? 255 : 0;
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Failed to export mask")),
      "image/png",
    );
  });
}

function drawMaskToCanvas(result: MaskResult, canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const bestIdx = getBestMaskIndex(result);
  const pixelCount = result.width * result.height;
  const offset = bestIdx * pixelCount;
  const imageData = ctx.createImageData(result.width, result.height);
  for (let i = 0; i < pixelCount; i += 1) {
    if (result.mask[offset + i] !== 1) continue;
    const target = i * 4;
    imageData.data[target] = MASK_COLOR.r;
    imageData.data[target + 1] = MASK_COLOR.g;
    imageData.data[target + 2] = MASK_COLOR.b;
    imageData.data[target + 3] = 180;
  }

  if (canvas.width !== result.width || canvas.height !== result.height) {
    const tmp = document.createElement("canvas");
    tmp.width = result.width;
    tmp.height = result.height;
    tmp.getContext("2d")?.putImageData(imageData, 0, 0);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.putImageData(imageData, 0, 0);
  }
}

export function SegmentPointSelector({
  referenceImageUrl,
  initialPoints = EMPTY_POINTS,
  initialMaskUrl,
  maxWidth = 700,
  maxHeight = 500,
  className,
  onMaskChange,
  onComplete,
  onClose,
}: SegmentPointSelectorProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<SegmentPoint[]>(initialPoints);
  const decodingRef = useRef(false);
  const pendingDecodeRef = useRef<SegmentPoint[] | null>(null);
  const isHoveringRef = useRef(false);
  const lastHoverRef = useRef<{ x: number; y: number } | null>(null);
  const encodingRef = useRef(false);
  const previousImageUrlRef = useRef(referenceImageUrl);
  const onMaskChangeRef = useRef(onMaskChange);
  const lastNotifiedPointsKeyRef = useRef(JSON.stringify(initialPoints));

  const [points, setPoints] = useState<SegmentPoint[]>(initialPoints);
  const [imageSize, setImageSize] = useState({ width: 400, height: 300 });
  const [naturalSize, setNaturalSize] = useState({ width: 400, height: 300 });
  const [loaded, setLoaded] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [encoding, setEncoding] = useState(false);
  const [encoded, setEncoded] = useState(false);
  const [lastMask, setLastMask] = useState<MaskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notifying, setNotifying] = useState(false);

  pointsRef.current = points;

  useEffect(() => {
    onMaskChangeRef.current = onMaskChange;
  }, [onMaskChange]);

  const { segmentImage, decodeMask, dispose } = useSegmentAnythingWorker({
    onError: (msg) => setError(msg),
  });

  const initialPointsKey = useMemo(
    () => JSON.stringify(initialPoints),
    [initialPoints],
  );

  useEffect(() => {
    const currentPointsKey = JSON.stringify(pointsRef.current);
    if (currentPointsKey === initialPointsKey) return;
    setPoints(initialPoints);
    pointsRef.current = initialPoints;
    setLastMask(null);
    lastNotifiedPointsKeyRef.current = initialPointsKey;
  }, [initialPoints, initialPointsKey]);

  useEffect(() => {
    if (previousImageUrlRef.current === referenceImageUrl) return;
    previousImageUrlRef.current = referenceImageUrl;
    setPoints(initialPoints);
    pointsRef.current = initialPoints;
    setLastMask(null);
    setLoaded(false);
    setImageDataUrl(null);
    setEncoded(false);
    setEncoding(false);
    setError(null);
    lastNotifiedPointsKeyRef.current = JSON.stringify(initialPoints);
  }, [initialPoints, referenceImageUrl]);

  useEffect(() => {
    if (!referenceImageUrl?.trim()) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = (width * maxHeight) / height;
        height = maxHeight;
      }
      setImageSize({ width: Math.round(width), height: Math.round(height) });
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.drawImage(img, 0, 0);
      setImageDataUrl(canvas.toDataURL("image/png"));
      setLoaded(true);
    };
    img.onerror = () => {
      if (!cancelled) setLoaded(true);
    };
    img.src = referenceImageUrl;

    return () => {
      cancelled = true;
    };
  }, [maxHeight, maxWidth, referenceImageUrl]);

  useEffect(() => {
    if (!loaded || !imageDataUrl || encoded || encodingRef.current) return;
    encodingRef.current = true;
    let cancelled = false;
    const run = async () => {
      setEncoding(true);
      setError(null);
      try {
        await segmentImage(imageDataUrl);
        if (!cancelled) setEncoded(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setEncoding(false);
        encodingRef.current = false;
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [encoded, imageDataUrl, loaded, segmentImage]);

  useEffect(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || !loaded) return;
    canvas.width = naturalSize.width;
    canvas.height = naturalSize.height;
  }, [loaded, naturalSize]);

  useEffect(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || !loaded || !initialMaskUrl || pointsRef.current.length > 0) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = initialMaskUrl;
    return () => {
      cancelled = true;
    };
  }, [initialMaskUrl, loaded, naturalSize.height, naturalSize.width]);

  const clearMaskCanvas = useCallback(() => {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const notifyMaskChange = useCallback(
    async (nextPoints: SegmentPoint[], result: MaskResult | null) => {
      const handler = onMaskChangeRef.current;
      if (!handler) return;
      setNotifying(true);
      try {
        const blob = result ? await maskResultToBlob(result) : undefined;
        await handler(nextPoints, blob);
      } finally {
        setNotifying(false);
      }
    },
    [],
  );

  const runDecode = useCallback(
    async (nextPoints: SegmentPoint[]) => {
      if (!encoded || nextPoints.length === 0) {
        clearMaskCanvas();
        return;
      }
      if (decodingRef.current) {
        pendingDecodeRef.current = nextPoints;
        return;
      }

      decodingRef.current = true;
      try {
        const result = await decodeMask(
          nextPoints.map((point) => ({
            point: point.point,
            label: point.label,
          })),
        );
        const nextPointsKey = JSON.stringify(nextPoints);
        const currentPointsKey = JSON.stringify(pointsRef.current);
        const isFixedDecode = nextPointsKey === currentPointsKey;
        if (isHoveringRef.current || isFixedDecode) {
          const canvas = maskCanvasRef.current;
          if (canvas) drawMaskToCanvas(result, canvas);
        }
        if (isFixedDecode) {
          setLastMask(result);
          if (currentPointsKey !== lastNotifiedPointsKeyRef.current) {
            lastNotifiedPointsKeyRef.current = currentPointsKey;
            void notifyMaskChange(pointsRef.current, result).catch((err) => {
              lastNotifiedPointsKeyRef.current = "";
              console.error("Mask notify error:", err);
            });
          }
        }
      } catch (err) {
        console.error("Decode error:", err);
      } finally {
        decodingRef.current = false;
        const pending = pendingDecodeRef.current;
        if (pending) {
          pendingDecodeRef.current = null;
          runDecode(pending);
        }
      }
    },
    [clearMaskCanvas, decodeMask, encoded, notifyMaskChange],
  );

  useEffect(() => {
    if (points.length === 0) {
      if (initialMaskUrl) return;
      if (!isHoveringRef.current) {
        clearMaskCanvas();
        setLastMask(null);
      }
      return;
    }
    runDecode(points);
  }, [clearMaskCanvas, initialMaskUrl, points, runDecode]);

  const getNormalizedCoords = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): [number, number] | null => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      return [
        clamp((event.clientX - rect.left) / rect.width),
        clamp((event.clientY - rect.top) / rect.height),
      ];
    },
    [],
  );

  const decodeHover = useCallback(
    (hoverPoint: SegmentPoint) => {
      runDecode([...pointsRef.current, hoverPoint]);
    },
    [runDecode],
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!encoded) return;
      isHoveringRef.current = true;
      const coords = getNormalizedCoords(event);
      if (!coords) return;
      const [x, y] = coords;
      if (
        lastHoverRef.current &&
        Math.abs(lastHoverRef.current.x - x) < 0.005 &&
        Math.abs(lastHoverRef.current.y - y) < 0.005
      ) {
        return;
      }
      lastHoverRef.current = { x, y };
      decodeHover({ point: [x, y], label: 1 });
    },
    [decodeHover, encoded, getNormalizedCoords],
  );

  const handleMouseLeave = useCallback(() => {
    isHoveringRef.current = false;
    lastHoverRef.current = null;
    if (pointsRef.current.length > 0) {
      runDecode(pointsRef.current);
    } else {
      clearMaskCanvas();
    }
  }, [clearMaskCanvas, runDecode]);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.button !== 2) return;
      event.preventDefault();
      event.stopPropagation();
      if (!encoded) return;
      const coords = getNormalizedCoords(event);
      if (!coords) return;
      const label = event.button === 2 ? 0 : 1;
      setPoints((prev) => [
        ...prev,
        { point: [coords[0], coords[1]], label: label as 0 | 1 },
      ]);
    },
    [encoded, getNormalizedCoords],
  );

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleClear = useCallback(() => {
    const emptyKey = JSON.stringify([]);
    lastNotifiedPointsKeyRef.current = emptyKey;
    setPoints([]);
    pointsRef.current = [];
    setLastMask(null);
    clearMaskCanvas();
    void notifyMaskChange([], null).catch((err) => {
      lastNotifiedPointsKeyRef.current = "";
      console.error("Mask clear notify error:", err);
    });
  }, [clearMaskCanvas, notifyMaskChange]);

  const handleDone = useCallback(async () => {
    const nextPoints =
      points.length > 0
        ? points
        : ([{ point: [0.5, 0.5], label: 1 }] as SegmentPoint[]);
    const maskBlob = lastMask ? await maskResultToBlob(lastMask) : undefined;
    await onComplete?.(nextPoints, maskBlob);
  }, [lastMask, onComplete, points]);

  useEffect(() => {
    return () => {
      dispose();
    };
  }, [dispose]);

  const statusText = encoding
    ? t("workflow.segmentPointPicker.encoding")
    : !encoded
      ? t("workflow.segmentPointPicker.waitingEncode")
      : notifying
        ? t("workflow.paintNode.savingMask", "Saving mask...")
        : null;

  return (
    <div className={cn("space-y-2", className)}>
      {!loaded ? (
        <div
          className="flex items-center justify-center rounded-lg bg-muted"
          style={{ height: Math.min(maxHeight, 300) }}
        >
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div
          ref={containerRef}
          className={cn(
            "relative mx-auto select-none overflow-hidden rounded-lg bg-muted",
            encoded ? "cursor-crosshair" : "cursor-wait",
          )}
          style={{ width: imageSize.width, height: imageSize.height }}
          onMouseDown={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onContextMenu={handleContextMenu}
        >
          <img
            src={referenceImageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-contain pointer-events-none"
            draggable={false}
          />
          <canvas
            ref={maskCanvasRef}
            className="absolute inset-0 h-full w-full pointer-events-none"
            style={{ opacity: 0.55 }}
          />
          {points.map((point, index) => (
            <div
              key={`${point.point[0]}-${point.point[1]}-${index}`}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${point.point[0] * 100}%`,
                top: `${point.point[1] * 100}%`,
              }}
            >
              {point.label === 1 ? (
                <Star className="h-6 w-6 fill-yellow-400 text-yellow-400 drop-shadow-lg" />
              ) : (
                <X
                  className="h-6 w-6 text-red-500 drop-shadow-lg"
                  strokeWidth={3}
                />
              )}
            </div>
          ))}
          {encoding && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
              <div className="flex items-center gap-2 text-sm text-white">
                <Loader2 className="h-5 w-5 animate-spin" />
                {t("workflow.segmentPointPicker.encoding")}
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/95 px-2 py-1.5 shadow-sm">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
            {points.length} {t("workflow.segmentPointPicker.points")}
          </span>
          <span className="min-w-0 truncate">
            {t("workflow.segmentPointPicker.hint")}
          </span>
          {statusText && (
            <span className="inline-flex shrink-0 items-center gap-1 text-blue-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              {statusText}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={handleClear}
            disabled={points.length === 0}
          >
            <Trash2 className="h-4 w-4" />
            {t("workflow.segmentPointPicker.clear")}
          </Button>
          {onClose && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
          )}
          {onComplete && (
            <Button
              size="sm"
              className="h-8"
              onClick={handleDone}
              disabled={encoding || (points.length > 0 && !lastMask)}
            >
              {t("workflow.segmentPointPicker.done")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function SegmentPointPicker({
  referenceImageUrl,
  onComplete,
  onClose,
}: SegmentPointPickerProps) {
  const { t } = useTranslation();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-3xl gap-0 p-0"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader className="p-4 pb-2">
          <DialogTitle>{t("workflow.segmentPointPicker.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("workflow.segmentPointPicker.hint")}
          </DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-2">
          <SegmentPointSelector
            referenceImageUrl={referenceImageUrl}
            onComplete={async (points, maskBlob) => {
              await onComplete(points, maskBlob);
              onClose();
            }}
            onClose={onClose}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
