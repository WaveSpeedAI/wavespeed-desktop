/**
 * Main storyboard store v3.0 — two-convergence pipeline.
 *
 * State machine: IDLE → INTENT → PLANNING → PREVIEW → GENERATING → COMPLETE
 *
 * First convergence (PREVIEW): all keyframes → Animatic → user confirms
 * Second convergence (COMPLETE): all videos → assembled final video
 */
import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type {
  Project, ProjectStatus, DurationType,
  SuperDID, Character, Scene,
} from "../types/project";
import type {
  Shot, Beat, DependencyEdge,
} from "../types/shot";
import {
  callSuperDID, callWorldPack, callShotPack,
  type CharacterDraft, type SceneDraft, type ShotDraft, type BeatDraft,
} from "../agents/pipeline";
import { setDeepSeekApiKey, setDeepSeekBaseUrl, setDeepSeekModel } from "../api/deepseek";
import { useAgentActivityStore } from "./agent-activity.store";
import { DEFAULT_MODELS, clampDuration, type ModelCategory, type ModelOption } from "../models/model-config";
import { buildFirstFramePrompt, buildI2VPrompt, buildNegativePrompt } from "../engine/prompt-builder";
import { routeAllShots, buildDependencyEdges } from "../engine/execution-router";
import { validateShotSequence } from "../engine/validator";
import { generateAllFirstFrames, generateAllVideos } from "../engine/scheduler";
import { generateImage } from "../models/generation-client";
import { ffmpegMerge } from "@/workflow/browser/ffmpeg-helpers";

/* ── Chat Message ──────────────────────────────────────── */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

/* ── State Interface ───────────────────────────────────── */

interface StoryboardState {
  // Core data
  project: Project | null;
  superDID: SuperDID | null;
  characters: Character[];
  scenes: Scene[];
  shots: Shot[];
  beats: Beat[];
  edges: DependencyEdge[];
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

  // Animatic state
  animaticReady: boolean;
  firstFrameUrls: Map<string, string>;

  // Model selection
  selectedModels: Record<ModelCategory, ModelOption>;

  // Actions
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
  regenerateFirstFrame: (shotId: string) => Promise<void>;
  confirmAnimatic: () => Promise<void>;
  startGeneration: () => Promise<void>;
  assembleAllShots: () => Promise<void>;
  setProjectStatus: (status: ProjectStatus) => void;
  deleteShotById: (shotId: string) => void;
  reorderShot: (shotId: string, newIndex: number) => void;
  reset: () => void;
}

/* ── Duration Extraction ───────────────────────────────── */

function extractDuration(prompt: string): number {
  const secMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:s|秒|seconds?|sec)\b/i);
  if (secMatch) return Math.max(4, Math.min(120, parseFloat(secMatch[1])));

  const minMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:分钟|min(?:utes?)?|mins?)\b/i);
  if (minMatch) return Math.max(4, Math.min(120, parseFloat(minMatch[1]) * 60));

  if (/短视频|短片|short|brief|clip/i.test(prompt)) return 15;
  if (/长视频|长片|long|完整|full|电影|movie/i.test(prompt)) return 90;
  if (/中等|medium|trailer|预告|宣传/i.test(prompt)) return 45;

  return 14;
}

function classifyDuration(seconds: number): DurationType {
  if (seconds <= 15) return "micro";
  if (seconds <= 45) return "short";
  if (seconds <= 90) return "medium";
  return "full";
}

/* ── Draft → Domain Entity Mappers ─────────────────────── */

function mapCharacterDraft(draft: CharacterDraft, projectId: string): Character {
  return {
    character_id: uuid(),
    project_id: projectId,
    name: draft.name,
    role: draft.role,
    immutable_traits: draft.immutable_traits,
    mutable_states: draft.mutable_states.map((s) => ({
      state_id: s.state_id,
      name: s.name,
      description: s.description,
    })),
    turnaround_prompt: draft.turnaround_prompt,
    turnaround_image: null,
    cropped_views: { front: null, three_quarter: null, side: null },
    state_images: new Map(),
  };
}

function mapSceneDraft(draft: SceneDraft, projectId: string): Scene {
  return {
    scene_id: uuid(),
    project_id: projectId,
    name: draft.name,
    environment_description: draft.environment_description,
    dominant_colors: draft.dominant_colors,
    key_light_mood: draft.key_light_mood,
    landmark_objects: draft.landmark_objects,
    geometry_hint: draft.geometry_hint,
    weather_state: draft.weather_state,
    reference_prompt: draft.reference_prompt,
    master_frame: null,
  };
}

function mapShotDraft(
  draft: ShotDraft,
  projectId: string,
  charIdMap: Map<string, string>,
  sceneIdMap: Map<string, string>,
  beatIdMap: Map<string, string>,
  index: number,
): Shot {
  return {
    shot_id: uuid(),
    project_id: projectId,
    beat_id: beatIdMap.get(draft.beat_id) ?? "",
    scene_id: sceneIdMap.get(draft.scene_id) ?? "",
    sequence_number: index + 1,
    duration_seconds: draft.is_atmosphere ? draft.duration_seconds : clampDuration(draft.duration_seconds),
    narrative_value: draft.narrative_value,
    is_atmosphere: draft.is_atmosphere,
    composition: {
      scale: draft.composition.scale as any,
      framing: draft.composition.framing as any,
      camera_angle: draft.composition.camera_angle as any,
    },
    subjects: (draft.subjects || []).map((s) => ({
      character_id: charIdMap.get(s.character_id) ?? s.character_id,
      state_id: s.state_id,
      action: s.action,
      screen_position: s.screen_position as any,
      face_visibility: s.face_visibility as any,
    })),
    camera_motion: {
      type: draft.camera_motion.type as any,
      intensity: draft.camera_motion.intensity,
    },
    transition_in: draft.transition_in as any,
    transition_out: draft.transition_out as any,
    continuity: {
      carry_over_subject: draft.continuity.carry_over_subject
        ? (charIdMap.get(draft.continuity.carry_over_subject) ?? draft.continuity.carry_over_subject)
        : null,
      screen_direction_match: draft.continuity.screen_direction_match,
      motion_direction: draft.continuity.motion_direction as any,
    },
    mood_keywords: draft.mood_keywords || [],
    visual_poetry: draft.visual_poetry || "",
    tension_moment: draft.tension_moment || "",
    scene_type: null,
    execution_plan: null,
    first_frame_prompt: "",
    i2v_prompt: "",
    negative_prompt: "",
    generation_status: "pending",
    generated_assets: {
      first_frame: null,
      end_frame: null,
      video_url: null,
      video_versions: [],
      thumbnail: null,
    },
    qc_warnings: [],
  };
}

function mapBeatDraft(draft: BeatDraft): Beat {
  const newId = uuid();
  return {
    beat_id: newId,
    type: draft.type as any,
    time_range: draft.time_range,
    audience_feeling: draft.audience_feeling,
    shot_ids: draft.shot_ids, // Will be remapped after shots are created
  };
}

/* ── Initial State ─────────────────────────────────────── */

const INITIAL_STATE = {
  project: null as Project | null,
  superDID: null as SuperDID | null,
  characters: [] as Character[],
  scenes: [] as Scene[],
  shots: [] as Shot[],
  beats: [] as Beat[],
  edges: [] as DependencyEdge[],
  chatMessages: [] as ChatMessage[],
  selectedShotId: null as string | null,
  selectedCharacterId: null as string | null,
  selectedSceneId: null as string | null,
  isAgentWorking: false,
  error: null as string | null,
  assembledVideoUrl: null as string | null,
  isAssembling: false,
  assembleError: null as string | null,
  animaticReady: false,
  firstFrameUrls: new Map<string, string>(),
  selectedModels: { ...DEFAULT_MODELS } as Record<ModelCategory, ModelOption>,
};

/* ── Store ─────────────────────────────────────────────── */

export const useStoryboardStore = create<StoryboardState>((set, get) => ({
  ...INITIAL_STATE,

  /* ── Config ──────────────────────────────────────────── */

  setLlmConfig: (config) => {
    if (config.apiKey) setDeepSeekApiKey(config.apiKey);
    if (config.baseUrl) setDeepSeekBaseUrl(config.baseUrl);
    if (config.model) setDeepSeekModel(config.model);
  },

  setModel: (category, model) => {
    set((s) => ({ selectedModels: { ...s.selectedModels, [category]: model } }));
  },

  /* ── Selection ───────────────────────────────────────── */

  selectShot: (id) => set({ selectedShotId: id, selectedCharacterId: null, selectedSceneId: null }),
  selectCharacter: (id) => set({ selectedCharacterId: id, selectedShotId: null, selectedSceneId: null }),
  selectScene: (id) => set({ selectedSceneId: id, selectedShotId: null, selectedCharacterId: null }),

  /* ── Chat helpers ────────────────────────────────────── */

  appendToMessage: (messageId, chunk) => {
    set((s) => ({
      chatMessages: s.chatMessages.map((m) =>
        m.id === messageId ? { ...m, content: m.content + chunk } : m,
      ),
    }));
  },

  finalizeMessage: (messageId) => {
    set((s) => ({
      chatMessages: s.chatMessages.map((m) =>
        m.id === messageId ? { ...m, isStreaming: false } : m,
      ),
    }));
  },

  /* ── Status ──────────────────────────────────────────── */

  setProjectStatus: (status) => {
    set((s) => s.project ? { project: { ...s.project, status, updated_at: Date.now() } } : {});
  },

  /* ── sendMessage — main entry point ──────────────────── */

  sendMessage: async (message: string) => {
    const state = get();
    if (state.isAgentWorking) return;

    // Add user message
    const userMsg: ChatMessage = {
      id: uuid(), role: "user", content: message, timestamp: Date.now(),
    };
    set((s) => ({ chatMessages: [...s.chatMessages, userMsg] }));

    // Add streaming assistant placeholder
    const assistantMsgId = uuid();
    set((s) => ({
      chatMessages: [...s.chatMessages, {
        id: assistantMsgId, role: "assistant", content: "", timestamp: Date.now(), isStreaming: true,
      }],
      isAgentWorking: true,
      error: null,
    }));

    const phaseId = useAgentActivityStore.getState().startPhase("storyboard-pipeline");

    try {
      if (!state.project) {
        // ── First message: full pipeline (Call 1 → 2 → 3) ──
        await runFullPipeline(message, assistantMsgId, phaseId);
      } else {
        // ── Subsequent messages: route through Super DID ──
        await runFollowUp(message, assistantMsgId, phaseId);
      }
    } catch (err: any) {
      set({ error: err.message });
      get().appendToMessage(assistantMsgId, `\n\n❌ 错误: ${err.message}`);
    } finally {
      get().finalizeMessage(assistantMsgId);
      set({ isAgentWorking: false });
      useAgentActivityStore.getState().completePhase(phaseId);
    }
  },

  /* ── CRUD ────────────────────────────────────────────── */

  updateShot: (shotId, updates) => {
    set((s) => ({
      shots: s.shots.map((sh) => sh.shot_id === shotId ? { ...sh, ...updates } : sh),
    }));
  },

  updateCharacter: (charId, updates) => {
    set((s) => ({
      characters: s.characters.map((c) => c.character_id === charId ? { ...c, ...updates } : c),
    }));
  },

  updateScene: (sceneId, updates) => {
    set((s) => ({
      scenes: s.scenes.map((sc) => sc.scene_id === sceneId ? { ...sc, ...updates } : sc),
    }));
  },

  deleteShotById: (shotId) => {
    set((s) => {
      const remaining = s.shots.filter((sh) => sh.shot_id !== shotId);
      // Re-sequence
      const sorted = [...remaining].sort((a, b) => a.sequence_number - b.sequence_number);
      sorted.forEach((sh, i) => { sh.sequence_number = i + 1; });
      return {
        shots: sorted,
        selectedShotId: s.selectedShotId === shotId ? null : s.selectedShotId,
      };
    });
  },

  reorderShot: (shotId, newIndex) => {
    set((s) => {
      const shots = [...s.shots].sort((a, b) => a.sequence_number - b.sequence_number);
      const idx = shots.findIndex((sh) => sh.shot_id === shotId);
      if (idx === -1) return {};
      const [moved] = shots.splice(idx, 1);
      shots.splice(newIndex, 0, moved);
      shots.forEach((sh, i) => { sh.sequence_number = i + 1; });
      return { shots };
    });
  },

  /* ── Regenerate single first frame ───────────────────── */

  regenerateFirstFrame: async (shotId) => {
    const state = get();
    const shot = state.shots.find((s) => s.shot_id === shotId);
    if (!shot || !state.superDID) return;

    set((s) => ({
      shots: s.shots.map((sh) =>
        sh.shot_id === shotId ? { ...sh, generation_status: "generating" as const } : sh,
      ),
    }));

    const phaseId = useAgentActivityStore.getState().startPhase("regenerate-frame");
    try {
      const scene = state.scenes.find((sc) => sc.scene_id === shot.scene_id);
      const prompt = buildFirstFramePrompt(shot, state.characters, scene, state.superDID);
      const negative = buildNegativePrompt(shot, state.characters);

      const refImages: string[] = [];
      for (const subj of shot.subjects) {
        const char = state.characters.find((c) => c.character_id === subj.character_id);
        if (char?.cropped_views.three_quarter) refImages.push(char.cropped_views.three_quarter);
        else if (char?.turnaround_image) refImages.push(char.turnaround_image);
      }
      if (scene?.master_frame) refImages.push(scene.master_frame);

      const result = await generateImage(prompt, {
        negativePrompt: negative,
        imageSize: "1280x720",
        seed: Math.floor(Math.random() * 10000),
        phaseId,
        referenceImages: refImages.length > 0 ? refImages : undefined,
      });

      set((s) => ({
        shots: s.shots.map((sh) =>
          sh.shot_id === shotId
            ? {
                ...sh,
                generation_status: "done" as const,
                generated_assets: { ...sh.generated_assets, first_frame: result.outputUrl },
              }
            : sh,
        ),
        firstFrameUrls: new Map(s.firstFrameUrls).set(shotId, result.outputUrl),
      }));
    } catch (err: any) {
      set((s) => ({
        shots: s.shots.map((sh) =>
          sh.shot_id === shotId ? { ...sh, generation_status: "failed" as const } : sh,
        ),
        error: err.message,
      }));
    } finally {
      useAgentActivityStore.getState().completePhase(phaseId);
    }
  },

  /* ── Confirm Animatic → start video generation ───────── */

  confirmAnimatic: async () => {
    const state = get();
    if (!state.project || state.project.status !== "preview") return;

    // Snapshot for rollback
    const snapshotId = uuid();
    set((s) => ({
      project: s.project ? { ...s.project, status: "generating" as const, preview_snapshot_id: snapshotId } : null,
    }));

    // Start video generation
    await get().startGeneration();
  },

  /* ── Start Generation (Phase C: videos) ──────────────── */

  startGeneration: async () => {
    const state = get();
    if (!state.superDID) return;

    set({ isAgentWorking: true });
    const phaseId = useAgentActivityStore.getState().startPhase("video-generation");

    try {
      const result = await generateAllVideos(
        state.shots,
        state.characters,
        state.scenes,
        state.superDID,
        state.firstFrameUrls,
        phaseId,
        {
          onVideoReady: (shotId, videoUrl) => {
            set((s) => ({
              shots: s.shots.map((sh) =>
                sh.shot_id === shotId
                  ? {
                      ...sh,
                      generation_status: "done" as const,
                      generated_assets: { ...sh.generated_assets, video_url: videoUrl },
                    }
                  : sh,
              ),
            }));
          },
          onShotFailed: (shotId, error) => {
            set((s) => ({
              shots: s.shots.map((sh) =>
                sh.shot_id === shotId
                  ? { ...sh, generation_status: "failed" as const, qc_warnings: [...sh.qc_warnings, error] }
                  : sh,
              ),
            }));
          },
          onDegraded: (shotId, level) => {
            set((s) => ({
              shots: s.shots.map((sh) =>
                sh.shot_id === shotId
                  ? { ...sh, qc_warnings: [...sh.qc_warnings, `降级: ${level}`] }
                  : sh,
              ),
            }));
          },
        },
      );

      const allDone = result.success + result.failed === state.shots.length;
      if (allDone) {
        set((s) => ({
          project: s.project ? { ...s.project, status: "complete" as const } : null,
        }));

        // Auto-assemble all shot videos into final video
        if (result.success >= 2) {
          await get().assembleAllShots();
        }
      }
    } catch (err: any) {
      set({ error: err.message });
    } finally {
      set({ isAgentWorking: false });
      useAgentActivityStore.getState().completePhase(phaseId);
    }
  },

  /* ── Assemble all shot videos into final video ───────── */

  assembleAllShots: async () => {
    const state = get();
    const videoUrls = state.shots
      .filter((s) => s.generated_assets.video_url)
      .sort((a, b) => a.sequence_number - b.sequence_number)
      .map((s) => s.generated_assets.video_url!);

    if (videoUrls.length < 2) return;

    set({ isAssembling: true, assembleError: null });
    try {
      const merged = await ffmpegMerge(videoUrls, "mp4");
      set({ assembledVideoUrl: merged, isAssembling: false });
    } catch (err: any) {
      set({ assembleError: err.message, isAssembling: false });
    }
  },

  /* ── Reset ───────────────────────────────────────────── */

  reset: () => set({ ...INITIAL_STATE, firstFrameUrls: new Map() }),
}));

/* ── Full Pipeline (first message) ─────────────────────── */

async function runFullPipeline(
  message: string,
  assistantMsgId: string,
  phaseId: string,
) {
  const { appendToMessage } = useStoryboardStore.getState();

  // ── Call 1: Super DID ──
  appendToMessage(assistantMsgId, "🎬 正在解析你的创意...\n");
  const did = await callSuperDID(message, phaseId);

  const duration = did.target_duration;
  const durationType = did.duration_type;

  // Create project
  const projectId = uuid();
  const project: Project = {
    project_id: projectId,
    name: did.premise.slice(0, 30),
    status: "planning",
    duration_type: durationType,
    target_duration: duration,
    created_at: Date.now(),
    updated_at: Date.now(),
    preview_snapshot_id: null,
  };

  useStoryboardStore.setState({ project, superDID: did });
  appendToMessage(assistantMsgId,
    `✅ 导演视觉确立: ${did.premise}\n📐 ${durationType} · ${duration}s · ${did.character_count} 角色 · ${did.scene_count} 场景\n\n`);

  // ── Call 2: World Pack ──
  appendToMessage(assistantMsgId, "🌍 正在构建世界观...\n");
  const world = await callWorldPack(did, message, phaseId);

  // Map drafts to domain entities
  const charIdMap = new Map<string, string>();
  const characters = world.characters.map((draft) => {
    const char = mapCharacterDraft(draft, projectId);
    charIdMap.set(draft.id, char.character_id);
    return char;
  });

  const sceneIdMap = new Map<string, string>();
  const scenes = world.scenes.map((draft) => {
    const scene = mapSceneDraft(draft, projectId);
    sceneIdMap.set(draft.id, scene.scene_id);
    return scene;
  });

  useStoryboardStore.setState({ characters, scenes });
  appendToMessage(assistantMsgId,
    `✅ ${characters.length} 角色 + ${scenes.length} 场景就绪\n\n`);

  // ── Start asset generation in parallel with Call 3 ──
  appendToMessage(assistantMsgId, "🖼 开始生成角色参考图和场景母图...\n");
  const assetPromise = generateCharacterAndSceneAssets(characters, scenes, did, phaseId);

  // ── Call 3: Shot Pack ──
  appendToMessage(assistantMsgId, "🎞 正在设计分镜序列...\n");
  const shotPack = await callShotPack(did, world, phaseId);

  // Map beats
  const beatIdMap = new Map<string, string>();
  const beats = shotPack.beats.map((draft) => {
    const beat = mapBeatDraft(draft);
    beatIdMap.set(draft.beat_id, beat.beat_id);
    return beat;
  });

  // Map shots
  const shots = shotPack.shots.map((draft, i) =>
    mapShotDraft(draft, projectId, charIdMap, sceneIdMap, beatIdMap, i),
  );

  // Remap beat.shot_ids to new shot IDs
  const oldToNewShotId = new Map<string, string>();
  shotPack.shots.forEach((draft, i) => {
    oldToNewShotId.set(draft.shot_id, shots[i].shot_id);
  });
  for (const beat of beats) {
    beat.shot_ids = beat.shot_ids.map((oldId) => oldToNewShotId.get(oldId) ?? oldId);
  }

  // ── Prompt Translation (pure code) ──
  for (const shot of shots) {
    const scene = scenes.find((sc) => sc.scene_id === shot.scene_id);
    shot.first_frame_prompt = buildFirstFramePrompt(shot, characters, scene, did);
    shot.i2v_prompt = buildI2VPrompt(shot, characters, scene, did);
    shot.negative_prompt = buildNegativePrompt(shot, characters);
  }

  // ── Execution Routing (pure code) ──
  const routedShots = routeAllShots(shots);
  const edges = buildDependencyEdges(routedShots);

  // ── Validation ──
  const validation = validateShotSequence(routedShots, beats, did);
  if (validation.warnings.length > 0) {
    const warnText = validation.warnings
      .map((w) => `${w.severity === "error" ? "❌" : "⚠"} ${w.message}`)
      .join("\n");
    appendToMessage(assistantMsgId, `\n📋 验证结果:\n${warnText}\n`);
  }

  useStoryboardStore.setState({ shots: routedShots, beats, edges });
  appendToMessage(assistantMsgId,
    `✅ ${routedShots.length} 个分镜就绪 · ${beats.length} 个节拍\n\n`);

  // ── Wait for asset generation ──
  appendToMessage(assistantMsgId, "⏳ 等待参考图生成完成...\n");
  const { updatedChars, updatedScenes } = await assetPromise;
  useStoryboardStore.setState({ characters: updatedChars, scenes: updatedScenes });

  // ── Phase B: Generate first frames ──
  appendToMessage(assistantMsgId, "🖼 正在生成所有首帧 (Animatic)...\n");
  const firstFrameUrls = await generateAllFirstFrames(
    routedShots, updatedChars, updatedScenes, did, phaseId,
    {
      onFirstFrameReady: (shotId, url) => {
        useStoryboardStore.setState((s) => ({
          shots: s.shots.map((sh) =>
            sh.shot_id === shotId
              ? { ...sh, generated_assets: { ...sh.generated_assets, first_frame: url } }
              : sh,
          ),
        }));
      },
    },
  );

  useStoryboardStore.setState({
    firstFrameUrls,
    animaticReady: true,
    project: { ...useStoryboardStore.getState().project!, status: "preview" },
  });

  appendToMessage(assistantMsgId,
    `\n🎬 Animatic 就绪! ${firstFrameUrls.size}/${routedShots.length} 首帧已生成。\n` +
    `请检查分镜序列，确认后点击「开始生成视频」。`,
  );
}

/* ── Follow-up message handler ─────────────────────────── */

async function runFollowUp(
  message: string,
  assistantMsgId: string,
  phaseId: string,
) {
  const state = useStoryboardStore.getState();
  const { appendToMessage } = state;

  // Route through Super DID to understand intent
  appendToMessage(assistantMsgId, "🤔 正在理解你的修改意图...\n");
  const did = await callSuperDID(message, phaseId);

  // Update Super DID
  useStoryboardStore.setState({ superDID: did });
  appendToMessage(assistantMsgId, `✅ 已更新导演视觉\n`);

  // Re-run World Pack if character/scene count changed
  const currentState = useStoryboardStore.getState();
  if (did.character_count !== currentState.characters.length ||
      did.scene_count !== currentState.scenes.length) {
    appendToMessage(assistantMsgId, "🌍 角色/场景数量变化，重新构建...\n");
    const world = await callWorldPack(did, message, phaseId);

    const projectId = currentState.project!.project_id;
    const charIdMap = new Map<string, string>();
    const characters = world.characters.map((draft) => {
      const char = mapCharacterDraft(draft, projectId);
      charIdMap.set(draft.id, char.character_id);
      return char;
    });
    const sceneIdMap = new Map<string, string>();
    const scenes = world.scenes.map((draft) => {
      const scene = mapSceneDraft(draft, projectId);
      sceneIdMap.set(draft.id, scene.scene_id);
      return scene;
    });

    useStoryboardStore.setState({ characters, scenes });
    appendToMessage(assistantMsgId, `✅ ${characters.length} 角色 + ${scenes.length} 场景\n`);
  }

  appendToMessage(assistantMsgId, "\n修改已应用。如需重新生成分镜，请描述具体需求。");
}

/* ── Asset Generation (parallel with Call 3) ───────────── */

async function generateCharacterAndSceneAssets(
  characters: Character[],
  scenes: Scene[],
  did: SuperDID,
  phaseId: string,
): Promise<{ updatedChars: Character[]; updatedScenes: Scene[] }> {
  const updatedChars = [...characters];
  const updatedScenes = [...scenes];

  // Generate character turnaround sheets
  const charTasks = updatedChars.map((char, i) => async () => {
    try {
      const result = await generateImage(char.turnaround_prompt, {
        imageSize: "1280x720",
        seed: 42,
        phaseId,
      });
      updatedChars[i] = {
        ...updatedChars[i],
        turnaround_image: result.outputUrl,
        cropped_views: {
          front: result.outputUrl,       // TODO: actual cropping
          three_quarter: result.outputUrl,
          side: result.outputUrl,
        },
      };
    } catch { /* continue — degraded but not fatal */ }
  });

  // Generate scene master frames
  const sceneTasks = updatedScenes.map((scene, i) => async () => {
    try {
      const prompt = `${did.cinematic_identity.global_prompt_prefix}, ${scene.reference_prompt}`;
      const result = await generateImage(prompt, {
        imageSize: "1280x720",
        seed: 42,
        phaseId,
      });
      updatedScenes[i] = { ...updatedScenes[i], master_frame: result.outputUrl };
    } catch { /* continue */ }
  });

  // Run all in parallel (max 3 concurrent)
  const allTasks = [...charTasks, ...sceneTasks];
  const executing = new Set<Promise<void>>();
  for (const task of allTasks) {
    const p = task().then(() => { executing.delete(p); });
    executing.add(p);
    if (executing.size >= 3) await Promise.race(executing);
  }
  await Promise.all(executing);

  return { updatedChars, updatedScenes };
}
