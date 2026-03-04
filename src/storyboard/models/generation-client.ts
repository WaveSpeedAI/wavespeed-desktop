/**
 * Generation client — wraps the existing WaveSpeed apiClient
 * for video/image/TTS generation in the storyboard system.
 *
 * Uses the same submit+poll pattern as the playground.
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
 * Used for character reference images and scene concept art.
 */
export async function generateImage(
  prompt: string,
  options?: {
    negativePrompt?: string;
    imageSize?: string;
    seed?: number;
    model?: ModelOption;
    phaseId?: string;
  },
): Promise<GenerationResult> {
  const model = options?.model ?? DEFAULT_MODELS.image;
  const activity = useAgentActivityStore.getState();
  let taskId: string | undefined;

  if (options?.phaseId) {
    taskId = activity.startTask(options.phaseId, "asset", `🖼 资产Agent: 生成图片`);
    activity.appendStream(taskId, `模型: ${model.name}\n`);
    activity.appendStream(taskId, `Prompt: ${prompt.slice(0, 100)}...\n`);
  }

  try {
    const input: Record<string, unknown> = {
      prompt,
      ...model.defaultParams,
      ...(options?.negativePrompt && { negative_prompt: options.negativePrompt }),
      ...(options?.imageSize && { image_size: options.imageSize }),
      ...(options?.seed !== undefined && { seed: options.seed }),
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
      activity.appendStream(taskId, `✅ 生成完成\n`);
      activity.appendStream(taskId, `输出: ${outputUrl.slice(0, 80)}...\n`);
      activity.completeTask(taskId, `图片已生成`);
    }

    return {
      outputUrl,
      allOutputs: outputs,
      predictionId: result.id,
      inferenceTime: result.timings?.inference,
    };
  } catch (err: any) {
    if (taskId) {
      activity.failTask(taskId, err.message);
    }
    throw err;
  }
}

/**
 * Generate a video using the WaveSpeed API.
 * Used for shot video generation.
 */
export async function generateVideo(
  prompt: string,
  options?: {
    imageUrl?: string;     // reference image for i2v
    negativePrompt?: string;
    duration?: number;     // target duration in seconds (4-12 for Seedance)
    seed?: number;
    model?: ModelOption;
    phaseId?: string;
  },
): Promise<GenerationResult> {
  // Use i2v model if we have a reference image, otherwise t2v
  const model = options?.imageUrl
    ? (options?.model ?? VIDEO_I2V_MODEL)
    : (options?.model ?? DEFAULT_MODELS.video);

  const activity = useAgentActivityStore.getState();
  let taskId: string | undefined;

  if (options?.phaseId) {
    taskId = activity.startTask(options.phaseId, "production", `🎬 生成Agent: 生成视频`);
    activity.appendStream(taskId, `模型: ${model.name}\n`);
    activity.appendStream(taskId, `模式: ${options?.imageUrl ? "图生视频" : "文生视频"}\n`);
    activity.appendStream(taskId, `Prompt: ${prompt.slice(0, 100)}...\n`);
  }

  try {
    const input: Record<string, unknown> = {
      prompt,
      ...model.defaultParams,
      ...(options?.negativePrompt && { negative_prompt: options.negativePrompt }),
      ...(options?.seed !== undefined && { seed: options.seed }),
      ...(options?.imageUrl && { image: options.imageUrl }),
      ...(options?.duration !== undefined && { duration: options.duration }),
    };

    taskId && activity.appendStream(taskId, `时长: ${options?.duration ?? "默认"}s\n`);
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
      activity.appendStream(taskId, `输出: ${outputUrl.slice(0, 80)}...\n`);
      if (result.timings?.inference) {
        activity.appendStream(taskId, `推理耗时: ${result.timings.inference.toFixed(1)}s\n`);
      }
      activity.completeTask(taskId, `视频已生成`);
    }

    return {
      outputUrl,
      allOutputs: outputs,
      predictionId: result.id,
      inferenceTime: result.timings?.inference,
    };
  } catch (err: any) {
    if (taskId) {
      activity.failTask(taskId, err.message);
    }
    throw err;
  }
}
