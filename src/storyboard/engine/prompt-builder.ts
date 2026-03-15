/**
 * Prompt Builder (V6) — assembles generation prompts using fixed templates + DID global prefix.
 *
 * Key principles:
 * - EVERY prompt starts with DID visual identity prefix (brand stamp)
 * - Character appearance and scene environment are FIXED template strings
 * - Focal length → perspective effect mapping (code, not LLM)
 * - Lighting intent → prompt keywords mapping (code, not LLM)
 * - Different assembly per strategy type (A1/A2/B/C/D)
 */
import type { Shot, Scene, Character, ShotStrategy } from "../types";
import type { StyleProfile } from "../types/project";
import type { DirectorIntent } from "../types/director-intent";

/* ── DID Global Prefix ─────────────────────────────────── */

/**
 * Build the global visual identity prefix from DID.
 * This is prepended to EVERY image prompt — the "brand stamp".
 */
export function buildDIDPrefix(did?: DirectorIntent): string {
  if (!did) return "";
  const parts: string[] = [];
  if (did.visual_identity.art_style_anchor) parts.push(did.visual_identity.art_style_anchor);
  if (did.visual_identity.color_palette.dominant) parts.push(`${did.visual_identity.color_palette.dominant} color palette`);
  if (did.visual_identity.color_palette.shadow_tone) parts.push(`${did.visual_identity.color_palette.shadow_tone} shadows`);
  if (did.visual_identity.lighting_philosophy) parts.push(did.visual_identity.lighting_philosophy);
  if (did.visual_identity.era_and_texture) parts.push(did.visual_identity.era_and_texture);
  return parts.join(", ");
}

/* ── Focal Length → Prompt Keywords ────────────────────── */

export function focalLengthToKeywords(mm: number, dof?: string): string {
  let perspective = "";
  if (mm <= 18) perspective = "ultra wide-angle, barrel distortion, immersive foreground dominance";
  else if (mm <= 24) perspective = "dramatic wide-angle perspective, exaggerated depth, foreground elements large";
  else if (mm <= 35) perspective = "natural wide perspective, full environment visible, slight depth exaggeration";
  else if (mm <= 60) perspective = "standard perspective, no distortion, balanced spatial depth";
  else if (mm <= 85) perspective = "portrait compression, gentle background separation, flattering perspective";
  else if (mm <= 100) perspective = "compressed perspective, shallow depth of field, soft blurred background";
  else perspective = "heavily compressed telephoto, extreme bokeh, flat spatial depth, subject isolation";

  let dofStr = "";
  if (dof === "shallow") dofStr = "shallow depth of field, creamy bokeh background, only subject in sharp focus";
  else if (dof === "moderate") dofStr = "moderate depth of field, background slightly soft, context visible";
  else if (dof === "deep") dofStr = "deep focus, everything sharp from foreground to background, zone focusing";

  return [perspective, dofStr].filter(Boolean).join(", ");
}

/* ── Composition → Prompt Keywords ─────────────────────── */

export function compositionToKeywords(rule?: string, placement?: string): string {
  const parts: string[] = [];
  switch (rule) {
    case "rule_of_thirds":
      parts.push("rule of thirds composition, balanced negative space");
      break;
    case "center":
    case "symmetry":
      parts.push("centered symmetrical composition, mirror balance");
      break;
    case "diagonal":
      parts.push("dynamic diagonal composition, tilted energy, tension lines");
      break;
    case "frame_within_frame":
      parts.push("subject framed through archway, natural vignetting, layered depth");
      break;
    case "golden_ratio":
      parts.push("golden ratio composition, spiral leading to subject, organic balance");
      break;
  }
  switch (placement) {
    case "left_third":
      parts.push("subject positioned in left third of frame, open space on right");
      break;
    case "right_third":
      parts.push("subject positioned in right third of frame, open space on left");
      break;
    case "center":
      parts.push("subject centered in frame");
      break;
    case "bottom_third":
      parts.push("subject in lower third, sky or ceiling dominant");
      break;
    case "top_third":
      parts.push("subject in upper third, ground or floor dominant");
      break;
    case "full_frame":
      parts.push("subject fills entire frame, no negative space");
      break;
  }
  return parts.join(", ");
}

/* ── Lighting → Prompt Keywords ────────────────────────── */

export function lightingToKeywords(style?: string, motivation?: string): string {
  const parts: string[] = [];
  switch (style) {
    case "rembrandt":
      parts.push("Rembrandt lighting, triangle of light on shadow side of face, warm key light");
      break;
    case "silhouette":
      parts.push("backlit silhouette, rim light only, dark figure against bright background, edge glow");
      break;
    case "chiaroscuro":
      parts.push("high contrast chiaroscuro, deep shadows, isolated pools of light, dramatic tonal range");
      break;
    case "motivated_practical":
      parts.push(`lit by ${motivation || "practical source"}, naturalistic lighting, visible light source, ambient spill`);
      break;
    case "flat":
      parts.push("even flat lighting, minimal shadows, soft diffused illumination");
      break;
  }
  return parts.join(", ");
}

/* ── Template Builders ─────────────────────────────────── */

export function buildCharacterTemplate(char: Character): string {
  return `${char.name}: ${char.visual_description}`;
}

export function buildSceneTemplate(scene: Scene): string {
  return `${scene.description}, ${scene.lighting} lighting, ${scene.time_of_day}, ${scene.weather}, ${scene.mood} atmosphere`;
}

/* ── Main Prompt Assembler ─────────────────────────────── */

export function assemblePrompt(
  shot: Shot,
  strategy: ShotStrategy,
  characters: Character[],
  scene: Scene | undefined,
  style: StyleProfile,
  did?: DirectorIntent,
  segmentIndex?: number,
): string {
  const shotChars = characters.filter((c) => shot.character_ids.includes(c.character_id));
  const charTemplates = shotChars.map(buildCharacterTemplate).join(". ");
  const sceneTemplate = scene ? buildSceneTemplate(scene) : "";
  const styleStr = [style.visual_style, style.color_tone].filter(Boolean).join(", ");
  const cameraStr = shot.camera_movement !== "static" ? `, ${shot.camera_movement} camera` : "";
  const emotionStr = shot.emotion_tag !== "neutral" ? `, ${shot.emotion_tag} mood` : "";

  // V6: DID global prefix — every prompt starts with this
  const didPrefix = buildDIDPrefix(did);

  // V6: Cinematography keywords
  const focalStr = shot.focal_length_intent
    ? focalLengthToKeywords(shot.focal_length_intent.equivalent_mm, shot.focal_length_intent.depth_of_field)
    : "";
  const compStr = shot.composition
    ? compositionToKeywords(shot.composition.rule, shot.composition.subject_placement)
    : "";
  const lightStr = shot.lighting_intent
    ? lightingToKeywords(shot.lighting_intent.style, shot.lighting_intent.motivation)
    : "";

  // B/D continuation segments
  if (segmentIndex != null && segmentIndex > 0) {
    return buildContinuationPrompt(shot, shotChars, cameraStr, didPrefix);
  }

  switch (strategy.strategy_type) {
    case "C":
    case "D":
      return buildFullPrompt(didPrefix, focalStr, compStr, lightStr, styleStr, sceneTemplate, charTemplates, shot, cameraStr, emotionStr);
    case "A1":
      return buildMinimalPrompt(didPrefix, charTemplates, shot, cameraStr);
    case "A2":
      return buildMediumPrompt(didPrefix, focalStr, compStr, lightStr, sceneTemplate, charTemplates, shot, cameraStr, emotionStr);
    case "B":
      return buildFullPrompt(didPrefix, focalStr, compStr, lightStr, styleStr, sceneTemplate, charTemplates, shot, cameraStr, emotionStr);
    default:
      return buildFullPrompt(didPrefix, focalStr, compStr, lightStr, styleStr, sceneTemplate, charTemplates, shot, cameraStr, emotionStr);
  }
}

/* ── Strategy-specific builders ────────────────────────── */

/** C/D-first/B-first: everything spelled out, DID prefix leads */
function buildFullPrompt(
  didPrefix: string, focal: string, comp: string, light: string,
  style: string, scene: string, chars: string,
  shot: Shot, camera: string, emotion: string,
): string {
  const parts: string[] = [];
  if (didPrefix) parts.push(didPrefix);
  if (focal) parts.push(focal);
  if (comp) parts.push(comp);
  if (style) parts.push(style);
  if (scene) parts.push(scene);
  if (chars) parts.push(chars);
  parts.push(`${shot.shot_type} shot`);
  parts.push(shot.action_description);
  if (light) parts.push(light);
  if (camera) parts.push(camera.replace(/^, /, ""));
  if (emotion) parts.push(emotion.replace(/^, /, ""));
  if (shot.dialogue) parts.push(`dialogue: "${shot.dialogue}"`);
  // Atmospheric depth cues for wide shots
  if (shot.shot_type === "wide" || shot.shot_type === "aerial") {
    parts.push("atmospheric haze, depth layers visible");
  }
  // Detail cues for close-ups
  if (shot.shot_type === "close_up" || shot.shot_type === "extreme_close_up") {
    parts.push("fine detail visible, skin texture, material surface");
  }
  return parts.join(". ") + ".";
}

/** A1: frame ref carries scene, DID prefix + action only */
function buildMinimalPrompt(
  didPrefix: string, chars: string, shot: Shot, camera: string,
): string {
  const parts: string[] = [];
  if (didPrefix) parts.push(didPrefix);
  if (chars) parts.push(chars);
  parts.push(shot.action_description);
  if (camera) parts.push(camera.replace(/^, /, ""));
  return parts.join(". ") + ".";
}

/** A2: scene keywords + characters + action, with cinematography */
function buildMediumPrompt(
  didPrefix: string, focal: string, comp: string, light: string,
  scene: string, chars: string, shot: Shot, camera: string, emotion: string,
): string {
  const parts: string[] = [];
  if (didPrefix) parts.push(didPrefix);
  if (focal) parts.push(focal);
  if (comp) parts.push(comp);
  if (scene) parts.push(scene);
  if (chars) parts.push(chars);
  parts.push(`${shot.shot_type} shot`);
  parts.push(shot.action_description);
  if (light) parts.push(light);
  if (camera) parts.push(camera.replace(/^, /, ""));
  if (emotion) parts.push(emotion.replace(/^, /, ""));
  return parts.join(". ") + ".";
}

/** B/D continuation: motion-only, DID prefix still present */
function buildContinuationPrompt(
  shot: Shot, chars: Character[], camera: string, didPrefix: string,
): string {
  const charAnchors = chars.map((c) => c.name).join(", ");
  const parts: string[] = [];
  if (didPrefix) parts.push(didPrefix);
  if (charAnchors) parts.push(charAnchors);
  parts.push(`continue the motion: ${shot.action_description}`);
  if (camera) parts.push(camera.replace(/^, /, ""));
  return parts.join(". ") + ".";
}
