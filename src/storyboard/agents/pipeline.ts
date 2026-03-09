/**
 * Pipeline Orchestrator (v4) — Wires all stages together.
 *
 * Stage 0: Super Router (merged input normalization + intent parsing, single LLM call)
 * Stage 1: Asset Cards (generalized from "Character Cards" to support any subject type)
 * Stage 2: Scene cards (serial dependency on Stage 1)
 * Stage 2.5 || Stage 3: Asset generation || Shot sequence (parallel)
 * Stage 3.5: Prompt translation & assembly
 * Stage 4: Rule engine (pure code)
 * Stage 5: Execution scheduler
 * Stage 6: FFmpeg concatenation
 */
import { streamChatCompletion, parseJsonResponse } from "../api/deepseek";
import { useAgentActivityStore } from "../stores/agent-activity.store";
import {
  STAGE_ROUTER_SYSTEM, STAGE_ROUTER_CONFIG,
  STAGE1_SYSTEM, STAGE1_CONFIG,
  STAGE2_SYSTEM, STAGE2_CONFIG,
  STAGE3_SYSTEM, STAGE3_CONFIG,
  STAGE3_5_SYSTEM, STAGE3_5_CONFIG,
} from "./prompts";

import { type BaseFrameRequest } from "../types";

/* ── Types ─────────────────────────────────────────────── */

/** Subject type — generalized from "character" to support any focal entity */
export type SubjectType = "person" | "object" | "creature" | "environment";

export interface SubjectMeta {
  name: string;
  type: SubjectType;
  ip_source: string;
}

/**
 * Super Router result — merged Stage -1 + Stage 0.
 * One LLM call does: classify, normalize, expand, and extract metadata.
 */
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

/**
 * IntentResult — backward-compatible shape consumed by downstream stages.
 * Built from RouterResult.metadata by the adapter layer.
 */
export interface IntentResult {
  type: "new_project" | "chat";
  characters: string[];
  ip_sources: string[];
  genre: string;
  duration: number;
  style_hint: string;
  entities: string[];
  /** New: full subject metadata for type-aware downstream processing */
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
  /** V5: Immutable visual traits */
  immutable_traits?: {
    core_visual: string;
    art_style: string;
  };
  /** V5: Mutable state pool */
  mutable_states?: {
    clothing: string[];
    expression: string[];
    pose_class: string[];
  };
}

export interface SceneDraft {
  name: string;
  visual_prompt: string;
  visual_negative: string;
  lighting: string;
  weather: string;
  time_of_day: string;
  mood: string;
  /** V5: Spatial perspective constraint */
  perspective_hint?: string;
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
  /** V5: Per-subject motion vectors */
  subject_motions?: Array<{
    subject: string;
    mid_action: string;
    direction: string;
    intensity: number;
    clothing_state?: string;
    expression_state?: string;
  }>;
  /** V5: Environmental motion */
  env_motion?: {
    description: string;
    direction: string;
  };
}

export interface ShotPromptDraft {
  shot_sequence: number;
  image_prompt: string;
  video_prompt: string;
}

/* ── Default Duration Heuristics ───────────────────────── */

/** Estimate duration from genre/complexity when LLM returns null */
function inferDefaultDuration(genre: string, subjectCount: number): number {
  if (genre === "commercial") return 14;
  if (genre === "atmospheric" || genre === "slice_of_life") return 14;
  if (subjectCount <= 1) return 14;
  if (subjectCount <= 3) return 20;
  return 30;
}

/* ── Stage 0: Super Router (merged -1 + 0) ──────────────── */

/**
 * Single LLM call that replaces both normalizeInput() and parseIntent().
 * Performs: classify → normalize → expand → extract metadata.
 *
 * Returns RouterResult which is then adapted to IntentResult for downstream stages.
 * Saves ~300-500ms by eliminating one serial LLM round-trip.
 * Uses streaming for real-time feedback in the activity panel.
 */
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

/**
 * Adapt RouterResult → IntentResult for backward compatibility with downstream stages.
 * Applies default duration heuristics when LLM returns null.
 */
export function routerToIntent(router: RouterResult, fallbackDuration: number): IntentResult {
  const subjects = router.metadata.subjects;
  const characters = subjects.map((s) => s.name);
  const ip_sources = subjects.map((s) => s.ip_source);
  const entities = subjects.filter((s) => s.type !== "person").map((s) => s.name);

  const duration = router.metadata.duration
    ?? fallbackDuration
    ?? inferDefaultDuration(router.metadata.genre, subjects.length);

  return {
    type: "new_project",
    characters,
    ip_sources,
    genre: router.metadata.genre,
    duration,
    style_hint: router.metadata.style_hint,
    entities,
    subjects,
  };
}

/* ── Legacy wrappers (kept for backward compat, delegate to routeInput) ── */

/** @deprecated Use routeInput() instead. Kept for gradual migration. */
export async function normalizeInput(
  userMessage: string,
  phaseId: string,
): Promise<{ intent: string; brief: string; confidence: string; needs_clarification: boolean; clarification_question: string | null }> {
  const router = await routeInput(userMessage, phaseId);
  return {
    intent: router.intent,
    brief: router.normalized_brief,
    confidence: router.confidence,
    needs_clarification: router.needs_clarification,
    clarification_question: router.clarification_question,
  };
}

/** @deprecated Use routerToIntent(routeInput(...)) instead. Kept for gradual migration. */
export async function parseIntent(
  normalizedBrief: string,
  phaseId: string,
): Promise<IntentResult> {
  const router = await routeInput(normalizedBrief, phaseId);
  return routerToIntent(router, 30);
}

/* ── Stage 1: Character Cards ──────────────────────────── */

export async function generateCharacterCards(
  intent: IntentResult,
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
${intent.entities.length > 0 ? `Key entities/props: ${intent.entities.join(", ")}` : ""}`;

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

/* ── Stage 2: Scene Cards ──────────────────────────────── */

export async function generateSceneCards(
  intent: IntentResult,
  characters: CharacterDraft[],
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

/* ── Stage 3: Shot Sequence ────────────────────────────── */

export async function generateShotSequence(
  intent: IntentResult,
  characters: CharacterDraft[],
  scenes: SceneDraft[],
  phaseId: string,
): Promise<{ shots: ShotDraft[]; warnings: string[] }> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "story", "Story Agent: generating shot sequence");

  const targetShots = Math.round(intent.duration / 6); // ~6s average per shot

  try {
    // Compact context: name + fighting_style only (no visual_prompt)
    const charContext = characters
      .map((c) => `${c.name} (${c.role_in_story}): ${c.fighting_style}`)
      .join("\n");
    const sceneContext = scenes
      .map((s) => `${s.name}: ${s.mood}, ${s.lighting} [${s.time_of_day}]`)
      .join("\n");

    let fullText = "";
    const stream = streamChatCompletion(
      [
        { role: "system", content: STAGE3_SYSTEM },
        {
          role: "user",
          content: `Genre: ${intent.genre}
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

/* ── Stage 3.5: Prompt Translation ─────────────────────── */

export async function translatePrompts(
  shots: ShotDraft[],
  characters: CharacterDraft[],
  scenes: SceneDraft[],
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
          ? `mutable_states: {clothing: [${c.mutable_states.clothing.join(", ")}], expression: [${c.mutable_states.expression.join(", ")}]}`
          : "";
        return `${c.name}: ${immutable}${mutable ? "\n  " + mutable : ""}`;
      })
      .join("\n");
    const sceneAnchors = scenes
      .map((s) => {
        const persp = s.perspective_hint ? `, perspective: "${s.perspective_hint}"` : "";
        return `${s.name} visual anchor: ${s.visual_prompt}${persp}`;
      })
      .join("\n");
    const shotDescriptions = shots
      .map((s) => {
        const bfr = s.base_frame_request;
        const bfrStr = bfr
          ? ` base_frame_request={subjects=[${bfr.subject_names.join(",")}], pose="${bfr.pose_or_angle}", scene="${bfr.scene_context}"}`
          : "";
        const motions = (s.subject_motions || [])
          .map((m) => `{${m.subject}: mid_action="${m.mid_action}", dir=${m.direction}, intensity=${m.intensity}${m.clothing_state ? `, clothing="${m.clothing_state}"` : ""}${m.expression_state ? `, expression="${m.expression_state}"` : ""}}`)
          .join(", ");
        const motionStr = motions ? ` subject_motions=[${motions}]` : "";
        const envStr = s.env_motion ? ` env_motion={${s.env_motion.description}, dir=${s.env_motion.direction}}` : "";
        return `Shot #${s.sequence_number} [${s.shot_type}, ${s.camera_movement}]: scene="${s.scene_name}", characters=[${s.character_names.join(",")}], action="${s.action_description}", emotion=${s.emotion_tag}${bfrStr}${motionStr}${envStr}`;
      })
      .join("\n");

    let fullText = "";
    const stream = streamChatCompletion(
      [
        { role: "system", content: STAGE3_5_SYSTEM },
        {
          role: "user",
          content: `Character visual anchors:
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
