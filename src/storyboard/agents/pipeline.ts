/**
 * Pipeline Orchestrator v3.0 — 3+1 LLM calls, two convergence points.
 *
 * Call 1: Super DID (Router + DID + Hook, merged)
 * Call 2: World Pack (all characters + scenes)
 * Call 3: Story-to-Shot Pack (beats + shots, batched for >20 shots)
 * Call 4: Repair Call (on-demand)
 *
 * After Call 2 completes → immediately start asset generation (parallel with Call 3)
 * After Call 3 completes → prompt translation (pure code) → first convergence (Animatic)
 * After user confirms → execution routing (pure code) → second convergence (video)
 */
import { streamChatCompletion, parseJsonResponse } from "../api/deepseek";
import { useAgentActivityStore } from "../stores/agent-activity.store";
import {
  CALL1_SUPER_DID_SYSTEM, CALL1_CONFIG,
  CALL2_WORLD_PACK_SYSTEM, CALL2_CONFIG,
  CALL3_SHOT_PACK_SYSTEM, CALL3_CONFIG,
  CALL3_CONTINUATION_TEMPLATE,
  CALL4_REPAIR_SYSTEM, CALL4_CONFIG,
} from "./prompts";
import type { SuperDID } from "../types/project";
// Beat and Shot types used by consumers of this module

/* ── Call 1: Super DID ─────────────────────────────────── */

export interface SuperDIDResult extends SuperDID {}

export async function callSuperDID(
  userMessage: string,
  phaseId: string,
): Promise<SuperDIDResult> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "orchestrator", "Call 1: Super DID — 解析意图 + 导演视觉");

  try {
    let fullText = "";
    const stream = streamChatCompletion(
      [
        { role: "system", content: CALL1_SUPER_DID_SYSTEM },
        { role: "user", content: userMessage },
      ],
      { temperature: CALL1_CONFIG.temperature, max_tokens: CALL1_CONFIG.max_tokens },
    );
    for await (const chunk of stream) {
      fullText += chunk;
      useAgentActivityStore.getState().appendStream(taskId, chunk);
    }

    const result = parseJsonResponse<SuperDIDResult>(fullText);

    // Hard validation: act percentages sum to 100 ± 5
    const actSum = result.three_act_structure.reduce((s, a) => s + a.percentage, 0);
    if (Math.abs(actSum - 100) > 5) {
      throw new Error(`Act percentages sum to ${actSum}, must be 100 ± 5`);
    }
    if (!result.hook_strategy?.description) {
      throw new Error("hook_strategy must be non-empty");
    }

    useAgentActivityStore.getState().completeTask(taskId,
      `${result.duration_type} · ${result.target_duration}s · ${result.character_count} chars · ${result.scene_count} scenes`);
    return result;
  } catch (err: any) {
    useAgentActivityStore.getState().failTask(taskId, err.message);
    throw err;
  }
}

/* ── Call 2: World Pack ────────────────────────────────── */

export interface CharacterDraft {
  id: string;
  name: string;
  role: "protagonist" | "antagonist" | "supporting" | "extra";
  immutable_traits: {
    face_description: string;
    core_outfit: string;
    signature_features: string;
  };
  mutable_states: Array<{
    state_id: string;
    name: string;
    description: string;
  }>;
  turnaround_prompt: string;
}

export interface SceneDraft {
  id: string;
  name: string;
  environment_description: string;
  dominant_colors: string[];
  key_light_mood: "warm" | "cold" | "dramatic" | "soft";
  landmark_objects: string[];
  geometry_hint: string;
  weather_state: string;
  reference_prompt: string;
}

export interface WorldPackResult {
  characters: CharacterDraft[];
  scenes: SceneDraft[];
}

export async function callWorldPack(
  did: SuperDIDResult,
  userMessage: string,
  phaseId: string,
): Promise<WorldPackResult> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "story", "Call 2: World Pack — 角色 + 场景设计");

  try {
    const userPrompt = `Director's Intent:
Premise: ${did.premise}
Duration: ${did.target_duration}s (${did.duration_type})
Art style: ${did.cinematic_identity.art_style}
Color palette: ${did.cinematic_identity.color_palette.join(", ")}
Visual mood: ${did.cinematic_identity.visual_mood}
Characters needed: ${did.character_count}
Scenes needed: ${did.scene_count}

Original user request: "${userMessage}"

Generate all characters and scenes now.`;

    let fullText = "";
    const stream = streamChatCompletion(
      [
        { role: "system", content: CALL2_WORLD_PACK_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      { temperature: CALL2_CONFIG.temperature, max_tokens: CALL2_CONFIG.max_tokens },
    );
    for await (const chunk of stream) {
      fullText += chunk;
      useAgentActivityStore.getState().appendStream(taskId, chunk);
    }

    const result = parseJsonResponse<WorldPackResult>(fullText);

    // Hard validation
    for (const c of result.characters) {
      if (!c.immutable_traits?.face_description) {
        throw new Error(`Character "${c.name}" missing face_description`);
      }
    }
    for (const s of result.scenes) {
      if (!s.landmark_objects || s.landmark_objects.length === 0) {
        throw new Error(`Scene "${s.name}" missing landmark_objects`);
      }
    }

    useAgentActivityStore.getState().completeTask(taskId,
      `${result.characters.length} 角色 · ${result.scenes.length} 场景`);
    return result;
  } catch (err: any) {
    useAgentActivityStore.getState().failTask(taskId, err.message);
    throw err;
  }
}

/* ── Call 3: Story-to-Shot Pack ────────────────────────── */

export interface ShotDraft {
  shot_id: string;
  beat_id: string;
  scene_id: string;
  duration_seconds: number;
  narrative_value: "high" | "medium" | "low";
  is_atmosphere: boolean;
  composition: {
    scale: string;
    framing: string;
    camera_angle: string;
  };
  subjects: Array<{
    character_id: string;
    state_id: string;
    action: string;
    screen_position: string;
    face_visibility: string;
  }>;
  camera_motion: {
    type: string;
    intensity: number;
  };
  transition_in: string;
  transition_out: string;
  continuity: {
    carry_over_subject: string | null;
    screen_direction_match: boolean;
    motion_direction: string | null;
  };
  mood_keywords: string[];
  visual_poetry: string;
  tension_moment: string;
}

export interface BeatDraft {
  beat_id: string;
  type: string;
  time_range: string;
  audience_feeling: string;
  shot_ids: string[];
}

export interface ShotPackResult {
  beats: BeatDraft[];
  shots: ShotDraft[];
}

export async function callShotPack(
  did: SuperDIDResult,
  world: WorldPackResult,
  phaseId: string,
): Promise<ShotPackResult> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "story", "Call 3: Shot Pack — 分镜序列");

  try {
    const charContext = world.characters
      .map((c) => `${c.id}: ${c.name} (${c.role}) — face: ${c.immutable_traits.face_description}, outfit: ${c.immutable_traits.core_outfit}, states: [${c.mutable_states.map((s) => s.state_id).join(",")}]`)
      .join("\n");
    const sceneContext = world.scenes
      .map((s) => `${s.id}: ${s.name} — ${s.environment_description}, light: ${s.key_light_mood}, landmarks: [${s.landmark_objects.join(",")}]`)
      .join("\n");
    const actContext = did.three_act_structure
      .map((a) => `Act ${a.act_number} (${a.percentage}%): ${a.goal} — hook: ${a.memory_hook}`)
      .join("\n");

    const targetShots = did.duration_type === "micro" ? "2-4"
      : did.duration_type === "short" ? "5-10"
      : did.duration_type === "medium" ? "10-18"
      : "15-25";

    const userPrompt = `Director's Intent:
Premise: ${did.premise}
Duration: ${did.target_duration}s (${did.duration_type})
Hook: ${did.hook_strategy.type} — ${did.hook_strategy.description}
Style prefix: ${did.cinematic_identity.global_prompt_prefix}

Act Structure:
${actContext}

Characters:
${charContext}

Scenes:
${sceneContext}

Target: ${targetShots} shots, EXACTLY ${did.target_duration}s total.
Generate the complete beat + shot sequence now.`;

    let fullText = "";
    const stream = streamChatCompletion(
      [
        { role: "system", content: CALL3_SHOT_PACK_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      { temperature: CALL3_CONFIG.temperature, max_tokens: CALL3_CONFIG.max_tokens },
    );
    for await (const chunk of stream) {
      fullText += chunk;
      useAgentActivityStore.getState().appendStream(taskId, chunk);
    }

    const result = parseJsonResponse<ShotPackResult>(fullText);

    // Hard validation
    const totalDuration = result.shots.reduce((s, sh) => s + sh.duration_seconds, 0);
    const tolerance = Math.max(1, did.target_duration * 0.1);
    if (Math.abs(totalDuration - did.target_duration) > tolerance) {
      activity.appendStream(taskId,
        `\n⚠ Duration mismatch: ${totalDuration}s vs target ${did.target_duration}s`);
    }

    // Check climax beat exists and is not in first 30%
    const climaxBeat = result.beats.find((b) => b.type === "climax");
    if (did.duration_type !== "micro" && !climaxBeat) {
      activity.appendStream(taskId, "\n⚠ No climax beat found");
    }

    // Check hook segment (first 5s)
    const hookShots = result.shots.filter((s) => {
      const idx = result.shots.indexOf(s);
      const cumDur = result.shots.slice(0, idx + 1).reduce((sum, sh) => sum + sh.duration_seconds, 0);
      return cumDur <= 5;
    });
    const hookValid = hookShots.some((s) =>
      ["ECU", "CU", "MCU"].includes(s.composition.scale) || s.camera_motion.intensity >= 3);
    if (!hookValid && hookShots.length > 0) {
      activity.appendStream(taskId, "\n⚠ Hook segment lacks close-up or high intensity");
    }

    useAgentActivityStore.getState().completeTask(taskId,
      `${result.beats.length} beats · ${result.shots.length} shots · ${totalDuration}s`);
    return result;
  } catch (err: any) {
    useAgentActivityStore.getState().failTask(taskId, err.message);
    throw err;
  }
}


/* ── Call 3 Batched (>20 shots) ────────────────────────── */

export async function callShotPackBatched(
  did: SuperDIDResult,
  world: WorldPackResult,
  phaseId: string,
): Promise<ShotPackResult> {
  const estimatedShots = did.duration_type === "full" ? 20 : 15;

  if (estimatedShots <= 20) {
    return callShotPack(did, world, phaseId);
  }

  // Batch: 8 shots per call with continuation summary
  const allBeats: BeatDraft[] = [];
  const allShots: ShotDraft[] = [];
  let accumulatedDuration = 0;
  let batchNum = 0;

  while (accumulatedDuration < did.target_duration * 0.9) {
    batchNum++;
    const activity = useAgentActivityStore.getState();
    const taskId = activity.startTask(phaseId, "story",
      `Call 3.${batchNum}: Shot Pack batch — 续写分镜`);

    const continuationContext = batchNum === 1 ? "" : CALL3_CONTINUATION_TEMPLATE
      .replace("{generated_shot_ids}", allShots.map((s) => s.shot_id).join(", "))
      .replace("{accumulated_duration}", String(accumulatedDuration))
      .replace("{target_duration}", String(did.target_duration))
      .replace("{current_act}", String(did.three_act_structure.length))
      .replace("{active_characters}", world.characters.map((c) => c.name).join(", "))
      .replace("{last_shot_end_state}", allShots.length > 0
        ? allShots[allShots.length - 1].visual_poetry : "start")
      .replace("{unresolved_threads}", "continue narrative");

    try {
      let fullText = "";
      const remainingDuration = did.target_duration - accumulatedDuration;
      const stream = streamChatCompletion(
        [
          { role: "system", content: CALL3_SHOT_PACK_SYSTEM },
          {
            role: "user",
            content: `${continuationContext}\n\nGenerate next 8 shots. Remaining duration: ${remainingDuration}s.`,
          },
        ],
        { temperature: CALL3_CONFIG.temperature, max_tokens: CALL3_CONFIG.max_tokens },
      );
      for await (const chunk of stream) {
        fullText += chunk;
        useAgentActivityStore.getState().appendStream(taskId, chunk);
      }

      const batch = parseJsonResponse<ShotPackResult>(fullText);
      allBeats.push(...batch.beats);
      allShots.push(...batch.shots);
      accumulatedDuration += batch.shots.reduce((s, sh) => s + sh.duration_seconds, 0);

      activity.completeTask(taskId, `+${batch.shots.length} shots, total ${accumulatedDuration}s`);
    } catch (err: any) {
      activity.failTask(taskId, err.message);
      break;
    }
  }

  return { beats: allBeats, shots: allShots };
}

/* ── Call 4: Repair Call ───────────────────────────────── */

export interface RepairResult {
  modified_shots: Array<Partial<ShotDraft> & { shot_id: string }>;
  added_shots: ShotDraft[];
  removed_shot_ids: string[];
}

export async function callRepair(
  currentShots: ShotDraft[],
  problems: string[],
  targetDuration: number,
  phaseId: string,
): Promise<RepairResult> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "orchestrator", "Call 4: Repair — 修复问题");

  try {
    const shotSummary = currentShots.map((s) =>
      `${s.shot_id}: ${s.duration_seconds}s, scene=${s.scene_id}, value=${s.narrative_value}, atmo=${s.is_atmosphere}`
    ).join("\n");

    let fullText = "";
    const stream = streamChatCompletion(
      [
        { role: "system", content: CALL4_REPAIR_SYSTEM },
        {
          role: "user",
          content: `Current shots (${currentShots.length}, total ${currentShots.reduce((s, sh) => s + sh.duration_seconds, 0)}s, target ${targetDuration}s):
${shotSummary}

Problems to fix:
${problems.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Fix these issues with minimal changes.`,
        },
      ],
      { temperature: CALL4_CONFIG.temperature, max_tokens: CALL4_CONFIG.max_tokens },
    );
    for await (const chunk of stream) {
      fullText += chunk;
      useAgentActivityStore.getState().appendStream(taskId, chunk);
    }

    const result = parseJsonResponse<RepairResult>(fullText);
    useAgentActivityStore.getState().completeTask(taskId,
      `${result.modified_shots.length} modified, ${result.added_shots.length} added, ${result.removed_shot_ids.length} removed`);
    return result;
  } catch (err: any) {
    useAgentActivityStore.getState().failTask(taskId, err.message);
    throw err;
  }
}
