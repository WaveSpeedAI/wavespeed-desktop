/**
 * Shared types, constants, and utility functions for CustomNode components.
 */
import type {
  ParamDefinition,
  PortDefinition,
  ModelParamSchema,
} from "@/workflow/types/node-defs";
import type { FormFieldConfig } from "@/lib/schemaToForm";

/* ── types ───────────────────────────────────────────────────────────── */

export interface CustomNodeData {
  nodeType: string;
  params: Record<string, unknown>;
  label: string;
  paramDefinitions?: ParamDefinition[];
  inputDefinitions?: PortDefinition[];
  outputDefinitions?: PortDefinition[];
  modelInputSchema?: ModelParamSchema[];
}

/* ── constants ───────────────────────────────────────────────────────── */

export const HANDLE_SIZE = 12;
export const ACCENT = "hsl(var(--primary))";
export const ACCENT_MEDIA = "hsl(142 71% 45%)";

export const MIN_NODE_WIDTH = 300;
export const MIN_NODE_HEIGHT = 80;
export const DEFAULT_NODE_WIDTH = 380;

export const TEXTAREA_NAMES = new Set([
  "prompt",
  "negative_prompt",
  "text",
  "description",
  "content",
  "system_prompt",
]);

// Same range as playground (FormField generateRandomSeed)
export const RANDOM_SEED_MAX = 65536;

/**
 * Centralized file-picker accept rules by workflow node type.
 * Keep node-specific constraints here to avoid scattered if/else logic.
 */
export const NODE_INPUT_ACCEPT_RULES: Record<
  string,
  string | Record<string, string>
> = {
  "free-tool/image-enhancer": { input: "image/*" },
  "free-tool/background-remover": { input: "image/*" },
  "free-tool/face-enhancer": { input: "image/*" },
  "free-tool/video-enhancer": { input: "video/*" },
  "free-tool/face-swapper": { source: "image/*", target: "image/*" },
  "free-tool/image-eraser": { input: "image/*", mask_image: "image/*" },
  "free-tool/segment-anything": { input: "image/*" },
  "free-tool/image-converter": { input: "image/*" },
  "free-tool/video-converter": { input: "video/*" },
  "free-tool/audio-converter": { input: "audio/*" },
  "free-tool/media-trimmer": { input: "video/*,audio/*" },
  "free-tool/media-merger": {
    input1: "video/*,audio/*",
    input2: "video/*,audio/*",
    input3: "video/*,audio/*",
    input4: "video/*,audio/*",
    input5: "video/*,audio/*",
  },
  "input/media-upload": { output: "image/*,video/*,audio/*" },
};

export const ML_FREE_TOOLS = new Set([
  "free-tool/image-enhancer",
  "free-tool/background-remover",
  "free-tool/face-enhancer",
  "free-tool/video-enhancer",
  "free-tool/face-swapper",
  "free-tool/image-eraser",
  "free-tool/segment-anything",
]);

/* ── utility functions ───────────────────────────────────────────────── */

export function formatLabel(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Convert workflow ParamDefinition to Playground FormFieldConfig for consistent FormField rendering */
export function paramDefToFormFieldConfig(
  p: ParamDefinition,
  nodeType?: string,
): FormFieldConfig | null {
  if (nodeType === "output/file" && p.key === "outputDir") return null;
  const typeMap = {
    string: "text" as const,
    number: "number" as const,
    boolean: "boolean" as const,
    select: "select" as const,
    file: "file" as const,
    textarea: "textarea" as const,
    slider: "slider" as const,
  };
  const formType = typeMap[p.type];
  if (!formType) return null;
  const options = p.options?.map((o) => o.value);
  return {
    name: p.key,
    type: formType,
    label: p.label,
    required: false,
    default: p.default,
    min: p.validation?.min,
    max: p.validation?.max,
    step: p.validation?.step,
    options,
    description: p.description,
  };
}

/** Convert input PortDefinition to FormFieldConfig so we can use Playground FormField (text, url, or file). */
export function portToFormFieldConfig(
  port: PortDefinition,
  nodeType?: string,
): FormFieldConfig | null {
  if (port.dataType === "text" || port.dataType === "url") {
    return {
      name: port.key,
      type: "text",
      label: port.label,
      required: port.required,
      placeholder: port.dataType === "url" ? "https://..." : undefined,
    };
  }
  if (
    port.dataType === "image" ||
    port.dataType === "video" ||
    port.dataType === "audio" ||
    port.dataType === "any"
  ) {
    const rule = nodeType ? NODE_INPUT_ACCEPT_RULES[nodeType] : undefined;
    const acceptFromRule = typeof rule === "string" ? rule : rule?.[port.key];
    const accept =
      acceptFromRule ??
      (port.dataType === "image"
        ? "image/*"
        : port.dataType === "video"
          ? "video/*"
          : port.dataType === "audio"
            ? "audio/*"
            : "*/*");
    return {
      name: port.key,
      type: "file",
      label: port.label,
      required: port.required,
      accept,
    };
  }
  return null;
}
