/**
 * Core data models for the AI Storyboard system.
 * Maps to the full spec: Project, Character, Scene, Shot, DependencyGraph, EditHistory.
 */

export type ProjectMode = "lite" | "pro";
export type ProjectStatus =
  | "idle"
  | "creating"
  | "ready"
  | "generating"
  | "assembling"
  | "done";

export interface StyleProfile {
  visual_style: string;
  color_tone: string;
  aspect_ratio: "16:9" | "9:16" | "1:1";
  reference_images: string[];
}

export interface AudioProfile {
  bgm_style: string;
  narration_voice: string | null;
  sfx_density: "minimal" | "normal" | "rich";
}

export interface Project {
  project_id: string;
  name: string;
  mode: ProjectMode;
  status: ProjectStatus;
  style_profile: StyleProfile;
  audio_profile: AudioProfile;
  target_duration: number; // seconds
  created_at: number;
  updated_at: number;
}

export type CharacterStatus = "alive" | "dead" | "absent";

export interface AnchorImages {
  front: string | null;
  side: string | null;
  full_body: string | null;
  /** Battle pose reference image (used as edit base for action shots) */
  battle: string | null;
}

/** Immutable visual traits — locked IP core that never changes across shots */
export interface ImmutableTraits {
  /** Core visual anchor keywords (e.g. "orange spiky hair, Rinnegan eyes") */
  core_visual: string;
  /** Art style constraint (e.g. "anime cel-shaded", "photorealistic") */
  art_style: string;
}

/** Mutable state pool — pre-defined visual states that can change per shot */
export interface MutableStates {
  clothing: string[];    // e.g. ["pristine uniform", "battle-damaged torn"]
  expression: string[];  // e.g. ["stoic calm", "screaming rage", "smirking"]
  pose_class: string[];  // e.g. ["standing neutral", "fighting stance", "mid-air leap"]
}

export interface Character {
  character_id: string;
  project_id: string;
  name: string;
  /** English visual prompt for image generation (global anchor) */
  visual_description: string;
  /** Negative prompt to avoid visual errors for this character */
  visual_negative: string;
  personality: string;
  role_in_story: string;
  /** Signature abilities and combat approach */
  fighting_style: string;
  voice_id: string | null;
  anchor_images: AnchorImages;
  status: CharacterStatus;
  version: number;
  /** V5: Immutable visual traits — locked IP core */
  immutable_traits?: ImmutableTraits;
  /** V5: Mutable state pool — pre-defined visual variations */
  mutable_states?: MutableStates;
}
