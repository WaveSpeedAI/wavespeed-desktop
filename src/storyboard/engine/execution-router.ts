/**
 * Execution Router v3.0 — pure code, zero LLM calls.
 *
 * Determines the optimal generation path for each shot:
 *   P1: first frame → i2v (default, most shots)
 *   P2: first frame + end frame → i2v (clear start/end, ≤6s)
 *   P3: composite first frame → i2v (3+ chars forced, 2 char fallback)
 *   P4: static image + Ken Burns (atmosphere, establishing, low risk)
 *   P5: segmented i2v + stitch (>7s with internal rhythm)
 *
 * Also handles:
 * - Scene type annotation (A/B/C)
 * - Scheduling (parallel vs sequential)
 * - Dependency graph construction
 */
import type { Shot, ShotExecutionPlan, DependencyEdge } from "../types/shot";
import {
  VIDEO_MODEL_CAPABILITIES,
  clampDuration,
  getSegmentationThreshold,
  getTripleSegmentThreshold,
} from "../models/model-config";

/* ── Scene Type Annotation ─────────────────────────────── */

/**
 * Annotate each shot with its scene type relative to the previous shot.
 * A = same scene + continuous action (frame chain)
 * B = different scene (cross-scene)
 * C = same scene + big angle/scale change (independent)
 */
export function annotateSceneTypes(shots: Shot[]): Shot[] {
  const sorted = [...shots].sort((a, b) => a.sequence_number - b.sequence_number);

  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      sorted[i].scene_type = "B"; // First shot is always independent
      continue;
    }

    const prev = sorted[i - 1];
    const curr = sorted[i];

    if (curr.scene_id !== prev.scene_id) {
      curr.scene_type = "B"; // Different scene
    } else {
      // Same scene — check if continuous action or angle change
      const hasCarryOver = curr.continuity.carry_over_subject !== null;
      const scaleChange = getScaleDistance(prev.composition.scale, curr.composition.scale);
      const angleChange = prev.composition.camera_angle !== curr.composition.camera_angle;

      if (hasCarryOver && scaleChange <= 2 && !angleChange) {
        curr.scene_type = "A"; // Continuous action
      } else {
        curr.scene_type = "C"; // Big change within same scene
      }
    }
  }

  return sorted;
}

const SCALE_ORDER = ["ECU", "CU", "MCU", "MS", "MLS", "LS", "ELS"];

function getScaleDistance(a: string, b: string): number {
  const ia = SCALE_ORDER.indexOf(a);
  const ib = SCALE_ORDER.indexOf(b);
  if (ia === -1 || ib === -1) return 3;
  return Math.abs(ia - ib);
}

/* ── Execution Path Router ─────────────────────────────── */

/**
 * Route each shot to its optimal execution path.
 * Pure code decision tree — no LLM.
 *
 * Also enforces model duration constraints:
 * - Clamps duration to [minDuration, maxDuration]
 * - Shots exceeding maxDuration get P5 (segmented) path
 */
export function routeExecutionPath(shot: Shot): ShotExecutionPlan {
  const { minDuration, maxDuration } = VIDEO_MODEL_CAPABILITIES;
  const dur = shot.duration_seconds;
  const subjectCount = shot.subjects.length;

  // P4: atmosphere shot → static + Ken Burns (zero risk, zero retry budget)
  // P4 doesn't go through i2v, so no duration constraint needed
  if (shot.is_atmosphere || subjectCount === 0) {
    return {
      path: "P4",
      need_end_frame: false,
      need_composite: false,
      segmented: false,
      segment_count: 1,
      safe_max_duration: dur,
      fallback_path: "P4",
    };
  }

  // P5: exceeds model max → forced segmented i2v
  // Each segment must be within [minDuration, maxDuration]
  if (dur > maxDuration) {
    const segCount = Math.ceil(dur / maxDuration);
    const segDur = Math.ceil(dur / segCount);
    return {
      path: "P5",
      need_end_frame: false,
      need_composite: subjectCount >= 3,
      segmented: true,
      segment_count: segCount,
      safe_max_duration: Math.min(segDur, maxDuration),
      fallback_path: "P1",
    };
  }

  // P5: above segmentation threshold with internal rhythm change → segmented i2v (optional, for quality)
  const segThreshold = getSegmentationThreshold();
  const tripleThreshold = getTripleSegmentThreshold();
  if (dur > segThreshold) {
    const segCount = dur > tripleThreshold ? 3 : 2;
    const segDur = Math.ceil(dur / segCount);
    // Ensure each segment respects model minimum
    const safeSegDur = Math.max(minDuration, Math.min(segDur + 0.5, maxDuration));
    return {
      path: "P5",
      need_end_frame: false,
      need_composite: subjectCount >= 3,
      segmented: true,
      segment_count: segCount,
      safe_max_duration: safeSegDur,
      fallback_path: "P1",
    };
  }

  // P3: 3+ characters → forced composite
  if (subjectCount >= 3) {
    return {
      path: "P3",
      need_end_frame: false,
      need_composite: true,
      segmented: false,
      segment_count: 1,
      safe_max_duration: clampDuration(dur),
      fallback_path: "P1",
    };
  }

  // P2: type A chain + short duration + has clear end state → first + end frame
  // Threshold: half of maxDuration (short enough for reliable end-frame matching)
  const p2MaxDuration = Math.round(maxDuration / 2);
  if (shot.scene_type === "A" && dur <= p2MaxDuration) {
    return {
      path: "P2",
      need_end_frame: true,
      need_composite: false,
      segmented: false,
      segment_count: 1,
      safe_max_duration: clampDuration(dur),
      fallback_path: "P1",
    };
  }

  // P1: default — first frame → i2v
  return {
    path: "P1",
    need_end_frame: false,
    need_composite: false,
    segmented: false,
    segment_count: 1,
    safe_max_duration: clampDuration(dur),
    fallback_path: "P4",
  };
}

/**
 * Route all shots and annotate execution plans.
 * Also clamps shot durations to model-valid range.
 */
export function routeAllShots(shots: Shot[]): Shot[] {
  // First: clamp all durations to model-valid range
  const clamped = clampShotDurations(shots);
  // Then: annotate scene types
  const annotated = annotateSceneTypes(clamped);
  // Finally: route execution paths
  for (const shot of annotated) {
    shot.execution_plan = routeExecutionPath(shot);
  }
  return annotated;
}

/**
 * Clamp all shot durations to the model's valid range.
 * Shots below minimum get bumped up; shots above maximum get split.
 * This is a critical safety layer — LLM may generate invalid durations.
 */
export function clampShotDurations(shots: Shot[]): Shot[] {
  const { minDuration, maxDuration } = VIDEO_MODEL_CAPABILITIES;
  const result: Shot[] = [];

  for (const shot of shots) {
    // Atmosphere shots (P4 path) don't go through i2v — no duration constraint
    if (shot.is_atmosphere) {
      result.push(shot);
      continue;
    }

    if (shot.duration_seconds < minDuration) {
      // Clamp up to minimum
      result.push({ ...shot, duration_seconds: minDuration });
    } else if (shot.duration_seconds > maxDuration) {
      // Split into multiple shots, each within valid range
      const splitCount = Math.ceil(shot.duration_seconds / maxDuration);
      const splitDur = Math.round(shot.duration_seconds / splitCount);
      const safeDur = Math.max(minDuration, Math.min(splitDur, maxDuration));

      for (let i = 0; i < splitCount; i++) {
        const isLast = i === splitCount - 1;
        const dur = isLast
          ? shot.duration_seconds - safeDur * (splitCount - 1)
          : safeDur;
        result.push({
          ...shot,
          shot_id: i === 0 ? shot.shot_id : `${shot.shot_id}_split_${i}`,
          duration_seconds: Math.max(minDuration, dur),
          sequence_number: shot.sequence_number + i * 0.1, // Will be re-sequenced
        });
      }
    } else {
      result.push(shot);
    }
  }

  // Re-sequence after potential splits
  result.sort((a, b) => a.sequence_number - b.sequence_number);
  result.forEach((s, i) => { s.sequence_number = i + 1; });

  return result;
}

/* ── Dependency Graph ──────────────────────────────────── */

/**
 * Build dependency edges between shots.
 * Type A chains create frame_chain dependencies.
 * All adjacent shots have narrative_order dependencies.
 */
export function buildDependencyEdges(shots: Shot[]): DependencyEdge[] {
  const sorted = [...shots].sort((a, b) => a.sequence_number - b.sequence_number);
  const edges: DependencyEdge[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    // Narrative order (always)
    edges.push({ from: prev.shot_id, to: curr.shot_id, type: "narrative_order" });

    // Frame chain (type A only)
    if (curr.scene_type === "A") {
      edges.push({ from: prev.shot_id, to: curr.shot_id, type: "frame_chain" });
    }
  }

  return edges;
}

/* ── Scheduling ────────────────────────────────────────── */

export interface ScheduleResult {
  /** Shots that can run in parallel (P1, P4, type B/C) */
  parallel: Shot[];
  /** Shots that must run sequentially (type A chains, P2, P5 segments) */
  sequential: Shot[];
  /** Priority queue for scheduling */
  priorityQueue: Shot[];
}

/**
 * Build execution schedule.
 *
 * Priority order:
 * 1. Shots that can form continuous playable segments with already-done shots
 * 2. narrative_value = "high" shots
 * 3. Type A chain next-in-line
 * 4. Everything else
 */
export function buildSchedule(shots: Shot[]): ScheduleResult {
  const sorted = [...shots].sort((a, b) => a.sequence_number - b.sequence_number);
  const parallel: Shot[] = [];
  const sequential: Shot[] = [];

  // Identify type A chains
  const chains: Shot[][] = [];
  let currentChain: Shot[] = [];

  for (const shot of sorted) {
    if (shot.scene_type === "A") {
      currentChain.push(shot);
    } else {
      if (currentChain.length > 0) {
        chains.push(currentChain);
        currentChain = [];
      }
      // B and C types can be parallel
      if (shot.execution_plan?.path === "P4" || shot.scene_type === "B" || shot.scene_type === "C") {
        parallel.push(shot);
      } else {
        sequential.push(shot);
      }
    }
  }
  if (currentChain.length > 0) chains.push(currentChain);

  // Type A chains are sequential within chain, but chains can be parallel
  for (const chain of chains) {
    sequential.push(...chain);
  }

  // Priority queue
  const priorityQueue = [...sorted].sort((a, b) => {
    // High narrative value first
    const valOrder = { high: 0, medium: 1, low: 2 };
    const va = valOrder[a.narrative_value] ?? 1;
    const vb = valOrder[b.narrative_value] ?? 1;
    if (va !== vb) return va - vb;
    // Then by sequence number
    return a.sequence_number - b.sequence_number;
  });

  return { parallel, sequential, priorityQueue };
}
