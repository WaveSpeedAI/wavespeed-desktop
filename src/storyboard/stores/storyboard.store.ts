/**
 * Main storyboard store — manages project, characters, scenes, shots, and agent state.
 * Uses streaming agents with real-time activity reporting.
 */
import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type {
  Project,
  ProjectMode,
  ProjectStatus,
  Character,
  Scene,
  Shot,
  DependencyEdge,
  EditHistoryEntry,
  StyleProfile,
  AudioProfile,
  GenerationStatus,
} from "../types";
import {
  routeInput,
  routerToIntent,
  generateCharacterCards,
  generateSceneCards,
  generateShotSequence,
  translatePrompts,
} from "../agents/pipeline";
import { modifyShotStreaming } from "../agents/story-agent";
import { setDeepSeekApiKey, setDeepSeekBaseUrl, setDeepSeekModel } from "../api/deepseek";
import { useAgentActivityStore } from "./agent-activity.store";
import { DEFAULT_MODELS, type ModelCategory, type ModelOption } from "../models/model-config";
import { ffmpegMerge } from "@/workflow/browser/ffmpeg-helpers";
import type { CharacterStatus } from "../types";
import { buildExecutionPlan, type ShotPrompts } from "../engine/rule-engine";
import { executePlan } from "../engine/scheduler";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  /** If true, content is still being streamed (show typing indicator) */
  isStreaming?: boolean;
}

interface StoryboardState {
  // Project
  project: Project | null;
  characters: Character[];
  scenes: Scene[];
  shots: Shot[];
  edges: DependencyEdge[];
  editHistory: EditHistoryEntry[];
  chatMessages: ChatMessage[];

  // UI state
  selectedShotId: string | null;
  selectedCharacterId: string | null;
  selectedSceneId: string | null;
  isAgentWorking: boolean;
  error: string | null;

  // Assembly state
  assembledVideoUrl: string | null;
  isAssembling: boolean;
  assembleError: string | null;

  // Model selection
  selectedModels: Record<ModelCategory, ModelOption>;

  // Actions
  initProject: (name: string, mode: ProjectMode, prompt: string) => Promise<void>;
  setApiKey: (key: string) => void;
  setLlmConfig: (config: { apiKey?: string; baseUrl?: string; model?: string }) => void;
  setModel: (category: ModelCategory, model: ModelOption) => void;
  selectShot: (id: string | null) => void;
  selectCharacter: (id: string | null) => void;
  selectScene: (id: string | null) => void;
  sendMessage: (message: string) => Promise<void>;
  updateShot: (shotId: string, updates: Partial<Shot>) => void;
  updateCharacter: (charId: string, updates: Partial<Character>) => void;
  updateScene: (sceneId: string, updates: Partial<Scene>) => void;
  appendToMessage: (messageId: string, chunk: string) => void;
  finalizeMessage: (messageId: string) => void;
  regenerateShot: (shotId: string) => void;
  markDirty: (shotIds: string[]) => void;
  deleteShotById: (shotId: string) => void;
  insertShotAfter: (afterShotId: string, description: string) => Promise<void>;
  reorderShot: (shotId: string, newIndex: number) => void;
  setProjectStatus: (status: ProjectStatus) => void;
  startGeneration: () => Promise<void>;
  assembleAllShots: () => Promise<void>;
  toggleMode: () => void;
  computeDirtyPropagation: (changedEntityType: string, entityId: string) => string[];
  reset: () => void;
}

const defaultStyleProfile: StyleProfile = {
  visual_style: "",
  color_tone: "",
  aspect_ratio: "16:9",
  reference_images: [],
};

const defaultAudioProfile: AudioProfile = {
  bgm_style: "",
  narration_voice: null,
  sfx_density: "normal",
};

/**
 * Extract target duration from user prompt.
 * Supports: "20s", "20 seconds", "2min", "1.5 minutes", and CJK equivalents
 * Falls back to 30s for short-form hints, 60s otherwise.
 */
function extractDuration(prompt: string): number {
  // Match seconds patterns (including CJK)
  const secMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:s|秒|seconds?|sec)\b/i);
  if (secMatch) return Math.max(4, Math.min(600, parseFloat(secMatch[1])));

  // Match minutes patterns (including CJK)
  const minMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:分钟|min(?:utes?)?|mins?)\b/i);
  if (minMatch) return Math.max(4, Math.min(600, parseFloat(minMatch[1]) * 60));

  // Heuristic: short video keywords -> 14s, otherwise 14s (default changed from 60s)
  if (/短视频|短片|short|brief|快速/i.test(prompt)) return 14;
  return 14;
}

function buildDependencyEdges(shots: Shot[]): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const sorted = [...shots].sort((a, b) => a.sequence_number - b.sequence_number);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const strategy = curr.strategy;

    if (strategy) {
      // Strategy-aware edges
      if (strategy.use_frame_chain) {
        edges.push({ from: prev.shot_id, to: curr.shot_id, type: "frame_chain" });
      }
      // Always add narrative order for adjacent shots
      edges.push({ from: prev.shot_id, to: curr.shot_id, type: "narrative_order" });
    } else {
      // Fallback: old behavior
      if (prev.scene_id === curr.scene_id) {
        edges.push({ from: prev.shot_id, to: curr.shot_id, type: "frame_chain" });
      }
      edges.push({ from: prev.shot_id, to: curr.shot_id, type: "narrative_order" });
    }
  }
  return edges;
}

export const useStoryboardStore = create<StoryboardState>((set, get) => ({
  project: null,
  characters: [],
  scenes: [],
  shots: [],
  edges: [],
  editHistory: [],
  chatMessages: [],
  selectedShotId: null,
  selectedCharacterId: null,
  selectedSceneId: null,
  isAgentWorking: false,
  error: null,

  assembledVideoUrl: null,
  isAssembling: false,
  assembleError: null,

  selectedModels: { ...DEFAULT_MODELS },

  setApiKey: (key: string) => setDeepSeekApiKey(key),

  setLlmConfig: (config) => {
    if (config.apiKey) setDeepSeekApiKey(config.apiKey);
    if (config.baseUrl) setDeepSeekBaseUrl(config.baseUrl);
    if (config.model) setDeepSeekModel(config.model);
  },

  setModel: (category, model) =>
    set((s) => ({
      selectedModels: { ...s.selectedModels, [category]: model },
    })),

  selectShot: (id) => set({ selectedShotId: id, selectedCharacterId: null, selectedSceneId: null }),
  selectCharacter: (id) => set({ selectedCharacterId: id, selectedShotId: null, selectedSceneId: null }),
  selectScene: (id) => set({ selectedSceneId: id, selectedShotId: null, selectedCharacterId: null }),

  setProjectStatus: (status) =>
    set((s) => s.project ? { project: { ...s.project, status, updated_at: Date.now() } } : {}),

  toggleMode: () =>
    set((s) => {
      if (!s.project) return {};
      const newMode: ProjectMode = s.project.mode === "lite" ? "pro" : "lite";
      return { project: { ...s.project, mode: newMode, updated_at: Date.now() } };
    }),

  startGeneration: async () => {
    const state = get();
    if (!state.project) return;

    const pendingShots = state.shots
      .filter((s) => s.generation_status === "pending" || s.generation_status === "dirty")
      .sort((a, b) => a.sequence_number - b.sequence_number);

    if (pendingShots.length === 0) return;

    set({
      isAgentWorking: true,
      project: { ...state.project, status: "generating", updated_at: Date.now() },
      assembledVideoUrl: null,
      assembleError: null,
      chatMessages: [
        ...state.chatMessages,
        { id: uuid(), role: "assistant", content: `Generating ${pendingShots.length} shots...`, timestamp: Date.now() },
      ],
    });

    const activityStore = useAgentActivityStore.getState();

    try {
      // ── Stage 3.5: Prompt Translation ──
      // Build draft representations for the prompt translator
      const charDrafts = state.characters.map((c) => ({
        name: c.name,
        visual_prompt: c.visual_description,
        visual_negative: c.visual_negative || "",
        personality: c.personality,
        fighting_style: c.fighting_style || "",
        role_in_story: c.role_in_story,
        immutable_traits: c.immutable_traits ?? undefined,
        mutable_states: c.mutable_states ?? undefined,
      }));
      const sceneDrafts = state.scenes.map((s) => ({
        name: s.name,
        visual_prompt: s.visual_prompt || s.description,
        visual_negative: s.visual_negative || "",
        lighting: s.lighting,
        weather: s.weather,
        time_of_day: s.time_of_day,
        mood: s.mood,
        perspective_hint: s.perspective_hint ?? undefined,
      }));
      const shotDrafts = pendingShots.map((s) => {
        const scene = state.scenes.find((sc) => sc.scene_id === s.scene_id);
        const charNames = state.characters
          .filter((c) => s.character_ids.includes(c.character_id))
          .map((c) => c.name);
        return {
          sequence_number: s.sequence_number,
          act_number: s.act_number,
          scene_name: scene?.name ?? "",
          character_names: charNames,
          shot_type: s.shot_type,
          camera_movement: s.camera_movement,
          duration: s.duration,
          dialogue: s.dialogue,
          dialogue_character: s.dialogue_character,
          narration: s.narration,
          action_description: s.action_description,
          emotion_tag: s.emotion_tag,
          transition_to_next: s.transition_to_next,
          is_key_shot: s.is_key_shot,
          base_frame_request: s.base_frame_request ?? { subject_names: charNames, pose_or_angle: s.action_description, scene_context: "" },
          subject_motions: s.subject_motions ?? undefined,
          env_motion: s.env_motion ?? undefined,
        };
      });

      const promptPhaseId = activityStore.startPhase("Prompt Translation");
      const promptDrafts = await translatePrompts(shotDrafts, charDrafts, sceneDrafts, promptPhaseId);
      activityStore.completePhase(promptPhaseId);

      // Build prompt map: shot_id -> { image_prompt, video_prompt }
      const promptMap = new Map<string, ShotPrompts>();
      for (const shot of pendingShots) {
        const draft = promptDrafts.find((p) => p.shot_sequence === shot.sequence_number);
        if (draft) {
          promptMap.set(shot.shot_id, {
            image_prompt: draft.image_prompt,
            video_prompt: draft.video_prompt,
          });
        }
      }

      // ── Stage 4: Rule Engine (pure code) ──
      const plan = buildExecutionPlan(pendingShots, promptMap, state.characters, state.scenes);

      // ── Stage 5: Execution ──
      const execPhaseId = activityStore.startPhase("Execution");
      const result = await executePlan(plan, execPhaseId, {
        onShotComplete: (shotId, videoUrl) => {
          set((s) => ({
            shots: s.shots.map((sh) =>
              sh.shot_id === shotId
                ? {
                    ...sh,
                    generation_status: "done" as GenerationStatus,
                    generated_assets: {
                      ...sh.generated_assets,
                      video_path: videoUrl,
                      video_versions: [...sh.generated_assets.video_versions, videoUrl],
                      thumbnail: videoUrl,
                      last_frame_path: videoUrl,
                    },
                  }
                : sh,
            ),
          }));
        },
        onShotFailed: (shotId, error) => {
          set((s) => ({
            shots: s.shots.map((sh) =>
              sh.shot_id === shotId
                ? { ...sh, generation_status: "failed" as GenerationStatus, qc_warnings: [...sh.qc_warnings, error] }
                : sh,
            ),
          }));
        },
      });
      activityStore.completePhase(execPhaseId);

      // ── Summary ──
      const finalStatus: ProjectStatus = result.failed === 0 ? "done" : "ready";
      const summary = result.failed === 0
        ? `All ${result.success} shots generated successfully. Click preview to watch, or export.`
        : `${result.success} shots succeeded, ${result.failed} failed. Click retry on failed shots.`;

      set((s) => ({
        isAgentWorking: false,
        project: s.project ? { ...s.project, status: finalStatus, updated_at: Date.now() } : null,
        chatMessages: [
          ...s.chatMessages,
          { id: uuid(), role: "assistant", content: summary, timestamp: Date.now() },
        ],
      }));

      // Auto-assemble if all shots succeeded
      if (result.failed === 0 && result.success >= 2) {
        await get().assembleAllShots();
      }
    } catch (err: any) {
      set((s) => ({
        isAgentWorking: false,
        project: s.project ? { ...s.project, status: "ready", updated_at: Date.now() } : null,
        chatMessages: [
          ...s.chatMessages,
          { id: uuid(), role: "system", content: `Generation failed: ${err.message}`, timestamp: Date.now() },
        ],
      }));
    }
  },

  assembleAllShots: async () => {
    const state = get();
    const doneShots = state.shots
      .filter((s) => s.generation_status === "done" && s.generated_assets.video_path)
      .sort((a, b) => a.sequence_number - b.sequence_number);

    if (doneShots.length < 2) {
      set({ assembleError: "Need at least 2 completed shots to assemble" });
      return;
    }

    if (state.assembledVideoUrl) {
      URL.revokeObjectURL(state.assembledVideoUrl);
    }

    set({ isAssembling: true, assembleError: null, assembledVideoUrl: null });

    const activityStore = useAgentActivityStore.getState();
    const phaseId = activityStore.startPhase("Video Assembly");
    const taskId = activityStore.startTask(phaseId, "production", "Production Agent: assembling final video");
    activityStore.appendStream(taskId, `Concatenating ${doneShots.length} shots...\n`);

    try {
      const videoUrls = doneShots.map((s) => s.generated_assets.video_path!);
      activityStore.appendStream(taskId, "Running FFmpeg merge...\n");
      const blobUrl = await ffmpegMerge(videoUrls, "mp4");
      activityStore.appendStream(taskId, "Merge complete\n");
      activityStore.completeTask(taskId, "Final video assembled");
      activityStore.completePhase(phaseId);

      set({
        assembledVideoUrl: blobUrl,
        isAssembling: false,
        project: state.project ? { ...state.project, status: "done", updated_at: Date.now() } : null,
        chatMessages: [
          ...get().chatMessages,
          { id: uuid(), role: "assistant", content: "Final video assembled. Click preview to watch and export.", timestamp: Date.now() },
        ],
      });
    } catch (err: any) {
      activityStore.failTask(taskId, err.message);
      activityStore.completePhase(phaseId);
      set({
        isAssembling: false,
        assembleError: err.message,
        chatMessages: [
          ...get().chatMessages,
          { id: uuid(), role: "system", content: `Assembly failed: ${err.message}`, timestamp: Date.now() },
        ],
      });
    }
  },

  initProject: async (name, mode, prompt) => {
    const projectId = uuid();
    const targetDuration = extractDuration(prompt);
    const project: Project = {
      project_id: projectId,
      name,
      mode,
      status: "creating",
      style_profile: defaultStyleProfile,
      audio_profile: defaultAudioProfile,
      target_duration: targetDuration,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const activityStore = useAgentActivityStore.getState();
    activityStore.reset();

    set({
      project,
      isAgentWorking: true,
      chatMessages: [
        { id: uuid(), role: "user", content: prompt, timestamp: Date.now() },
      ],
      error: null,
    });

    // Create a streaming progress message
    const progressMsgId = uuid();
    set((s) => ({
      chatMessages: [
        ...s.chatMessages,
        { id: progressMsgId, role: "assistant", content: "", isStreaming: true, timestamp: Date.now() },
      ],
    }));
    const append = (text: string) => get().appendToMessage(progressMsgId, text);

    try {
      // ── Stage 0: Super Router (merged -1 + 0, single LLM call) ──
      append("🧭 正在分析你的创意...\n");
      const routerPhaseId = activityStore.startPhase("Input Routing");
      const routerResult = await routeInput(prompt, routerPhaseId);
      activityStore.completePhase(routerPhaseId);

      // If clarification needed (unclear/reject), ask user and stop
      if (routerResult.needs_clarification && routerResult.clarification_question) {
        // Replace the streaming message with the clarification question
        set((s) => ({
          isAgentWorking: false,
          project: { ...project, status: "idle" },
          chatMessages: s.chatMessages.map((m) =>
            m.id === progressMsgId
              ? { ...m, content: routerResult.clarification_question!, isStreaming: false }
              : m,
          ),
        }));
        return;
      }

      append(`✅ 意图识别完成: ${routerResult.confidence === "high" ? "高置信度" : routerResult.confidence === "medium" ? "中置信度" : "低置信度"}\n`);

      // Adapt router result to IntentResult for downstream stages
      const intent = routerToIntent(routerResult, targetDuration);

      // Override duration if router extracted a specific one
      const duration = intent.duration || targetDuration;

      // ── Stage 1: Character Cards ──
      append(`\n🎭 正在设计 ${intent.characters.length} 个角色...\n`);
      const charPhaseId = activityStore.startPhase("Character Design");
      const characterDrafts = await generateCharacterCards(intent, charPhaseId);
      activityStore.completePhase(charPhaseId);
      for (const c of characterDrafts) {
        append(`  · ${c.name} — ${c.personality}\n`);
      }

      // ── Stage 2: Scene Cards (serial dependency on Stage 1) ──
      append(`\n🏞 正在构建场景...\n`);
      const scenePhaseId = activityStore.startPhase("Scene Design");
      const sceneDrafts = await generateSceneCards(intent, characterDrafts, scenePhaseId);
      activityStore.completePhase(scenePhaseId);

      // Map drafts to domain entities
      const characters: Character[] = characterDrafts.map((c) => ({
        character_id: uuid(),
        project_id: projectId,
        name: c.name,
        visual_description: c.visual_prompt,
        visual_negative: c.visual_negative || "",
        personality: c.personality,
        role_in_story: c.role_in_story,
        fighting_style: c.fighting_style || "",
        voice_id: null,
        anchor_images: { front: null, side: null, full_body: null, battle: null },
        status: "alive" as CharacterStatus,
        version: 1,
        immutable_traits: c.immutable_traits ?? undefined,
        mutable_states: c.mutable_states ?? undefined,
      }));

      const scenes: Scene[] = sceneDrafts.map((s) => ({
        scene_id: uuid(),
        project_id: projectId,
        name: s.name,
        description: s.visual_prompt,
        visual_prompt: s.visual_prompt,
        visual_negative: s.visual_negative || "",
        lighting: s.lighting,
        weather: s.weather,
        time_of_day: s.time_of_day,
        mood: s.mood,
        anchor_image: null,
        version: 1,
        perspective_hint: s.perspective_hint ?? undefined,
      }));

      // ── Parallel: Stage 2.5 (asset gen) || Stage 3 (shot sequence) ──
      // Asset generation happens during startGeneration, not here.
      // Stage 3 runs now to get the shot sequence.
      append(`\n🎬 正在编排分镜序列...\n`);
      const shotPhaseId = activityStore.startPhase("Shot Sequence");
      const shotResult = await generateShotSequence(intent, characterDrafts, sceneDrafts, shotPhaseId);
      activityStore.completePhase(shotPhaseId);

      // Map shot drafts to domain entities
      const charMap = new Map(characters.map((c) => [c.name, c.character_id]));
      const sceneMap = new Map(scenes.map((s) => [s.name, s.scene_id]));

      const shots: Shot[] = (shotResult.shots || []).map((s: any, i: number) => ({
        shot_id: uuid(),
        project_id: projectId,
        sequence_number: s.sequence_number ?? i + 1,
        act_number: s.act_number ?? 1,
        scene_id: sceneMap.get(s.scene_name) ?? scenes[0]?.scene_id ?? "",
        character_ids: (s.character_names || []).map((n: string) => charMap.get(n) ?? "").filter(Boolean),
        shot_type: s.shot_type ?? "medium",
        camera_movement: s.camera_movement ?? "static",
        duration: s.duration ?? 6,
        dialogue: s.dialogue ?? null,
        dialogue_character: s.dialogue_character ? (charMap.get(s.dialogue_character) ?? null) : null,
        narration: s.narration ?? null,
        action_description: s.action_description ?? "",
        emotion_tag: s.emotion_tag ?? "neutral",
        generation_prompt: "",
        negative_prompt: "",
        transition_to_next: s.transition_to_next ?? "cut",
        is_key_shot: s.is_key_shot ?? false,
        dependencies: [],
        generation_status: "pending" as GenerationStatus,
        generated_assets: {
          video_path: null, video_versions: [], selected_version: 0,
          dialogue_audio: null, narration_audio: null, sfx_audio: null,
          last_frame_path: null, thumbnail: null,
        },
        qc_score: 0,
        qc_warnings: [],
        base_frame_request: s.base_frame_request ?? undefined,
        subject_motions: s.subject_motions ?? undefined,
        env_motion: s.env_motion ?? undefined,
      }));

      const edges = buildDependencyEdges(shots);
      for (const shot of shots) {
        shot.dependencies = edges.filter((e) => e.to === shot.shot_id).map((e) => e.from);
      }

      const totalDuration = shots.reduce((sum, s) => sum + s.duration, 0);
      const warnings = shotResult.warnings || [];

      // Finalize the streaming progress message
      append(`\n✅ 故事板就绪: ${characters.length} 角色 · ${scenes.length} 场景 · ${shots.length} 镜头 · ~${totalDuration}s`);
      if (warnings.length > 0) {
        append(`\n⚠ ${warnings.join(", ")}`);
      }
      append(`\n\n点击「生成」开始渲染视频。`);
      get().finalizeMessage(progressMsgId);

      set({
        project: { ...project, target_duration: duration, status: "ready", updated_at: Date.now() },
        characters,
        scenes,
        shots,
        edges,
        isAgentWorking: false,
      });
    } catch (err: any) {
      // Finalize the streaming message with error
      set((s) => ({
        isAgentWorking: false,
        error: err.message || "Pipeline failed",
        project: { ...project, status: "idle" },
        chatMessages: s.chatMessages.map((m) =>
          m.id === progressMsgId
            ? { ...m, content: m.content + `\n\n❌ 出错了: ${err.message}`, isStreaming: false }
            : m,
        ),
      }));
    }
  },

  sendMessage: async (message) => {
    const state = get();
    const newMsg: ChatMessage = { id: uuid(), role: "user", content: message, timestamp: Date.now() };
    set({ chatMessages: [...state.chatMessages, newMsg] });

    if (!state.project) {
      await get().initProject("New Project", "lite", message);
      return;
    }

    set({ isAgentWorking: true });
    const activityStore = useAgentActivityStore.getState();
    const phaseId = activityStore.startPhase("User Command");

    try {
      // Super Router: single call to classify + normalize + extract
      const routerResult = await routeInput(message, phaseId);

      // If clarification needed (unclear/reject), ask and stop
      if (routerResult.needs_clarification && routerResult.clarification_question) {
        activityStore.completePhase(phaseId);
        set({
          isAgentWorking: false,
          chatMessages: [
            ...get().chatMessages,
            { id: uuid(), role: "assistant", content: routerResult.clarification_question, timestamp: Date.now() },
          ],
        });
        return;
      }

      if (routerResult.intent === "create") {
        // New project creation from existing project context
        activityStore.completePhase(phaseId);
        await get().initProject("New Project", "lite", message);
        return;
      }

      if (routerResult.intent === "modify") {
        // Modification — use legacy intent parser for shot-level routing
        const parseUserIntentStreaming = (await import("../agents/story-agent")).parseUserIntentStreaming;
        const legacyIntent = await parseUserIntentStreaming(message, {
          shotCount: state.shots.length,
          characterNames: state.characters.map((c) => c.name),
          sceneNames: state.scenes.map((s) => s.name),
        }, phaseId);

        if (legacyIntent.type === "modify_shot" && legacyIntent.target_name) {
          const shotNum = parseInt(legacyIntent.target_name);
          const targetShot = !isNaN(shotNum)
            ? state.shots.find((s) => s.sequence_number === shotNum)
            : state.shots.find((s) => s.action_description.includes(legacyIntent.target_name!));

          if (targetShot) {
            const scene = state.scenes.find((s) => s.scene_id === targetShot.scene_id);
            const chars = state.characters.filter((c) => targetShot.character_ids.includes(c.character_id));
            const updates = await modifyShotStreaming(targetShot, legacyIntent.details || message, chars, scene!, phaseId);
            get().updateShot(targetShot.shot_id, { ...updates, generation_status: "dirty" });
            set({
              chatMessages: [...get().chatMessages, { id: uuid(), role: "assistant", content: `Modified shot #${targetShot.sequence_number}`, timestamp: Date.now() }],
            });
          }
        } else if (legacyIntent.type === "generate") {
          await get().startGeneration();
        } else {
          set({
            chatMessages: [...get().chatMessages, { id: uuid(), role: "assistant", content: `Got it. ${legacyIntent.details || ""}`, timestamp: Date.now() }],
          });
        }
      } else {
        // Unclear intent — just acknowledge
        set({
          chatMessages: [...get().chatMessages, { id: uuid(), role: "assistant", content: `Got it. ${routerResult.normalized_brief}`, timestamp: Date.now() }],
        });
      }

      activityStore.completePhase(phaseId);
    } catch (err: any) {
      activityStore.completePhase(phaseId);
      set({
        chatMessages: [...get().chatMessages, { id: uuid(), role: "system", content: `Error: ${err.message}`, timestamp: Date.now() }],
      });
    } finally {
      set({ isAgentWorking: false });
    }
  },

  updateShot: (shotId, updates) =>
    set((s) => ({
      shots: s.shots.map((shot) =>
        shot.shot_id === shotId ? { ...shot, ...updates, generation_status: updates.generation_status ?? "dirty" } : shot,
      ),
    })),

  updateCharacter: (charId, updates) =>
    set((s) => ({
      characters: s.characters.map((c) =>
        c.character_id === charId ? { ...c, ...updates, version: c.version + 1 } : c,
      ),
    })),

  updateScene: (sceneId, updates) =>
    set((s) => ({
      scenes: s.scenes.map((sc) =>
        sc.scene_id === sceneId ? { ...sc, ...updates, version: sc.version + 1 } : sc,
      ),
    })),

  appendToMessage: (messageId, chunk) =>
    set((s) => ({
      chatMessages: s.chatMessages.map((m) =>
        m.id === messageId ? { ...m, content: m.content + chunk } : m,
      ),
    })),

  finalizeMessage: (messageId) =>
    set((s) => ({
      chatMessages: s.chatMessages.map((m) =>
        m.id === messageId ? { ...m, isStreaming: false } : m,
      ),
    })),

  regenerateShot: (shotId) =>
    set((s) => ({
      shots: s.shots.map((shot) =>
        shot.shot_id === shotId ? { ...shot, generation_status: "pending" as GenerationStatus } : shot,
      ),
    })),

  markDirty: (shotIds) =>
    set((s) => ({
      shots: s.shots.map((shot) =>
        shotIds.includes(shot.shot_id) ? { ...shot, generation_status: "dirty" as GenerationStatus } : shot,
      ),
    })),

  deleteShotById: (shotId) =>
    set((s) => {
      const remaining = s.shots.filter((sh) => sh.shot_id !== shotId);
      const sorted = remaining.sort((a, b) => a.sequence_number - b.sequence_number);
      sorted.forEach((sh, i) => { sh.sequence_number = i + 1; });
      return { shots: sorted, edges: buildDependencyEdges(sorted), selectedShotId: null };
    }),

  insertShotAfter: async (afterShotId, description) => {
    const s = get();
    const afterShot = s.shots.find((sh) => sh.shot_id === afterShotId);
    if (!afterShot) return;

    const newShot: Shot = {
      shot_id: uuid(),
      project_id: s.project?.project_id ?? "",
      sequence_number: afterShot.sequence_number + 0.5,
      act_number: afterShot.act_number,
      scene_id: afterShot.scene_id,
      character_ids: [],
      shot_type: "medium",
      camera_movement: "static",
      duration: 6,
      dialogue: null,
      dialogue_character: null,
      narration: null,
      action_description: description,
      emotion_tag: "neutral",
      generation_prompt: "",
      negative_prompt: "",
      transition_to_next: "cut",
      is_key_shot: false,
      dependencies: [],
      generation_status: "pending",
      generated_assets: { video_path: null, video_versions: [], selected_version: 0, dialogue_audio: null, narration_audio: null, sfx_audio: null, last_frame_path: null, thumbnail: null },
      qc_score: 0,
      qc_warnings: [],
    };

    const allShots = [...s.shots, newShot].sort((a, b) => a.sequence_number - b.sequence_number);
    allShots.forEach((sh, i) => { sh.sequence_number = i + 1; });
    set({ shots: allShots, edges: buildDependencyEdges(allShots) });
  },

  reorderShot: (shotId, newIndex) =>
    set((s) => {
      const shots = [...s.shots].sort((a, b) => a.sequence_number - b.sequence_number);
      const idx = shots.findIndex((sh) => sh.shot_id === shotId);
      if (idx === -1) return {};
      const [moved] = shots.splice(idx, 1);
      shots.splice(newIndex, 0, moved);
      shots.forEach((sh, i) => { sh.sequence_number = i + 1; });
      return { shots, edges: buildDependencyEdges(shots) };
    }),

  computeDirtyPropagation: (changedEntityType, entityId) => {
    const s = get();
    const dirtyIds: string[] = [];
    if (changedEntityType === "character") {
      s.shots.forEach((shot) => { if (shot.character_ids.includes(entityId)) dirtyIds.push(shot.shot_id); });
    } else if (changedEntityType === "scene") {
      s.shots.forEach((shot) => { if (shot.scene_id === entityId) dirtyIds.push(shot.shot_id); });
    } else if (changedEntityType === "global_style") {
      s.shots.forEach((shot) => dirtyIds.push(shot.shot_id));
    } else if (changedEntityType === "shot") {
      const downstream = new Set<string>();
      const queue = [entityId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        s.edges.filter((e) => e.from === current && e.type === "frame_chain").forEach((e) => {
          if (!downstream.has(e.to)) { downstream.add(e.to); queue.push(e.to); }
        });
      }
      downstream.forEach((id) => dirtyIds.push(id));
    }
    return dirtyIds;
  },

  reset: () => {
    const state = get();
    if (state.assembledVideoUrl) URL.revokeObjectURL(state.assembledVideoUrl);
    useAgentActivityStore.getState().reset();
    set({
      project: null, characters: [], scenes: [], shots: [], edges: [],
      editHistory: [], chatMessages: [], selectedShotId: null,
      selectedCharacterId: null, selectedSceneId: null,
      isAgentWorking: false, error: null,
      assembledVideoUrl: null, isAssembling: false, assembleError: null,
      selectedModels: { ...DEFAULT_MODELS },
    });
  },
}));
