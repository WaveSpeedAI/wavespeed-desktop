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
  | "match_cut";

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
