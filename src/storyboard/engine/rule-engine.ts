/**
 * Rule Engine (Stage 4) — V6: CV & AI Hybrid Computation Pipeline.
 * Pure code, zero LLM calls.
 *
 * V6 enhancements:
 * - DID global prefix injected into all prompts
 * - Focal length → perspective keywords in prompt assembly
 * - Lighting intent → prompt keywords
 * - Director Rules Validator integration point
 */
import type {
  Shot, Scene, Character,
  SubjectMotion,
} from "../types";
import type { DirectorIntent } from "../types/director-intent";
import { buildDIDPrefix, focalLengthToKeywords, compositionToKeywords, lightingToKeywords } from "./prompt-builder";

/* ── Constants ─────────────────────────────────────────── */

const I2V_MAX_DURATION = 10;

const DEFAULT_NEGATIVE_PROMPT =
  "blurry, low quality, distorted face, extra limbs, watermark, text overlay, bad anatomy, deformed, ugly, duplicate";

/** Adaptive denoising parameters */
const D_BASE = 0.2;       // Base fusion strength (minimal change)
const ALPHA_LIGHT = 0.15;  // Light mismatch coefficient
const BETA_PERSP = 0.15;   // Perspective/edge harshness coefficient
const D_MAX = 0.5;         // Maximum denoising (heavy repaint)

/* ── Types ─────────────────────────────────────────────── */

export type StepType =
  | "generate_image"   // Seedream t2i (keyframe / single-subject reference)
  | "generate_scene"   // Seedream t2i (empty scene background)
  | "collage"          // CV: affine transform + composite subjects onto scene
  | "edit_image"       // Seedream edit: adaptive fusion pass
  | "i2v"              // Seedance image-to-video
  | "video_extend"     // Seedance video extension
  | "t2v";             // Seedance text-to-video (fallback)

export interface ExecutionStep {
  step_type: StepType;
  prompt?: string;
  negative_prompt?: string;
  duration?: number;
  output_key: string;
  /** Reference a previous step's output_key as input */
  input_from?: string;
  /** Base image key for collage/edit operations */
  base_image?: string;
  /** Overlay image keys for collage (character cutouts) */
  overlay_images?: string[];
  image_size?: string;
  seed?: number;
  /** Adaptive denoising strength for edit_image */
  denoising_strength?: number;
  /** Metadata for collage: perspective hint from scene */
  perspective_hint?: string;
  /** Number of subjects in collage (affects denoising calculation) */
  subject_count?: number;
}

export interface ShotExecutionPlan {
  shot_id: string;
  shot_seq: number;
  steps: ExecutionStep[];
  depends_on: string[];
  parallel_eligible: boolean;
}

export interface FullExecutionPlan {
  /** All image generation steps (parallelizable) */
  asset_steps: ExecutionStep[];
  /** Per-shot execution plans */
  shot_plans: ShotExecutionPlan[];
  parallel_batch: string[];
  sequential_queue: string[];
}

export interface ShotPrompts {
  image_prompt: string;
  video_prompt: string;
}

/* ── Key Helpers ───────────────────────────────────────── */

function subjectKey(shotSeq: number, subjectName: string): string {
  return `subject/shot${shotSeq}_${subjectName.replace(/\s+/g, "_").toLowerCase()}`;
}

function sceneKey(shotSeq: number): string {
  return `scene/shot${shotSeq}`;
}

function collageKey(shotSeq: number): string {
  return `collage/shot${shotSeq}`;
}

function keyframeKey(shotSeq: number): string {
  return `keyframe/shot${shotSeq}`;
}

function videoKey(shotSeq: number): string {
  return `videos/shot${shotSeq}`;
}

/* ── Adaptive Denoising Calculation ────────────────────── */

/**
 * Calculate adaptive denoising strength for edit fusion.
 * D = D_base + α·M_light + β·E_persp
 *
 * Since we can't do real histogram analysis at plan-build time,
 * we estimate based on structural heuristics:
 * - M_light: higher if scene has dramatic/contrasty lighting
 * - E_persp: higher if multiple subjects or complex perspective
 */
function calculateDenoising(
  scene: Scene | undefined,
  subjectCount: number,
): number {
  // Estimate light mismatch from scene lighting description
  let mLight = 0.3; // default moderate
  if (scene?.lighting) {
    const l = scene.lighting.toLowerCase();
    if (l.includes("dramatic") || l.includes("harsh") || l.includes("rim") || l.includes("backlit")) {
      mLight = 0.8;
    } else if (l.includes("soft") || l.includes("diffused") || l.includes("overcast") || l.includes("flat")) {
      mLight = 0.1;
    } else if (l.includes("side") || l.includes("directional")) {
      mLight = 0.5;
    }
  }

  // Estimate perspective harshness from subject count and perspective hint
  let ePersp = 0.2; // default low
  if (subjectCount > 2) {
    ePersp = 0.7;
  } else if (subjectCount === 2) {
    ePersp = 0.4;
  }
  if (scene?.perspective_hint) {
    const p = scene.perspective_hint.toLowerCase();
    if (p.includes("low angle") || p.includes("bird") || p.includes("aerial")) {
      ePersp = Math.min(1.0, ePersp + 0.2); // extreme angles increase harshness
    }
  }

  const D = D_BASE + ALPHA_LIGHT * mLight + BETA_PERSP * ePersp;
  return Math.min(D_MAX, Math.max(D_BASE, D));
}

/* ── Prompt Assembly ───────────────────────────────────── */

/**
 * Assemble a single-subject reference image prompt.
 * V6: Includes DID global prefix for visual consistency.
 */
function assembleSubjectPrompt(
  char: Character,
  motion: SubjectMotion | undefined,
  didPrefix?: string,
): string {
  const parts: string[] = [];

  // V6: DID global prefix
  if (didPrefix) parts.push(didPrefix);

  // Immutable core
  if (char.immutable_traits?.core_visual) {
    parts.push(char.immutable_traits.core_visual);
  } else {
    parts.push(char.visual_description);
  }

  // Selected mutable states
  if (motion?.clothing_state) {
    parts.push(motion.clothing_state);
  } else if (char.mutable_states?.clothing?.[0]) {
    parts.push(char.mutable_states.clothing[0]); // default state
  }

  if (motion?.expression_state) {
    parts.push(motion.expression_state);
  } else if (char.mutable_states?.expression?.[0]) {
    parts.push(char.mutable_states.expression[0]);
  }

  // Mid-action pose (off-balance, dynamic)
  if (motion?.mid_action) {
    parts.push(motion.mid_action);
  }

  // Art style
  if (char.immutable_traits?.art_style) {
    parts.push(char.immutable_traits.art_style);
  }

  // Clean background for cutout — enhanced with lighting note for better compositing
  parts.push("plain white background, full body visible, isolated subject, even studio lighting, clean edges for compositing");

  return parts.join(", ");
}

/**
 * Assemble the full keyframe prompt for single-subject shots (no collage needed).
 * V6: Includes DID prefix + focal length + composition + lighting keywords.
 */
function assembleDirectKeyframePrompt(
  shot: Shot,
  imagePrompt: string,
  characters: Character[],
  scenes: Scene[],
  didPrefix?: string,
): string {
  const bfr = shot.base_frame_request;
  if (!bfr?.pose_or_angle) return imagePrompt;

  const parts: string[] = [];

  // V6: DID global prefix
  if (didPrefix) parts.push(didPrefix);

  // V6: Focal length keywords
  if (shot.focal_length_intent) {
    parts.push(focalLengthToKeywords(shot.focal_length_intent.equivalent_mm, shot.focal_length_intent.depth_of_field));
  }

  // V6: Composition keywords
  if (shot.composition) {
    parts.push(compositionToKeywords(shot.composition.rule, shot.composition.subject_placement));
  }

  const shotChars = characters.filter((c) => shot.character_ids.includes(c.character_id));

  // Subject visuals with motion state
  for (const char of shotChars) {
    const motion = shot.subject_motions?.find(
      (m) => m.subject.toLowerCase() === char.name.toLowerCase(),
    );

    if (char.immutable_traits?.core_visual) {
      parts.push(char.immutable_traits.core_visual);
    } else {
      parts.push(char.visual_description);
    }

    if (motion?.clothing_state) parts.push(motion.clothing_state);
    if (motion?.expression_state) parts.push(motion.expression_state);
    if (motion?.mid_action) parts.push(motion.mid_action);
    if (char.immutable_traits?.art_style) parts.push(char.immutable_traits.art_style);
  }

  // Composition from base_frame_request
  parts.push(bfr.pose_or_angle);

  // Scene context
  const scene = scenes.find((s) => s.scene_id === shot.scene_id);
  if (scene?.visual_prompt) parts.push(scene.visual_prompt);
  if (scene?.perspective_hint) parts.push(scene.perspective_hint);

  // V6: Lighting intent keywords
  if (shot.lighting_intent) {
    parts.push(lightingToKeywords(shot.lighting_intent.style, shot.lighting_intent.motivation));
  }

  // Environmental motion (frozen)
  if (shot.env_motion?.description) {
    parts.push(shot.env_motion.description + " frozen mid-air");
  }

  // Shot framing with atmospheric cues
  const framingHints: Record<string, string> = {
    wide: "wide shot, full scene visible, atmospheric depth layers",
    medium: "medium shot, waist up, environmental context visible",
    close_up: "close up shot, fine detail visible, skin texture",
    extreme_close_up: "extreme close up, macro detail, surface texture prominent",
    over_shoulder: "over the shoulder shot, depth separation between foreground and background",
    pov: "first person point of view, immersive perspective",
    aerial: "aerial view, bird's eye, atmospheric haze between layers",
  };
  const framing = framingHints[shot.shot_type];
  if (framing) parts.push(framing);

  // Emotion-driven atmospheric modifier
  const emotionAtmosphere: Record<string, string> = {
    tense: "taut atmosphere, sharp contrasts",
    joyful: "warm luminous atmosphere, soft highlights",
    melancholy: "muted tones, diffused light, gentle grain",
    explosive: "high energy, motion blur traces, particle effects",
    mysterious: "obscured details, volumetric fog, partial shadows",
    romantic: "soft glow, warm diffusion, lens flare hints",
    horror: "desaturated, harsh shadows, unnatural angles",
  };
  const emotionMod = emotionAtmosphere[shot.emotion_tag];
  if (emotionMod) parts.push(emotionMod);

  return parts.join(", ");
}

/* ── Shot Plan Builder ─────────────────────────────────── */

/**
 * Build execution plan for a single shot.
 *
 * V5 routing logic:
 * - 0 subjects (pure scene): generate_scene → i2v
 * - 1 subject: generate direct keyframe (subject + scene in one image) → i2v
 * - 2+ subjects: generate each subject separately + generate scene →
 *                collage (CV affine transform) → edit_image (adaptive fusion) → i2v
 */
function buildShotPlan(
  shot: Shot,
  prompts: ShotPrompts,
  characters: Character[],
  scenes: Scene[],
  allShots: Shot[],
  didPrefix?: string,
): ShotExecutionPlan {
  const steps: ExecutionStep[] = [];
  const shotChars = characters.filter((c) => shot.character_ids.includes(c.character_id));
  const scene = scenes.find((s) => s.scene_id === shot.scene_id);
  const isMultiSubject = shotChars.length > 1;
  const needsExtend = shot.duration > I2V_MAX_DURATION;
  const i2vDuration = needsExtend ? I2V_MAX_DURATION : shot.duration;

  const kfKey = keyframeKey(shot.sequence_number);
  const vidKey = videoKey(shot.sequence_number);

  // Build negative prompt
  const charNegatives = shotChars.map((c) => c.visual_negative).filter(Boolean).join(", ");
  const sceneNegative = scene?.visual_negative || "";
  const fullNegative = [DEFAULT_NEGATIVE_PROMPT, charNegatives, sceneNegative].filter(Boolean).join(", ");

  if (isMultiSubject) {
    // ── MULTI-SUBJECT: separate generation → collage → edit → i2v ──

    // Step 1a: Generate each subject separately (clean background for cutout)
    const overlayKeys: string[] = [];
    for (const char of shotChars) {
      const motion = shot.subject_motions?.find(
        (m) => m.subject.toLowerCase() === char.name.toLowerCase(),
      );
      const sKey = subjectKey(shot.sequence_number, char.name);
      overlayKeys.push(sKey);

      steps.push({
        step_type: "generate_image",
        prompt: assembleSubjectPrompt(char, motion, didPrefix),
        negative_prompt: `${DEFAULT_NEGATIVE_PROMPT}, ${char.visual_negative || ""}, background, scenery`,
        output_key: sKey,
        image_size: "1280x720",
        seed: 42,
      });
    }

    // Step 1b: Generate empty scene background
    const scKey = sceneKey(shot.sequence_number);
    const scenePrompt = scene?.visual_prompt || shot.base_frame_request?.scene_context || "";
    const perspHint = scene?.perspective_hint || "";

    steps.push({
      step_type: "generate_scene",
      prompt: `${scenePrompt}, ${perspHint}, empty scene, no people, no characters, cinematic composition`,
      negative_prompt: `${DEFAULT_NEGATIVE_PROMPT}, people, person, human, character, figure`,
      output_key: scKey,
      image_size: "1280x720",
      seed: 42,
    });

    // Step 2: Collage — CV affine transform + composite
    const colKey = collageKey(shot.sequence_number);
    steps.push({
      step_type: "collage",
      base_image: scKey,
      overlay_images: overlayKeys,
      output_key: colKey,
      perspective_hint: perspHint,
      subject_count: shotChars.length,
    });

    // Step 3: Edit fusion — adaptive denoising to unify lighting/style
    const denoising = calculateDenoising(scene, shotChars.length);
    steps.push({
      step_type: "edit_image",
      input_from: colKey,
      prompt: prompts.image_prompt,
      negative_prompt: fullNegative,
      denoising_strength: denoising,
      output_key: kfKey,
      image_size: "1280x720",
    });

  } else {
    // ── SINGLE/ZERO SUBJECT: direct keyframe generation ──
    const directPrompt = assembleDirectKeyframePrompt(shot, prompts.image_prompt, characters, scenes, didPrefix);

    steps.push({
      step_type: shotChars.length === 0 ? "generate_scene" : "generate_image",
      prompt: directPrompt,
      negative_prompt: fullNegative,
      output_key: kfKey,
      image_size: "1280x720",
      seed: 42,
    });
  }

  // ── i2v: keyframe → video ──
  steps.push({
    step_type: "i2v",
    input_from: kfKey,
    prompt: prompts.video_prompt,
    negative_prompt: DEFAULT_NEGATIVE_PROMPT,
    duration: i2vDuration,
    output_key: vidKey,
  });

  // ── video-extend (if duration > 10s) ──
  if (needsExtend) {
    steps.push({
      step_type: "video_extend",
      input_from: vidKey,
      prompt: prompts.video_prompt,
      duration: shot.duration - I2V_MAX_DURATION,
      output_key: `${vidKey}_extended`,
    });
  }

  const depends_on = computeDependencies(shot, allShots);

  return {
    shot_id: shot.shot_id,
    shot_seq: shot.sequence_number,
    steps,
    depends_on,
    parallel_eligible: depends_on.length === 0,
  };
}

/* ── Dependency Graph ──────────────────────────────────── */

function computeDependencies(shot: Shot, allShots: Shot[]): string[] {
  const deps: string[] = [];
  const sameScene = [...allShots]
    .filter((s) => s.scene_id === shot.scene_id)
    .sort((a, b) => a.sequence_number - b.sequence_number);

  if (sameScene.length === 0) return deps;

  const anchor = sameScene[0];
  if (anchor.shot_id !== shot.shot_id) {
    deps.push(anchor.shot_id);
  }

  const idx = sameScene.findIndex((s) => s.shot_id === shot.shot_id);
  if (idx > 0) {
    const prev = sameScene[idx - 1];
    const hasCharOverlap = shot.character_ids.some((id) =>
      prev.character_ids.includes(id),
    );
    if (hasCharOverlap && shot.sequence_number === prev.sequence_number + 1) {
      if (!deps.includes(prev.shot_id)) {
        deps.push(prev.shot_id);
      }
    }
  }

  return deps;
}

/* ── Schedule Builder ──────────────────────────────────── */

function buildSchedule(plans: ShotExecutionPlan[]): {
  parallel: string[];
  sequential: string[];
} {
  const parallel: string[] = [];
  const sequential: string[] = [];
  const sorted = [...plans].sort((a, b) => a.shot_seq - b.shot_seq);

  for (const plan of sorted) {
    if (plan.parallel_eligible) {
      parallel.push(plan.shot_id);
    } else {
      sequential.push(plan.shot_id);
    }
  }

  return { parallel, sequential };
}

/* ── Main Entry Point ──────────────────────────────────── */

/**
 * Build the full V5 execution plan.
 *
 * For each shot:
 * - Single/zero subject: generate_image → i2v (2 API calls)
 * - Multi-subject: N×generate_image + generate_scene + collage(CV) + edit_image → i2v
 *
 * All generate_image/generate_scene steps are extracted as parallelizable asset_steps.
 * Shot plans contain only collage → edit → i2v (or just i2v for single-subject).
 */
export function buildExecutionPlan(
  shots: Shot[],
  promptMap: Map<string, ShotPrompts>,
  characters: Character[],
  scenes: Scene[],
  did?: DirectorIntent,
): FullExecutionPlan {
  const sortedShots = [...shots].sort((a, b) => a.sequence_number - b.sequence_number);
  const didPrefix = buildDIDPrefix(did);

  const shot_plans = sortedShots.map((shot) => {
    const prompts = promptMap.get(shot.shot_id) ?? {
      image_prompt: shot.generation_prompt || shot.action_description,
      video_prompt: shot.action_description,
    };
    return buildShotPlan(shot, prompts, characters, scenes, shots, didPrefix);
  });

  // Extract all image generation steps as parallelizable asset_steps
  const asset_steps: ExecutionStep[] = [];
  const strippedPlans: ShotExecutionPlan[] = [];

  for (const plan of shot_plans) {
    const genSteps = plan.steps.filter(
      (s) => s.step_type === "generate_image" || s.step_type === "generate_scene",
    );
    const postGenSteps = plan.steps.filter(
      (s) => s.step_type !== "generate_image" && s.step_type !== "generate_scene",
    );

    asset_steps.push(...genSteps);
    strippedPlans.push({ ...plan, steps: postGenSteps });
  }

  const { parallel, sequential } = buildSchedule(strippedPlans);

  return {
    asset_steps,
    shot_plans: strippedPlans,
    parallel_batch: parallel,
    sequential_queue: sequential,
  };
}
