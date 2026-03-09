/**
 * Execution Scheduler (Stage 5) — V5: CV & AI Hybrid Pipeline.
 *
 * Handles:
 * - generate_image / generate_scene: Seedream t2i (parallel)
 * - collage: CV-based affine transform + composite (code-layer)
 * - edit_image: Seedream edit with adaptive denoising (AI fusion)
 * - i2v: Seedance image-to-video
 * - video_extend / t2v: fallback paths
 */
import type {
  FullExecutionPlan,
  ShotExecutionPlan,
  ExecutionStep,
} from "./rule-engine";
import { useAgentActivityStore } from "../stores/agent-activity.store";
import { generateImage, generateVideo } from "../models/generation-client";
import { IMAGE_EDIT_MODEL, VIDEO_I2V_MODEL } from "../models/model-config";

const MAX_CONCURRENCY = 3;

/* ── Types ─────────────────────────────────────────────── */

export interface ExecutionContext {
  assets: Map<string, string>;
  phaseId: string;
  onShotComplete?: (shotId: string, videoUrl: string) => void;
  onShotFailed?: (shotId: string, error: string) => void;
}

export interface ExecutionResult {
  success: number;
  failed: number;
  videoUrls: Map<string, string>;
  errors: Map<string, string>;
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

/* ── Step Executors ────────────────────────────────────── */

function resolveInput(step: ExecutionStep, ctx: ExecutionContext): string | undefined {
  if (step.input_from) return ctx.assets.get(step.input_from);
  if (step.base_image) return ctx.assets.get(step.base_image);
  return undefined;
}

async function executeStep(step: ExecutionStep, ctx: ExecutionContext): Promise<void> {
  const inputUrl = resolveInput(step, ctx);

  switch (step.step_type) {
    case "generate_image":
    case "generate_scene": {
      const result = await generateImage(step.prompt ?? "", {
        negativePrompt: step.negative_prompt,
        imageSize: step.image_size,
        seed: step.seed,
        phaseId: ctx.phaseId,
      });
      ctx.assets.set(step.output_key, result.outputUrl);
      break;
    }

    case "collage": {
      // CV-based compositing: affine transform subjects onto scene
      // TODO: Implement OpenCV/Canvas-based perspective-aware placement:
      // 1. Extract vanishing point from scene using perspective_hint
      // 2. Apply affine transform to each subject for correct scale/perspective
      // 3. Composite subjects onto scene with alpha blending
      //
      // For now: pass through the base scene image as placeholder.
      // The edit_image step after this will handle visual unification.
      const baseUrl = step.base_image ? ctx.assets.get(step.base_image) : undefined;
      if (baseUrl) {
        ctx.assets.set(step.output_key, baseUrl);
      }

      const activity = useAgentActivityStore.getState();
      const taskId = activity.startTask(ctx.phaseId, "asset",
        `🎨 CV Agent: collage (${step.subject_count ?? 0} subjects, perspective: ${step.perspective_hint || "auto"})`);
      activity.appendStream(taskId, `Base scene: ${step.base_image}\n`);
      activity.appendStream(taskId, `Overlays: ${(step.overlay_images || []).join(", ")}\n`);
      activity.appendStream(taskId, `⚠ CV collage not yet implemented — using scene passthrough + edit fusion\n`);
      activity.completeTask(taskId, "Collage placeholder");
      break;
    }

    case "edit_image": {
      const result = await generateImage(step.prompt ?? "", {
        negativePrompt: step.negative_prompt,
        imageSize: step.image_size,
        seed: step.seed,
        model: IMAGE_EDIT_MODEL,
        phaseId: ctx.phaseId,
        baseImageUrl: inputUrl,
      });
      ctx.assets.set(step.output_key, result.outputUrl);
      break;
    }

    case "i2v": {
      const result = await generateVideo(step.prompt ?? "", {
        imageUrl: inputUrl,
        negativePrompt: step.negative_prompt,
        duration: step.duration,
        model: VIDEO_I2V_MODEL,
        phaseId: ctx.phaseId,
      });
      ctx.assets.set(step.output_key, result.outputUrl);
      break;
    }

    case "video_extend": {
      // TODO: implement video-extend API
      if (inputUrl) ctx.assets.set(step.output_key, inputUrl);
      break;
    }

    case "t2v": {
      const result = await generateVideo(step.prompt ?? "", {
        negativePrompt: step.negative_prompt,
        duration: step.duration,
        phaseId: ctx.phaseId,
      });
      ctx.assets.set(step.output_key, result.outputUrl);
      break;
    }
  }
}

/* ── Shot Executor ─────────────────────────────────────── */

async function executeShotPlan(
  plan: ShotExecutionPlan,
  ctx: ExecutionContext,
): Promise<{ shotId: string; videoUrl: string | null; error: string | null }> {
  try {
    for (const step of plan.steps) {
      await executeStep(step, ctx);
    }
    const videoStep = [...plan.steps].reverse().find(
      (s) => s.step_type === "i2v" || s.step_type === "video_extend" || s.step_type === "t2v",
    );
    const videoUrl = videoStep ? ctx.assets.get(videoStep.output_key) ?? null : null;
    if (videoUrl) ctx.onShotComplete?.(plan.shot_id, videoUrl);
    return { shotId: plan.shot_id, videoUrl, error: null };
  } catch (err: any) {
    ctx.onShotFailed?.(plan.shot_id, err.message);
    return { shotId: plan.shot_id, videoUrl: null, error: err.message };
  }
}

/* ── Main Executor ─────────────────────────────────────── */

export async function executePlan(
  plan: FullExecutionPlan,
  phaseId: string,
  callbacks?: {
    onShotComplete?: (shotId: string, videoUrl: string) => void;
    onShotFailed?: (shotId: string, error: string) => void;
  },
): Promise<ExecutionResult> {
  const activity = useAgentActivityStore.getState();
  const ctx: ExecutionContext = {
    assets: new Map(),
    phaseId,
    onShotComplete: callbacks?.onShotComplete,
    onShotFailed: callbacks?.onShotFailed,
  };

  // ── Phase 1: Asset Generation (all parallel) ──
  const kfPhaseId = activity.startPhase("Asset Generation");
  const kfTaskId = activity.startTask(kfPhaseId, "asset", "Asset Agent: generating reference images & keyframes");
  activity.appendStream(kfTaskId, `Generating ${plan.asset_steps.length} images (subjects + scenes, lazy per-shot)...\n`);

  const assetTasks = plan.asset_steps.map((step) => () => executeStep(step, ctx));
  await runWithConcurrency(assetTasks, MAX_CONCURRENCY);

  activity.appendStream(kfTaskId, `${ctx.assets.size} assets generated\n`);
  activity.completeTask(kfTaskId, `${ctx.assets.size} assets ready`);
  activity.completePhase(kfPhaseId);

  // ── Phase 2: Collage + Edit + Video Generation ──
  const videoPhaseId = activity.startPhase("Video Generation");
  const planMap = new Map(plan.shot_plans.map((p) => [p.shot_id, p]));
  const videoUrls = new Map<string, string>();
  const errors = new Map<string, string>();
  let success = 0;
  let failed = 0;

  // Sequential shots first
  if (plan.sequential_queue.length > 0) {
    const seqTaskId = activity.startTask(videoPhaseId, "production",
      `Production Agent: sequential shots (${plan.sequential_queue.length})`);

    for (const shotId of plan.sequential_queue) {
      const shotPlan = planMap.get(shotId);
      if (!shotPlan) continue;
      activity.appendStream(seqTaskId, `Shot #${shotPlan.shot_seq}...\n`);
      const result = await executeShotPlan(shotPlan, ctx);
      if (result.videoUrl) {
        videoUrls.set(shotId, result.videoUrl);
        success++;
        activity.appendStream(seqTaskId, `Shot #${shotPlan.shot_seq} done\n`);
      } else {
        errors.set(shotId, result.error ?? "Unknown error");
        failed++;
        activity.appendStream(seqTaskId, `Shot #${shotPlan.shot_seq} FAILED: ${result.error}\n`);
      }
    }
    activity.completeTask(seqTaskId, `${success} done, ${failed} failed`);
  }

  // Parallel shots
  if (plan.parallel_batch.length > 0) {
    const parTaskId = activity.startTask(videoPhaseId, "production",
      `Production Agent: parallel shots (${plan.parallel_batch.length})`);

    const parallelTasks = plan.parallel_batch.map((shotId) => async () => {
      const shotPlan = planMap.get(shotId);
      if (!shotPlan) return;
      const result = await executeShotPlan(shotPlan, ctx);
      if (result.videoUrl) {
        videoUrls.set(shotId, result.videoUrl);
        success++;
      } else {
        errors.set(shotId, result.error ?? "Unknown error");
        failed++;
      }
    });

    await runWithConcurrency(parallelTasks, MAX_CONCURRENCY);
    activity.completeTask(parTaskId, `Parallel batch complete`);
  }

  activity.completePhase(videoPhaseId);
  return { success, failed, videoUrls, errors };
}
