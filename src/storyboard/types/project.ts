/**
 * Core data models for the AI Director System v3.0.
 *
 * Design constitution:
 * - Execution layer must be minimal
 * - Consistency priority: identity > outfit > style/color > lighting > spatial direction
 * - Architecture is determined by model capabilities, not the other way around
 */

/* ── Project ───────────────────────────────────────────── */

export type ProjectStatus =
  | "idle"
  | "intent"       // understanding user input
  | "planning"     // LLM calls 1-3
  | "preview"      // Animatic — user confirms
  | "generating"   // i2v video generation
  | "complete";    // final video ready

export type DurationType =
  | "micro"        // 0-15s: hook + payoff
  | "short"        // 15-45s: hook → build → payoff
  | "medium"       // 45-90s: hook → setup → complication → payoff
  | "full";        // 90-120s: full 7-beat structure

export interface Project {
  project_id: string;
  name: string;
  status: ProjectStatus;
  duration_type: DurationType;
  target_duration: number; // seconds, sacred constraint
  created_at: number;
  updated_at: number;
  /** Snapshot ID for rollback from GENERATING → PREVIEW */
  preview_snapshot_id: string | null;
}

/* ── Super DID (Call 1 output) ─────────────────────────── */

export interface HookStrategy {
  type: "conflict" | "mystery" | "spectacle" | "emotion" | "question";
  description: string;
}

export interface ActStructure {
  act_number: number;
  percentage: number;       // sum of all acts = 100 ± 5
  goal: string;
  memory_hook: string;      // the moment audience remembers
}

export interface CinematicIdentity {
  art_style: string;
  color_palette: string[];
  visual_mood: string;
  /** ≤40 tokens, prefixed to EVERY generation prompt */
  global_prompt_prefix: string;
}

export interface RetentionMechanism {
  type: string;
  description: string;
}

export interface SuperDID {
  premise: string;                    // one-sentence core
  duration_type: DurationType;
  target_duration: number;
  hook_strategy: HookStrategy;
  three_act_structure: ActStructure[];
  cinematic_identity: CinematicIdentity;
  character_count: number;
  scene_count: number;
  retention_mechanism: RetentionMechanism;
}

/* ── Character (Call 2 output) ─────────────────────────── */

export interface ImmutableTraits {
  /** ≤30 tokens */
  face_description: string;
  /** ≤20 tokens */
  core_outfit: string;
  signature_features: string;
}

export interface MutableState {
  state_id: string;
  name: string;
  description: string;
}

export interface Character {
  character_id: string;
  project_id: string;
  name: string;
  role: "protagonist" | "antagonist" | "supporting" | "extra";
  immutable_traits: ImmutableTraits;
  mutable_states: MutableState[];
  /** Prompt for generating turnaround sheet (front + 3/4 + side, white bg) */
  turnaround_prompt: string;
  /** Generated turnaround sheet URL */
  turnaround_image: string | null;
  /** Cropped view URLs: front, three_quarter, side */
  cropped_views: {
    front: string | null;
    three_quarter: string | null;
    side: string | null;
  };
  /** Per mutable_state reference images */
  state_images: Map<string, string>;
}

/* ── Scene (Call 2 output) ─────────────────────────────── */

export interface Scene {
  scene_id: string;
  project_id: string;
  name: string;
  /** ≤40 tokens */
  environment_description: string;
  /** Subset of CinematicIdentity.color_palette */
  dominant_colors: string[];
  key_light_mood: "warm" | "cold" | "dramatic" | "soft";
  /** Landmark objects for spatial anchoring */
  landmark_objects: string[];
  /** Spatial structure description */
  geometry_hint: string;
  weather_state: string;
  /** Prompt for generating scene master frame */
  reference_prompt: string;
  /** Generated scene master frame URL */
  master_frame: string | null;
}
