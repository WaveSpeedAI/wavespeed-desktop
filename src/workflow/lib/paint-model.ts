import type { Model } from "../../types/model";
import type { ModelParamSchema } from "../types/node-defs";

export type PaintTask =
  | "repaint"
  | "erase"
  | "expand"
  | "cutout"
  | "remove-bg"
  | "enhance"
  | "face-enhance"
  | "region";

export type PaintTarget = "image" | "video";
export type RepaintScope = "region" | "full";

const REPAINT_REGION_FALLBACK =
  "Fill the selected area naturally, consistent with the surrounding image.";
const REPAINT_REGION_CONSTRAINT =
  "Only edit the selected area. Keep everything outside unchanged.";
const REPAINT_REGION_BLEND =
  "Match surrounding lighting, texture, perspective, and edges.";
const REPAINT_MARKER_REGION = "Use the red marked area as the edit region.";
const REPAINT_MARKER_SKETCH =
  "Follow the red sketch as visual guidance for the selected area.";
const REPAINT_MARKER_FINAL =
  "The red marks are selection guides only and must not appear in the final image.";
const EXPAND_FALLBACK = "Extend the image naturally into the new canvas area.";
const EXPAND_PRESERVE_ORIGINAL =
  "Preserve the original image content unchanged.";
const EXPAND_FILL_NEW_AREA = "Fill only the newly added canvas area.";
const EXPAND_BLEND =
  "Match the original image's lighting, perspective, texture, and style.";

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
const GENERIC_IMAGE_EDIT_MODEL_RE = /gpt[-_\s]*image|nano[-_\s]*banana/;
const IMAGE_EDIT_MODEL_RE =
  /\/edit\b|image[-_\s]*(?:edit|to[-_\s]*image)|img[-_\s]*to[-_\s]*img|i2i|inpaint|repaint|seededit|kontext/;
const EXPAND_MODEL_RE = /outpaint|expand|uncrop|extend|generative[-_\s]*fill/;
const ERASE_MODEL_RE =
  /erase|cleanup|clean[-_\s]*up|object[-_\s]*(?:remove|removal)|inpaint|mask/;
const CUTOUT_MODEL_RE =
  /background[-_\s]*(?:remove|removal|remover)|remove[-_\s]*background|rmbg|matting|cutout|isnet|bria/;
const NON_IMAGE_EDIT_MODEL_RE =
  /translate|translation|locali[sz]e|embed[-_\s]*product|product[-_\s]*embed|product[-_\s]*(?:placement|try|scene)|fat[-_\s]*filter|skinny[-_\s]*filter|beauty[-_\s]*filter|ai[-_\s]*filter|\bfilter\b|gender[-_\s]*swap|dog[-_\s]*selfie|pet[-_\s]*selfie|animal[-_\s]*selfie|face[-_\s]*swap|faceswap|swap[-_\s]*face|face[-_\s]*fusion|lip[-_\s]*sync|lipsync|talking[-_\s]*head|avatar|try[-_\s]*on|virtual[-_\s]*try|clothes?|garment|fashion|makeup|hair[-_\s]*(?:change|style)|pose|relight|upscal|enhanc|restor|super[-_\s]*resolution|background[-_\s]*(?:remove|removal|remover)|remove[-_\s]*background|rmbg|matting|cutout/;
const NON_CUTOUT_MODEL_RE =
  /translate|translation|locali[sz]e|embed[-_\s]*product|product[-_\s]*embed|product[-_\s]*(?:placement|try|scene)|fat[-_\s]*filter|skinny[-_\s]*filter|beauty[-_\s]*filter|ai[-_\s]*filter|\bfilter\b|gender[-_\s]*swap|dog[-_\s]*selfie|pet[-_\s]*selfie|animal[-_\s]*selfie|face[-_\s]*swap|faceswap|swap[-_\s]*face|lip[-_\s]*sync|lipsync|talking[-_\s]*head|avatar|try[-_\s]*on|virtual[-_\s]*try|upscal|enhanc|restor|inpaint|repaint|outpaint|expand|uncrop|seededit|kontext/;

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

export function normalizeRepaintScope(value: unknown): RepaintScope {
  return value === "full" ? "full" : "region";
}

function joinPromptLines(lines: string[]): string {
  const seen = new Set<string>();
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .join("\n");
}

function buildRepaintPrompt({
  userPrompt,
  scope,
  selectionMode,
  usesMarkedReference,
}: {
  userPrompt: unknown;
  scope: RepaintScope;
  selectionMode: string;
  usesMarkedReference: boolean;
}): string {
  const text = String(userPrompt ?? "").trim();
  if (scope === "full") return text;

  const lines = [
    text || REPAINT_REGION_FALLBACK,
    REPAINT_REGION_CONSTRAINT,
    REPAINT_REGION_BLEND,
  ];

  if (usesMarkedReference) {
    lines.push(
      selectionMode === "sketch"
        ? REPAINT_MARKER_SKETCH
        : REPAINT_MARKER_REGION,
      REPAINT_MARKER_FINAL,
    );
  }

  return joinPromptLines(lines);
}

function buildExpandPrompt(userPrompt: unknown): string {
  const text = String(userPrompt ?? "").trim();
  return joinPromptLines([
    text || EXPAND_FALLBACK,
    EXPAND_PRESERVE_ORIGINAL,
    EXPAND_FILL_NEW_AREA,
    EXPAND_BLEND,
  ]);
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
  repaintScope,
  selectionMode,
}: {
  params: Record<string, unknown>;
  schema: ModelParamSchema[];
  task: PaintTask;
  source: string;
  mask: string;
  prompt: string;
  reference: string;
  expandRatio: string;
  repaintScope?: RepaintScope;
  selectionMode?: string;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const customParams = readPaintModelParams(params.__paintModelParams);
  const sourceField = findPaintSourceField(schema);
  const promptField =
    task === "repaint" || task === "expand"
      ? findPaintPromptField(schema)
      : undefined;
  const normalizedRepaintScope = normalizeRepaintScope(
    repaintScope ?? params.__repaintScope,
  );
  const hasMaskField = schema.some(isPaintMaskField);
  const effectiveMask =
    task === "erase" ||
    (task === "repaint" && normalizedRepaintScope === "region")
      ? mask
      : "";
  const normalizedSelectionMode = String(selectionMode ?? "paint");
  const shouldUseMarkedReference =
    task === "repaint" &&
    normalizedRepaintScope === "region" &&
    Boolean(reference && reference !== source) &&
    (!hasMaskField || normalizedSelectionMode === "sketch");
  const modelInputImage =
    task === "repaint" && shouldUseMarkedReference
      ? reference
      : task === "repaint"
        ? source
        : source;

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
      effectiveMask
    ) {
      out[field.name] = valueForField(field, effectiveMask);
      continue;
    }

    if (task === "expand" && isPaintAspectField(field)) {
      const customValue = customParams[field.name];
      out[field.name] = !isEmptyPaintValue(customValue)
        ? customValue
        : expandRatio;
      continue;
    }

    if (task === "expand" && field.name === promptField?.name) {
      const customValue = customParams[field.name];
      const expandPrompt = buildExpandPrompt(
        prompt.trim()
          ? prompt
          : !isEmptyPaintValue(customValue)
            ? customValue
            : "",
      );
      if (expandPrompt) out[field.name] = expandPrompt;
      continue;
    }

    if (task === "repaint" && field.name === promptField?.name) {
      const customValue = customParams[field.name];
      const repaintPrompt = buildRepaintPrompt({
        userPrompt: prompt.trim()
          ? prompt
          : !isEmptyPaintValue(customValue)
            ? customValue
            : "",
        scope: normalizedRepaintScope,
        selectionMode: normalizedSelectionMode,
        usesMarkedReference: shouldUseMarkedReference,
      });
      if (repaintPrompt) out[field.name] = repaintPrompt;
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
    schema.some(isPaintMaskField) || ERASE_MODEL_RE.test(haystack);
  const hasGenericEditCapability =
    GENERIC_IMAGE_EDIT_MODEL_RE.test(haystack) && hasSource && hasPrompt;
  const hasImageEditHint =
    IMAGE_EDIT_MODEL_RE.test(haystack) || hasGenericEditCapability;
  const hasExpandHint = EXPAND_MODEL_RE.test(haystack);
  const hasExpandControl = schema.some(isPaintDimensionField);
  const hasCutoutHint = CUTOUT_MODEL_RE.test(haystack);

  if (target === "video") {
    if (!/image-to-video|img-to-video|i2v/.test(haystack)) return 0;
    return 70 + (hasPrompt ? 10 : 0) + (hasSource ? 10 : 0);
  }

  if (isVideoModel || isAudioModel || is3dModel) return 0;

  if (
    !hasSource &&
    !hasImageEditHint &&
    !/outpaint|expand|uncrop|extend/.test(haystack)
  ) {
    return 0;
  }

  if (task === "repaint") {
    if (NON_IMAGE_EDIT_MODEL_RE.test(haystack)) return 0;
    if (!hasPrompt) return 0;
    if (!hasImageEditHint && !hasMask) return 0;
    let score = 0;
    if (/inpaint|mask/.test(haystack) || hasMask) score += 55;
    if (hasImageEditHint) score += 28;
    if (/text-to-image|text2image|t2i/.test(haystack)) score -= 35;
    if (hasPrompt) score += 12;
    return Math.max(0, score);
  }

  if (task === "expand") {
    if (NON_IMAGE_EDIT_MODEL_RE.test(haystack)) return 0;
    const canGenericEditExpand =
      hasImageEditHint && hasPrompt && hasExpandControl;
    if (!hasExpandHint && !canGenericEditExpand) return 0;
    let score = 0;
    if (hasExpandHint) score += 65;
    if (canGenericEditExpand) score += 22;
    if (hasExpandControl) score += 12;
    if (hasPrompt) score += 8;
    if (/text-to-image|text2image|t2i/.test(haystack)) score -= 30;
    return Math.max(0, score);
  }

  if (task === "erase") {
    if (NON_IMAGE_EDIT_MODEL_RE.test(haystack)) return 0;
    if (!ERASE_MODEL_RE.test(haystack) && !hasMask) return 0;
    let score = 0;
    if (ERASE_MODEL_RE.test(haystack) || hasMask) score += 65;
    if (hasImageEditHint) score += 18;
    return score;
  }

  if (task === "remove-bg") {
    if (NON_CUTOUT_MODEL_RE.test(haystack)) return 0;
    if (!hasCutoutHint) return 0;
    let score = 60;
    if (/isnet|bria|rmbg/.test(haystack)) score += 20;
    if (hasSource) score += 10;
    return score;
  }

  return 0;
}
