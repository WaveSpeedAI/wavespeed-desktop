import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Brush,
  Check,
  ChevronDown,
  Eraser,
  ImageOff,
  LassoSelect,
  Loader2,
  Maximize2,
  Paintbrush,
  PenLine,
  ScanLine,
  Settings2,
  SmilePlus,
  Sparkles,
  SquareDashed,
  Star,
  Trash2,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import { FormField } from "@/components/playground/FormField";
import { ModelSelector } from "@/components/playground/ModelSelector";
import { SizeSelector } from "@/components/playground/SizeSelector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type SegmentPoint } from "@/workflow/components/SegmentPointPicker";
import {
  useSegmentAnythingWorker,
  type MaskResult,
} from "@/hooks/useSegmentAnythingWorker";
import { cn } from "@/lib/utils";
import {
  getDefaultValues,
  getFormFieldsFromModel,
  type FormFieldConfig,
} from "@/lib/schemaToForm";
import { formFieldsToModelParamSchema } from "../../../lib/model-converter";
import {
  findPaintPromptField,
  getPaintModelBindings,
  getPaintModelMatchScore,
  isPaintAspectField,
  isPaintDimensionField,
  readPaintModelParams,
  readPaintModelSchema,
  type PaintTarget,
} from "../../../lib/paint-model";
import type { Model } from "@/types/model";

type EditMode =
  | "repaint"
  | "erase"
  | "expand"
  | "remove-bg"
  | "enhance"
  | "face-enhance"
  | "region";
type RepaintSelectionMode = "paint" | "box" | "lasso" | "sketch";
type ManualSelectionMode = RepaintSelectionMode | "erase";
type CanvasInteractionMode = ManualSelectionMode | "region" | "view";
type ExpandRatio = string;
type MaskBbox = {
  x: number;
  y: number;
  width: number;
  height: number;
};
type SelectionHistoryAction = "undo" | "redo";
type SelectionHistoryCommand = {
  action: SelectionHistoryAction;
  id: number;
};
type SelectionHistoryState = {
  canUndo: boolean;
  canRedo: boolean;
};
type SelectionSnapshot = {
  mask: ImageData | null;
  paint: ImageData | null;
  points: SegmentPoint[];
};
type NumericModelField = ReturnType<typeof schemaForModel>[number];

const REQUIRED_REGION_MODES = new Set<EditMode>(["repaint", "erase", "region"]);
const MODEL_TARGET_MODES = new Set<EditMode>(["repaint", "expand"]);
const EXPAND_RATIOS: ExpandRatio[] = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "21:9",
];
const REPAINT_SELECTION_MODES: RepaintSelectionMode[] = [
  "paint",
  "box",
  "lasso",
  "sketch",
];
const SEGMENT_MASK_COLOR = { r: 0, g: 114, b: 189 };
const EMPTY_SEGMENT_POINTS: SegmentPoint[] = [];
const EMPTY_HISTORY_STATE: SelectionHistoryState = {
  canUndo: false,
  canRedo: false,
};
const MAX_SELECTION_HISTORY = 50;
const CANVAS_READ_OPTIONS: CanvasRenderingContext2DSettings = {
  willReadFrequently: true,
};
const DEFAULT_PAINT_PROMPT_KEYS: Record<string, string> = {
  repaint: "workflow.paintNode.prompts.repaintPaint",
  "repaint:paint": "workflow.paintNode.prompts.repaintPaint",
  "repaint:box": "workflow.paintNode.prompts.repaintBox",
  "repaint:lasso": "workflow.paintNode.prompts.repaintLasso",
  "repaint:sketch": "workflow.paintNode.prompts.repaintSketch",
  erase: "workflow.paintNode.prompts.erase",
  expand: "workflow.paintNode.prompts.expand",
};
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function normalizeSelectionMode(value: unknown): RepaintSelectionMode {
  const text = String(value ?? "");
  return REPAINT_SELECTION_MODES.includes(text as RepaintSelectionMode)
    ? (text as RepaintSelectionMode)
    : "paint";
}

function normalizeExpandRatio(value: unknown): ExpandRatio {
  const text = String(value ?? "");
  return text || "16:9";
}

function normalizePaintTarget(): PaintTarget {
  return "image";
}

function fieldsForModel(model: Model | undefined): FormFieldConfig[] {
  return model ? getFormFieldsFromModel(model) : [];
}

function schemaForModel(model: Model | undefined) {
  return formFieldsToModelParamSchema(fieldsForModel(model));
}

function getDefaultPaintPrompt(
  t: TFunction,
  mode: EditMode,
  selectionMode: string,
) {
  const key =
    DEFAULT_PAINT_PROMPT_KEYS[`${mode}:${selectionMode}`] ??
    DEFAULT_PAINT_PROMPT_KEYS[mode];
  return key ? t(key) : "";
}

function getPreferredPaintModelScore(model: Model) {
  const text = `${model.model_id} ${model.name}`.toLowerCase();
  if (/gpt[-_\s]*image[-_\s]*2/.test(text)) return 1000;
  if (text.includes("gpt") && text.includes("image") && text.includes("2")) {
    return 900;
  }
  return 0;
}

function withDefaultPaintPrompt(
  t: TFunction,
  schema: ReturnType<typeof schemaForModel>,
  params: Record<string, unknown>,
  mode: EditMode,
  selectionMode: string,
) {
  const promptField = findPaintPromptField(schema);
  const prompt = getDefaultPaintPrompt(t, mode, selectionMode);
  if (!promptField || !prompt) return params;
  return {
    ...params,
    [promptField.name]: prompt,
  };
}

function withExpandRatioParam(
  schema: ReturnType<typeof schemaForModel>,
  params: Record<string, unknown>,
  ratio: string,
) {
  const aspectField = schema.find(isPaintAspectField);
  if (!aspectField) return params;
  const value = resolveExpandAspectValue(schema, params, ratio);
  return {
    ...params,
    [aspectField.name]: value,
  };
}

function resolveExpandAspectValue(
  schema: ReturnType<typeof schemaForModel>,
  params: Record<string, unknown>,
  preferred: string,
) {
  const aspectField = schema.find(isPaintAspectField);
  if (!aspectField) return preferred;
  const current = String(params[aspectField.name] ?? "");
  const fallback = String(
    aspectField.default ?? aspectField.enum?.[0] ?? preferred,
  );
  const candidates = [preferred, current, fallback, ...(aspectField.enum ?? [])]
    .map((value) => String(value ?? ""))
    .filter(Boolean);
  if (!aspectField.enum?.length) return candidates[0] ?? preferred;
  return (
    candidates.find((value) => aspectField.enum?.includes(value)) ??
    aspectField.enum[0]
  );
}

function isWidthField(field: NumericModelField) {
  const name = field.name.toLowerCase();
  return (
    name === "width" ||
    name === "image_width" ||
    name === "output_width" ||
    name === "target_width" ||
    name.endsWith("_width")
  );
}

function isHeightField(field: NumericModelField) {
  const name = field.name.toLowerCase();
  return (
    name === "height" ||
    name === "image_height" ||
    name === "output_height" ||
    name === "target_height" ||
    name.endsWith("_height")
  );
}

function isSizeField(field: NumericModelField) {
  const name = field.name.toLowerCase();
  return name === "size" && (field.fieldType === "size" || !field.enum?.length);
}

function numericValueForField(
  params: Record<string, unknown>,
  field: NumericModelField | undefined,
) {
  if (!field) return 0;
  const value = params[field.name];
  const next =
    value !== undefined && value !== null && value !== ""
      ? Number(value)
      : Number(field.default ?? field.min ?? 0);
  return Number.isFinite(next) ? next : Number(field.min ?? 0);
}

function HoverOnlyTooltip({
  children,
  content,
  side = "right",
  className,
}: {
  children: React.ReactElement<Record<string, unknown>>;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const child = children as React.ReactElement<{
    onPointerEnter?: (event: React.PointerEvent) => void;
    onPointerLeave?: (event: React.PointerEvent) => void;
    onBlur?: (event: React.FocusEvent) => void;
    onClick?: (event: React.MouseEvent) => void;
  }>;

  return (
    <Tooltip open={open} onOpenChange={(next) => !next && setOpen(false)}>
      <TooltipTrigger asChild>
        {React.cloneElement(child, {
          onPointerEnter: (event: React.PointerEvent) => {
            child.props.onPointerEnter?.(event);
            if (event.pointerType !== "touch") setOpen(true);
          },
          onPointerLeave: (event: React.PointerEvent) => {
            child.props.onPointerLeave?.(event);
            setOpen(false);
          },
          onBlur: (event: React.FocusEvent) => {
            child.props.onBlur?.(event);
            setOpen(false);
          },
          onClick: (event: React.MouseEvent) => {
            child.props.onClick?.(event);
            setOpen(false);
          },
        })}
      </TooltipTrigger>
      {open && (
        <TooltipContent side={side} className={className}>
          {content}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

function ModeButton({
  label,
  active,
  children,
  onClick,
  onMouseEnter,
}: {
  label: string;
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
  onMouseEnter?: () => void;
}) {
  return (
    <HoverOnlyTooltip content={label}>
      <Button
        type="button"
        variant={active ? "default" : "outline"}
        size="icon"
        className="h-8 w-8"
        onClick={(event) => {
          event.currentTarget.blur();
          onClick();
        }}
        onMouseEnter={onMouseEnter}
      >
        {children}
        <span className="sr-only">{label}</span>
      </Button>
    </HoverOnlyTooltip>
  );
}

async function computeMaskBlobBbox(blob: Blob): Promise<MaskBbox | null> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const alpha = data[(y * canvas.width + x) * 4 + 3];
      if (alpha <= 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Export failed."))),
      "image/png",
    );
  });
}

function hasMaskPixels(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return true;
  }
  return false;
}

function getBestMaskIndex(result: MaskResult): number {
  let bestIdx = 0;
  for (let i = 1; i < result.scores.length; i += 1) {
    if (result.scores[i] > result.scores[bestIdx]) bestIdx = i;
  }
  return bestIdx;
}

function segmentMaskToBlob(result: MaskResult): Promise<Blob> {
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

  return canvasToBlob(canvas);
}

function drawSegmentMaskToCanvas(
  result: MaskResult,
  canvas: HTMLCanvasElement,
) {
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
    imageData.data[target] = SEGMENT_MASK_COLOR.r;
    imageData.data[target + 1] = SEGMENT_MASK_COLOR.g;
    imageData.data[target + 2] = SEGMENT_MASK_COLOR.b;
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

function fitSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
) {
  let nextWidth = width;
  let nextHeight = height;
  if (nextWidth > maxWidth) {
    nextHeight = (nextHeight * maxWidth) / nextWidth;
    nextWidth = maxWidth;
  }
  if (nextHeight > maxHeight) {
    nextWidth = (nextWidth * maxHeight) / nextHeight;
    nextHeight = maxHeight;
  }
  return {
    width: Math.round(nextWidth),
    height: Math.round(nextHeight),
  };
}

function SelectionModeButton({
  active,
  icon: Icon,
  label,
  helper,
  onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  helper: string;
  onClick: () => void;
}) {
  return (
    <HoverOnlyTooltip
      side="right"
      className="max-w-44"
      content={
        <>
          <div className="text-xs font-medium">{label}</div>
          <div className="text-[10px] text-primary-foreground/80">{helper}</div>
        </>
      }
    >
      <button
        type="button"
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
          active
            ? "border-primary/50 bg-primary text-primary-foreground"
            : "border-border bg-background text-muted-foreground hover:bg-muted",
        )}
        onClick={(event) => {
          event.currentTarget.blur();
          onClick();
        }}
      >
        <Icon className="h-4 w-4" />
        <span className="sr-only">{label}</span>
      </button>
    </HoverOnlyTooltip>
  );
}

function ManualSelectionCanvas({
  referenceImageUrl,
  maskUrl,
  mode,
  brushSize,
  clearSignal,
  showChrome = true,
  segmentPoints = EMPTY_SEGMENT_POINTS,
  historyCommand,
  maxWidth = 520,
  maxHeight = 420,
  onBrushSizeChange,
  onSelectionChange,
  onSegmentChange,
  onHistoryStateChange,
}: {
  referenceImageUrl: string;
  maskUrl?: string;
  mode: CanvasInteractionMode;
  brushSize: number;
  clearSignal?: number;
  showChrome?: boolean;
  segmentPoints?: SegmentPoint[];
  historyCommand?: SelectionHistoryCommand | null;
  maxWidth?: number;
  maxHeight?: number;
  onBrushSizeChange: (value: number) => void;
  onSelectionChange: (
    maskBlob?: Blob,
    paintedBlob?: Blob,
  ) => void | Promise<void>;
  onSegmentChange?: (
    points: SegmentPoint[],
    maskBlob?: Blob,
  ) => void | Promise<void>;
  onHistoryStateChange?: (state: SelectionHistoryState) => void;
}) {
  const { t } = useTranslation();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const paintCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const lassoPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const lastClearSignalRef = useRef(clearSignal);
  const pointsRef = useRef<SegmentPoint[]>(segmentPoints);
  const decodingRef = useRef(false);
  const pendingDecodeRef = useRef<SegmentPoint[] | null>(null);
  const isHoveringRef = useRef(false);
  const lastHoverRef = useRef<{ x: number; y: number } | null>(null);
  const encodingRef = useRef(false);
  const lastNotifiedPointsKeyRef = useRef(JSON.stringify(segmentPoints));
  const onSegmentChangeRef = useRef(onSegmentChange);
  const onHistoryStateChangeRef = useRef(onHistoryStateChange);
  const historyRef = useRef<SelectionSnapshot[]>([]);
  const redoHistoryRef = useRef<SelectionSnapshot[]>([]);
  const currentSnapshotRef = useRef<SelectionSnapshot | null>(null);
  const snapshotRefreshTimerRef = useRef<number | null>(null);
  const lastHistoryStateRef =
    useRef<SelectionHistoryState>(EMPTY_HISTORY_STATE);
  const lastHistoryCommandIdRef = useRef<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [displaySize, setDisplaySize] = useState({ width: 420, height: 300 });
  const [naturalSize, setNaturalSize] = useState({ width: 420, height: 300 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageCacheKey, setImageCacheKey] = useState("");
  const [encoded, setEncoded] = useState(false);
  const [encoding, setEncoding] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [points, setPoints] = useState<SegmentPoint[]>(segmentPoints);

  const isBrushLike = mode === "paint" || mode === "sketch" || mode === "erase";
  const needsBrushSize =
    mode === "paint" || mode === "sketch" || mode === "erase";
  const isManualMode =
    mode === "paint" ||
    mode === "box" ||
    mode === "lasso" ||
    mode === "sketch" ||
    mode === "erase";
  const isRegionMode = mode === "region";

  pointsRef.current = points;

  const { segmentImage, decodeMask, dispose } = useSegmentAnythingWorker({
    onError: (msg) => console.error("Paint mask error:", msg),
  });

  const emitHistoryState = useCallback(() => {
    const nextState = {
      canUndo: historyRef.current.length > 0,
      canRedo: redoHistoryRef.current.length > 0,
    };
    if (
      nextState.canUndo === lastHistoryStateRef.current.canUndo &&
      nextState.canRedo === lastHistoryStateRef.current.canRedo
    ) {
      return;
    }
    lastHistoryStateRef.current = nextState;
    onHistoryStateChangeRef.current?.(nextState);
  }, []);

  const captureSelectionSnapshot = useCallback((): SelectionSnapshot | null => {
    const maskCanvas = maskCanvasRef.current;
    const paintCanvas = paintCanvasRef.current;
    const maskCtx = maskCanvas?.getContext("2d", CANVAS_READ_OPTIONS);
    const paintCtx = paintCanvas?.getContext("2d", CANVAS_READ_OPTIONS);
    if (!maskCanvas || !paintCanvas || !maskCtx || !paintCtx) return null;

    return {
      mask: maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height),
      paint: paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height),
      points: pointsRef.current.map((point) => ({
        point: [point.point[0], point.point[1]],
        label: point.label,
      })),
    };
  }, []);

  const scheduleSnapshotRefresh = useCallback(() => {
    if (snapshotRefreshTimerRef.current !== null) {
      window.clearTimeout(snapshotRefreshTimerRef.current);
    }
    snapshotRefreshTimerRef.current = window.setTimeout(() => {
      snapshotRefreshTimerRef.current = null;
      currentSnapshotRef.current = captureSelectionSnapshot();
    }, 0);
  }, [captureSelectionSnapshot]);

  const pushSelectionHistory = useCallback(() => {
    const snapshot = currentSnapshotRef.current ?? captureSelectionSnapshot();
    if (!snapshot) return;
    historyRef.current = [...historyRef.current, snapshot].slice(
      -MAX_SELECTION_HISTORY,
    );
    redoHistoryRef.current = [];
    emitHistoryState();
  }, [captureSelectionSnapshot, emitHistoryState]);

  useEffect(() => {
    onSegmentChangeRef.current = onSegmentChange;
  }, [onSegmentChange]);

  useEffect(() => {
    onHistoryStateChangeRef.current = onHistoryStateChange;
  }, [onHistoryStateChange]);

  useEffect(() => {
    return () => {
      if (snapshotRefreshTimerRef.current !== null) {
        window.clearTimeout(snapshotRefreshTimerRef.current);
      }
      dispose();
    };
  }, [dispose]);

  const segmentPointsKey = useMemo(
    () => JSON.stringify(segmentPoints),
    [segmentPoints],
  );

  useEffect(() => {
    const currentPointsKey = JSON.stringify(pointsRef.current);
    if (currentPointsKey === segmentPointsKey) return;
    setPoints(segmentPoints);
    pointsRef.current = segmentPoints;
    lastNotifiedPointsKeyRef.current = segmentPointsKey;
  }, [segmentPoints, segmentPointsKey]);

  useEffect(() => {
    if (!referenceImageUrl) return;
    let cancelled = false;
    setLoaded(false);
    setEncoded(false);
    setEncoding(false);
    setImageDataUrl(null);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      const nextNatural = {
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      };
      setNaturalSize(nextNatural);
      setDisplaySize(
        fitSize(nextNatural.width, nextNatural.height, maxWidth, maxHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = nextNatural.width;
      canvas.height = nextNatural.height;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      setImageDataUrl(canvas.toDataURL("image/png"));
      setImageCacheKey(
        `${referenceImageUrl}|${nextNatural.width}x${nextNatural.height}`,
      );
      setLoaded(true);
    };
    image.onerror = () => {
      if (!cancelled) setLoaded(true);
    };
    image.src = referenceImageUrl;
    return () => {
      cancelled = true;
    };
  }, [maxHeight, maxWidth, referenceImageUrl]);

  useEffect(() => {
    const maskCanvas = maskCanvasRef.current;
    const paintCanvas = paintCanvasRef.current;
    if (!loaded || !maskCanvas || !paintCanvas) return;
    maskCanvas.width = naturalSize.width;
    maskCanvas.height = naturalSize.height;
    paintCanvas.width = naturalSize.width;
    paintCanvas.height = naturalSize.height;
    paintCanvas
      .getContext("2d", CANVAS_READ_OPTIONS)
      ?.clearRect(0, 0, naturalSize.width, naturalSize.height);
    maskCanvas
      .getContext("2d", CANVAS_READ_OPTIONS)
      ?.clearRect(0, 0, naturalSize.width, naturalSize.height);
    historyRef.current = [];
    redoHistoryRef.current = [];
    currentSnapshotRef.current = {
      mask: null,
      paint: null,
      points: [],
    };
    scheduleSnapshotRefresh();
    emitHistoryState();
  }, [
    emitHistoryState,
    loaded,
    naturalSize.height,
    naturalSize.width,
    scheduleSnapshotRefresh,
  ]);

  useEffect(() => {
    const maskCanvas = maskCanvasRef.current;
    if (!loaded || !maskCanvas) return;
    const ctx = maskCanvas.getContext("2d", CANVAS_READ_OPTIONS);
    if (!ctx) return;
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    if (!maskUrl) {
      scheduleSnapshotRefresh();
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      ctx.drawImage(image, 0, 0, maskCanvas.width, maskCanvas.height);
      currentSnapshotRef.current = captureSelectionSnapshot();
    };
    image.src = maskUrl;
    return () => {
      cancelled = true;
    };
  }, [
    captureSelectionSnapshot,
    loaded,
    maskUrl,
    naturalSize.height,
    naturalSize.width,
    scheduleSnapshotRefresh,
  ]);

  useEffect(() => {
    if (
      !isRegionMode ||
      !loaded ||
      !imageDataUrl ||
      encoded ||
      encodingRef.current
    ) {
      return;
    }

    let cancelled = false;
    encodingRef.current = true;
    const run = async () => {
      setEncoding(true);
      try {
        await segmentImage(imageDataUrl, imageCacheKey);
        if (!cancelled) setEncoded(true);
      } catch (err) {
        console.error("Paint mask encode error:", err);
      } finally {
        if (!cancelled) setEncoding(false);
        encodingRef.current = false;
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    encoded,
    imageCacheKey,
    imageDataUrl,
    isRegionMode,
    loaded,
    segmentImage,
  ]);

  const getCanvasPoint = useCallback((event: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const canvas = maskCanvasRef.current;
    if (!rect || !canvas) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
      displayX: event.clientX - rect.left,
      displayY: event.clientY - rect.top,
    };
  }, []);

  const drawBrush = useCallback(
    (
      point: { x: number; y: number },
      previous?: { x: number; y: number } | null,
      subtract = false,
    ) => {
      const maskCtx = maskCanvasRef.current?.getContext("2d");
      if (!maskCtx) return;

      maskCtx.save();
      maskCtx.globalCompositeOperation = subtract
        ? "destination-out"
        : "source-over";
      maskCtx.fillStyle = "#ffffff";
      maskCtx.strokeStyle = "#ffffff";
      maskCtx.lineWidth = brushSize;
      maskCtx.lineCap = "round";
      maskCtx.lineJoin = "round";
      maskCtx.beginPath();
      if (previous) {
        maskCtx.moveTo(previous.x, previous.y);
        maskCtx.lineTo(point.x, point.y);
        maskCtx.stroke();
      } else {
        maskCtx.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
        maskCtx.fill();
      }
      maskCtx.restore();

      if (mode === "sketch" && !subtract) {
        const paintCtx = paintCanvasRef.current?.getContext("2d");
        if (!paintCtx) return;
        paintCtx.save();
        paintCtx.strokeStyle = "#ef4444";
        paintCtx.fillStyle = "#ef4444";
        paintCtx.lineWidth = Math.max(3, brushSize * 0.45);
        paintCtx.lineCap = "round";
        paintCtx.lineJoin = "round";
        paintCtx.beginPath();
        if (previous) {
          paintCtx.moveTo(previous.x, previous.y);
          paintCtx.lineTo(point.x, point.y);
          paintCtx.stroke();
        } else {
          paintCtx.arc(
            point.x,
            point.y,
            Math.max(2, brushSize * 0.22),
            0,
            Math.PI * 2,
          );
          paintCtx.fill();
        }
        paintCtx.restore();
      }
    },
    [brushSize, mode],
  );

  const drawBox = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const maskCanvas = maskCanvasRef.current;
      const maskCtx = maskCanvas?.getContext("2d");
      if (!maskCanvas || !maskCtx) return;
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      maskCtx.fillStyle = "#ffffff";
      maskCtx.fillRect(
        Math.min(start.x, end.x),
        Math.min(start.y, end.y),
        Math.abs(end.x - start.x),
        Math.abs(end.y - start.y),
      );
    },
    [],
  );

  const drawLasso = useCallback((points: Array<{ x: number; y: number }>) => {
    const maskCanvas = maskCanvasRef.current;
    const maskCtx = maskCanvas?.getContext("2d");
    if (!maskCanvas || !maskCtx) return;
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    if (points.length < 2) return;
    maskCtx.strokeStyle = "#ffffff";
    maskCtx.fillStyle = "rgba(255,255,255,0.82)";
    maskCtx.lineWidth = 3;
    maskCtx.lineJoin = "round";
    maskCtx.beginPath();
    maskCtx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => maskCtx.lineTo(point.x, point.y));
    if (points.length > 2) {
      maskCtx.closePath();
      maskCtx.fill();
    }
    maskCtx.stroke();
  }, []);

  const clearMaskCanvas = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    const ctx = maskCanvas?.getContext("2d");
    if (!maskCanvas || !ctx) return;
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  }, []);

  const notifySegmentChange = useCallback(
    async (nextPoints: SegmentPoint[], result: MaskResult | null) => {
      const handler = onSegmentChangeRef.current;
      if (!handler) return;
      try {
        const blob = result ? await segmentMaskToBlob(result) : undefined;
        await handler(nextPoints, blob);
      } catch (err) {
        throw err;
      }
    },
    [],
  );

  const runSegmentDecode = useCallback(
    async (nextPoints: SegmentPoint[]) => {
      if (!encoded || nextPoints.length === 0) {
        clearMaskCanvas();
        currentSnapshotRef.current = {
          mask: null,
          paint: null,
          points: [],
        };
        return;
      }
      if (decodingRef.current) {
        pendingDecodeRef.current = nextPoints;
        return;
      }

      decodingRef.current = true;
      setDecoding(true);
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
        const canvas = maskCanvasRef.current;
        if (canvas && (isHoveringRef.current || isFixedDecode)) {
          drawSegmentMaskToCanvas(result, canvas);
        }
        if (isFixedDecode) {
          scheduleSnapshotRefresh();
          if (currentPointsKey !== lastNotifiedPointsKeyRef.current) {
            lastNotifiedPointsKeyRef.current = currentPointsKey;
            void notifySegmentChange(pointsRef.current, result).catch((err) => {
              lastNotifiedPointsKeyRef.current = "";
              console.error("Paint mask notify error:", err);
            });
          }
        }
      } catch (err) {
        console.error("Paint mask decode error:", err);
      } finally {
        decodingRef.current = false;
        setDecoding(false);
        const pending = pendingDecodeRef.current;
        if (pending) {
          pendingDecodeRef.current = null;
          void runSegmentDecode(pending);
        }
      }
    },
    [
      clearMaskCanvas,
      decodeMask,
      encoded,
      notifySegmentChange,
      scheduleSnapshotRefresh,
    ],
  );

  useEffect(() => {
    if (!isRegionMode) return;
    if (points.length === 0) {
      if (!isHoveringRef.current && !maskUrl) {
        clearMaskCanvas();
      }
      return;
    }
    void runSegmentDecode(points);
  }, [clearMaskCanvas, isRegionMode, maskUrl, points, runSegmentDecode]);

  const exportSelection = useCallback(async () => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || !hasMaskPixels(maskCanvas)) {
      await onSelectionChange(undefined, undefined);
      currentSnapshotRef.current = {
        mask: null,
        paint: null,
        points: [],
      };
      return;
    }

    const maskBlob = await canvasToBlob(maskCanvas);
    let paintedBlob: Blob | undefined;

    if (
      mode === "paint" ||
      mode === "box" ||
      mode === "lasso" ||
      mode === "sketch"
    ) {
      const image = imageRef.current;
      const paintCanvas = paintCanvasRef.current;
      if (image && paintCanvas) {
        const outputCanvas = document.createElement("canvas");
        outputCanvas.width = naturalSize.width;
        outputCanvas.height = naturalSize.height;
        const ctx = outputCanvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(image, 0, 0, naturalSize.width, naturalSize.height);
          const overlayCanvas = document.createElement("canvas");
          overlayCanvas.width = naturalSize.width;
          overlayCanvas.height = naturalSize.height;
          const overlayCtx = overlayCanvas.getContext("2d");
          if (overlayCtx) {
            overlayCtx.drawImage(maskCanvas, 0, 0);
            overlayCtx.globalCompositeOperation = "source-in";
            overlayCtx.fillStyle = "#ef4444";
            overlayCtx.fillRect(0, 0, naturalSize.width, naturalSize.height);
            ctx.save();
            ctx.globalAlpha = 0.46;
            ctx.drawImage(overlayCanvas, 0, 0);
            ctx.restore();
          }

          const outlineCanvas = document.createElement("canvas");
          outlineCanvas.width = naturalSize.width;
          outlineCanvas.height = naturalSize.height;
          const outlineCtx = outlineCanvas.getContext("2d");
          if (outlineCtx) {
            const outlineWidth = Math.max(
              3,
              Math.round(
                Math.min(naturalSize.width, naturalSize.height) * 0.006,
              ),
            );
            for (let dx = -outlineWidth; dx <= outlineWidth; dx += 1) {
              for (let dy = -outlineWidth; dy <= outlineWidth; dy += 1) {
                if (dx * dx + dy * dy > outlineWidth * outlineWidth) continue;
                outlineCtx.drawImage(maskCanvas, dx, dy);
              }
            }
            outlineCtx.globalCompositeOperation = "destination-out";
            outlineCtx.drawImage(maskCanvas, 0, 0);
            outlineCtx.globalCompositeOperation = "source-in";
            outlineCtx.fillStyle = "#ef4444";
            outlineCtx.fillRect(0, 0, naturalSize.width, naturalSize.height);
            ctx.drawImage(outlineCanvas, 0, 0);
          }
          ctx.drawImage(paintCanvas, 0, 0);
          paintedBlob = await canvasToBlob(outputCanvas);
        }
      }
    }

    await onSelectionChange(maskBlob, paintedBlob);
    scheduleSnapshotRefresh();
  }, [
    mode,
    naturalSize.height,
    naturalSize.width,
    onSelectionChange,
    scheduleSnapshotRefresh,
  ]);

  const restoreSelectionSnapshot = useCallback(
    async (snapshot: SelectionSnapshot) => {
      const maskCanvas = maskCanvasRef.current;
      const paintCanvas = paintCanvasRef.current;
      const maskCtx = maskCanvas?.getContext("2d", CANVAS_READ_OPTIONS);
      const paintCtx = paintCanvas?.getContext("2d", CANVAS_READ_OPTIONS);
      if (!maskCanvas || !paintCanvas || !maskCtx || !paintCtx) return;

      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
      if (snapshot.mask) maskCtx.putImageData(snapshot.mask, 0, 0);
      if (snapshot.paint) paintCtx.putImageData(snapshot.paint, 0, 0);

      const nextPoints: SegmentPoint[] = snapshot.points.map((point) => ({
        point: [point.point[0], point.point[1]] as [number, number],
        label: point.label,
      }));
      setPoints(nextPoints);
      pointsRef.current = nextPoints;
      currentSnapshotRef.current = snapshot;

      if (isRegionMode) {
        const nextKey = JSON.stringify(nextPoints);
        lastNotifiedPointsKeyRef.current = "";
        if (nextPoints.length === 0) {
          clearMaskCanvas();
          lastNotifiedPointsKeyRef.current = nextKey;
          await notifySegmentChange([], null);
        } else {
          await runSegmentDecode(nextPoints);
        }
        return;
      }

      await exportSelection();
      currentSnapshotRef.current = snapshot;
    },
    [
      clearMaskCanvas,
      exportSelection,
      isRegionMode,
      notifySegmentChange,
      runSegmentDecode,
    ],
  );

  const runHistoryAction = useCallback(
    async (action: SelectionHistoryAction) => {
      const sourceStack = action === "undo" ? historyRef : redoHistoryRef;
      const targetStack = action === "undo" ? redoHistoryRef : historyRef;
      const snapshot = sourceStack.current.pop();
      const currentSnapshot =
        currentSnapshotRef.current ?? captureSelectionSnapshot();
      if (!snapshot || !currentSnapshot) {
        emitHistoryState();
        return;
      }

      targetStack.current = [...targetStack.current, currentSnapshot].slice(
        -MAX_SELECTION_HISTORY,
      );
      await restoreSelectionSnapshot(snapshot);
      emitHistoryState();
    },
    [captureSelectionSnapshot, emitHistoryState, restoreSelectionSnapshot],
  );

  useEffect(() => {
    if (
      !historyCommand ||
      lastHistoryCommandIdRef.current === historyCommand.id
    ) {
      return;
    }
    lastHistoryCommandIdRef.current = historyCommand.id;
    void runHistoryAction(historyCommand.action);
  }, [historyCommand, runHistoryAction]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const point = getCanvasPoint(event);
      if (!point) return;

      if (isRegionMode) {
        if (!encoded) return;
        const label = event.button === 2 ? 0 : 1;
        pushSelectionHistory();
        setPoints((prev) => [
          ...prev,
          {
            point: [
              clamp01(point.x / naturalSize.width),
              clamp01(point.y / naturalSize.height),
            ],
            label: label as 0 | 1,
          },
        ]);
        return;
      }

      if (!isManualMode) return;

      pushSelectionHistory();
      event.currentTarget.setPointerCapture(event.pointerId);
      drawingRef.current = true;
      lastPointRef.current = point;
      setCursor({ x: point.displayX, y: point.displayY });

      if (isBrushLike) {
        drawBrush(
          point,
          null,
          mode === "paint" && (event.button === 2 || event.altKey),
        );
        return;
      }

      if (mode === "box") {
        dragStartRef.current = point;
        drawBox(point, point);
        return;
      }

      if (mode === "lasso") {
        lassoPointsRef.current = [point];
        drawLasso(lassoPointsRef.current);
      }
    },
    [
      drawBox,
      drawBrush,
      drawLasso,
      encoded,
      getCanvasPoint,
      isBrushLike,
      isManualMode,
      isRegionMode,
      mode,
      naturalSize.height,
      naturalSize.width,
      pushSelectionHistory,
    ],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const point = getCanvasPoint(event);
      if (!point) return;
      setCursor({ x: point.displayX, y: point.displayY });

      if (isRegionMode && encoded && !drawingRef.current) {
        isHoveringRef.current = true;
        const hoverPoint = {
          x: clamp01(point.x / naturalSize.width),
          y: clamp01(point.y / naturalSize.height),
        };
        if (
          lastHoverRef.current &&
          Math.abs(lastHoverRef.current.x - hoverPoint.x) < 0.005 &&
          Math.abs(lastHoverRef.current.y - hoverPoint.y) < 0.005
        ) {
          return;
        }
        lastHoverRef.current = hoverPoint;
        void runSegmentDecode([
          ...pointsRef.current,
          { point: [hoverPoint.x, hoverPoint.y], label: 1 },
        ]);
        return;
      }

      if (!drawingRef.current) return;

      if (isBrushLike) {
        drawBrush(
          point,
          lastPointRef.current,
          mode === "paint" && (event.buttons === 2 || event.altKey),
        );
        lastPointRef.current = point;
        return;
      }

      if (mode === "box" && dragStartRef.current) {
        drawBox(dragStartRef.current, point);
        return;
      }

      if (mode === "lasso") {
        lassoPointsRef.current = [...lassoPointsRef.current, point];
        drawLasso(lassoPointsRef.current);
      }
    },
    [
      drawBox,
      drawBrush,
      drawLasso,
      encoded,
      getCanvasPoint,
      isBrushLike,
      isRegionMode,
      mode,
      naturalSize.height,
      naturalSize.width,
      runSegmentDecode,
    ],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!drawingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      drawingRef.current = false;
      lastPointRef.current = null;
      dragStartRef.current = null;

      if (mode === "lasso" && lassoPointsRef.current.length < 3) {
        drawLasso([]);
      }
      void exportSelection();
    },
    [drawLasso, exportSelection, mode],
  );

  const handlePointerLeave = useCallback(() => {
    setCursor(null);
    isHoveringRef.current = false;
    lastHoverRef.current = null;
    if (!isRegionMode) return;
    if (pointsRef.current.length > 0) {
      void runSegmentDecode(pointsRef.current);
    } else if (!maskUrl) {
      clearMaskCanvas();
    }
  }, [clearMaskCanvas, isRegionMode, maskUrl, runSegmentDecode]);

  const handleClear = useCallback(() => {
    pushSelectionHistory();
    maskCanvasRef.current
      ?.getContext("2d", CANVAS_READ_OPTIONS)
      ?.clearRect(0, 0, naturalSize.width, naturalSize.height);
    paintCanvasRef.current
      ?.getContext("2d", CANVAS_READ_OPTIONS)
      ?.clearRect(0, 0, naturalSize.width, naturalSize.height);
    currentSnapshotRef.current = {
      mask: null,
      paint: null,
      points: [],
    };
    if (isRegionMode) {
      const emptyKey = JSON.stringify([]);
      lastNotifiedPointsKeyRef.current = emptyKey;
      setPoints([]);
      pointsRef.current = [];
      void notifySegmentChange([], null).catch((err) => {
        lastNotifiedPointsKeyRef.current = "";
        console.error("Paint mask clear notify error:", err);
      });
      return;
    }

    void onSelectionChange(undefined, undefined);
  }, [
    isRegionMode,
    naturalSize.height,
    naturalSize.width,
    notifySegmentChange,
    onSelectionChange,
    pushSelectionHistory,
  ]);

  useEffect(() => {
    if (
      clearSignal === undefined ||
      lastClearSignalRef.current === clearSignal
    ) {
      return;
    }
    lastClearSignalRef.current = clearSignal;
    handleClear();
  }, [clearSignal, handleClear]);

  const hint =
    mode === "paint"
      ? t(
          "workflow.paintNode.paintHint",
          "Paint the area to repaint. Right-drag or hold Alt to subtract.",
        )
      : mode === "box"
        ? t("workflow.paintNode.boxHint", "Drag a rectangle around the area.")
        : mode === "lasso"
          ? t(
              "workflow.paintNode.lassoHint",
              "Drag around the area to close a freeform selection.",
            )
          : mode === "sketch"
            ? t(
                "workflow.paintNode.sketchHint",
                "Sketch visual guidance; the stroke area becomes the edit region.",
              )
            : t(
                "workflow.paintNode.eraseBrushHint",
                "Brush over the object or area to erase.",
              );

  return (
    <div className={cn(showChrome && "space-y-2")}>
      {showChrome && (
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[10px] text-muted-foreground">
            {hint}
          </span>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={handleClear}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">
                  {t("workflow.paintNode.clearRegion", "Clear region")}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {t("workflow.paintNode.clearRegion", "Clear region")}
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      <div
        ref={containerRef}
        className={cn(
          "relative mx-auto select-none overflow-hidden rounded-lg border border-border bg-muted",
          isBrushLike
            ? "cursor-none"
            : isManualMode || isRegionMode
              ? "cursor-crosshair"
              : "cursor-default",
        )}
        style={{ width: displaySize.width, height: displaySize.height }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <img
          src={referenceImageUrl}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
        <canvas
          ref={maskCanvasRef}
          className={cn(
            "pointer-events-none absolute inset-0 h-full w-full",
            isRegionMode ? "opacity-80" : "opacity-45",
          )}
        />
        <canvas
          ref={paintCanvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
        {isRegionMode &&
          points.map((point, index) => (
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
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <div className="flex items-center gap-2 rounded-md border border-border bg-background/95 px-3 py-2 text-xs font-medium text-foreground shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>
                {t(
                  "workflow.paintNode.loadingMaskTools",
                  "Loading mask tools...",
                )}
              </span>
            </div>
          </div>
        )}
        {isRegionMode && encoding && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/35">
            <div className="flex items-center gap-2 rounded-md bg-black/70 px-3 py-2 text-xs font-medium text-white shadow-lg">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                {t("workflow.paintNode.encoding", "Analyzing image...")}
              </span>
            </div>
          </div>
        )}
        {isRegionMode && !encoding && decoding && (
          <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-md bg-black/70 px-3 py-2 text-xs font-medium text-white shadow-lg">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t("workflow.paintNode.decoding", "Updating mask...")}</span>
          </div>
        )}
        {cursor && needsBrushSize && (
          <div
            className="pointer-events-none absolute rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
            style={{
              left: cursor.x,
              top: cursor.y,
              width: Math.max(
                8,
                (brushSize / naturalSize.width) * displaySize.width,
              ),
              height: Math.max(
                8,
                (brushSize / naturalSize.width) * displaySize.width,
              ),
              transform: "translate(-50%, -50%)",
            }}
          />
        )}
      </div>

      {showChrome && (
        <div
          className={cn(
            "grid grid-cols-[auto_1fr_auto] items-center gap-2",
            !needsBrushSize && "pointer-events-none invisible",
          )}
          aria-hidden={!needsBrushSize}
        >
          <span className="text-[10px] text-muted-foreground">
            {mode === "erase"
              ? t("workflow.paintNode.eraserSize", "Eraser")
              : t("workflow.paintNode.brushSize", "Brush")}
          </span>
          <Slider
            value={[brushSize]}
            onValueChange={([value]) => onBrushSizeChange(value)}
            min={6}
            max={120}
            step={1}
            disabled={!needsBrushSize}
          />
          <span className="w-7 text-right text-[10px] tabular-nums text-muted-foreground">
            {brushSize}
          </span>
        </div>
      )}
    </div>
  );
}

export function PaintNodeEditor({
  nodeId,
  imageUrl,
  params,
  storeModels,
  getModelById,
  ensureWorkflowId,
  onParamChange,
  onPreview,
  onUploadFile,
}: {
  nodeId: string;
  imageUrl: string;
  params: Record<string, unknown>;
  storeModels: Model[];
  getModelById: (id: string) => Model | undefined;
  ensureWorkflowId: () => Promise<string | null | undefined>;
  onParamChange: (updates: Record<string, unknown>) => void;
  onPreview: (src: string) => void;
  onUploadFile: (file: File) => Promise<string>;
}) {
  const { t } = useTranslation();
  const [mode, setModeState] = useState<EditMode>(
    String(params.__paintTask ?? "repaint") as EditMode,
  );
  const [selectionMode, setSelectionModeState] = useState<RepaintSelectionMode>(
    normalizeSelectionMode(
      params.__selectionMode ??
        (params.__regionMode === "smart" ? "smart" : "paint"),
    ),
  );
  const [brushSize, setBrushSizeState] = useState(
    Number(params.__brushSize ?? 30) || 30,
  );
  const [expandRatio, setExpandRatioState] = useState<ExpandRatio>(
    normalizeExpandRatio(params.__expandRatio),
  );
  const paintTarget = normalizePaintTarget();
  const [editorOpen, setEditorOpen] = useState(false);
  const [toolControlsOpen, setToolControlsOpen] = useState(false);
  const [clearSignal, setClearSignal] = useState(0);
  const [historyCommand, setHistoryCommand] =
    useState<SelectionHistoryCommand | null>(null);
  const [historyState, setHistoryState] =
    useState<SelectionHistoryState>(EMPTY_HISTORY_STATE);
  const [localSelectionReady, setLocalSelectionReady] = useState(
    Boolean(params.__maskImage),
  );
  const [selectionSaving, setSelectionSaving] = useState(false);
  const pendingSelectionSaveRef = useRef<Promise<void> | null>(null);
  const [error, setError] = useState("");

  const savedSource = String(params.__sourceImage ?? "");
  const savedMask = String(params.__maskImage ?? "");
  const savedPaintedImage = String(params.__paintedImage ?? "");
  const savedBbox = String(params.__maskBbox ?? "");
  const sourceMatchesSavedSelection = Boolean(
    imageUrl && savedSource && imageUrl === savedSource,
  );
  const selectionReady = Boolean(
    localSelectionReady && sourceMatchesSavedSelection,
  );
  const segmentPoints = useMemo<SegmentPoint[]>(() => {
    try {
      const points = JSON.parse(String(params.__segmentPoints ?? "[]"));
      return Array.isArray(points) ? (points as SegmentPoint[]) : [];
    } catch {
      return [];
    }
  }, [params.__segmentPoints]);
  const needsRegion = REQUIRED_REGION_MODES.has(mode);
  const supportsModelTarget = MODEL_TARGET_MODES.has(mode);
  const selectedPaintModelId = String(params.__paintModelId ?? "");
  const selectedPaintModel = selectedPaintModelId
    ? getModelById(selectedPaintModelId)
    : undefined;

  useEffect(() => {
    if (savedMask && sourceMatchesSavedSelection) setLocalSelectionReady(true);
  }, [savedMask, sourceMatchesSavedSelection]);

  useEffect(() => {
    const nextSource = imageUrl.trim();
    if (!nextSource || nextSource === savedSource) return;
    onParamChange({
      ...params,
      __sourceImage: nextSource,
      __paintedImage: nextSource,
      __maskImage: "",
      __maskBbox: "",
      __segmentPoints: "[]",
    });
    setLocalSelectionReady(false);
    setError("");
  }, [imageUrl, onParamChange, params, savedSource]);

  const selectedModelFields = useMemo(
    () => fieldsForModel(selectedPaintModel),
    [selectedPaintModel],
  );
  const selectedModelSchema = useMemo(
    () =>
      selectedPaintModel
        ? formFieldsToModelParamSchema(selectedModelFields)
        : readPaintModelSchema(params.__paintModelInputSchema),
    [params.__paintModelInputSchema, selectedModelFields, selectedPaintModel],
  );
  const modelBindings = useMemo(
    () => getPaintModelBindings(selectedModelSchema, mode),
    [mode, selectedModelSchema],
  );
  const paintModelParams = useMemo(
    () => readPaintModelParams(params.__paintModelParams),
    [params.__paintModelParams],
  );
  const selectedAspectField = useMemo(
    () => selectedModelSchema.find(isPaintAspectField),
    [selectedModelSchema],
  );
  const selectedWidthField = useMemo(
    () => selectedModelSchema.find(isWidthField),
    [selectedModelSchema],
  );
  const selectedHeightField = useMemo(
    () => selectedModelSchema.find(isHeightField),
    [selectedModelSchema],
  );
  const selectedSizeField = useMemo(
    () => selectedModelSchema.find(isSizeField),
    [selectedModelSchema],
  );

  const modeOptions = useMemo(
    () => [
      {
        value: "repaint" as const,
        icon: Paintbrush,
        label: t("workflow.paintNode.modeRepaint", "Repaint"),
      },
      {
        value: "region" as const,
        icon: ScanLine,
        label: t("workflow.paintNode.modeRegion", "Mask"),
      },
      {
        value: "erase" as const,
        icon: Eraser,
        label: t("workflow.paintNode.modeErase", "Erase"),
      },
      {
        value: "expand" as const,
        icon: Maximize2,
        label: t("workflow.paintNode.modeExpand", "Expand"),
      },
      {
        value: "remove-bg" as const,
        icon: ImageOff,
        label: t("workflow.paintNode.modeRemoveBg", "Remove background"),
      },
      {
        value: "enhance" as const,
        icon: Sparkles,
        label: t("workflow.paintNode.modeEnhance", "Enhance"),
      },
      {
        value: "face-enhance" as const,
        icon: SmilePlus,
        label: t("workflow.paintNode.modeFace", "Face enhance"),
      },
    ],
    [t],
  );

  const paintModelOptions = useMemo(() => {
    if (!supportsModelTarget) return [];
    return storeModels
      .map((model) => {
        const schema = schemaForModel(model);
        return {
          model,
          score: getPaintModelMatchScore(model, schema, mode, paintTarget),
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        const preferredDelta =
          getPreferredPaintModelScore(b.model) -
          getPreferredPaintModelScore(a.model);
        if (preferredDelta !== 0) return preferredDelta;
        if (b.score !== a.score) return b.score - a.score;
        return (b.model.sort_order ?? 0) - (a.model.sort_order ?? 0);
      })
      .map((item) => item.model);
  }, [mode, paintTarget, storeModels, supportsModelTarget]);

  const configurableModelFields = useMemo(
    () =>
      selectedModelFields.filter(
        (field) =>
          !modelBindings.has(field.name) &&
          (mode === "expand" || !isPaintDimensionField(field)),
      ),
    [mode, modelBindings, selectedModelFields],
  );
  const modelSelectorOptions = useMemo(() => {
    return paintModelOptions;
  }, [paintModelOptions]);
  const selectedModelMissing = Boolean(
    supportsModelTarget && selectedPaintModelId && !selectedPaintModel,
  );
  const selectedModelIncompatible = Boolean(
    supportsModelTarget &&
    selectedPaintModel &&
    getPaintModelMatchScore(
      selectedPaintModel,
      selectedModelSchema,
      mode,
      paintTarget,
    ) <= 0,
  );

  const setMode = useCallback(
    (nextMode: EditMode) => {
      const nextSelectionMode: RepaintSelectionMode = selectionMode;
      const nextTarget = normalizePaintTarget();
      setModeState(nextMode);
      setSelectionModeState(nextSelectionMode);
      setError("");
      const nextSchema = selectedPaintModel ? selectedModelSchema : [];
      const nextModelParams = withDefaultPaintPrompt(
        t,
        nextSchema,
        readPaintModelParams(params.__paintModelParams),
        nextMode,
        nextSelectionMode,
      );
      onParamChange({
        ...params,
        __paintTask: nextMode,
        __paintTarget: nextTarget,
        __selectionMode: nextSelectionMode,
        __regionMode: nextSelectionMode,
        __paintModelId: selectedPaintModelId,
        __paintModelInputSchema: nextSchema,
        __paintModelParams:
          nextMode === "expand"
            ? withExpandRatioParam(nextSchema, nextModelParams, expandRatio)
            : nextModelParams,
        __maskImage: "",
        __maskBbox: "",
        __segmentPoints: "[]",
        __paintedImage: imageUrl || String(params.__sourceImage ?? ""),
      });
    },
    [
      imageUrl,
      onParamChange,
      params,
      expandRatio,
      selectedModelSchema,
      selectedPaintModel,
      selectedPaintModelId,
      selectionMode,
      t,
    ],
  );

  const setSelectionMode = useCallback(
    (nextSelectionMode: RepaintSelectionMode) => {
      setSelectionModeState(nextSelectionMode);
      setError("");
      const nextModelParams = withDefaultPaintPrompt(
        t,
        selectedModelSchema,
        paintModelParams,
        mode,
        nextSelectionMode,
      );
      onParamChange({
        ...params,
        __paintTask: mode,
        __selectionMode: nextSelectionMode,
        __regionMode: nextSelectionMode,
        __paintModelParams: nextModelParams,
      });
    },
    [mode, onParamChange, paintModelParams, params, selectedModelSchema, t],
  );

  const setBrushSize = useCallback(
    (nextBrushSize: number) => {
      setBrushSizeState(nextBrushSize);
      onParamChange({
        ...params,
        __paintTask: mode,
        __selectionMode: selectionMode,
        __brushSize: nextBrushSize,
      });
    },
    [mode, onParamChange, params, selectionMode],
  );

  const setExpandRatio = useCallback(
    (nextRatio: ExpandRatio) => {
      const nextValue = resolveExpandAspectValue(
        selectedModelSchema,
        paintModelParams,
        nextRatio,
      );
      const normalizedRatio = normalizeExpandRatio(nextValue);
      setExpandRatioState(normalizedRatio);
      onParamChange({
        ...params,
        __paintTask: mode,
        __expandRatio: normalizedRatio,
        __paintModelParams: withExpandRatioParam(
          selectedModelSchema,
          paintModelParams,
          nextValue,
        ),
      });
    },
    [mode, onParamChange, paintModelParams, params, selectedModelSchema],
  );

  const setPaintModel = useCallback(
    (modelId: string) => {
      const model = getModelById(modelId);
      if (!model) return;
      const fields = fieldsForModel(model);
      const schema = formFieldsToModelParamSchema(fields);
      const defaultParams = withDefaultPaintPrompt(
        t,
        schema,
        getDefaultValues(fields),
        mode,
        selectionMode,
      );
      const nextAspectValue = resolveExpandAspectValue(
        schema,
        defaultParams,
        expandRatio,
      );
      const nextExpandRatio = normalizeExpandRatio(nextAspectValue);
      setExpandRatioState(nextExpandRatio);
      setError("");
      onParamChange({
        ...params,
        __paintTask: mode,
        __selectionMode: selectionMode,
        __regionMode: selectionMode,
        __paintTarget: paintTarget,
        __expandRatio: nextExpandRatio,
        __paintModelId: modelId,
        __paintModelInputSchema: schema,
        __paintModelParams: withExpandRatioParam(
          schema,
          defaultParams,
          nextAspectValue,
        ),
      });
    },
    [
      expandRatio,
      getModelById,
      mode,
      onParamChange,
      paintTarget,
      params,
      selectionMode,
      t,
    ],
  );

  useEffect(() => {
    if (
      !supportsModelTarget ||
      selectedPaintModelId ||
      paintModelOptions.length === 0
    ) {
      return;
    }
    setPaintModel(paintModelOptions[0].model_id);
  }, [
    paintModelOptions,
    selectedPaintModelId,
    setPaintModel,
    supportsModelTarget,
  ]);

  const setPaintModelParam = useCallback(
    (fieldName: string, value: unknown) => {
      const nextExpandRatio =
        selectedAspectField?.name === fieldName
          ? normalizeExpandRatio(value)
          : expandRatio;
      if (nextExpandRatio !== expandRatio) {
        setExpandRatioState(nextExpandRatio);
      }
      onParamChange({
        ...params,
        __paintTask: mode,
        __selectionMode: selectionMode,
        __regionMode: selectionMode,
        __paintTarget: paintTarget,
        __expandRatio: nextExpandRatio,
        __paintModelParams: {
          ...paintModelParams,
          [fieldName]: value,
        },
      });
    },
    [
      mode,
      onParamChange,
      paintModelParams,
      paintTarget,
      params,
      selectionMode,
      selectedAspectField,
      expandRatio,
    ],
  );

  const setExpandNumericParam = useCallback(
    (field: NumericModelField, value: number) => {
      const rounded = field.type === "integer" ? Math.round(value) : value;
      const clamped = Math.max(
        field.min ?? rounded,
        Math.min(field.max ?? rounded, rounded),
      );
      setPaintModelParam(field.name, clamped);
    },
    [setPaintModelParam],
  );

  const expandAspectOptions = selectedAspectField?.enum ?? [];
  const expandAspectValue = selectedAspectField
    ? resolveExpandAspectValue(
        selectedModelSchema,
        paintModelParams,
        expandRatio,
      )
    : expandRatio;
  const expandWidthValue = numericValueForField(
    paintModelParams,
    selectedWidthField,
  );
  const expandHeightValue = numericValueForField(
    paintModelParams,
    selectedHeightField,
  );
  const expandSizeValue = String(
    selectedSizeField
      ? (paintModelParams[selectedSizeField.name] ??
          selectedSizeField.default ??
          `${selectedSizeField.min ?? 1024}*${selectedSizeField.min ?? 1024}`)
      : "",
  );

  useEffect(() => {
    if (mode !== "expand" || !selectedAspectField) return;
    const nextAspectValue = resolveExpandAspectValue(
      selectedModelSchema,
      paintModelParams,
      expandRatio,
    );
    const nextExpandRatio = normalizeExpandRatio(nextAspectValue);
    if (
      paintModelParams[selectedAspectField.name] === nextAspectValue &&
      expandRatio === nextExpandRatio
    ) {
      return;
    }
    if (nextExpandRatio !== expandRatio) {
      setExpandRatioState(nextExpandRatio);
    }
    onParamChange({
      ...params,
      __paintTask: mode,
      __expandRatio: nextExpandRatio,
      __paintModelParams: withExpandRatioParam(
        selectedModelSchema,
        paintModelParams,
        nextAspectValue,
      ),
    });
  }, [
    expandRatio,
    mode,
    onParamChange,
    paintModelParams,
    params,
    selectedAspectField,
    selectedModelSchema,
  ]);

  const saveSelection = useCallback(
    async ({
      maskBlob,
      paintedBlob,
      points,
      nextSelectionMode,
    }: {
      maskBlob?: Blob;
      paintedBlob?: Blob;
      points?: SegmentPoint[];
      nextSelectionMode: string;
    }) => {
      const saveTask = (async () => {
        setSelectionSaving(Boolean(maskBlob));
        setLocalSelectionReady(false);
        setError("");
        const sourceUrl = imageUrl || String(params.__sourceImage ?? "");
        const updates: Record<string, unknown> = {
          ...params,
          __paintTask: mode,
          __selectionMode: nextSelectionMode,
          __regionMode: nextSelectionMode,
          __segmentPoints: JSON.stringify(points ?? []),
          __sourceImage: sourceUrl,
        };

        if (!maskBlob) {
          updates.__maskImage = "";
          updates.__maskBbox = "";
          updates.__paintedImage = sourceUrl;
          onParamChange(updates);
          setLocalSelectionReady(false);
          return;
        }

        const wfId = await ensureWorkflowId();
        if (!wfId) throw new Error("Workflow not saved yet.");
        const { storageIpc } = await import("../../../ipc/ipc-client");
        const maskPath = await storageIpc.saveNodeOutput(
          wfId,
          nodeId,
          "frame-edit-region-mask",
          "png",
          await maskBlob.arrayBuffer(),
        );
        updates.__maskImage = `local-asset://${encodeURIComponent(maskPath)}`;
        const bbox = await computeMaskBlobBbox(maskBlob);
        updates.__maskBbox = bbox ? JSON.stringify(bbox) : "";

        if (paintedBlob) {
          const paintedPath = await storageIpc.saveNodeOutput(
            wfId,
            nodeId,
            "frame-edit-painted-reference",
            "png",
            await paintedBlob.arrayBuffer(),
          );
          updates.__paintedImage = `local-asset://${encodeURIComponent(
            paintedPath,
          )}`;
        } else {
          updates.__paintedImage = sourceUrl;
        }

        onParamChange(updates);
        setLocalSelectionReady(true);
      })();

      pendingSelectionSaveRef.current = saveTask;
      saveTask
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (pendingSelectionSaveRef.current === saveTask) {
            pendingSelectionSaveRef.current = null;
          }
          setSelectionSaving(false);
        });
      await saveTask;
    },
    [ensureWorkflowId, imageUrl, mode, nodeId, onParamChange, params],
  );

  const handleSmartRegionChange = useCallback(
    async (points: SegmentPoint[], maskBlob?: Blob) => {
      await saveSelection({
        maskBlob,
        points,
        nextSelectionMode: "smart",
      });
    },
    [saveSelection],
  );

  const handleManualSelectionChange = useCallback(
    async (maskBlob?: Blob, paintedBlob?: Blob) => {
      await saveSelection({
        maskBlob,
        paintedBlob,
        nextSelectionMode: mode === "erase" ? "erase" : selectionMode,
      });
    },
    [mode, saveSelection, selectionMode],
  );

  const activeMode = modeOptions.find((item) => item.value === mode);
  const ActiveModeIcon = activeMode?.icon ?? Paintbrush;
  const editorSourceUrl = imageUrl || savedSource;
  const canvasMode: CanvasInteractionMode =
    mode === "repaint"
      ? selectionMode
      : mode === "erase"
        ? "erase"
        : mode === "region"
          ? "region"
          : "view";
  const showBrushControl =
    mode === "erase" ||
    (mode === "repaint" &&
      (selectionMode === "paint" || selectionMode === "sketch"));
  const supportsSelectionHistory =
    mode === "repaint" || mode === "erase" || mode === "region";
  const hasFloatingToolControls =
    mode === "repaint" ||
    mode === "erase" ||
    mode === "region" ||
    mode === "expand";
  const requiresSelection =
    mode === "repaint" || mode === "erase" || mode === "region";
  const selectionFooterTitle =
    requiresSelection && selectionSaving
      ? t("workflow.paintNode.savingSelection", "Saving selection...")
      : requiresSelection && selectionReady
        ? t("workflow.paintNode.selectionSaved", "Selection saved")
        : requiresSelection
          ? t(
              "workflow.paintNode.selectionRequired",
              "Select an area on the frame",
            )
          : t("workflow.paintNode.functionSelected", "{{mode}} selected", {
              mode:
                activeMode?.label ??
                t("workflow.paintNode.editImage", "Edit image"),
            });
  const selectionFooterHint =
    requiresSelection && selectionSaving
      ? t(
          "workflow.paintNode.savingSelectionHint",
          "Preparing the marked image that will be sent to the model.",
        )
      : requiresSelection && selectionReady
        ? t(
            "workflow.paintNode.selectionSavedHint",
            "Continue to configure the edit. The saved preview is ready to run.",
          )
        : requiresSelection
          ? t(
              "workflow.paintNode.selectionRequiredHint",
              "Use the active mask tool on the image, then continue.",
            )
          : t(
              "workflow.paintNode.functionSelectedHint",
              "Continue to configure this function for the next AI generation.",
            );
  const pendingRequestImage =
    mode === "repaint"
      ? sourceMatchesSavedSelection && savedPaintedImage
        ? savedPaintedImage
        : editorSourceUrl
      : mode === "region"
        ? sourceMatchesSavedSelection
          ? savedMask || ""
          : ""
        : editorSourceUrl;
  const runSelectionHistoryCommand = useCallback(
    (action: SelectionHistoryAction) => {
      setHistoryCommand((previous) => ({
        action,
        id: (previous?.id ?? 0) + 1,
      }));
    },
    [],
  );

  useEffect(() => {
    if (!editorOpen || !supportsSelectionHistory) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      event.preventDefault();
      runSelectionHistoryCommand(
        key === "y" || event.shiftKey ? "redo" : "undo",
      );
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editorOpen, runSelectionHistoryCommand, supportsSelectionHistory]);

  const floatingToolControls = toolControlsOpen ? (
    <div className="absolute left-3 top-3 z-20 flex flex-col gap-1 rounded-xl border border-border/80 bg-background/95 p-1 shadow-xl backdrop-blur">
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setToolControlsOpen(false)}
          >
            <ChevronDown className="h-3.5 w-3.5 rotate-90" />
            <span className="sr-only">
              {t("workflow.paintNode.collapseTools", "Collapse tools")}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {t("workflow.paintNode.collapseTools", "Collapse tools")}
        </TooltipContent>
      </Tooltip>

      {mode === "repaint" && (
        <>
          <SelectionModeButton
            active={selectionMode === "paint"}
            icon={Brush}
            label={t("workflow.paintNode.selectPaint", "Paint")}
            helper={t("workflow.paintNode.selectPaintHelp", "fast soft area")}
            onClick={() => setSelectionMode("paint")}
          />
          <SelectionModeButton
            active={selectionMode === "box"}
            icon={SquareDashed}
            label={t("workflow.paintNode.selectBox", "Box")}
            helper={t("workflow.paintNode.selectBoxHelp", "rough block")}
            onClick={() => setSelectionMode("box")}
          />
          <SelectionModeButton
            active={selectionMode === "lasso"}
            icon={LassoSelect}
            label={t("workflow.paintNode.selectLasso", "Lasso")}
            helper={t("workflow.paintNode.selectLassoHelp", "free shape")}
            onClick={() => setSelectionMode("lasso")}
          />
          <SelectionModeButton
            active={selectionMode === "sketch"}
            icon={PenLine}
            label={t("workflow.paintNode.selectSketch", "Sketch")}
            helper={t("workflow.paintNode.selectSketchHelp", "visual guide")}
            onClick={() => setSelectionMode("sketch")}
          />
        </>
      )}

      {showBrushControl && (
        <div className="flex w-8 flex-col items-center gap-1.5 rounded-md border border-border bg-muted/30 px-1 py-1.5">
          <span className="text-[10px] tabular-nums text-foreground/70">
            {brushSize}
          </span>
          <div className="h-28 w-7 px-2">
            <Slider
              orientation="vertical"
              className="h-full w-full"
              trackClassName="w-1.5"
              thumbClassName="h-3.5 w-3.5 border-[1.5px] shadow-sm hover:scale-110 hover:shadow-md focus-visible:scale-110 active:scale-105"
              value={[brushSize]}
              onValueChange={([value]) => setBrushSize(value)}
              min={6}
              max={120}
              step={1}
            />
          </div>
        </div>
      )}

      {mode === "expand" && (
        <>
          {expandAspectOptions.length > 0 ? (
            <div className="flex max-h-[360px] flex-col gap-1 overflow-y-auto">
              {expandAspectOptions.map((ratio) => (
                <Tooltip key={ratio} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "flex h-8 min-w-12 items-center justify-center rounded-md px-2 text-xs transition-colors",
                        expandAspectValue === ratio
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                      onClick={() =>
                        setPaintModelParam(selectedAspectField!.name, ratio)
                      }
                    >
                      {ratio}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {t("workflow.paintNode.expandRatio", "Expanded ratio")}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          ) : selectedSizeField ? (
            <div className="w-64 rounded-md border border-border bg-background p-2 shadow-sm">
              <SizeSelector
                value={expandSizeValue}
                min={selectedSizeField.min}
                max={selectedSizeField.max}
                onChange={(value) =>
                  setPaintModelParam(selectedSizeField.name, value)
                }
              />
            </div>
          ) : selectedWidthField && selectedHeightField ? (
            <div className="flex w-36 flex-col gap-2 rounded-md border border-border bg-muted/30 p-2">
              {[
                {
                  label: "W",
                  field: selectedWidthField,
                  value: expandWidthValue,
                },
                {
                  label: "H",
                  field: selectedHeightField,
                  value: expandHeightValue,
                },
              ].map(({ label, field, value }) => (
                <div key={field.name} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {label}
                    </span>
                    <Input
                      type="number"
                      className="h-7 w-20 px-2 text-xs"
                      value={value}
                      min={field.min}
                      max={field.max}
                      step={field.step ?? 1}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) {
                          setExpandNumericParam(field, next);
                        }
                      }}
                    />
                  </div>
                  {field.min !== undefined && field.max !== undefined && (
                    <Slider
                      value={[value]}
                      min={field.min}
                      max={field.max}
                      step={field.step ?? 1}
                      onValueChange={([next]) =>
                        setExpandNumericParam(field, next)
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {EXPAND_RATIOS.map((ratio) => (
                <Tooltip key={ratio} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "flex h-8 min-w-12 items-center justify-center rounded-md px-2 text-xs transition-colors",
                        expandRatio === ratio
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                      onClick={() => setExpandRatio(ratio)}
                    >
                      {ratio}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {t("workflow.paintNode.expandRatio", "Expanded ratio")}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
        </>
      )}

      {supportsSelectionHistory && (
        <div className="flex flex-col gap-1">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={!historyState.canUndo}
                onClick={() => runSelectionHistoryCommand("undo")}
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span className="sr-only">
                  {t("workflow.paintNode.undo", "Undo")}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("workflow.paintNode.undoShortcut", "Undo (Ctrl+Z)")}
            </TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={!historyState.canRedo}
                onClick={() => runSelectionHistoryCommand("redo")}
              >
                <Redo2 className="h-3.5 w-3.5" />
                <span className="sr-only">
                  {t("workflow.paintNode.redo", "Redo")}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("workflow.paintNode.redoShortcut", "Redo (Ctrl+Y)")}
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      {(mode === "repaint" || mode === "erase" || mode === "region") && (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setClearSignal((value) => value + 1)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="sr-only">
                {t("workflow.paintNode.clearRegion", "Clear region")}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {t("workflow.paintNode.clearRegion", "Clear region")}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  ) : hasFloatingToolControls ? (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute left-3 top-3 z-20 h-9 w-9 rounded-full bg-background/95 shadow-xl backdrop-blur"
          onClick={() => setToolControlsOpen(true)}
        >
          <Settings2 className="h-3.5 w-3.5" />
          <span className="sr-only">
            {t("workflow.paintNode.expandTools", "Expand tools")}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {t("workflow.paintNode.expandTools", "Expand tools")}
      </TooltipContent>
    </Tooltip>
  ) : null;

  const editorStage = (
    <div className="relative flex h-full min-w-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40 p-3">
      <ManualSelectionCanvas
        key={editorSourceUrl}
        referenceImageUrl={editorSourceUrl}
        maskUrl={sourceMatchesSavedSelection ? savedMask : ""}
        mode={canvasMode}
        brushSize={brushSize}
        clearSignal={clearSignal}
        historyCommand={historyCommand}
        showChrome={false}
        segmentPoints={segmentPoints}
        maxWidth={800}
        maxHeight={570}
        onBrushSizeChange={setBrushSize}
        onSelectionChange={handleManualSelectionChange}
        onSegmentChange={handleSmartRegionChange}
        onHistoryStateChange={setHistoryState}
      />
      {floatingToolControls}
    </div>
  );

  const editorContent = (
    <div className="space-y-2">
      <div className="relative grid h-[calc(100vh-180px)] min-h-[420px] max-h-[620px] grid-cols-[44px_minmax(0,1fr)] gap-3 overflow-hidden">
        <div className="flex h-full flex-col items-center gap-1 rounded-lg border border-border bg-background p-1">
          {modeOptions.map((item) => {
            const Icon = item.icon;
            return (
              <ModeButton
                key={item.value}
                label={item.label}
                active={mode === item.value}
                onMouseEnter={() => {
                  if (item.value === mode && hasFloatingToolControls) {
                    setToolControlsOpen(true);
                  }
                }}
                onClick={() => {
                  setMode(item.value);
                  setToolControlsOpen(
                    item.value === "repaint" ||
                      item.value === "erase" ||
                      item.value === "region" ||
                      item.value === "expand",
                  );
                }}
              >
                <Icon className="h-4 w-4" />
              </ModeButton>
            );
          })}
        </div>
        {editorStage}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">
            {selectionFooterTitle}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {selectionFooterHint}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 gap-1.5"
          disabled={requiresSelection && (!selectionReady || selectionSaving)}
          onClick={() => setEditorOpen(false)}
        >
          {selectionSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {t("workflow.paintNode.continueEdit", "Continue")}
        </Button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );

  if (!imageUrl) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        {t(
          "workflow.paintNode.needImage",
          "Connect an extracted frame or upload an image to edit it.",
        )}
      </div>
    );
  }

  return (
    <div
      className="space-y-2 px-3 py-2 nodrag"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="space-y-2 rounded-lg border border-border bg-card p-2">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg border border-primary/35 bg-primary/5 p-2 text-left shadow-sm shadow-primary/10 transition-colors hover:border-primary/55 hover:bg-primary/10"
          onClick={() => setEditorOpen(true)}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
            <ActiveModeIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              {activeMode?.label ??
                t("workflow.paintNode.editImage", "Edit image")}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {selectionReady && savedMask && needsRegion
                ? t("workflow.paintNode.regionReady", "Region ready")
                : t(
                    "workflow.paintNode.openEditorHint",
                    "Open the editor to choose an area, mask, erase, expand, or enhance.",
                  )}
            </span>
          </span>
          <ChevronDown className="-rotate-90 h-4 w-4 shrink-0 text-primary" />
        </button>

        <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
          <DialogContent
            className="max-w-[960px] overflow-hidden"
            onClick={(event) => event.stopPropagation()}
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>
                {t("workflow.paintNode.editorTitle", "Frame editor")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t(
                  "workflow.paintNode.editorDescription",
                  "Choose an area or target frame for the repaint node.",
                )}
              </DialogDescription>
            </DialogHeader>
            {editorContent}
          </DialogContent>
        </Dialog>

        {supportsModelTarget && (
          <div className="space-y-2 rounded-lg border border-border bg-background p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">
                  {t("workflow.paintNode.modelOutput", "Output")}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {t(
                    "workflow.paintNode.modelOutputGenerate",
                    "run selected model",
                  )}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <ModelSelector
                models={modelSelectorOptions}
                value={selectedPaintModelId || undefined}
                onChange={setPaintModel}
              />
              {modelSelectorOptions.length === 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {t(
                    "workflow.paintNode.noMatchedModels",
                    "No matching model is available in the local model cache yet.",
                  )}
                </p>
              )}
              {selectedModelMissing && (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-700 dark:text-amber-300">
                  {t(
                    "workflow.paintNode.missingSelectedModel",
                    "The selected model is not available locally. Choose a supported model from the list before running.",
                  )}
                </p>
              )}
              {selectedModelIncompatible && (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-700 dark:text-amber-300">
                  {t(
                    "workflow.paintNode.incompatibleSelectedModel",
                    "The selected model does not support this paint function. Choose a compatible model from the list before running.",
                  )}
                </p>
              )}
              {selectedPaintModel && configurableModelFields.length > 0 && (
                <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
                  {configurableModelFields.map((field) => (
                    <FormField
                      key={field.name}
                      field={field}
                      value={paintModelParams[field.name]}
                      onChange={(value) =>
                        setPaintModelParam(field.name, value)
                      }
                      formValues={paintModelParams}
                      modelType={selectedPaintModel.type}
                      imageValue={imageUrl || savedSource}
                      onUploadFile={onUploadFile}
                      tooltipDescription
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-center text-xs text-muted-foreground">
            {mode === "repaint"
              ? t(
                  "workflow.paintNode.repaintModelHint",
                  "Runs the selected model with the marked frame, mask when supported, and prompt.",
                )
              : mode === "erase"
                ? t(
                    "workflow.paintNode.eraseHint",
                    "Runs the existing image eraser with the brushed area.",
                  )
                : mode === "expand"
                  ? t(
                      "workflow.paintNode.expandHint",
                      "Outputs the source frame with the selected expand ratio.",
                    )
                  : mode === "region"
                    ? t(
                        "workflow.paintNode.regionOnlyHint",
                        "Outputs only the selected region mask.",
                      )
                    : t(
                        "workflow.paintNode.directToolHint",
                        "Runs the matching free tool when the workflow runs.",
                      )}
          </p>
          <div className="flex justify-center">
            {pendingRequestImage ? (
              <button
                type="button"
                className="group relative h-28 w-28 overflow-hidden rounded-md border border-border bg-muted/40"
                onClick={() => onPreview(pendingRequestImage)}
              >
                <img
                  src={pendingRequestImage}
                  alt=""
                  className={cn(
                    "h-full w-full object-contain",
                    selectionSaving && "opacity-45",
                  )}
                  draggable={false}
                />
                {selectionSaving && (
                  <span className="absolute inset-0 flex items-center justify-center bg-background/45">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </span>
                )}
                <span className="pointer-events-none absolute inset-0 rounded-md ring-0 ring-primary/40 transition group-hover:ring-2" />
              </button>
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-md border border-dashed border-border bg-muted/30 text-muted-foreground">
                <ImageOff className="h-5 w-5" />
              </div>
            )}
          </div>
        </div>
        {savedBbox && needsRegion && (
          <p className="truncate text-[10px] text-muted-foreground/80">
            bbox {savedBbox}
          </p>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </div>
  );
}
