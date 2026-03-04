/**
 * Story & Storyboard Agent — optimized with streaming support.
 *
 * Performance optimizations:
 * 1. Split generation into 2 phases: characters+scenes first (fast), then shots (with context)
 * 2. Pre-fill deterministic fields (negative_prompt, transition defaults) to reduce token output
 * 3. Use non-streaming for intent parsing (tiny response, streaming overhead wasteful)
 * 4. Provide enum constraints inline so LLM doesn't hallucinate values
 * 5. Use temperature 0.2 for structured output, 0.8 only for creative content
 */
import { streamChatCompletion, chatCompletion, parseJsonResponse } from "../api/deepseek";
import { useAgentActivityStore } from "../stores/agent-activity.store";
import type { Character, Scene, Shot, StyleProfile, AudioProfile } from "../types";

/* ── Types ─────────────────────────────────────────────── */

interface CharacterDraft {
  name: string;
  visual_description: string;
  personality: string;
  role_in_story: string;
  voice_id: string | null;
  status: string;
}

interface SceneDraft {
  name: string;
  description: string;
  lighting: string;
  weather: string;
  time_of_day: string;
  mood: string;
}

interface ShotDraft {
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
  generation_prompt?: string; // optional — now built by prompt-builder, LLM may still return it
  transition_to_next: string;
  is_key_shot: boolean;
}

interface StoryGenerationResult {
  characters: CharacterDraft[];
  scenes: SceneDraft[];
  shots: ShotDraft[];
  warnings: string[];
}

/* ── Default negative prompt (no need for LLM to generate this) ── */

const DEFAULT_NEGATIVE_PROMPT =
  "blurry, low quality, distorted face, extra limbs, watermark, text overlay, bad anatomy, deformed, ugly, duplicate";

/* ── Enum constraints (injected into prompts to prevent hallucination) ── */

const ENUMS = {
  shot_type: "wide|medium|close_up|extreme_close_up|over_shoulder|pov|aerial",
  camera_movement: "static|pan_left|pan_right|tilt_up|tilt_down|dolly_in|dolly_out|tracking|handheld",
  emotion_tag: "tense|joyful|melancholy|neutral|explosive|mysterious|romantic|horror",
  transition: "cut|fade|dissolve|wipe|match_cut",
};

/* ── Phase 1: Characters + Scenes (fast, small output) ── */

const PHASE1_SYSTEM = `You are a professional film director. Given a story description, generate ONLY the characters and scenes (NOT shots).

Output STRICT JSON:
{
  "characters": [{ "name": "string", "visual_description": "detailed appearance for AI image generation (include hair, clothing, build, distinguishing features)", "personality": "brief", "role_in_story": "protagonist/antagonist/supporting", "voice_id": null, "status": "alive" }],
  "scenes": [{ "name": "short name", "description": "detailed environment for AI generation", "lighting": "string", "weather": "string", "time_of_day": "morning/afternoon/evening/night", "mood": "string" }]
}

Rules:
- 2-5 characters max for a short video
- 3-8 scenes max
- visual_description must be detailed enough for consistent AI image generation across shots
- scene description must include spatial layout, key objects, atmosphere`;

/* ── Phase 2: Shots (with character+scene context) ────── */

const PHASE2_SYSTEM = `You are a professional film director. Given characters and scenes, generate the shot sequence.

Output STRICT JSON:
{
  "shots": [{ "sequence_number": 1, "act_number": 1, "scene_name": "must match a scene name exactly", "character_names": ["must match character names exactly"], "shot_type": "${ENUMS.shot_type}", "camera_movement": "${ENUMS.camera_movement}", "duration": 4-12, "dialogue": "string or null", "dialogue_character": "character name or null", "narration": "string or null", "action_description": "concise description of what happens in this shot — action, movement, expression", "emotion_tag": "${ENUMS.emotion_tag}", "transition_to_next": "${ENUMS.transition}", "is_key_shot": false }],
  "warnings": ["any narrative warnings"]
}

Rules:
- Target {TARGET_SHOTS} shots, {TARGET_DURATION}s total
- Each shot 4-12 seconds
- DO NOT generate "generation_prompt" — it will be assembled automatically from templates
- action_description should focus ONLY on what happens (action, emotion, composition) — NOT character appearance or scene environment (those are injected from fixed templates)
- Vary shot_type and camera_movement for cinematic feel
- Mark 2-3 pivotal moments as is_key_shot: true
- Use "cut" for most transitions, save special transitions for dramatic moments
- DO NOT include negative_prompt (it's handled separately)`;

/* ── Main generation function ─────────────────────────── */

export async function generateStoryStreaming(
  userPrompt: string,
  styleProfile: StyleProfile,
  _audioProfile: AudioProfile,
  targetDuration: number,
  phaseId: string,
): Promise<StoryGenerationResult> {
  const activity = useAgentActivityStore.getState();
  const targetShots = Math.round(targetDuration / 8); // ~8s average per shot

  // ── Phase 1: Characters + Scenes ──
  const phase1TaskId = activity.startTask(phaseId, "story", "🎭 创作Agent: 构建角色与场景");

  let phase1Text = "";
  let charSceneResult: { characters: CharacterDraft[]; scenes: SceneDraft[] };

  try {
    const stream = streamChatCompletion(
      [
        { role: "system", content: PHASE1_SYSTEM },
        {
          role: "user",
          content: `Story: "${userPrompt}"
Style: ${styleProfile.visual_style || "auto"}, color: ${styleProfile.color_tone || "auto"}, ratio: ${styleProfile.aspect_ratio}
Target: ${targetDuration}s video (~${Math.round(targetDuration / 60)} min)`,
        },
      ],
      { temperature: 0.7, max_tokens: 2048 },
    );

    for await (const chunk of stream) {
      phase1Text += chunk;
      useAgentActivityStore.getState().appendStream(phase1TaskId, chunk);
    }

    charSceneResult = parseJsonResponse<{ characters: CharacterDraft[]; scenes: SceneDraft[] }>(phase1Text);
    useAgentActivityStore.getState().completeTask(
      phase1TaskId,
      `✅ ${charSceneResult.characters.length} 角色, ${charSceneResult.scenes.length} 场景`,
    );
  } catch (err: any) {
    useAgentActivityStore.getState().failTask(phase1TaskId, err.message);
    throw err;
  }

  // ── Phase 2: Shots (with character+scene context) ──
  const phase2TaskId = activity.startTask(phaseId, "story", "🎬 创作Agent: 生成分镜序列");

  let phase2Text = "";
  let shotsResult: { shots: ShotDraft[]; warnings: string[] };

  try {
    const phase2System = PHASE2_SYSTEM
      .replace("{TARGET_SHOTS}", String(targetShots))
      .replace("{TARGET_DURATION}", String(targetDuration));

    // Build compact context string for characters and scenes
    const charContext = charSceneResult.characters
      .map((c) => `${c.name}: ${c.visual_description} (${c.role_in_story})`)
      .join("\n");
    const sceneContext = charSceneResult.scenes
      .map((s) => `${s.name}: ${s.description} [${s.time_of_day}, ${s.lighting}, ${s.mood}]`)
      .join("\n");

    const stream = streamChatCompletion(
      [
        { role: "system", content: phase2System },
        {
          role: "user",
          content: `Story: "${userPrompt}"

Characters:
${charContext}

Scenes:
${sceneContext}

Generate ${targetShots} shots now.`,
        },
      ],
      { temperature: 0.8, max_tokens: 6144 },
    );

    for await (const chunk of stream) {
      phase2Text += chunk;
      useAgentActivityStore.getState().appendStream(phase2TaskId, chunk);
    }

    shotsResult = parseJsonResponse<{ shots: ShotDraft[]; warnings: string[] }>(phase2Text);

    // Post-process: add default negative_prompt to all shots
    for (const shot of shotsResult.shots) {
      (shot as any).negative_prompt = DEFAULT_NEGATIVE_PROMPT;
    }

    useAgentActivityStore.getState().completeTask(
      phase2TaskId,
      `✅ ${shotsResult.shots.length} 镜头`,
    );
  } catch (err: any) {
    useAgentActivityStore.getState().failTask(phase2TaskId, err.message);
    throw err;
  }

  return {
    characters: charSceneResult.characters,
    scenes: charSceneResult.scenes,
    shots: shotsResult.shots,
    warnings: shotsResult.warnings || [],
  };
}

/* ── Intent parsing (non-streaming for speed) ─────────── */

export async function parseUserIntentStreaming(
  message: string,
  projectContext: { shotCount: number; characterNames: string[]; sceneNames: string[] },
  phaseId: string,
): Promise<{
  type: "new_project" | "modify_shot" | "modify_character" | "modify_scene" | "modify_global" | "generate" | "export" | "chat";
  target_id?: string;
  target_name?: string;
  details?: string;
}> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "orchestrator", "🧠 主控Agent: 解析用户意图");
  activity.appendStream(taskId, `分析: "${message.slice(0, 50)}..."\n`);

  try {
    // Non-streaming — intent parsing is tiny, no need for SSE overhead
    const raw = await chatCompletion(
      [
        {
          role: "system",
          content: `You are an intent parser. Return JSON: { "type": "new_project|modify_shot|modify_character|modify_scene|modify_global|generate|export|chat", "target_name": "optional", "details": "extracted details" }
Context: ${projectContext.shotCount} shots, characters: [${projectContext.characterNames.join(",")}], scenes: [${projectContext.sceneNames.join(",")}]`,
        },
        { role: "user", content: message },
      ],
      { temperature: 0.1, max_tokens: 256 },
    );

    const result = parseJsonResponse<any>(raw);
    activity.appendStream(taskId, `意图类型: ${result.type}\n`);
    if (result.target_name) activity.appendStream(taskId, `目标: ${result.target_name}\n`);
    if (result.details) activity.appendStream(taskId, `详情: ${result.details}\n`);
    activity.completeTask(taskId, `意图: ${result.type}`);
    return result;
  } catch (err: any) {
    activity.failTask(taskId, err.message);
    throw err;
  }
}

/* ── Shot modification (streaming for visibility) ─────── */

export async function modifyShotStreaming(
  shot: Shot,
  instruction: string,
  characters: Character[],
  scene: Scene,
  phaseId: string,
): Promise<Partial<Shot>> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "story", "✏️ 创作Agent: 修改镜头 #" + shot.sequence_number);

  let fullText = "";
  try {
    // Only send the fields the LLM might need to change — not the full shot blob
    // Note: generation_prompt is NOT included — it's assembled by prompt-builder, not LLM
    const editableFields = {
      action_description: shot.action_description,
      dialogue: shot.dialogue,
      narration: shot.narration,
      shot_type: shot.shot_type,
      camera_movement: shot.camera_movement,
      duration: shot.duration,
      emotion_tag: shot.emotion_tag,
      transition_to_next: shot.transition_to_next,
    };

    const stream = streamChatCompletion(
      [
        {
          role: "system",
          content: `You are a film director. Modify the shot based on the instruction. Return ONLY changed fields as JSON.
Valid values — shot_type: ${ENUMS.shot_type} | camera_movement: ${ENUMS.camera_movement} | emotion_tag: ${ENUMS.emotion_tag} | transition: ${ENUMS.transition}`,
        },
        {
          role: "user",
          content: `Shot #${shot.sequence_number}: ${JSON.stringify(editableFields)}
Characters: ${characters.map((c) => `${c.name}: ${c.visual_description}`).join("; ")}
Scene: ${scene.name} - ${scene.description}
Instruction: ${instruction}`,
        },
      ],
      { temperature: 0.5, max_tokens: 1024 },
    );

    for await (const chunk of stream) {
      fullText += chunk;
      useAgentActivityStore.getState().appendStream(taskId, chunk);
    }

    const result = parseJsonResponse<Partial<Shot>>(fullText);
    useAgentActivityStore.getState().completeTask(taskId, `已修改镜头 #${shot.sequence_number}`);
    return result;
  } catch (err: any) {
    useAgentActivityStore.getState().failTask(taskId, err.message);
    throw err;
  }
}
