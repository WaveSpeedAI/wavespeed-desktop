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
  // Strategy fields (populated before generation)
  strategy?: ShotStrategy;
  user_strategy_override?: Partial<ShotStrategy>;
}

export interface Scene {
  scene_id: string;
  project_id: string;
  name: string;
  description: string;
  lighting: string;
  weather: string;
  time_of_day: string;
  mood: string;
  anchor_image: string | null;
  version: number;
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
