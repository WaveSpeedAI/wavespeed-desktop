/**
 * Execution Scheduler v3.0 — handles the actual generation calls.
 *
 * Two convergence points:
 *   Phase B: Asset generation + keyframe generation → Animatic (first convergence)
 *   Phase C: i2v video generation → final video (second convergence)
 *
 * Execution paths:
 *   P1: first frame → i2v
 *   P2: first frame + end frame → i2v (with both frames)
 *   P3: composite first frame → i2v (multi-character)
 *   P4: static image + Ken Burns (atmosphere, zero risk)
 *   P5: segmented i2v + stitch (>7s)
 *
 * Degradation levels:
 *   L1: first frame Ken Burns (i2v failed but first frame OK)
 *   L2: scene master Ken Burns (first frame also failed)
 *   L3: delete shot, dissolve fill (low narrative value only)
 */
import { useAgentActivityStore } from "../stores/agent-activity.store";
import { generateImage, generateVideo } from "../models/generation-client";
import type { Shot } from "../types/shot";
import type { Character, Scene, SuperDID } from "../types/project";
import { buildFirstFramePrompt, buildI2VPrompt, buildNegativePrompt } from "./prompt-builder";
import { buildSchedule } from "./execution-router";
import { clampDuration, VIDEO_MODEL_CAPABILITIES } from "../models/model-config";

const MAX_CONCURRENCY = 3;
const MAX_FIRST_FRAME_RETRIES = 3;
const MAX_I2V_RETRIES = 1;

/* ── Types ─────────────────────────────────────────────── */

export interface GenerationCallbacks {
  onFirstFrameReady?: (shotId: string, imageUrl: string) => void;
  onVideoReady?: (shotId: string, videoUrl: string) => void;
  onShotFailed?: (shotId: string, error: string) => void;
  onDegraded?: (shotId: string, level: "L1" | "L2" | "L3") => void;
}

export interface GenerationResult {
  success: number;
  failed: number;
  degraded: number;
  videoUrls: Map<string, string>;
  firstFrameUrls: Map<string, string>;
}

/* ── Concurrency Pool ──────────────────────────────────── */

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrent: number,
): Promise<T[]> {
  const results: T[] = [];
  const executing = new Set<Promise<void>>();

  for (const task of tasks) {
    const p = task().then((result) => { results.push(result); });
    const wrapped = p.then(() => { executing.delete(wrapped); });
    executing.add(wrapped);
    if (executing.size >= maxConcurrent) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  return results;
}

/* ── Phase B: First Convergence (Keyframes → Animatic) ── */

/**
 * Generate all first frames (keyframes) for the Animatic preview.
 * This is the FIRST convergence point — cheap, fast, iterable.
 */
export async function generateAllFirstFrames(
  shots: Shot[],
  characters: Character[],
  scenes: Scene[],
  did: SuperDID,
  phaseId: string,
  callbacks?: GenerationCallbacks,
): Promise<Map<string, string>> {
  const activity = useAgentActivityStore.getState();
  const taskId = activity.startTask(phaseId, "asset", "Phase B: 生成所有首帧");
  const firstFrameUrls = new Map<string, string>();

  const sorted = [...shots].sort((a, b) => a.sequence_number - b.sequence_number);

  const tasks = sorted.map((shot) => async () => {
    const scene = scenes.find((s) => s.scene_id === shot.scene_id);
    const prompt = shot.first_frame_prompt || buildFirstFramePrompt(shot, characters, scene, did);
    const negative = shot.negative_prompt || buildNegativePrompt(shot, characters);

    // Determine reference images
    const refImages: string[] = [];
    // Character turnaround as reference (P0 consistency)
    for (const subj of shot.subjects) {
      const char = characters.find((c) => c.character_id === subj.character_id);
      if (char?.cropped_views.three_quarter) {
        refImages.push(char.cropped_views.three_quarter);
      } else if (char?.turnaround_image) {
        refImages.push(char.turnaround_image);
      }
    }
    // Scene master as style reference
    if (scene?.master_frame) {
      refImages.push(scene.master_frame);
    }

    // Retry loop
    for (let attempt = 0; attempt < MAX_FIRST_FRAME_RETRIES; attempt++) {
      try {
        const result = await generateImage(prompt, {
          negativePrompt: negative,
          imageSize: "1280x720",
          seed: attempt === 0 ? 42 : Math.floor(Math.random() * 10000),
          phaseId,
          referenceImages: refImages.length > 0 ? refImages : undefined,
        });

        firstFrameUrls.set(shot.shot_id, result.outputUrl);
        callbacks?.onFirstFrameReady?.(shot.shot_id, result.outputUrl);
        activity.appendStream(taskId, `✅ Shot #${shot.sequence_number} 首帧就绪\n`);
        return;
      } catch (err: any) {
        if (attempt < MAX_FIRST_FRAME_RETRIES - 1) {
          activity.appendStream(taskId, `⚠ Shot #${shot.sequence_number} 重试 ${attempt + 1}\n`);
        } else {
          // Degradation: use scene master as fallback
          if (scene?.master_frame) {
            firstFrameUrls.set(shot.shot_id, scene.master_frame);
            callbacks?.onDegraded?.(shot.shot_id, "L2");
            activity.appendStream(taskId, `⚠ Shot #${shot.sequence_number} 降级为场景母图\n`);
          } else {
            callbacks?.onShotFailed?.(shot.shot_id, err.message);
            activity.appendStream(taskId, `❌ Shot #${shot.sequence_number} 首帧失败\n`);
          }
        }
      }
    }
  });

  await runWithConcurrency(tasks, MAX_CONCURRENCY);
  activity.completeTask(taskId, `${firstFrameUrls.size}/${sorted.length} 首帧就绪`);
  return firstFrameUrls;
}

/* ── Phase C: Second Convergence (Videos) ──────────────── */

/**
 * Generate all videos from first frames.
 * This is the SECOND convergence point — expensive, slow, minimize retries.
 */
export async function generateAllVideos(
  shots: Shot[],
  characters: Character[],
  scenes: Scene[],
  did: SuperDID,
  firstFrameUrls: Map<string, string>,
  phaseId: string,
  callbacks?: GenerationCallbacks,
): Promise<GenerationResult> {
  const activity = useAgentActivityStore.getState();
  const { parallel, sequential } = buildSchedule(shots);

  const videoUrls = new Map<string, string>();
  let success = 0;
  let failed = 0;
  let degraded = 0;

  const executeShot = async (shot: Shot) => {
    const scene = scenes.find((s) => s.scene_id === shot.scene_id);
    const firstFrame = firstFrameUrls.get(shot.shot_id);
    const plan = shot.execution_plan;

    if (!plan) return;

    // P4: Ken Burns (no video generation needed — handled in assembly)
    if (plan.path === "P4") {
      if (firstFrame) {
        videoUrls.set(shot.shot_id, firstFrame); // Placeholder — Ken Burns applied in assembly
        callbacks?.onVideoReady?.(shot.shot_id, firstFrame);
        success++;
      }
      return;
    }

    // Build i2v prompt with duration info
    const i2vPrompt = shot.i2v_prompt || buildI2VPrompt(shot, characters, scene, did);

    // P5: Segmented generation
    if (plan.path === "P5" && plan.segmented) {
      try {
        const segmentUrl = await generateSegmentedVideo(
          shot, firstFrame, i2vPrompt, plan, phaseId);
        if (segmentUrl) {
          videoUrls.set(shot.shot_id, segmentUrl);
          callbacks?.onVideoReady?.(shot.shot_id, segmentUrl);
          success++;
        }
      } catch {
        // Fallback to single i2v
        await generateSingleVideo(shot, firstFrame, i2vPrompt, phaseId,
          videoUrls, callbacks, () => { success++; }, () => { failed++; degraded++; });
      }
      return;
    }

    // P1, P2, P3: single i2v call
    await generateSingleVideo(shot, firstFrame, i2vPrompt, phaseId,
      videoUrls, callbacks, () => { success++; }, () => { failed++; degraded++; });
  };

  // Sequential shots first
  if (sequential.length > 0) {
    const seqTaskId = activity.startTask(phaseId, "production",
      `Phase C: 顺序生成 (${sequential.length} shots)`);
    for (const shot of sequential) {
      activity.appendStream(seqTaskId, `Shot #${shot.sequence_number}...\n`);
      await executeShot(shot);
    }
    activity.completeTask(seqTaskId, `${success} done`);
  }

  // Parallel shots
  if (parallel.length > 0) {
    const parTaskId = activity.startTask(phaseId, "production",
      `Phase C: 并行生成 (${parallel.length} shots)`);
    const parTasks = parallel.map((shot) => () => executeShot(shot));
    await runWithConcurrency(parTasks, MAX_CONCURRENCY);
    activity.completeTask(parTaskId, `parallel batch done`);
  }

  return { success, failed, degraded, videoUrls, firstFrameUrls };
}

/* ── Single Video Generation ───────────────────────────── */

async function generateSingleVideo(
  shot: Shot,
  firstFrame: string | undefined,
  i2vPrompt: string,
  phaseId: string,
  videoUrls: Map<string, string>,
  callbacks: GenerationCallbacks | undefined,
  onSuccess: () => void,
  onFail: () => void,
): Promise<void> {
  // CRITICAL: clamp duration to model-valid range before API call
  const safeDuration = clampDuration(shot.duration_seconds);

  for (let attempt = 0; attempt <= MAX_I2V_RETRIES; attempt++) {
    try {
      const result = await generateVideo(i2vPrompt, {
        imageUrl: firstFrame,
        duration: safeDuration,
        phaseId,
      });
      videoUrls.set(shot.shot_id, result.outputUrl);
      callbacks?.onVideoReady?.(shot.shot_id, result.outputUrl);
      onSuccess();
      return;
    } catch (err: any) {
      if (attempt >= MAX_I2V_RETRIES) {
        // Degradation L1: Ken Burns on first frame
        if (firstFrame) {
          videoUrls.set(shot.shot_id, firstFrame);
          callbacks?.onDegraded?.(shot.shot_id, "L1");
          onFail();
        } else {
          callbacks?.onShotFailed?.(shot.shot_id, err.message);
          onFail();
        }
      }
    }
  }
}

/* ── Segmented Video Generation (P5) ───────────────────── */

async function generateSegmentedVideo(
  shot: Shot,
  firstFrame: string | undefined,
  _i2vPrompt: string,
  plan: NonNullable<Shot["execution_plan"]>,
  phaseId: string,
): Promise<string | null> {
  const { minDuration, maxDuration } = VIDEO_MODEL_CAPABILITIES;
  const segDur = Math.ceil(shot.duration_seconds / plan.segment_count);
  let currentFrame = firstFrame;
  const segmentUrls: string[] = [];

  for (let seg = 0; seg < plan.segment_count; seg++) {
    const rawDur = seg === plan.segment_count - 1
      ? shot.duration_seconds - segDur * (plan.segment_count - 1)
      : segDur;

    // CRITICAL: clamp each segment to model-valid range
    const dur = Math.max(minDuration, Math.min(rawDur, maxDuration));

    const segPrompt = `segment ${seg + 1}/${plan.segment_count}, ${dur}s`;

    const result = await generateVideo(segPrompt, {
      imageUrl: currentFrame,
      duration: dur,
      phaseId,
    });

    segmentUrls.push(result.outputUrl);
    currentFrame = result.outputUrl;
  }

  return segmentUrls[0] || null;
}
