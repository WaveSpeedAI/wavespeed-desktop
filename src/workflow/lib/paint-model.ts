import type { Model } from "../../types/model";
import type { ModelParamSchema } from "../types/node-defs";

export type PaintTask =
  | "repaint"
  | "erase"
  | "expand"
  | "remove-bg"
  | "enhance"
  | "face-enhance"
  | "region";

export type PaintTarget = "image" | "video";

export const PAINT_MODEL_PARAM_PREFIX = "__paintModelParam_";
const REPAINT_MARKER_INSTRUCTION =
  "Only modify the red highlighted region. The red overlay and outline are selection markers, not part of the final image.";

const SOURCE_FIELD_PRIORITY = [
  "image",
  "input_image",
  "source_image",
  "init_image",
  "image_url",
  "input",
  "start_image",
  "first_image",
  "first_frame",
  "reference_image",
  "images",
  "image_urls",
];

function lower(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

export function isEmptyPaintValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function hasImageName(name: string): boolean {
  return (
    name === "input" ||
    name.includes("image") ||
    name.includes("img") ||
    name.includes("frame")
  );
}

export function isPaintImageField(
  field: Pick<ModelParamSchema, "name" | "mediaType" | "fieldType">,
): boolean {
  const name = lower(field.name);
  if (field.mediaType === "image") return true;
  if (field.fieldType === "file" || field.fieldType === "file-array") {
    return hasImageName(name);
  }
  return hasImageName(name);
}

export function isPaintVideoField(
  field: Pick<ModelParamSchema, "name" | "mediaType" | "fieldType">,
): boolean {
  const name = lower(field.name);
  if (field.mediaType === "video") return true;
  if (field.fieldType === "file" || field.fieldType === "file-array") {
    return name.includes("video");
  }
  return name.includes("video");
}

export function isPaintMaskField(
  field: Pick<ModelParamSchema, "name">,
): boolean {
  const name = lower(field.name);
  return name.includes("mask");
}

export function isPaintPromptField(
  field: Pick<ModelParamSchema, "name">,
): boolean {
  const name = lower(field.name);
  return (
    name === "prompt" ||
    name.endsWith("_prompt") ||
    name.includes("instruction") ||
    name === "text" ||
    name.includes("description")
  );
}

export function isPaintReferenceField(
  field: Pick<ModelParamSchema, "name" | "mediaType" | "fieldType">,
): boolean {
  const name = lower(field.name);
  if (!isPaintImageField(field)) return false;
  return (
    name.includes("reference") ||
    name.includes("ref_") ||
    name.endsWith("_ref") ||
    name.includes("guide") ||
    name.includes("control") ||
    name.includes("sketch")
  );
}

export function isPaintAspectField(
  field: Pick<ModelParamSchema, "name">,
): boolean {
  const name = lower(field.name);
  return (
    name === "aspect_ratio" ||
    name === "ratio" ||
    name.includes("aspect") ||
    name.includes("canvas_ratio")
  );
}

export function isPaintDimensionField(
  field: Pick<ModelParamSchema, "name" | "fieldType">,
): boolean {
  const name = lower(field.name);
  if (field.fieldType === "size") return true;
  return (
    isPaintAspectField(field) ||
    name === "size" ||
    name === "width" ||
    name === "height" ||
    name === "image_size" ||
    name === "output_size" ||
    name === "canvas_size" ||
    name === "image_width" ||
    name === "image_height" ||
    name === "output_width" ||
    name === "output_height" ||
    name === "target_width" ||
    name === "target_height" ||
    name.endsWith("_size") ||
    name.endsWith("_width") ||
    name.endsWith("_height")
  );
}

export function isPaintSourceCandidate(field: ModelParamSchema): boolean {
  if (!isPaintImageField(field)) return false;
  if (isPaintMaskField(field)) return false;
  const name = lower(field.name);
  if (
    name.includes("negative") ||
    name.includes("mask") ||
    name.includes("target") ||
    name.includes("end_image") ||
    name.includes("last_image") ||
    name.includes("last_frame")
  ) {
    return false;
  }
  return true;
}

function getFieldPriority(name: string): number {
  const exact = SOURCE_FIELD_PRIORITY.indexOf(name);
  if (exact >= 0) return 100 - exact;
  if (name.includes("input") && name.includes("image")) return 70;
  if (name.includes("source") && name.includes("image")) return 68;
  if (name.includes("start") && hasImageName(name)) return 62;
  if (name.includes("first") && hasImageName(name)) return 60;
  if (name.includes("image")) return 50;
  if (name.includes("frame")) return 44;
  return 10;
}

export function findPaintSourceField(
  schema: ModelParamSchema[],
): ModelParamSchema | undefined {
  return schema.filter(isPaintSourceCandidate).sort((a, b) => {
    const priority =
      getFieldPriority(lower(b.name)) - getFieldPriority(lower(a.name));
    if (priority !== 0) return priority;
    return Number(Boolean(b.required)) - Number(Boolean(a.required));
  })[0];
}

export function findPaintPromptField(
  schema: ModelParamSchema[],
): ModelParamSchema | undefined {
  return (
    schema.find((field) => lower(field.name) === "prompt") ??
    schema.find(isPaintPromptField)
  );
}

export function findPaintReferenceField(
  schema: ModelParamSchema[],
): ModelParamSchema | undefined {
  return schema.find(isPaintReferenceField);
}

export function getPaintModelBindings(
  schema: ModelParamSchema[],
  task: PaintTask,
): Set<string> {
  const names = new Set<string>();
  const sourceField = findPaintSourceField(schema);
  if (sourceField) names.add(sourceField.name);

  if (task === "repaint" || task === "erase") {
    for (const field of schema) {
      if (isPaintMaskField(field)) names.add(field.name);
    }
  }

  return names;
}

export function readPaintModelSchema(value: unknown): ModelParamSchema[] {
  const raw = typeof value === "string" ? safeJsonParse(value) : value;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is ModelParamSchema =>
      !!item && typeof item === "object" && typeof item.name === "string",
  );
}

export function readPaintModelParams(value: unknown): Record<string, unknown> {
  const raw = typeof value === "string" ? safeJsonParse(value) : value;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function valueForField(field: ModelParamSchema, value: string): unknown {
  return field.fieldType === "file-array" ? [value] : value;
}

function appendRepaintMarkerInstruction(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return REPAINT_MARKER_INSTRUCTION;
  if (text.includes(REPAINT_MARKER_INSTRUCTION)) return text;
  return `${text}\n\n${REPAINT_MARKER_INSTRUCTION}`;
}

export function buildPaintModelApiParams({
  params,
  schema,
  task,
  source,
  mask,
  prompt,
  reference,
  expandRatio,
}: {
  params: Record<string, unknown>;
  schema: ModelParamSchema[];
  task: PaintTask;
  source: string;
  mask: string;
  prompt: string;
  reference: string;
  expandRatio: string;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const customParams = readPaintModelParams(params.__paintModelParams);
  const sourceField = findPaintSourceField(schema);
  const promptField =
    task === "repaint" ? findPaintPromptField(schema) : undefined;
  const modelInputImage = task === "repaint" ? reference || source : source;

  for (const field of schema) {
    if (field.name.startsWith("__")) continue;

    if (task !== "expand" && isPaintDimensionField(field)) {
      continue;
    }

    if (field.name === sourceField?.name && modelInputImage) {
      out[field.name] = valueForField(field, modelInputImage);
      continue;
    }

    if (
      (task === "repaint" || task === "erase") &&
      isPaintMaskField(field) &&
      mask
    ) {
      out[field.name] = valueForField(field, mask);
      continue;
    }

    if (task === "expand" && isPaintAspectField(field)) {
      const customValue = customParams[field.name];
      out[field.name] = !isEmptyPaintValue(customValue)
        ? customValue
        : expandRatio;
      continue;
    }

    if (task === "repaint" && field.name === promptField?.name) {
      const customValue = customParams[field.name];
      out[field.name] = appendRepaintMarkerInstruction(
        !isEmptyPaintValue(customValue) ? customValue : prompt,
      );
      continue;
    }

    const customValue = customParams[field.name];
    if (!isEmptyPaintValue(customValue)) {
      out[field.name] = customValue;
      continue;
    }

    if (field.name === promptField?.name && prompt.trim()) {
      out[field.name] = prompt.trim();
      continue;
    }

    if (!isEmptyPaintValue(field.default)) {
      out[field.name] = field.default;
    } else if (field.enum?.length) {
      out[field.name] = field.enum[0];
    }
  }

  return out;
}

export function getPaintModelMatchScore(
  model: Model,
  schema: ModelParamSchema[],
  task: PaintTask,
  target: PaintTarget,
): number {
  const id = lower(model.model_id);
  const type = lower(model.type);
  const haystack = `${id} ${type} ${lower(model.name)} ${lower(model.description)}`;
  const isVideoModel = type.includes("video") || id.includes("video");
  const isAudioModel = type.includes("audio") || id.includes("audio");
  const is3dModel =
    type.includes("3d") || id.includes("-to-3d") || id.includes("/3d");
  const hasSource =
    Boolean(findPaintSourceField(schema)) || haystack.includes("image-to");
  const hasPrompt =
    Boolean(findPaintPromptField(schema)) || haystack.includes("prompt");
  const hasMask =
    schema.some(isPaintMaskField) || /inpaint|mask|erase|remove/.test(haystack);

  if (target === "video") {
    if (!/image-to-video|img-to-video|i2v/.test(haystack)) return 0;
    return 70 + (hasPrompt ? 10 : 0) + (hasSource ? 10 : 0);
  }

  if (isVideoModel || isAudioModel || is3dModel) return 0;

  if (
    !hasSource &&
    !/\/edit|image-to-image|img-to-img|i2i|outpaint|inpaint/.test(haystack)
  ) {
    return 0;
  }

  if (task === "repaint") {
    let score = 20;
    if (/inpaint|mask/.test(haystack) || hasMask) score += 45;
    if (/\/edit|image-to-image|img-to-img|i2i/.test(haystack)) score += 28;
    if (/text-to-image|text2image|t2i/.test(haystack)) score -= 35;
    if (hasPrompt) score += 12;
    return Math.max(0, score);
  }

  if (task === "expand") {
    let score = 15;
    if (/outpaint|expand|uncrop|extend/.test(haystack)) score += 50;
    if (/\/edit|image-to-image|img-to-img|i2i/.test(haystack)) score += 22;
    if (/text-to-image|text2image|t2i/.test(haystack)) score -= 30;
    return Math.max(0, score);
  }

  if (task === "erase") {
    let score = 0;
    if (/erase|remove|cleanup|inpaint|mask/.test(haystack) || hasMask)
      score += 65;
    if (/\/edit|image-to-image|img-to-img|i2i/.test(haystack)) score += 18;
    return score;
  }

  return 0;
}
