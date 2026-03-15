/**
 * Director Rules Validator (Stage 4a) — pure code, zero LLM calls.
 *
 * Validates shot sequences against professional cinematography rules:
 * - 180-degree line consistency
 * - 30-degree rule
 * - Eyeline match
 * - Rhythm monotony detection
 * - Lighting direction consistency within scenes
 * - Cross-scene transition quality
 */
import type { Shot, Scene } from "../types";
import type { DirectorIntent } from "../types/director-intent";

export interface ValidationWarning {
  code: string;
  shot_index: number;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface ValidationResult {
  warnings: ValidationWarning[];
  valid: boolean;
}

/* ── Helpers ───────────────────────────────────────────── */

function groupByScene(shots: Shot[]): Map<string, Shot[]> {
  const map = new Map<string, Shot[]>();
  for (const s of shots) {
    const arr = map.get(s.scene_id) ?? [];
    arr.push(s);
    map.set(s.scene_id, arr);
  }
  return map;
}

/* ── Main Validator ────────────────────────────────────── */

export function validateDirectorRules(
  shots: Shot[],
  scenes: Scene[],
  did?: DirectorIntent,
): ValidationResult {
  const warnings: ValidationWarning[] = [];
  const sorted = [...shots].sort((a, b) => a.sequence_number - b.sequence_number);

  // ── 180-degree line check ──
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.scene_id === prev.scene_id &&
        curr.spatial_continuity?.camera_side &&
        prev.spatial_continuity?.camera_side &&
        curr.spatial_continuity.camera_side !== prev.spatial_continuity.camera_side) {
      if (curr.transition_detail?.type !== "whip_pan") {
        warnings.push({
          code: "180_LINE",
          shot_index: i,
          message: `180° line violation between shot ${prev.sequence_number} and ${curr.sequence_number}`,
          severity: "warning",
        });
      }
    }
  }

  // ── 30-degree rule check ──
  for (let i = 1; i < sorted.length; i++) {
    const delta = sorted[i].spatial_continuity?.angle_delta_from_prev;
    if (delta !== null && delta !== undefined && delta > 0 && delta < 30) {
      warnings.push({
        code: "30_DEGREE",
        shot_index: i,
        message: `30° rule violation: shot ${sorted[i].sequence_number} only ${delta}° from previous`,
        severity: "warning",
      });
    }
  }

  // ── Eyeline match check (consecutive close-ups) ──
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a.shot_type === "close_up" && b.shot_type === "close_up" &&
        a.scene_id === b.scene_id &&
        a.screen_direction?.subject_facing &&
        b.screen_direction?.subject_facing &&
        a.screen_direction.subject_facing === b.screen_direction.subject_facing) {
      warnings.push({
        code: "EYELINE",
        shot_index: i + 1,
        message: `Eyeline mismatch: consecutive close-ups both facing ${a.screen_direction.subject_facing}`,
        severity: "warning",
      });
    }
  }

  // ── Rhythm monotony check (3+ consecutive equal durations) ──
  for (let i = 2; i < sorted.length; i++) {
    if (sorted[i].duration === sorted[i - 1].duration &&
        sorted[i - 1].duration === sorted[i - 2].duration) {
      warnings.push({
        code: "RHYTHM_MONO",
        shot_index: i,
        message: `Monotonous rhythm: 3+ shots with same duration (${sorted[i].duration}s) at shot ${sorted[i].sequence_number}`,
        severity: "info",
      });
    }
  }

  // ── Rhythm role vs duration sanity ──
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.rhythm_role === "peak" && s.duration > 4) {
      warnings.push({
        code: "RHYTHM_PEAK",
        shot_index: i,
        message: `Peak shot ${s.sequence_number} has ${s.duration}s — consider shorter for impact`,
        severity: "info",
      });
    }
    if (s.rhythm_role === "establishing" && s.duration < 2) {
      warnings.push({
        code: "RHYTHM_ESTAB",
        shot_index: i,
        message: `Establishing shot ${s.sequence_number} only ${s.duration}s — may feel rushed`,
        severity: "info",
      });
    }
  }

  // ── Lighting direction consistency within scenes ──
  const sceneGroups = groupByScene(sorted);
  for (const [sceneId, sceneShots] of sceneGroups) {
    const lightDirs = sceneShots
      .map((s) => s.lighting_intent?.key_light_direction)
      .filter(Boolean);
    const unique = new Set(lightDirs);
    if (unique.size > 1) {
      const scene = scenes.find((sc) => sc.scene_id === sceneId);
      warnings.push({
        code: "LIGHT_DIR",
        shot_index: sorted.indexOf(sceneShots[0]),
        message: `Light direction inconsistency in scene "${scene?.name ?? sceneId}": ${[...unique].join(", ")}`,
        severity: "warning",
      });
    }
  }

  // ── Cross-scene hard cut without visual bridge ──
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].scene_id !== sorted[i + 1].scene_id) {
      const td = sorted[i].transition_detail;
      if ((!td || td.type === "cut") && !td?.visual_bridge) {
        warnings.push({
          code: "HARD_CUT_XSCENE",
          shot_index: i,
          message: `Hard cut across scenes at shot ${sorted[i].sequence_number}→${sorted[i + 1].sequence_number} with no visual bridge`,
          severity: "info",
        });
      }
    }
  }

  // ── Duration sum validation (strict) ──
  const targetDuration = did?.target_duration;
  if (targetDuration && targetDuration > 0) {
    const totalDuration = sorted.reduce((sum, s) => sum + s.duration, 0);
    const tolerance = Math.max(1, targetDuration * 0.1); // 10% or 1s
    const diff = Math.abs(totalDuration - targetDuration);
    if (diff > tolerance) {
      warnings.push({
        code: "DURATION_MISMATCH",
        shot_index: -1,
        message: `Duration mismatch: shots total ${totalDuration}s vs target ${targetDuration}s (diff: ${diff.toFixed(1)}s, tolerance: ${tolerance.toFixed(1)}s)`,
        severity: "error",
      });
    } else if (diff > 0.5) {
      warnings.push({
        code: "DURATION_DRIFT",
        shot_index: -1,
        message: `Minor duration drift: shots total ${totalDuration}s vs target ${targetDuration}s (diff: ${diff.toFixed(1)}s)`,
        severity: "info",
      });
    }
  }

  return { warnings, valid: warnings.filter((w) => w.severity === "error").length === 0 };
}
