/**
 * Pipeline Orchestrator (V6) — Wires all stages together.
 *
 * Stage 0:   Super Router (merged input normalization + intent parsing)
 * Stage 0.5: Director's Intent Document (DID) generation
 * Stage 1:   Asset Cards v2 (with visual_anchor, reads DID)
 * Stage 2:   Scene Cards v2 (with visual continuity, reads DID)
 * Stage 3:   Shot Sequence v2 (full cinematography, reads DID)
 * Stage 3.5: Prompt Translation v2 (cinematography→prompt mapping, reads DID)
 * Stage 4:   Rule Engine + Director Validator (pure code)
 * Stage 5:   Execution Scheduler (3-phase)
 * Stage 6:   FFmpeg Assembly
 */
import { streamChatCompletion, parseJsonResponse } from "../api/deepseek";
import { useAgentActivityStore } from "../stores/agent-activity.store";
import {
  STAGE_ROUTER_SYSTEM, STAGE_ROUTER_CONFIG,
  STAGE_DID_SYSTEM, STAGE_DID_CONFIG,
  STAGE1_SYSTEM, STAGE1_CONFIG,
  STAGE2_SYSTEM, STAGE2_CONFIG,
  STAGE3_SYSTEM, STAGE3_CONFIG,
  STAGE3_5_SYSTEM, STAGE3_5_CONFIG,
  STAGE3_75_SYSTEM, STAGE3_75_CONFIG,
} from "./prompts";

import type { BaseFrameRequest } from "../types";
import type { DirectorIntent } from "../types/director-intent";
import {
  composeFinalVideoPrompt as composeFinalVideoPromptCode,
  type FinalVideoPrompt,
} from "../engine/final-prompt-composer";

/* ── Types ─────────────────────────────────────────────── */

export type SubjectType = "person" | "object" | "creature" | "environment";

export interface SubjectMeta {
  name: string;
  type: SubjectType;
  ip_source: string;
}

export interface RouterResult {
  intent: "create" | "modify" | "unclear" | "reject";
  needs_clarification: boolean;
  clarification_question: string | null;
  normalized_brief: string;
  confidence: "high" | "medium" | "low";
  metadata: {
    subjects: SubjectMeta[];
    genre: string;
    duration: number | null;
    style_hint: string;
    has_url: boolean;
    detected_url: string | null;
  };
}

export interface IntentResult {
  type: "new_project" | "chat";
  characters: string[];
  ip_sources: string[];
  genre: string;
  duration: number;
  style_hint: string;
  entities: string[];
  subjects: SubjectMeta[];
}

export interface CharacterDraft {
  name: string;
  type?: SubjectType;
  visual_prompt: string;
  visual_negative: string;
  personality: string;
  fighting_style: string;
  role_in_story: string;
  immutable_traits?: {
    core_visual: string;
    art_style: string;
  };
  mutable_states?: {
    clothing: string[];
    expression: string[];
    pose_class: string[];
  };
  // V6 fields
  visual_anchor?: {
    reference_pose: string;
    anchor_prompt: string;
  };
  face_framing_note?: string;
  screen_direction_default?: "enters_from_left" | "enters_from_right";
}

export interface SceneDraft {
  name: string;
  visual_prompt: string;
  visual_negative: string;
  lighting: string;
  weather: string;
  time_of_day: string;
  mood: string;
  perspective_hint?: string;
  // V6 fields
  color_temperature?: "warm" | "neutral" | "cool";
  dominant_light_source?: string;
  weather_continuity?: string;
  exit_visual_hint?: string;
  entry_visual_hint?: string;
}

export interface ShotDraft {
  sequence_number: number;
  act_number: number;
  scene_name: string;
  character_names: string[];
  shot_type: string;
  camera_movement: string;
  duration: number;
  dialogue: string | null;
  dialogue_character: string | null;
  narration: string | null;
  action_description: string;
  emotion_tag: string;
  transition_to_next: string;
  is_key_shot: boolean;
  base_frame_request: BaseFrameRequest;
  subject_motions?: Array<{
    subject: string;
    mid_action: string;
    direction: string;
    intensity: number;
    clothing_state?: string;
    expression_state?: string;
  }>;
  env_motion?: { description: string; direction: string };
  // V6 fields
  focal_length_intent?: {
    equivalent_mm: number;
    purpose: string;
    depth_of_field: string;
  };
  composition?: {
    rule: string;
    subject_placement: string;
    leading_lines: string | null;
    negative_space: string | null;
  };
  rhythm_role?: string;
  emotional_beat_index?: number;
  screen_direction?: {
    subject_facing: string;
    movement_direction: string;
  };
  spatial_continuity?: {
    camera_side: string;
    angle_delta_from_prev: number | null;
    eyeline_target: string | null;
  };
  transition_detail?: {
    type: string;
    match_element: string | null;
    visual_bridge: string | null;
  };
  lighting_intent?: {
    key_light_direction: string;
    style: string;
    motivation: string;
  };
}

export interface ShotPromptDraft {
  shot_sequence: number;
  image_prompt: string;
  video_prompt: string;
}

/* ── Default Duration Heuristics ───────────────────────── */

function inferDefaultDuration(genre: string, subjectCount: number): number {
  if (genre === "commercial") return 14;
  if (genre === "atmospheric" || genre === "slice_of_life") return 14;
  if (subjectCount <= 1) return 14;
  if (subjectCount <= 3) return 20;
  return 30;
}

/* ── Stage 0: Super Router ─────────────────────────────── */

export async function routeInput(
  userMessage: string,
  phaseId: string,
): Promise<RouterResult> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "orchestrator", "Super Router: classify + normalize + extract");
  activity.appendStream(taskId, `Raw input: "${userMessage.slice(0, 100)}"\n`);

  try {
    let fullText = "";
    const stream = streamChatCompletion(
      [
        { role: "system", content: STAGE_ROUTER_SYSTEM },
        { role: "user", content: userMessage },
      ],
      { temperature: STAGE_ROUTER_CONFIG.temperature, max_tokens: STAGE_ROUTER_CONFIG.max_tokens },
    );
    for await (const chunk of stream) {
      fullText += chunk;
      useAgentActivityStore.getState().appendStream(taskId, chunk);
    }
    const result = parseJsonResponse<RouterResult>(fullText);
    useAgentActivityStore.getState().completeTask(taskId, `Routed: ${result.intent} (${result.confidence})`);
    return result;
  } catch (err: any) {
    useAgentActivityStore.getState().failTask(taskId, err.message);
    throw err;
  }
}

export function routerToIntent(router: RouterResult, fallbackDuration: number): IntentResult {
  const subjects = router.metadata.subjects;
  const duration = router.metadata.duration
    ?? fallbackDuration
    ?? inferDefaultDuration(router.metadata.genre, subjects.length);
  return {
    type: "new_project",
    characters: subjects.map((s) => s.name),
    ip_sources: subjects.map((s) => s.ip_source),
    genre: router.metadata.genre,
    duration,
    style_hint: router.metadata.style_hint,
    entities: subjects.filter((s) => s.type !== "person").map((s) => s.name),
    subjects,
  };
}

/** @deprecated Use routeInput() instead */
export async function normalizeInput(
  userMessage: string, phaseId: string,
): Promise<{ intent: string; brief: string; confidence: string; needs_clarification: boolean; clarification_question: string | null }> {
  const router = await routeInput(userMessage, phaseId);
  return { intent: router.intent, brief: router.normalized_brief, confidence: router.confidence, needs_clarification: router.needs_clarification, clarification_question: router.clarification_question };
}

/** @deprecated Use routerToIntent(routeInput(...)) instead */
export async function parseIntent(normalizedBrief: string, phaseId: string): Promise<IntentResult> {
  const router = await routeInput(normalizedBrief, phaseId);
  return routerToIntent(router, 30);
}

/* ── Stage 0.5: Director's Intent Document ─────────────── */

export async function generateDirectorIntent(
  intent: IntentResult,
  normalizedBrief: string,
  phaseId: string,
): Promise<DirectorIntent> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "orchestrator", "Director's Intent: building global vision");

  try {
    const subjectLines = intent.subjects.map((s) =>
      `${s.name} (${s.type}, from: ${s.ip_source})`).join(", ");

    const userPrompt = `Creative Brief: ${normalizedBrief}
Subjects: ${subjectLines}
Genre: ${intent.genre}
Style: ${intent.style_hint}
Duration: ${intent.duration}s

Generate the Director's Intent Document.`;

    let fullText = "";
    const stream = streamChatCompletion(
      [
        { role: "system", content: STAGE_DID_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      { temperature: STAGE_DID_CONFIG.temperature, max_tokens: STAGE_DID_CONFIG.max_tokens },
    );
    for await (const chunk of stream) {
      fullText += chunk;
      useAgentActivityStore.getState().appendStream(taskId, chunk);
    }
    const result = parseJsonResponse<DirectorIntent>(fullText);
    useAgentActivityStore.getState().completeTask(taskId, "DID ready");
    return result;
  } catch (err: any) {
    useAgentActivityStore.getState().failTask(taskId, err.message);
    throw err;
  }
}

/* ── Stage 1: Character Cards (V6 — reads DID) ────────── */

export async function generateCharacterCards(
  intent: IntentResult,
  did: DirectorIntent,
  phaseId: string,
): Promise<CharacterDraft[]> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "story", "Story Agent: generating asset cards");

  try {
    const subjectLines = (intent.subjects ?? []).map((s, i) => {
      const ipSource = s.ip_source || intent.ip_sources[i] || "original";
      return `${s.name} (type: ${s.type}, from: ${ipSource})`;
    });
    const fallbackLines = intent.characters.map((c, i) =>
      `${c} (type: person, from: ${intent.ip_sources[i] ?? "original"})`,
    );
    const lines = subjectLines.length > 0 ? subjectLines : fallbackLines;

    const userPrompt = `Subjects: ${lines.join(", ")}
Genre: ${intent.genre}
Style: ${intent.style_hint}
${intent.entities.length > 0 ? `Key entities/props: ${intent.entities.join(", ")}` : ""}

Director's Intent — Visual Identity:
- Art style anchor: ${did.visual_identity.art_style_anchor}
- Color palette: dominant=${did.visual_identity.color_palette.dominant}, accent=${did.visual_identity.color_palette.accent}
- Era/texture: ${did.visual_identity.era_and_texture}`;

    let fullText = "";
    const stream = streamChatCompletion(
      [
        { role: "system", content: STAGE1_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      { temperature: STAGE1_CONFIG.temperature, max_tokens: STAGE1_CONFIG.max_tokens },
    );
    for await (const chunk of stream) {
      fullText += chunk;
      useAgentActivityStore.getState().appendStream(taskId, chunk);
    }
    const result = parseJsonResponse<{ characters: CharacterDraft[] }>(fullText);
    useAgentActivityStore.getState().completeTask(taskId, `${result.characters.length} assets`);
    return result.characters;
  } catch (err: any) {
    useAgentActivityStore.getState().failTask(taskId, err.message);
    throw err;
  }
}

/* ── Stage 2: Scene Cards (V6 — reads DID) ─────────────── */

export async function generateSceneCards(
  intent: IntentResult,
  characters: CharacterDraft[],
  did: DirectorIntent,
  phaseId: string,
): Promise<SceneDraft[]> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "story", "Story Agent: generating scene cards");

  try {
    const charContext = characters
      .map((c) => `${c.name}: personality=${c.personality}, style=${c.fighting_style}`)
      .join("\n");

    let fullText = "";
    const stream = streamChatCompletion(
      [
        { role: "system", content: STAGE2_SYSTEM },
        {
          role: "user",
          content: `Genre: ${intent.genre}
Style: ${intent.style_hint}
Duration: ${intent.duration}s

Director's Intent — Visual Identity:
- Color palette: dominant=${did.visual_identity.color_palette.dominant}, accent=${did.visual_identity.color_palette.accent}, shadow=${did.visual_identity.color_palette.shadow_tone}
- Lighting philosophy: ${did.visual_identity.lighting_philosophy}
- Art style anchor: ${did.visual_identity.art_style_anchor}
- Era/texture: ${did.visual_identity.era_and_texture}

Characters (for atmosphere reference only):
${charContext}

Design scenes that amplify the narrative tension between these characters.`,
        },
      ],
      { temperature: STAGE2_CONFIG.temperature, max_tokens: STAGE2_CONFIG.max_tokens },
    );
    for await (const chunk of stream) {
      fullText += chunk;
      useAgentActivityStore.getState().appendStream(taskId, chunk);
    }
    const result = parseJsonResponse<{ scenes: SceneDraft[] }>(fullText);
    useAgentActivityStore.getState().completeTask(taskId, `${result.scenes.length} scenes`);
    return result.scenes;
  } catch (err: any) {
    useAgentActivityStore.getState().failTask(taskId, err.message);
    throw err;
  }
}

/* ── Stage 3: Shot Sequence (V6 — reads DID) ───────────── */

export async function generateShotSequence(
  intent: IntentResult,
  characters: CharacterDraft[],
  scenes: SceneDraft[],
  did: DirectorIntent,
  phaseId: string,
): Promise<{ shots: ShotDraft[]; warnings: string[] }> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "story", "Story Agent: generating shot sequence");
  const targetShots = Math.round(intent.duration / 6);

  try {
    const charContext = characters
      .map((c) => {
        const dir = c.screen_direction_default ?? "enters_from_left";
        const face = c.face_framing_note ?? "";
        return `${c.name} (${c.role_in_story}): ${c.fighting_style}${face ? `, face note: ${face}` : ""}, default direction: ${dir}`;
      })
      .join("\n");
    const sceneContext = scenes
      .map((s) => {
        const light = s.dominant_light_source ?? s.lighting;
        return `${s.name}: ${s.mood}, ${light} [${s.time_of_day}]${s.weather_continuity ? `, weather: ${s.weather_continuity}` : ""}`;
      })
      .join("\n");

    const didContext = `Director's Intent:
- Emotional arc: ${did.emotional_arc.structure}, beats: ${did.emotional_arc.beats.map((b) => `${b.beat_name}@${b.position}(${b.intensity})`).join(", ")}
- Rhythm: ${did.rhythm_blueprint.overall_tempo}, pacing=${did.rhythm_blueprint.pacing_strategy}, breath=${did.rhythm_blueprint.breath_pattern}
- Lens: default ${did.lens_philosophy.default_lens_mm}mm, wide for ${did.lens_philosophy.wide_usage}, tele for ${did.lens_philosophy.tele_usage}
- Lighting philosophy: ${did.visual_identity.lighting_philosophy}
- Style ref: ${did.lens_philosophy.style_reference}`;

    let fullText = "";
    const stream = streamChatCompletion(
      [
        { role: "system", content: STAGE3_SYSTEM },
        {
          role: "user",
          content: `${didContext}

Genre: ${intent.genre}
Target: ${targetShots} shots, ${intent.duration}s total

Characters:
${charContext}

Scenes:
${sceneContext}

Generate the shot sequence now.`,
        },
      ],
      { temperature: STAGE3_CONFIG.temperature, max_tokens: STAGE3_CONFIG.max_tokens },
    );
    for await (const chunk of stream) {
      fullText += chunk;
      useAgentActivityStore.getState().appendStream(taskId, chunk);
    }
    const result = parseJsonResponse<{ shots: ShotDraft[]; warnings: string[] }>(fullText);
    useAgentActivityStore.getState().completeTask(taskId, `${result.shots.length} shots`);
    return result;
  } catch (err: any) {
    useAgentActivityStore.getState().failTask(taskId, err.message);
    throw err;
  }
}

/* ── Stage 3.5: Prompt Translation (V6 — reads DID) ────── */

export async function translatePrompts(
  shots: ShotDraft[],
  characters: CharacterDraft[],
  scenes: SceneDraft[],
  did: DirectorIntent,
  phaseId: string,
): Promise<ShotPromptDraft[]> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "story", "Story Agent: translating prompts");

  try {
    const charAnchors = characters
      .map((c) => {
        const immutable = c.immutable_traits
          ? `immutable_traits: {core_visual: "${c.immutable_traits.core_visual}", art_style: "${c.immutable_traits.art_style}"}`
          : `visual anchor: ${c.visual_prompt}`;
        const mutable = c.mutable_states
          ? `mutable_states: {clothing: [${(c.mutable_states.clothing ?? []).join(", ")}], expression: [${(c.mutable_states.expression ?? []).join(", ")}]}`
          : "";
        return `${c.name}: ${immutable}${mutable ? "\n  " + mutable : ""}`;
      })
      .join("\n");
    const sceneAnchors = scenes
      .map((s) => {
        const persp = s.perspective_hint ? `, perspective: "${s.perspective_hint}"` : "";
        const light = s.dominant_light_source ? `, dominant_light: "${s.dominant_light_source}"` : "";
        return `${s.name} visual anchor: ${s.visual_prompt}${persp}${light}`;
      })
      .join("\n");
    const shotDescriptions = shots
      .map((s) => {
        const bfr = s.base_frame_request;
        const bfrStr = bfr ? ` base_frame={subjects=[${(bfr.subject_names ?? []).join(",")}], pose="${bfr.pose_or_angle}"}` : "";
        const motions = (s.subject_motions || [])
          .map((m) => `{${m.subject}: mid="${m.mid_action}", dir=${m.direction}, int=${m.intensity}${m.clothing_state ? `, cloth="${m.clothing_state}"` : ""}${m.expression_state ? `, expr="${m.expression_state}"` : ""}}`)
          .join(", ");
        const motionStr = motions ? ` motions=[${motions}]` : "";
        const envStr = s.env_motion ? ` env={${s.env_motion.description}, dir=${s.env_motion.direction}}` : "";
        const flStr = s.focal_length_intent ? ` lens=${s.focal_length_intent.equivalent_mm}mm(${s.focal_length_intent.depth_of_field})` : "";
        const compStr = s.composition ? ` comp=${s.composition.rule}@${s.composition.subject_placement}` : "";
        const lightStr = s.lighting_intent ? ` light=${s.lighting_intent.style}(${s.lighting_intent.key_light_direction}, "${s.lighting_intent.motivation}")` : "";
        const rhythmStr = s.rhythm_role ? ` rhythm=${s.rhythm_role}` : "";
        const screenStr = s.screen_direction ? ` screen_dir={facing=${s.screen_direction.subject_facing}, move=${s.screen_direction.movement_direction}}` : "";
        const transStr = s.transition_detail ? ` transition={type=${s.transition_detail.type}${s.transition_detail.match_element ? `, match="${s.transition_detail.match_element}"` : ""}${s.transition_detail.visual_bridge ? `, bridge="${s.transition_detail.visual_bridge}"` : ""}}` : "";
        const spatialStr = s.spatial_continuity ? ` spatial={side=${s.spatial_continuity.camera_side}${s.spatial_continuity.eyeline_target ? `, eyeline="${s.spatial_continuity.eyeline_target}"` : ""}}` : "";
        return `Shot #${s.sequence_number} [${s.shot_type}, ${s.camera_movement}, ${s.duration}s]: scene="${s.scene_name}", chars=[${(s.character_names ?? []).join(",")}], action="${s.action_description}", emotion=${s.emotion_tag}${bfrStr}${motionStr}${envStr}${flStr}${compStr}${lightStr}${rhythmStr}${screenStr}${transStr}${spatialStr}`;
      })
      .join("\n");

    const didPrefix = `Global Visual Identity (MUST prefix every image_prompt):
- Art style: ${did.visual_identity.art_style_anchor}
- Color palette: ${did.visual_identity.color_palette.dominant}
- Lighting philosophy: ${did.visual_identity.lighting_philosophy}`;

    let fullText = "";
    const stream = streamChatCompletion(
      [
        { role: "system", content: STAGE3_5_SYSTEM },
        {
          role: "user",
          content: `${didPrefix}

Character visual anchors:
${charAnchors}

Scene visual anchors:
${sceneAnchors}

Shots to translate:
${shotDescriptions}

Generate image_prompt and video_prompt for each shot.`,
        },
      ],
      { temperature: STAGE3_5_CONFIG.temperature, max_tokens: STAGE3_5_CONFIG.max_tokens },
    );
    for await (const chunk of stream) {
      fullText += chunk;
      useAgentActivityStore.getState().appendStream(taskId, chunk);
    }
    const result = parseJsonResponse<{ prompts: ShotPromptDraft[] }>(fullText);
    useAgentActivityStore.getState().completeTask(taskId, `${result.prompts.length} prompts translated`);
    return result.prompts;
  } catch (err: any) {
    useAgentActivityStore.getState().failTask(taskId, err.message);
    throw err;
  }
}


/* ── Stage 3.75: Final Prompt Composer ──────────────────── */

/**
 * Compose the final structured video prompt.
 * Step 1: Code skeleton (structural template via composeFinalVideoPromptCode)
 * Step 2: LLM polish pass (natural language quality)
 *
 * Returns both the raw structured prompt and the polished version.
 */
export async function composeFinalPrompt(
  shots: ShotDraft[],
  prompts: ShotPromptDraft[],
  scenes: SceneDraft[],
  did: DirectorIntent | undefined,
  targetDuration: number,
  phaseId: string,
): Promise<FinalVideoPrompt> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "orchestrator", "Final Prompt Composer: building structured video prompt");

  try {
    // Step 1: Code skeleton
    const skeleton = composeFinalVideoPromptCode(shots, prompts, scenes, did, targetDuration);
    activity.appendStream(taskId, `Skeleton built: ${skeleton.segments.length} segments\n`);

    // Step 2: LLM polish pass
    let fullText = "";
    const stream = streamChatCompletion(
      [
        { role: "system", content: STAGE3_75_SYSTEM },
        { role: "user", content: `Polish this structured video prompt:\n\n${skeleton.full}` },
      ],
      { temperature: STAGE3_75_CONFIG.temperature, max_tokens: STAGE3_75_CONFIG.max_tokens },
    );
    for await (const chunk of stream) {
      fullText += chunk;
      useAgentActivityStore.getState().appendStream(taskId, chunk);
    }

    // Use polished version as full, keep everything else from skeleton
    const polished: FinalVideoPrompt = {
      global: skeleton.global,
      full: fullText.trim() || skeleton.full,
      prefix: skeleton.prefix,
      segments: skeleton.segments,
      perShotPrompts: skeleton.perShotPrompts,
    };

    useAgentActivityStore.getState().completeTask(taskId, "Final prompt composed");
    return polished;
  } catch (err: any) {
    useAgentActivityStore.getState().failTask(taskId, err.message);
    // Fallback to code-only skeleton on LLM failure
    return composeFinalVideoPromptCode(shots, prompts, scenes, did, targetDuration);
  }
}
