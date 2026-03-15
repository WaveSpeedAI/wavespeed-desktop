/**
 * Director's Intent Document (DID) — the global constraint anchor
 * that flows through every pipeline stage.
 *
 * Generated after Stage 0 (Super Router), consumed by all subsequent stages.
 * This is the "director's statement" that every department must follow.
 */

/* ── Emotional Arc ─────────────────────────────────────── */

export type ArcStructure =
  | "buildup-climax-resolve"
  | "slow-burn"
  | "cold-open-escalate"
  | "cyclic"
  | "bookend"
  | "crescendo";

export interface EmotionalBeat {
  beat_name: string;
  /** Normalized position in total duration (0.0 ~ 1.0) */
  position: number;
  /** Intensity 1-10 */
  intensity: number;
  target_emotion: string;
}

export interface EmotionalArc {
  structure: ArcStructure;
  beats: EmotionalBeat[];
}

/* ── Visual Identity ───────────────────────────────────── */

export interface ColorPalette {
  dominant: string;
  accent: string;
  shadow_tone: string;
}

export interface VisualIdentity {
  color_palette: ColorPalette;
  lighting_philosophy: string;
  art_style_anchor: string;
  era_and_texture: string;
}

/* ── Rhythm Blueprint ──────────────────────────────────── */

export type PacingStrategy =
  | "gradual_acceleration"
  | "pulse"
  | "steady"
  | "bookend_slow"
  | "wave";

export interface RhythmBlueprint {
  overall_tempo: string;
  pacing_strategy: PacingStrategy;
  /** Textual breath pattern, e.g. "long-long-medium-short-short-burst-long" */
  breath_pattern: string;
  /** Target duration in seconds — echoed from user input for validation */
  target_duration_seconds?: number;
}

/* ── Lens Philosophy ───────────────────────────────────── */

export interface LensPhilosophy {
  default_lens_mm: number;
  wide_usage: string;
  tele_usage: string;
  style_reference: string;
}

/* ── Sound Design Brief ────────────────────────────────── */

export interface SoundDesignBrief {
  ambient_base: string;
  signature_sounds: string[];
  music_direction: string;
}

/* ── Director's Intent Document ────────────────────────── */

export interface DirectorIntent {
  emotional_arc: EmotionalArc;
  visual_identity: VisualIdentity;
  rhythm_blueprint: RhythmBlueprint;
  lens_philosophy: LensPhilosophy;
  sound_design_brief: SoundDesignBrief;
  /** Target duration in seconds — sacred constraint from user input */
  target_duration?: number;
}
