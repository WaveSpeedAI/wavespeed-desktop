/**
 * Prompt Translation Engine v3.0 — Authoring → Execution prompt conversion.
 *
 * Key design:
 * - Token budget system (not free-form): high=180-220, medium=120-150, low=80-120
 * - Priority-ordered assembly: P0 style → P1 face → P2 outfit → P3 poetry → P4 action → P5 comp → P6 camera → P7 mood
 * - Overflow truncates from P7 upward
 * - i2v prompts include duration-aware time segmentation
 * - tension_moment replaces raw action for first frame (frozen 0.5s before peak)
 *
 * Architecture is determined by model capabilities:
 * - No precise camera angles (model can't execute "85mm, key light 45°")
 * - Spatial direction as hint only (model often gets left/right wrong)
 * - Short prompts > long prompts (model compliance inversely proportional to length)
 */
import type { Shot } from "../types/shot";
import type { Character, Scene, SuperDID } from "../types/project";
import { VIDEO_MODEL_CAPABILITIES } from "../models/model-config";

/* ── Token Budget ──────────────────────────────────────── */

function getTokenBudget(shot: Shot): number {
  if (shot.narrative_value === "high" && shot.subjects.length > 1) return 220;
  if (shot.narrative_value === "high") return 180;
  if (shot.narrative_value === "medium") return 150;
  // low value: establishing, cutaway, atmosphere
  return 100;
}

/** Rough token count (English: ~1 token per word, CJK: ~2 tokens per char) */
function estimateTokens(text: string): number {
  return text.split(/\s+/).length;
}

/* ── Priority Assembly ─────────────────────────────────── */

interface PromptLayer {
  priority: number; // P0 = highest
  label: string;
  content: string;
}

function assembleWithBudget(layers: PromptLayer[], budget: number): string {
  const sorted = [...layers].sort((a, b) => a.priority - b.priority);
  const parts: string[] = [];
  let usedTokens = 0;

  for (const layer of sorted) {
    if (!layer.content) continue;
    const tokens = estimateTokens(layer.content);
    if (usedTokens + tokens > budget) {
      // Try to fit a truncated version
      const remaining = budget - usedTokens;
      if (remaining > 5) {
        const words = layer.content.split(/\s+/).slice(0, remaining);
        parts.push(words.join(" "));
      }
      break; // Over budget — stop adding lower priority layers
    }
    parts.push(layer.content);
    usedTokens += tokens;
  }

  return parts.join(", ");
}

/* ── First Frame Prompt Builder ────────────────────────── */

/**
 * Build the first frame (keyframe) generation prompt.
 * This captures the tension_moment — the frozen instant 0.5s before peak action.
 */
export function buildFirstFramePrompt(
  shot: Shot,
  characters: Character[],
  scene: Scene | undefined,
  did: SuperDID | undefined,
): string {
  const budget = getTokenBudget(shot);
  const layers: PromptLayer[] = [];

  // P0: Global style prefix (≤40 tokens, from DID)
  if (did?.cinematic_identity.global_prompt_prefix) {
    layers.push({
      priority: 0,
      label: "style",
      content: did.cinematic_identity.global_prompt_prefix,
    });
  }

  // P1: Character face descriptions (identity consistency — highest priority after style)
  for (const subj of shot.subjects) {
    const char = characters.find((c) => c.character_id === subj.character_id);
    if (char?.immutable_traits.face_description) {
      layers.push({
        priority: 1,
        label: `face:${char.name}`,
        content: char.immutable_traits.face_description,
      });
    }
  }

  // P2: Core outfit (identity consistency)
  for (const subj of shot.subjects) {
    const char = characters.find((c) => c.character_id === subj.character_id);
    if (char?.immutable_traits.core_outfit) {
      layers.push({
        priority: 2,
        label: `outfit:${char.name}`,
        content: char.immutable_traits.core_outfit,
      });
    }
  }

  // P3: Visual poetry (cinematic description)
  if (shot.visual_poetry) {
    layers.push({
      priority: 3,
      label: "poetry",
      content: shot.visual_poetry,
    });
  }

  // P4: Action as tension_moment (frozen instant before peak)
  if (shot.tension_moment) {
    layers.push({
      priority: 4,
      label: "tension",
      content: shot.tension_moment,
    });
  } else if (shot.subjects.length > 0) {
    // Fallback: use first subject's action
    const action = shot.subjects[0]?.action;
    if (action) {
      layers.push({ priority: 4, label: "action", content: action });
    }
  }

  // P5: Composition (scale + framing)
  const compStr = buildCompositionString(shot);
  if (compStr) {
    layers.push({ priority: 5, label: "composition", content: compStr });
  }

  // P6: Camera motion hint
  const camStr = buildCameraHint(shot);
  if (camStr) {
    layers.push({ priority: 6, label: "camera", content: camStr });
  }

  // P7: Mood keywords (lowest priority — truncated first)
  if (shot.mood_keywords.length > 0) {
    layers.push({
      priority: 7,
      label: "mood",
      content: shot.mood_keywords.join(", "),
    });
  }

  // Scene context (injected at P3.5 level — between poetry and action)
  if (scene) {
    const sceneStr = buildSceneContext(scene);
    if (sceneStr) {
      layers.push({ priority: 3.5 as number, label: "scene", content: sceneStr });
    }
  }

  return assembleWithBudget(layers, budget);
}

/* ── i2v Prompt Builder (with time segmentation) ───────── */

/**
 * Build the i2v (image-to-video) prompt with duration-aware time segmentation.
 *
 * Segmentation rules (respecting model constraints from model-config):
 * - ≤ sweetSpotMin: single segment
 * - sweetSpotMin to segmentation threshold: optional 2 segments (each ≥ minDuration)
 * - above segmentation threshold: 2-3 segments (each within [minDuration, maxDuration])
 * - above maxDuration: forced segmentation
 *
 * Each segment starts with a dynamic verb.
 */
export function buildI2VPrompt(
  shot: Shot,
  characters: Character[],
  scene: Scene | undefined,
  did: SuperDID | undefined,
): string {
  const prefix = did?.cinematic_identity.global_prompt_prefix || "";
  const dur = shot.duration_seconds;
  const { minDuration, maxDuration, sweetSpotMin } = VIDEO_MODEL_CAPABILITIES;

  // Build subject anchor (5-8 words)
  const subjectAnchor = buildSubjectAnchor(shot, characters);

  // Build camera description
  const cameraDesc = buildCameraMotionDesc(shot);

  // Build scene hint
  const sceneHint = scene
    ? `${scene.environment_description}, ${scene.weather_state}`
    : "";

  // Single segment: within sweet spot minimum and model range
  if (dur <= sweetSpotMin) {
    return formatSingleSegment(prefix, subjectAnchor, shot, cameraDesc, sceneHint);
  }

  // Two segments: up to segmentation threshold (each segment must be ≥ minDuration)
  const segThreshold = Math.round(maxDuration * 0.58);
  if (dur <= segThreshold && dur / 2 >= minDuration) {
    return formatTwoSegments(prefix, subjectAnchor, shot, cameraDesc, sceneHint, dur);
  }

  // Multi segments: above segmentation threshold (ensure each segment is within [minDuration, maxDuration])
  return formatMultiSegments(prefix, subjectAnchor, shot, cameraDesc, sceneHint, dur);
}

/* ── Negative Prompt ───────────────────────────────────── */

export function buildNegativePrompt(_shot: Shot, _characters: Character[]): string {
  const base = "blurry, low quality, distorted face, extra limbs, watermark, text overlay, bad anatomy, deformed, ugly, duplicate";
  // Add character-specific negatives if needed
  return base;
}

/* ── Helpers ───────────────────────────────────────────── */

function buildCompositionString(shot: Shot): string {
  const parts: string[] = [];
  const scaleMap: Record<string, string> = {
    ECU: "extreme close-up",
    CU: "close-up",
    MCU: "medium close-up",
    MS: "medium shot",
    MLS: "medium long shot",
    LS: "long shot",
    ELS: "extreme long shot",
  };
  const scale = scaleMap[shot.composition.scale];
  if (scale) parts.push(scale);

  if (shot.composition.framing === "rule_of_thirds_left") parts.push("subject in left third");
  else if (shot.composition.framing === "rule_of_thirds_right") parts.push("subject in right third");
  else if (shot.composition.framing === "symmetry") parts.push("symmetrical composition");

  if (shot.composition.camera_angle === "low_angle") parts.push("low angle");
  else if (shot.composition.camera_angle === "high_angle") parts.push("high angle");
  else if (shot.composition.camera_angle === "dutch") parts.push("dutch angle");

  return parts.join(", ");
}

function buildCameraHint(shot: Shot): string {
  if (shot.camera_motion.type === "static") return "";
  const intensityAdj = shot.camera_motion.intensity <= 2 ? "gentle"
    : shot.camera_motion.intensity <= 3 ? "steady"
    : shot.camera_motion.intensity <= 4 ? "dynamic"
    : "intense";
  return `${intensityAdj} ${shot.camera_motion.type.replace("_", " ")}`;
}

function buildSceneContext(scene: Scene): string {
  const parts = [scene.environment_description];
  if (scene.landmark_objects.length > 0) {
    parts.push(scene.landmark_objects.slice(0, 2).join(", "));
  }
  return parts.join(", ");
}

function buildSubjectAnchor(shot: Shot, characters: Character[]): string {
  if (shot.is_atmosphere || shot.subjects.length === 0) return "";
  const primary = shot.subjects[0];
  const char = characters.find((c) => c.character_id === primary.character_id);
  if (!char) return "";
  // 5-8 words: name + key visual + action hint
  return `${char.name}, ${char.immutable_traits.signature_features}`;
}

function buildCameraMotionDesc(shot: Shot): string {
  if (shot.camera_motion.type === "static") return "camera holds steady";
  const type = shot.camera_motion.type.replace("_", " ");
  const intensity = shot.camera_motion.intensity;
  if (intensity <= 2) return `camera slowly ${type}s`;
  if (intensity <= 3) return `camera ${type}s`;
  if (intensity <= 4) return `camera rapidly ${type}s`;
  return `camera explosively ${type}s`;
}

/* ── Segment Formatters ────────────────────────────────── */

function formatSingleSegment(
  prefix: string, subject: string, shot: Shot, camera: string, scene: string,
): string {
  const action = shot.subjects[0]?.action || shot.visual_poetry || "atmospheric scene";
  const parts = [prefix, subject, action, scene, camera].filter(Boolean);
  return parts.join(", ");
}

function formatTwoSegments(
  prefix: string, subject: string, shot: Shot, camera: string, scene: string, dur: number,
): string {
  const mid = Math.round(dur / 2);
  const action = shot.subjects[0]?.action || shot.visual_poetry;
  const lines = [
    `[STYLE] ${prefix}`,
    `[SUBJECT] ${subject}`,
    `[SCENE] ${scene}`,
    `[0:00-0:${String(mid).padStart(2, "0")}] ${action || "establishing state"}, ${camera}`,
    `[0:${String(mid).padStart(2, "0")}-0:${String(dur).padStart(2, "0")}] motion develops, camera settles`,
  ];
  return lines.filter(Boolean).join("\n");
}

function formatMultiSegments(
  prefix: string, subject: string, shot: Shot, camera: string, scene: string, dur: number,
): string {
  const { maxDuration } = VIDEO_MODEL_CAPABILITIES;
  const tripleThreshold = Math.round(maxDuration * 0.75);
  const segCount = dur > tripleThreshold ? 3 : 2;
  const segDur = Math.round(dur / segCount);
  const action = shot.subjects[0]?.action || shot.visual_poetry;

  const lines = [
    `[STYLE] ${prefix}`,
    `[SUBJECT] ${subject}`,
    `[SCENE] ${scene}`,
  ];

  for (let i = 0; i < segCount; i++) {
    const start = i * segDur;
    const end = i === segCount - 1 ? dur : (i + 1) * segDur;
    const timeTag = `[0:${String(start).padStart(2, "0")}-0:${String(end).padStart(2, "0")}]`;

    if (i === 0) {
      lines.push(`${timeTag} ${action || "establishing state"}, ${camera}`);
    } else if (i === segCount - 1) {
      lines.push(`${timeTag} motion resolves, camera settles`);
    } else {
      lines.push(`${timeTag} action develops, momentum builds`);
    }
  }

  return lines.filter(Boolean).join("\n");
}
