/**
 * Shot (镜头) — the core entity of the storyboard system.
 */

/**
 * Strategy types for generation routing:
 * A1 = same-scene continuous action (frame chain)
 * A2 = same-scene angle change (no frame chain)
 * B  = same-scene long shot (segmented with frame chain)
 * C  = cross-scene short (fully independent)
 * D  = cross-scene long (first segment independent, rest chained)
 */
export type StrategyType = "A1" | "A2" | "B" | "C" | "D";

export interface ShotStrategy {
  strategy_type: StrategyType;
  use_frame_chain: boolean;
  frame_chain_source: string | null; // previous shot's last_frame_path
  character_refs: string[];          // character anchor image paths
  scene_ref: string | null;          // scene anchor image path
  style_ref: string | null;          // global style reference (future: style embedding)
  segments: number;                  // >1 for B/D types
  correction_interval: number;       // every N segments do a correction pass
  is_scene_anchor_shot: boolean;     // first shot in scene → writes anchor_image
  parallel_eligible: boolean;        // C and A2 can run in parallel
}

export type ShotType =
  | "wide"
  | "medium"
  | "close_up"
  | "extreme_close_up"
  | "over_shoulder"
  | "pov"
  | "aerial";

export type CameraMovement =
  | "static"
  | "pan_left"
  | "pan_right"
  | "tilt_up"
  | "tilt_down"
  | "dolly_in"
  | "dolly_out"
  | "tracking"
  | "handheld";

export type EmotionTag =
  | "tense"
  | "joyful"
  | "melancholy"
  | "neutral"
  | "explosive"
  | "mysterious"
  | "romantic"
  | "horror";

export type TransitionType =
  | "cut"
  | "fade"
  | "dissolve"
  | "wipe"
  | "match_cut"
  | "whip_pan"
  | "dip_to_black"
  | "sound_bridge";

export type GenerationStatus =
  | "pending"
  | "generating"
  | "done"
  | "failed"
  | "dirty";

export interface GeneratedAssets {
  video_path: string | null;
  video_versions: string[];
  selected_version: number;
  dialogue_audio: string | null;
  narration_audio: string | null;
  sfx_audio: string | null;
  last_frame_path: string | null;
  thumbnail: string | null;
}

/** Base frame request — describes what the first frame of this shot should look like */
export interface BaseFrameRequest {
  subject_names: string[];
  pose_or_angle: string;
  scene_context: string;
}

/** V5: Motion vector for a subject — drives mid-action keyframe generation */
export interface SubjectMotion {
  /** Subject name (must match character name) */
  subject: string;
  /** Mid-action description — the motion frozen at its midpoint */
  mid_action: string;
  /** Direction of motion */
  direction: string;
  /** Intensity 1-5 (1=subtle, 5=explosive) */
  intensity: number;
  /** Which mutable state to use (e.g. "battle-damaged torn") */
  clothing_state?: string;
  /** Expression state (e.g. "screaming rage") */
  expression_state?: string;
}

/** V5: Environmental motion — fills visual tension in the frame */
export interface EnvMotion {
  /** Description of environmental dynamics */
  description: string;
  /** Direction of environmental motion */
  direction: string;
}

/* ── V6: Cinematography Types ──────────────────────────── */

export type CompositionRule =
  | "rule_of_thirds"
  | "center"
  | "diagonal"
  | "symmetry"
  | "frame_within_frame"
  | "golden_ratio";

export type SubjectPlacement =
  | "left_third"
  | "right_third"
  | "center"
  | "bottom_third"
  | "top_third"
  | "full_frame";

export type LightDirection =
  | "screen_left"
  | "screen_right"
  | "top"
  | "back"
  | "bottom"
  | "front";

export type LightStyle =
  | "rembrandt"
  | "silhouette"
  | "flat"
  | "chiaroscuro"
  | "motivated_practical";

export type RhythmRole =
  | "establishing"
  | "building"
  | "peak"
  | "release"
  | "breathing";

export interface FocalLengthIntent {
  equivalent_mm: number;
  purpose: string;
  depth_of_field: "shallow" | "moderate" | "deep";
}

export interface ShotComposition {
  rule: CompositionRule;
  subject_placement: SubjectPlacement;
  leading_lines: string | null;
  negative_space: string | null;
}

export interface ScreenDirection {
  subject_facing: "left" | "right";
  movement_direction: "left_to_right" | "right_to_left" | "toward_camera" | "away";
}

export interface SpatialContinuity {
  /** Which side of the 180-degree line the camera is on */
  camera_side: "A" | "B";
  /** Angle delta from previous shot in degrees (for 30-degree rule) */
  angle_delta_from_prev: number | null;
  /** What the subject is looking at (for eyeline match) */
  eyeline_target: string | null;
}

export interface TransitionDetail {
  type: TransitionType;
  /** Match element for match_cut (e.g. "blood droplet → rain drop") */
  match_element: string | null;
  /** Visual bridge description for cross-scene transitions */
  visual_bridge: string | null;
}

export interface LightingIntent {
  key_light_direction: LightDirection;
  style: LightStyle;
  /** What motivates the light (e.g. "lantern on left wall") */
  motivation: string;
}

export interface Shot {
  shot_id: string;
  project_id: string;
  sequence_number: number;
  act_number: number;
  scene_id: string;
  character_ids: string[];
  shot_type: ShotType;
  camera_movement: CameraMovement;
  duration: number; // 4-12 seconds
  dialogue: string | null;
  dialogue_character: string | null;
  narration: string | null;
  action_description: string;
  emotion_tag: EmotionTag;
  generation_prompt: string;
  negative_prompt: string;
  transition_to_next: TransitionType;
  is_key_shot: boolean;
  dependencies: string[]; // shot_ids
  generation_status: GenerationStatus;
  generated_assets: GeneratedAssets;
  qc_score: number;
  qc_warnings: string[];
  /** Lazy generation: what the first frame should look like (from Stage 3 LLM) */
  base_frame_request?: BaseFrameRequest;
  /** V5: Per-subject motion vectors */
  subject_motions?: SubjectMotion[];
  /** V5: Environmental motion */
  env_motion?: EnvMotion;
  // Strategy fields (populated before generation)
  strategy?: ShotStrategy;
  user_strategy_override?: Partial<ShotStrategy>;

  // ── V6: Cinematography fields ──
  /** Focal length intent — lens choice with purpose */
  focal_length_intent?: FocalLengthIntent;
  /** Composition rule and subject placement */
  composition?: ShotComposition;
  /** Role in the rhythm/pacing curve */
  rhythm_role?: RhythmRole;
  /** Index into DID.emotional_arc.beats */
  emotional_beat_index?: number;
  /** Screen direction for 180-degree line management */
  screen_direction?: ScreenDirection;
  /** Spatial continuity constraints */
  spatial_continuity?: SpatialContinuity;
  /** Rich transition detail (replaces simple transition_to_next for rendering) */
  transition_detail?: TransitionDetail;
  /** Per-shot lighting intent */
  lighting_intent?: LightingIntent;
}

export interface Scene {
  scene_id: string;
  project_id: string;
  name: string;
  description: string;
  /** English visual prompt for scene image generation */
  visual_prompt: string;
  /** Negative prompt to avoid unwanted elements in scene */
  visual_negative: string;
  lighting: string;
  weather: string;
  time_of_day: string;
  mood: string;
  anchor_image: string | null;
  version: number;
  /** V5: Spatial perspective constraint for affine transforms */
  perspective_hint?: string;

  // ── V6: Visual continuity fields ──
  /** Color temperature — must align with DID.visual_identity.color_palette */
  color_temperature?: "warm" | "neutral" | "cool";
  /** Primary light source position and type */
  dominant_light_source?: string;
  /** Weather continuity marker (prevents rain in some shots, sun in others) */
  weather_continuity?: string;
  /** Visual hint for how this scene ends (for cross-scene bridging) */
  exit_visual_hint?: string;
  /** Visual hint for how this scene opens (for cross-scene bridging) */
  entry_visual_hint?: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: "frame_chain" | "narrative_order";
}

export interface EditHistoryEntry {
  edit_id: string;
  project_id: string;
  timestamp: number;
  action_type: string;
  target_entity: string;
  before_state: unknown;
  after_state: unknown;
  dirty_propagation: string[];
}
