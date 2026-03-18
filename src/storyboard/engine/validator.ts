/**
 * Director Validator v3.0 — pure code, zero LLM calls.
 *
 * Validates shot sequences against v3.0 quality rules:
 * - Duration sum constraint
 * - Hook segment (first 5s) requirements
 * - Rhythm monotony detection
 * - Same-scene consecutive limit (≤4)
 * - Atmosphere shot presence per beat
 * - Midpoint re-engagement (for 90-120s)
 * - Narrative value distribution
 */
import type { Shot, Beat } from "../types/shot";
import type { SuperDID } from "../types/project";
import { VIDEO_MODEL_CAPABILITIES } from "../models/model-config";

export interface ValidationWarning {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
  /** Shot index or -1 for global */
  shot_index: number;
}

export interface ValidationResult {
  warnings: ValidationWarning[];
  valid: boolean;
}

export function validateShotSequence(
  shots: Shot[],
  beats: Beat[],
  did: SuperDID,
): ValidationResult {
  const warnings: ValidationWarning[] = [];
  const sorted = [...shots].sort((a, b) => a.sequence_number - b.sequence_number);

  // ── 1. Duration sum ──
  const totalDuration = sorted.reduce((s, sh) => s + sh.duration_seconds, 0);
  const tolerance = Math.max(1, did.target_duration * 0.1);
  if (Math.abs(totalDuration - did.target_duration) > tolerance) {
    warnings.push({
      code: "DURATION_SUM",
      message: `Total duration ${totalDuration}s vs target ${did.target_duration}s (tolerance ±${tolerance.toFixed(0)}s)`,
      severity: "error",
      shot_index: -1,
    });
  }

  // ── 1b. Per-shot model duration constraints ──
  const { minDuration, maxDuration } = VIDEO_MODEL_CAPABILITIES;
  for (let i = 0; i < sorted.length; i++) {
    const dur = sorted[i].duration_seconds;
    if (dur < minDuration) {
      warnings.push({
        code: "DURATION_BELOW_MIN",
        message: `Shot #${sorted[i].sequence_number}: ${dur}s < model minimum ${minDuration}s — will be clamped to ${minDuration}s`,
        severity: "error",
        shot_index: i,
      });
    }
    if (dur > maxDuration && !sorted[i].is_atmosphere) {
      warnings.push({
        code: "DURATION_ABOVE_MAX",
        message: `Shot #${sorted[i].sequence_number}: ${dur}s > model maximum ${maxDuration}s — will be segmented or split`,
        severity: "warning",
        shot_index: i,
      });
    }
  }

  // ── 2. Act percentage distribution ──
  const actDurations = new Map<number, number>();
  // Approximate act assignment by position
  let cumDur = 0;
  for (const shot of sorted) {
    cumDur += shot.duration_seconds;
    const position = cumDur / totalDuration;
    let actNum = 1;
    let actCum = 0;
    for (const act of did.three_act_structure) {
      actCum += act.percentage / 100;
      if (position <= actCum) { actNum = act.act_number; break; }
      actNum = act.act_number;
    }
    actDurations.set(actNum, (actDurations.get(actNum) ?? 0) + shot.duration_seconds);
  }
  for (const act of did.three_act_structure) {
    const actual = ((actDurations.get(act.act_number) ?? 0) / totalDuration) * 100;
    if (Math.abs(actual - act.percentage) > 10) {
      warnings.push({
        code: "ACT_BALANCE",
        message: `Act ${act.act_number}: ${actual.toFixed(0)}% vs target ${act.percentage}%`,
        severity: "warning",
        shot_index: -1,
      });
    }
  }

  // ── 3. Hook segment (first 5s) ──
  let hookDur = 0;
  const hookShots: Shot[] = [];
  for (const shot of sorted) {
    hookDur += shot.duration_seconds;
    hookShots.push(shot);
    if (hookDur >= 5) break;
  }
  const hookHasCloseUp = hookShots.some((s) =>
    ["ECU", "CU", "MCU"].includes(s.composition.scale));
  const hookHasIntensity = hookShots.some((s) => s.camera_motion.intensity >= 3);
  if (!hookHasCloseUp && !hookHasIntensity) {
    warnings.push({
      code: "HOOK_WEAK",
      message: "First 5s lacks close-up or high-intensity shot",
      severity: "warning",
      shot_index: 0,
    });
  }

  // ── 4. Climax beat existence ──
  if (did.duration_type !== "micro") {
    const climaxBeat = beats.find((b) => b.type === "climax");
    if (!climaxBeat) {
      warnings.push({
        code: "NO_CLIMAX",
        message: "No climax beat found",
        severity: "warning",
        shot_index: -1,
      });
    } else {
      // Climax should not be in first 30%
      const climaxShots = sorted.filter((s) => climaxBeat.shot_ids.includes(s.shot_id));
      if (climaxShots.length > 0) {
        const climaxStart = sorted.slice(0, sorted.indexOf(climaxShots[0]) + 1)
          .reduce((s, sh) => s + sh.duration_seconds, 0);
        if (climaxStart / totalDuration < 0.3) {
          warnings.push({
            code: "CLIMAX_EARLY",
            message: `Climax at ${((climaxStart / totalDuration) * 100).toFixed(0)}% — should be after 30%`,
            severity: "warning",
            shot_index: sorted.indexOf(climaxShots[0]),
          });
        }
      }
    }
  }

  // ── 5. Rhythm monotony (4+ consecutive same duration) ──
  for (let i = 3; i < sorted.length; i++) {
    const d = sorted[i].duration_seconds;
    if (sorted[i - 1].duration_seconds === d &&
        sorted[i - 2].duration_seconds === d &&
        sorted[i - 3].duration_seconds === d) {
      warnings.push({
        code: "RHYTHM_MONO",
        message: `4+ consecutive ${d}s shots at #${sorted[i].sequence_number}`,
        severity: "warning",
        shot_index: i,
      });
    }
  }

  // ── 6. Duration variance check (consecutive 4+ with variance < 0.3s) ──
  for (let i = 3; i < sorted.length; i++) {
    const window = [sorted[i - 3], sorted[i - 2], sorted[i - 1], sorted[i]];
    const durations = window.map((s) => s.duration_seconds);
    const mean = durations.reduce((a, b) => a + b, 0) / 4;
    const variance = durations.reduce((s, d) => s + (d - mean) ** 2, 0) / 4;
    if (variance < 0.3) {
      warnings.push({
        code: "RHYTHM_FLAT",
        message: `Low duration variance at shots #${sorted[i - 3].sequence_number}-#${sorted[i].sequence_number}`,
        severity: "info",
        shot_index: i,
      });
    }
  }

  // ── 7. Same-scene consecutive limit (>4) ──
  let consecutiveCount = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].scene_id === sorted[i - 1].scene_id) {
      consecutiveCount++;
      if (consecutiveCount > 4) {
        warnings.push({
          code: "SCENE_CONSECUTIVE",
          message: `${consecutiveCount} consecutive shots in same scene at #${sorted[i].sequence_number} — suggest cutaway`,
          severity: "warning",
          shot_index: i,
        });
      }
    } else {
      consecutiveCount = 1;
    }
  }

  // ── 8. Atmosphere shot per beat ──
  for (const beat of beats) {
    const beatShots = sorted.filter((s) => beat.shot_ids.includes(s.shot_id));
    const hasAtmosphere = beatShots.some((s) => s.is_atmosphere);
    if (!hasAtmosphere && beatShots.length >= 3) {
      warnings.push({
        code: "NO_BREATHING",
        message: `Beat "${beat.type}" (${beat.beat_id}) has no atmosphere shot — add visual breathing`,
        severity: "info",
        shot_index: -1,
      });
    }
  }

  // ── 9. Midpoint re-engagement (90-120s) ──
  if (did.duration_type === "full") {
    const midpointBeat = beats.find((b) => b.type === "midpoint");
    if (!midpointBeat) {
      warnings.push({
        code: "NO_MIDPOINT",
        message: "90-120s video requires midpoint re-engagement beat",
        severity: "warning",
        shot_index: -1,
      });
    }
  }

  // ── 10. Narrative value distribution ──
  if (sorted.length > 5) {
    // Check every 20-30s has at least one high-value shot
    let windowStart = 0;
    let lastHighAt = 0;
    for (let i = 0; i < sorted.length; i++) {
      windowStart += sorted[i].duration_seconds;
      if (sorted[i].narrative_value === "high") lastHighAt = windowStart;
      if (windowStart - lastHighAt > 30) {
        warnings.push({
          code: "VALUE_GAP",
          message: `No high-value shot for 30+ seconds around #${sorted[i].sequence_number}`,
          severity: "info",
          shot_index: i,
        });
        lastHighAt = windowStart; // Reset to avoid repeated warnings
      }
    }
  }

  return {
    warnings,
    valid: warnings.filter((w) => w.severity === "error").length === 0,
  };
}
