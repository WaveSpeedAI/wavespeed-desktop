/**
 * Generation client v3.0 — wraps WaveSpeed API for the two-convergence pipeline.
 *
 * Key changes from v2:
 * - Reference image support (turnaround sheet as identity anchor, weight 0.7-0.8)
 * - Scene master as style reference (weight 0.5-0.6)
 * - Duration parameter passed to i2v model
 * - Simplified: no collage/edit steps (handled by direct multi-char generation or reference)
 */
import { apiClient } from "@/api/client";
import { DEFAULT_MODELS, VIDEO_I2V_MODEL, type ModelOption } from "./model-config";
import { useAgentActivityStore } from "../stores/agent-activity.store";

export interface GenerationResult {
  outputUrl: string;
  allOutputs: string[];
  predictionId: string;
  inferenceTime?: number;
}

/**
 * Generate an image using the WaveSpeed API.
 * Supports reference images for identity consistency.
 */
export async function generateImage(
  prompt: string,
  options?: {
    negativePrompt?: string;
    imageSize?: string;
    seed?: number;
    model?: ModelOption;
    phaseId?: string;
    /** Reference images for consistency (turnaround sheet, scene master) */
    referenceImages?: string[];
    /** Reference weight (0.5-0.8, default 0.7) */
    referenceWeight?: number;
  },
): Promise<GenerationResult> {
  const model = options?.model ?? DEFAULT_MODELS.image;
  const activity = useAgentActivityStore.getState();
  let taskId: string | undefined;

  if (options?.phaseId) {
    taskId = activity.startTask(options.phaseId, "asset", "🖼 生成图片");
    activity.appendStream(taskId, `模型: ${model.name}\n`);
    activity.appendStream(taskId, `Prompt: ${prompt.slice(0, 80)}...\n`);
    if (options.referenceImages?.length) {
      activity.appendStream(taskId, `参考图: ${options.referenceImages.length} 张\n`);
    }
  }

  try {
    const input: Record<string, unknown> = {
      prompt,
      ...model.defaultParams,
      ...(options?.negativePrompt && { negative_prompt: options.negativePrompt }),
      ...(options?.imageSize && { image_size: options.imageSize }),
      ...(options?.seed !== undefined && { seed: options.seed }),
    };

    // Reference images for consistency
    if (options?.referenceImages && options.referenceImages.length > 0) {
      input.reference_images = options.referenceImages;
      input.reference_weight = options.referenceWeight ?? 0.7;
    }

    taskId && activity.appendStream(taskId, "提交生成请求...\n");
    const result = await apiClient.run(model.modelId, input);

    const outputs = (result.outputs || []).map((o: unknown) =>
      typeof o === "object" && o !== null && typeof (o as { url?: string }).url === "string"
        ? (o as { url: string }).url
        : String(o),
    ).filter((u: string) => u && u !== "[object Object]");

    const outputUrl = outputs[0] || "";

    if (taskId) {
      activity.appendStream(taskId, `✅ 生成完成\n`);
      activity.completeTask(taskId, "图片已生成");
    }

    return {
      outputUrl,
      allOutputs: outputs,
      predictionId: result.id,
      inferenceTime: result.timings?.inference,
    };
  } catch (err: any) {
    if (taskId) activity.failTask(taskId, err.message);
    throw err;
  }
}

/**
 * Generate a video using the WaveSpeed API.
 * Duration is explicitly passed so the model knows how long to generate.
 */
export async function generateVideo(
  prompt: string,
  options?: {
    imageUrl?: string;       // first frame for i2v
    endFrameUrl?: string;    // end frame for P2 path
    negativePrompt?: string;
    duration?: number;       // target duration in seconds
    seed?: number;
    model?: ModelOption;
    phaseId?: string;
  },
): Promise<GenerationResult> {
  const model = options?.imageUrl
    ? (options?.model ?? VIDEO_I2V_MODEL)
    : (options?.model ?? DEFAULT_MODELS.video);

  const activity = useAgentActivityStore.getState();
  let taskId: string | undefined;

  if (options?.phaseId) {
    taskId = activity.startTask(options.phaseId, "production", "🎬 生成视频");
    activity.appendStream(taskId, `模型: ${model.name}\n`);
    activity.appendStream(taskId, `模式: ${options?.imageUrl ? "图生视频" : "文生视频"}\n`);
    activity.appendStream(taskId, `时长: ${options?.duration ?? "默认"}s\n`);
    activity.appendStream(taskId, `Prompt: ${prompt.slice(0, 80)}...\n`);
  }

  try {
    const input: Record<string, unknown> = {
      prompt,
      ...model.defaultParams,
      ...(options?.negativePrompt && { negative_prompt: options.negativePrompt }),
      ...(options?.seed !== undefined && { seed: options.seed }),
      ...(options?.imageUrl && { image: options.imageUrl }),
      ...(options?.endFrameUrl && { end_image: options.endFrameUrl }),
      ...(options?.duration !== undefined && { duration: options.duration }),
    };

    taskId && activity.appendStream(taskId, "提交生成请求...\n");
    const result = await apiClient.run(model.modelId, input);

    const outputs = (result.outputs || []).map((o: unknown) =>
      typeof o === "object" && o !== null && typeof (o as { url?: string }).url === "string"
        ? (o as { url: string }).url
        : String(o),
    ).filter((u: string) => u && u !== "[object Object]");

    const outputUrl = outputs[0] || "";

    if (taskId) {
      activity.appendStream(taskId, `✅ 视频生成完成\n`);
      if (result.timings?.inference) {
        activity.appendStream(taskId, `推理耗时: ${result.timings.inference.toFixed(1)}s\n`);
      }
      activity.completeTask(taskId, "视频已生成");
    }

    return {
      outputUrl,
      allOutputs: outputs,
      predictionId: result.id,
      inferenceTime: result.timings?.inference,
    };
  } catch (err: any) {
    if (taskId) activity.failTask(taskId, err.message);
    throw err;
  }
}
