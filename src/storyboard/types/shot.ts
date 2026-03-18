/**
 * Shot & Beat types for AI Director System v3.0.
 *
 * Key design decisions:
 * - No precise cinematography params (model can't execute 85mm / key light 45°)
 * - Camera motion as intensity 1-5, not specific movement names
 * - Prompt token budget system instead of free-form prompts
 * - Duration-aware i2v prompt segmentation
 */

/* ── Beat (narrative rhythm unit) ──────────────────────── */

export interface Beat {
  beat_id: string;
  type: "hook" | "setup" | "build" | "complication" | "midpoint" | "escalation" | "climax" | "release" | "payoff";
  /** Time range within the full video, e.g. "0:00-0:08" */
  time_range: string;
  /** What the audience should feel */
  audience_feeling: string;
  shot_ids: string[];
}

/* ── Scene Adjacency Type ──────────────────────────────── */

/**
 * A = same scene, continuous action (frame chain)
 * B = different scene (cross-scene transition)
 * C = same scene, big angle/scale change (independent)
 */
export type SceneType = "A" | "B" | "C";

/* ── Execution Path ────────────────────────────────────── */

/**
 * P1 = first frame → i2v (default, most shots)
 * P2 = first frame + end frame → i2v (clear start/end state, ≤6s)
 * P3 = composite first frame → i2v (3+ characters forced, 2 char fallback)
 * P4 = static image + Ken Burns (atmosphere/establishing, zero risk)
 * P5 = segmented i2v + stitch (>7s with internal rhythm change)
 */
export type ExecutionPath = "P1" | "P2" | "P3" | "P4" | "P5";

/* ── Shot Subject ──────────────────────────────────────── */

export interface ShotSubject {
  character_id: string;
  state_id: string;           // which mutable_state to use
  /** ≤15 tokens */
  action: string;
  screen_position: "left" | "center" | "right" | "background";
  face_visibility: "full" | "partial" | "hidden";
}

/* ── Shot Composition ──────────────────────────────────── */

export type ShotScale = "ECU" | "CU" | "MCU" | "MS" | "MLS" | "LS" | "ELS";
export type Framing = "center" | "rule_of_thirds_left" | "rule_of_thirds_right" | "symmetry" | "over_shoulder";
export type CameraAngle = "eye_level" | "low_angle" | "high_angle" | "birds_eye" | "dutch";

export interface ShotComposition {
  scale: ShotScale;
  framing: Framing;
  camera_angle: CameraAngle;
}

/* ── Camera Motion ─────────────────────────────────────── */

export type CameraMotionType =
  | "static"
  | "pan"
  | "tilt"
  | "dolly_in"
  | "dolly_out"
  | "tracking"
  | "crane"
  | "handheld";

export interface CameraMotion {
  type: CameraMotionType;
  /** 1-5: 1=subtle, 5=explosive */
  intensity: number;
}

/* ── Transition ────────────────────────────────────────── */

export type TransitionType = "cut" | "dissolve" | "crossfade" | "fade" | "wipe" | "match_cut";

/* ── Continuity ────────────────────────────────────────── */

export interface ShotContinuity {
  /** Character carried over from previous shot */
  carry_over_subject: string | null;
  /** Screen direction match with previous shot */
  screen_direction_match: boolean;
  /** Motion direction continuity */
  motion_direction: "left_to_right" | "right_to_left" | "toward" | "away" | "static" | null;
}

/* ── Generation Status ─────────────────────────────────── */

export type GenerationStatus =
  | "pending"       // not yet generated
  | "generating"    // currently generating
  | "done"          // successfully generated
  | "failed"        // generation failed
  | "dirty";        // needs regeneration (upstream changed)

/* ── Generated Assets ──────────────────────────────────── */

export interface GeneratedAssets {
  /** First frame (keyframe) image URL */
  first_frame: string | null;
  /** End frame image URL (for P2 path) */
  end_frame: string | null;
  /** Generated video URL */
  video_url: string | null;
  /** Video versions for A/B selection */
  video_versions: string[];
  /** Thumbnail for UI display */
  thumbnail: string | null;
}

/* ── Shot Execution Plan ───────────────────────────────── */

export interface ShotExecutionPlan {
  path: ExecutionPath;
  need_end_frame: boolean;
  need_composite: boolean;
  segmented: boolean;
  segment_count: number;
  /** Max safe duration for single i2v call */
  safe_max_duration: number;
  fallback_path: ExecutionPath;
}

/* ── Shot ──────────────────────────────────────────────── */

export interface Shot {
  shot_id: string;
  project_id: string;
  beat_id: string;
  scene_id: string;
  sequence_number: number;
  /** Duration in seconds (MUST be within model range: 4-12s for i2v, unconstrained for P4/atmosphere) */
  duration_seconds: number;
  /** Narrative importance */
  narrative_value: "high" | "medium" | "low";
  /** Is this an atmosphere/breathing shot (no characters) */
  is_atmosphere: boolean;

  composition: ShotComposition;
  subjects: ShotSubject[];
  camera_motion: CameraMotion;

  transition_in: TransitionType;
  transition_out: TransitionType;
  continuity: ShotContinuity;

  /** Mood keywords for prompt assembly */
  mood_keywords: string[];
  /** ≤30 tokens, cinematic description for prompt polish */
  visual_poetry: string;
  /** ≤15 tokens, the most tense moment in this shot (for first frame) */
  tension_moment: string;

  // ── Computed by engine (not LLM) ──
  scene_type: SceneType | null;
  execution_plan: ShotExecutionPlan | null;

  // ── Prompt Translation output ──
  /** Assembled execution prompt for first frame generation */
  first_frame_prompt: string;
  /** Assembled execution prompt for i2v generation (with time segments) */
  i2v_prompt: string;
  /** Negative prompt */
  negative_prompt: string;

  // ── Generation state ──
  generation_status: GenerationStatus;
  generated_assets: GeneratedAssets;
  qc_warnings: string[];
}

/* ── Dependency Edge ───────────────────────────────────── */

export interface DependencyEdge {
  from: string;
  to: string;
  type: "frame_chain" | "narrative_order";
}
