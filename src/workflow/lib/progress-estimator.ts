/**
 * Estimated progress for AI task nodes.
 *
 * Two strategies depending on data availability:
 *
 * 1. KNOWN duration (analysis API returns execution_time > 0):
 *    Strictly linear 0→95% over T, then stepped slowdown 95→99%.
 *
 * 2. UNKNOWN duration (new models without API data):
 *    NProgress-style trickle — each tick adds a decreasing increment
 *    `(1 - n) * factor`, so the bar decelerates naturally and never
 *    reaches 100%.  The tick interval (trickleSpeed) is calibrated
 *    per model type using real median execution times from 898 models.
 *
 * Type-based trickle calibration (median execution times from API data):
 *   content-moderation  2s    | image-to-text    5s   | llm           10s
 *   speech-to-text     12s    | text-to-image   14s   | text-to-audio 20s
 *   upscaler           24s    | image-to-image  26s   | image-effects 35s
 *   lora-support       50s    | portrait-transfer 65s | image-to-video 88s
 *   text-to-video     100s    | video-effects  130s   | video-to-video 163s
 *   video-extend      185s    | digital-human  230s   | motion-control 236s
 *   image-to-3d       297s    | text-to-3d     313s   | training     1051s
 */

import axios from "axios";

const ANALYSIS_BASE =
  "https://api.wavespeed.ai/center/default/api/v1/model_product/analysis";

/** In-memory cache: model_uuid → avg execution time in ms */
const avgTimeCache = new Map<string, number>();

// ─── Type-based median execution times (seconds) ─────────────────────
// Derived from analysis API data across 898 models (681 with data).

const TYPE_MEDIAN_SEC: Record<string, number> = {
  "content-moderation": 2,
  "image-to-text": 5,
  llm: 10,
  "speech-to-text": 12,
  "text-to-image": 14,
  "video-to-text": 14,
  "audio-to-audio": 16,
  "text-to-audio": 20,
  upscaler: 24,
  "image-to-image": 26,
  "video-dubbing": 30,
  "image-effects": 35,
  "ai-remover": 41,
  "lora-support": 50,
  "portrait-transfer": 65,
  "image-to-video": 88,
  "text-to-video": 100,
  "video-effects": 130,
  "video-to-video": 163,
  "video-extend": 185,
  "digital-human": 230,
  "motion-control": 236,
  "image-to-3d": 297,
  "text-to-3d": 313,
  "video-to-audio": 30,
  training: 1051,
};

const GENERIC_MEDIAN_SEC = 30; // fallback if type is unknown

// ─── API helpers ─────────────────────────────────────────────────────

async function fetchExecTime(modelUuid: string): Promise<number> {
  const url = `${ANALYSIS_BASE}/${encodeURIComponent(modelUuid)}`;
  const resp = await axios.get<{
    code: number;
    data?: { execution_time?: number };
  }>(url, { timeout: 5000 });
  const sec = resp.data?.data?.execution_time;
  return typeof sec === "number" && sec > 0 ? sec * 1000 : 0;
}

function baseModelUuid(uuid: string): string | null {
  const parts = uuid.split("/");
  return parts.length > 2 ? parts.slice(0, 2).join("/") : null;
}

// ─── Public: get execution time ──────────────────────────────────────

/**
 * Resolution order:
 *   1. Full UUID from API
 *   2. Base UUID from API
 *   3. null (caller should use trickle fallback)
 */
export async function getAvgExecutionTime(
  modelUuid: string,
): Promise<number | null> {
  const cached = avgTimeCache.get(modelUuid);
  if (cached !== undefined) return cached;

  try {
    let ms = await fetchExecTime(modelUuid);
    if (ms === 0) {
      const base = baseModelUuid(modelUuid);
      if (base) ms = await fetchExecTime(base);
    }
    if (ms > 0) {
      console.log(
        `[ProgressEstimator] "${modelUuid}" → ${ms}ms (linear strategy)`,
      );
      avgTimeCache.set(modelUuid, ms);
      return ms;
    }
    // Mark as "no data" so we don't re-fetch every run
    console.log(
      `[ProgressEstimator] "${modelUuid}" → no data (trickle strategy)`,
    );
    avgTimeCache.set(modelUuid, 0);
    return null;
  } catch (err) {
    console.warn(
      `[ProgressEstimator] "${modelUuid}" → fetch failed (trickle strategy):`,
      err,
    );
    return null;
  }
}

// ─── Strategy 1: linear (known duration) ─────────────────────────────

export function estimateProgress(elapsedMs: number, avgMs: number): number {
  const T = Math.max(avgMs, 1);
  if (elapsedMs <= 0) return 0;

  if (elapsedMs <= T) {
    return (elapsedMs / T) * 95;
  }

  const overtime = elapsedMs - T;
  const thresholds = [0, 0.1 * T, 0.3 * T, 0.6 * T, 1.0 * T];
  const pctValues = [95, 96, 97, 98, 99];

  for (let i = 1; i < thresholds.length; i++) {
    if (overtime < thresholds[i]) {
      const frac =
        (overtime - thresholds[i - 1]) / (thresholds[i] - thresholds[i - 1]);
      return pctValues[i - 1] + frac * (pctValues[i] - pctValues[i - 1]);
    }
  }
  return 99;
}

export function startProgressTimer(
  avgMs: number,
  onProgress: (pct: number, msg?: string) => void,
  modelLabel: string,
  intervalMs = 500,
): () => void {
  const t0 = Date.now();
  const id = setInterval(() => {
    const elapsed = Date.now() - t0;
    const pct = Math.round(estimateProgress(elapsed, avgMs));
    onProgress(pct, `Running ${modelLabel}...`);
  }, intervalMs);
  return () => clearInterval(id);
}

// ─── Strategy 2: NProgress-style trickle (unknown duration) ──────────

/**
 * Get the trickle speed (ms between ticks) for a model type.
 *
 * The NProgress trickle formula `(1-n) * factor` reaches ~80% after
 * roughly `medianSec / tickInterval * factor` ticks.  We calibrate
 * tickInterval so that the bar hits ~80% around the type's median time.
 *
 * Empirically, with factor=0.035 and the NProgress inc formula,
 * it takes ~45 ticks to reach 80%.  So:
 *   tickInterval = medianSec * 1000 / 45
 *
 * Clamped to [200ms, 5000ms] for reasonable UX.
 */
function getTrickleSpeedMs(modelType: string | undefined): number {
  const medianSec = TYPE_MEDIAN_SEC[modelType ?? ""] ?? GENERIC_MEDIAN_SEC;
  const TICKS_TO_80 = 45;
  return Math.max(200, Math.min(5000, (medianSec * 1000) / TICKS_TO_80));
}

/**
 * NProgress-style increment: each call adds a decreasing amount.
 * The bar naturally decelerates and asymptotically approaches 99%.
 */
function trickleIncrement(current: number): number {
  const remaining = 1 - current;
  // Factor between 0.01 and 0.05, scaled by current progress
  const factor = Math.max(0.01, Math.min(0.05, current * 0.08));
  const amount = remaining * factor;
  return Math.min(current + amount, 0.99);
}

/**
 * Start a trickle-based progress timer for models without known duration.
 * Uses NProgress algorithm with type-calibrated tick speed.
 */
export function startTrickleTimer(
  modelType: string | undefined,
  onProgress: (pct: number, msg?: string) => void,
  modelLabel: string,
): () => void {
  const tickMs = getTrickleSpeedMs(modelType);
  let progress = 0;

  const id = setInterval(() => {
    progress = trickleIncrement(progress);
    onProgress(Math.round(progress * 100), `Running ${modelLabel}...`);
  }, tickMs);

  return () => clearInterval(id);
}

/**
 * Infer model type from UUID for trickle calibration.
 * Matches common patterns in model UUIDs.
 */
export function inferModelType(uuid: string): string | undefined {
  const u = uuid.toLowerCase();
  // Check for explicit type segments in UUID
  const typePatterns: [RegExp, string][] = [
    [/text-to-image/, "text-to-image"],
    [/image-to-image|\/edit/, "image-to-image"],
    [/text-to-video/, "text-to-video"],
    [/image-to-video/, "image-to-video"],
    [/video-to-video|video-edit/, "video-to-video"],
    [/video-extend/, "video-extend"],
    [/text-to-audio|text-to-speech|tts/, "text-to-audio"],
    [/speech-to-text|whisper|transcribe/, "speech-to-text"],
    [/voice-clone|audio-to-audio|vocal/, "audio-to-audio"],
    [/video-dubbing|foley|sfx/, "video-dubbing"],
    [/lipsync|digital-human|avatar|talking/, "digital-human"],
    [/image-to-3d/, "image-to-3d"],
    [/text-to-3d/, "text-to-3d"],
    [/upscal|enhance/, "upscaler"],
    [/remov|eras/, "ai-remover"],
    [/lora-train|trainer/, "training"],
    [/lora/, "lora-support"],
    [/motion-control|animate/, "motion-control"],
    [/face-swap|portrait|body-swap/, "portrait-transfer"],
    [/content-moderat/, "content-moderation"],
    [/caption|image-to-text|ocr|qa/, "image-to-text"],
    [/video-to-text|video-caption/, "video-to-text"],
    [/video-effect/, "video-effects"],
    [/image-effect/, "image-effects"],
  ];

  for (const [pattern, type] of typePatterns) {
    if (pattern.test(u)) return type;
  }

  // Fallback heuristics from provider patterns
  if (u.startsWith("video-effects/")) return "video-effects";
  if (u.startsWith("image-effects/")) return "image-effects";

  return undefined;
}
