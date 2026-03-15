/**
 * Final Prompt Composer (Stage 3.75) — Three-tier hierarchical prompt architecture.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Tier 1: GLOBAL DIRECTIVE (全片)                            │
 * │  Style, total duration, emotional arc, color system,        │
 * │  camera philosophy, style anchor                            │
 * │                                                             │
 * │  ┌─────────────────────────────────────────────────────┐   │
 * │  │  Tier 2: SEGMENT (片段)                              │   │
 * │  │  Scene context, segment camera behavior,             │   │
 * │  │  emotion trajectory within segment,                  │   │
 * │  │  entry/exit transitions, segment duration            │   │
 * │  │                                                      │   │
 * │  │  ┌──────────────────────────────────────────────┐   │   │
 * │  │  │  Tier 3: MICRO-BEAT (微拍)                    │   │   │
 * │  │  │  Concrete action, focal length, composition,  │   │   │
 * │  │  │  lighting, motion vector, rhythm role,        │   │   │
 * │  │  │  screen direction — this is what the model    │   │   │
 * │  │  │  actually receives                            │   │   │
 * │  │  └──────────────────────────────────────────────┘   │   │
 * │  └─────────────────────────────────────────────────────┘   │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Each shot's final video_prompt = Tier1 header + Tier2 segment context + Tier3 micro-beats
 */
import type { DirectorIntent } from "../types/director-intent";
import type { ShotDraft, ShotPromptDraft, SceneDraft } from "../agents/pipeline";

/* ── Tier 3: Micro-Beat ────────────────────────────────── */

export interface MicroBeat {
  /** Relative start within the parent shot (seconds) */
  offset: number;
  /** Duration of this micro-beat (seconds) */
  duration: number;
  /** What happens — concrete action description */
  action: string;
  /** Camera behavior during this micro-beat */
  camera: string;
  /** Focal length if specified */
  focal_mm?: number;
  /** Depth of field */
  dof?: string;
  /** Emotion intensity (1-10) at this micro-beat */
  intensity: number;
  /** Rhythm function: attack / sustain / release */
  phase: "attack" | "sustain" | "release";
}

/* ── Tier 2: Segment ───────────────────────────────────── */

export interface Segment {
  /** Absolute start time in the full video */
  start: number;
  /** Absolute end time */
  end: number;
  /** Scene name this segment belongs to */
  scene_name: string;
  /** Scene mood / atmosphere */
  mood: string;
  /** Scene lighting description */
  lighting: string;
  /** Dominant camera behavior pattern for this segment */
  camera_pattern: string;
  /** Emotion trajectory: e.g. "tension → explosion" */
  emotion_trajectory: string;
  /** How this segment begins (from previous segment) */
  entry_transition: string;
  /** How this segment ends (to next segment) */
  exit_transition: string;
  /** Shot indices belonging to this segment */
  shot_indices: number[];
  /** Micro-beats within this segment (Tier 3) */
  beats: MicroBeat[];
  /** Composed segment-level prompt string */
  prompt: string;
}

/* ── Tier 1: Global Directive ──────────────────────────── */

export interface GlobalDirective {
  /** Full style description */
  style: string;
  /** Total duration */
  duration: number;
  /** Global camera philosophy */
  camera_philosophy: string;
  /** Emotional arc structure */
  arc: string;
  /** Color system summary */
  palette: string;
  /** Tempo description */
  tempo: string;
  /** Style anchor tags */
  style_anchor: string;
  /** Composed global header string */
  prompt: string;
}

/* ── Final Output ──────────────────────────────────────── */

export interface FinalVideoPrompt {
  /** Tier 1: Global directive */
  global: GlobalDirective;
  /** Tier 2: Segments */
  segments: Segment[];
  /** Full composed prompt (Mode A) — all tiers flattened for long-video models */
  full: string;
  /** Per-shot structured prompt: shot_sequence_number → complete 3-tier prompt */
  perShotPrompts: Map<number, string>;
  /** Legacy compat */
  prefix: string;
}

/* ── Micro-Beat Decomposition ──────────────────────────── */

/**
 * Decompose a single shot into micro-beats based on its duration and cinematography.
 *
 * Decomposition rules (from cinematography theory):
 * - Shots ≤ 3s: 1 beat (atomic — too short to subdivide)
 * - Shots 4-6s: 2 beats (attack + release)
 * - Shots 7-10s: 3 beats (attack + sustain + release)
 * - Shots > 10s: 3-4 beats (attack + N×sustain + release)
 *
 * The "attack" beat captures the initial action/reveal.
 * The "sustain" beat(s) carry the main motion/development.
 * The "release" beat prepares the transition to the next shot.
 */
function decomposeShotToBeats(
  shot: ShotDraft,
  prompt: ShotPromptDraft | undefined,
): MicroBeat[] {
  const d = shot.duration;
  const cam = shot.camera_movement || "static";
  const focalMm = shot.focal_length_intent?.equivalent_mm;
  const dof = shot.focal_length_intent?.depth_of_field;
  const baseIntensity = shot.rhythm_role === "peak" ? 8
    : shot.rhythm_role === "building" ? 6
    : shot.rhythm_role === "establishing" ? 3
    : shot.rhythm_role === "breathing" ? 2
    : 5;

  // Atomic shot — no subdivision
  if (d <= 3) {
    return [{
      offset: 0,
      duration: d,
      action: shot.action_description,
      camera: cam,
      focal_mm: focalMm,
      dof,
      intensity: baseIntensity,
      phase: "attack",
    }];
  }

  const beats: MicroBeat[] = [];
  const motions = shot.subject_motions || [];
  const hasDialogue = !!shot.dialogue;

  if (d <= 6) {
    // 2-beat: attack + release
    const attackDur = hasDialogue ? Math.ceil(d * 0.6) : Math.ceil(d * 0.5);
    const releaseDur = d - attackDur;

    beats.push({
      offset: 0,
      duration: attackDur,
      action: buildAttackAction(shot, motions),
      camera: buildAttackCamera(cam, shot),
      focal_mm: focalMm,
      dof,
      intensity: baseIntensity,
      phase: "attack",
    });
    beats.push({
      offset: attackDur,
      duration: releaseDur,
      action: buildReleaseAction(shot, motions),
      camera: buildReleaseCamera(cam, shot),
      focal_mm: focalMm,
      dof,
      intensity: Math.max(1, baseIntensity - 2),
      phase: "release",
    });
  } else if (d <= 10) {
    // 3-beat: attack + sustain + release
    const attackDur = Math.round(d * 0.3);
    const releaseDur = Math.round(d * 0.25);
    const sustainDur = d - attackDur - releaseDur;

    beats.push({
      offset: 0,
      duration: attackDur,
      action: buildAttackAction(shot, motions),
      camera: buildAttackCamera(cam, shot),
      focal_mm: focalMm,
      dof,
      intensity: baseIntensity,
      phase: "attack",
    });
    beats.push({
      offset: attackDur,
      duration: sustainDur,
      action: buildSustainAction(shot, motions, prompt),
      camera: buildSustainCamera(cam),
      focal_mm: focalMm,
      dof,
      intensity: baseIntensity + (shot.rhythm_role === "building" ? 1 : 0),
      phase: "sustain",
    });
    beats.push({
      offset: attackDur + sustainDur,
      duration: releaseDur,
      action: buildReleaseAction(shot, motions),
      camera: buildReleaseCamera(cam, shot),
      focal_mm: focalMm,
      dof,
      intensity: Math.max(1, baseIntensity - 2),
      phase: "release",
    });
  } else {
    // 4-beat: attack + 2×sustain + release
    const attackDur = Math.round(d * 0.2);
    const releaseDur = Math.round(d * 0.2);
    const remainDur = d - attackDur - releaseDur;
    const sustain1Dur = Math.ceil(remainDur / 2);
    const sustain2Dur = remainDur - sustain1Dur;

    beats.push({
      offset: 0,
      duration: attackDur,
      action: buildAttackAction(shot, motions),
      camera: buildAttackCamera(cam, shot),
      focal_mm: focalMm,
      dof,
      intensity: baseIntensity,
      phase: "attack",
    });
    beats.push({
      offset: attackDur,
      duration: sustain1Dur,
      action: buildSustainAction(shot, motions, prompt),
      camera: buildSustainCamera(cam),
      focal_mm: focalMm,
      dof,
      intensity: baseIntensity + 1,
      phase: "sustain",
    });
    beats.push({
      offset: attackDur + sustain1Dur,
      duration: sustain2Dur,
      action: buildSustainPeakAction(shot, motions),
      camera: cam,
      focal_mm: focalMm,
      dof,
      intensity: Math.min(10, baseIntensity + 2),
      phase: "sustain",
    });
    beats.push({
      offset: attackDur + sustain1Dur + sustain2Dur,
      duration: releaseDur,
      action: buildReleaseAction(shot, motions),
      camera: buildReleaseCamera(cam, shot),
      focal_mm: focalMm,
      dof,
      intensity: Math.max(1, baseIntensity - 2),
      phase: "release",
    });
  }

  return beats;
}

/* ── Beat Action Builders ──────────────────────────────── */

type MotionArray = NonNullable<ShotDraft["subject_motions"]>;

/**
 * Attack: the opening moment — subject enters or initiates action.
 * Cinematography: this is the "reveal" or "inciting gesture".
 */
function buildAttackAction(shot: ShotDraft, motions: MotionArray): string {
  if (motions.length > 0) {
    const primary = motions[0];
    const dirHint = primary.direction ? `, ${primary.direction}` : "";
    return `${primary.subject} initiates ${primary.mid_action}${dirHint}`;
  }
  // Fallback: extract the first verb-phrase from action_description
  const firstClause = shot.action_description.split(/[,，.。;；]/)[0].trim();
  return firstClause || shot.action_description;
}

/**
 * Sustain: the main development — motion continues, environment reacts.
 */
function buildSustainAction(
  shot: ShotDraft,
  _motions: MotionArray,
  prompt: ShotPromptDraft | undefined,
): string {
  // Use the video_prompt if available (it's the LLM-polished version)
  if (prompt?.video_prompt) {
    return prompt.video_prompt;
  }
  // Fallback: full action + env motion
  const envPart = shot.env_motion ? `, ${shot.env_motion.description}` : "";
  return `${shot.action_description}${envPart}`;
}

/**
 * Sustain-peak: for long shots, the second sustain beat escalates.
 */
function buildSustainPeakAction(shot: ShotDraft, motions: MotionArray): string {
  if (motions.length > 1) {
    // Secondary subject reacts
    const secondary = motions[1];
    return `${secondary.subject} responds with ${secondary.mid_action}`;
  }
  if (motions.length === 1 && motions[0].intensity >= 4) {
    return `${motions[0].subject} intensifies ${motions[0].mid_action}`;
  }
  const envPart = shot.env_motion ? shot.env_motion.description : "";
  return envPart || "action reaches peak intensity";
}

/**
 * Release: the closing moment — motion settles, prepares transition.
 */
function buildReleaseAction(shot: ShotDraft, motions: MotionArray): string {
  const transition = shot.transition_detail;
  if (transition?.visual_bridge) {
    return `motion settles, ${transition.visual_bridge}`;
  }
  if (transition?.type === "dissolve" || transition?.type === "fade") {
    return `movement decelerates, scene begins to fade`;
  }
  if (motions.length > 0) {
    return `${motions[0].subject} completes motion, settling into position`;
  }
  return `action resolves, holding final composition`;
}

/* ── Beat Camera Builders ──────────────────────────────── */

/**
 * Attack camera: often starts with the establishing movement.
 */
function buildAttackCamera(baseCam: string, _shot: ShotDraft): string {
  if (baseCam === "static") return "static, locked frame";
  if (baseCam === "dolly_in") return "camera begins dolly forward";
  if (baseCam === "dolly_out") return "camera pulls back slowly";
  if (baseCam === "tracking") return "camera begins tracking alongside subject";
  if (baseCam === "pan_left" || baseCam === "pan_right") return `camera starts ${baseCam.replace("_", " ")}`;
  if (baseCam === "tilt_up" || baseCam === "tilt_down") return `camera starts ${baseCam.replace("_", " ")}`;
  if (baseCam === "handheld") return "handheld camera, slight organic sway";
  return baseCam;
}

/**
 * Sustain camera: the main camera movement continues.
 */
function buildSustainCamera(baseCam: string): string {
  if (baseCam === "static") return "static, steady";
  if (baseCam === "tracking") return "camera continues tracking, matching subject speed";
  if (baseCam === "dolly_in") return "camera continues pushing in";
  if (baseCam === "handheld") return "handheld follows action, reactive movement";
  return `${baseCam} continues`;
}

/**
 * Release camera: decelerates or holds for transition.
 */
function buildReleaseCamera(baseCam: string, shot: ShotDraft): string {
  const transition = shot.transition_detail?.type;
  if (transition === "whip_pan") return "camera whips away rapidly";
  if (transition === "dolly_out" || baseCam === "dolly_out") return "camera eases to a stop";
  if (baseCam === "tracking") return "camera decelerates, settling";
  if (baseCam === "handheld") return "handheld steadies";
  return "camera holds";
}

/* ── Segment Builder (Tier 2) ──────────────────────────── */

/**
 * Group shots into segments by scene boundary.
 * Each segment = one continuous scene block.
 */
function buildSegments(
  shots: ShotDraft[],
  prompts: ShotPromptDraft[],
  scenes: SceneDraft[],
): Segment[] {
  if (shots.length === 0) return [];

  const sorted = [...shots].sort((a, b) => a.sequence_number - b.sequence_number);
  const promptMap = new Map(prompts.map((p) => [p.shot_sequence, p]));
  const segments: Segment[] = [];

  let currentTime = 0;
  let groupScene = sorted[0].scene_name;
  let groupShots: ShotDraft[] = [];

  const flushGroup = () => {
    if (groupShots.length === 0) return;

    const scene = scenes.find((s) => s.name === groupScene);
    const segStart = currentTime - groupShots.reduce((s, sh) => s + sh.duration, 0);
    const segEnd = currentTime;

    // Camera pattern for this segment
    const camFreq = new Map<string, number>();
    for (const sh of groupShots) {
      const c = sh.camera_movement || "static";
      camFreq.set(c, (camFreq.get(c) ?? 0) + 1);
    }
    const dominantCam = [...camFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "static";

    // Emotion trajectory
    const emotions = groupShots.map((s) => s.emotion_tag).filter(Boolean);
    const uniqueEmotions = [...new Set(emotions)];
    const emotionTrajectory = uniqueEmotions.length > 1
      ? uniqueEmotions.join(" → ")
      : uniqueEmotions[0] || "neutral";

    // Entry/exit transitions
    const lastShot = groupShots[groupShots.length - 1];
    const entryTransition = segments.length > 0
      ? (segments[segments.length - 1].exit_transition || "cut")
      : "opening";
    const exitTransition = lastShot.transition_detail?.type ?? lastShot.transition_to_next ?? "cut";

    // Build micro-beats for all shots in this segment
    const beats: MicroBeat[] = [];
    let beatOffset = 0;
    for (const sh of groupShots) {
      const shotBeats = decomposeShotToBeats(sh, promptMap.get(sh.sequence_number));
      for (const b of shotBeats) {
        beats.push({ ...b, offset: beatOffset + b.offset });
      }
      beatOffset += sh.duration;
    }

    // Compose segment-level prompt
    const segPrompt = composeSegmentPrompt(
      scene, groupShots, dominantCam, emotionTrajectory, segStart, segEnd,
    );

    segments.push({
      start: segStart,
      end: segEnd,
      scene_name: groupScene,
      mood: scene?.mood ?? "neutral",
      lighting: scene?.lighting ?? "",
      camera_pattern: dominantCam,
      emotion_trajectory: emotionTrajectory,
      entry_transition: entryTransition,
      exit_transition: exitTransition,
      shot_indices: groupShots.map((s) => s.sequence_number),
      beats,
      prompt: segPrompt,
    });
  };

  for (const shot of sorted) {
    if (shot.scene_name !== groupScene) {
      flushGroup();
      groupScene = shot.scene_name;
      groupShots = [];
    }
    groupShots.push(shot);
    currentTime += shot.duration;
  }
  flushGroup();

  return segments;
}

function composeSegmentPrompt(
  scene: SceneDraft | undefined,
  _shots: ShotDraft[],
  dominantCam: string,
  emotionTrajectory: string,
  start: number,
  end: number,
): string {
  const dur = Math.round(end - start);
  const parts: string[] = [];
  parts.push(`[${formatTime(start)}-${formatTime(end)}] ${scene?.name ?? "unknown"} (${dur}s)`);
  if (scene?.mood) parts.push(`Mood: ${scene.mood}`);
  if (scene?.lighting) parts.push(`Lighting: ${scene.lighting}`);
  parts.push(`Camera: ${dominantCam}`);
  parts.push(`Emotion: ${emotionTrajectory}`);
  return parts.join(" | ");
}

/* ── Global Directive Builder (Tier 1) ─────────────────── */

function buildGlobalDirective(
  did: DirectorIntent | undefined,
  targetDuration: number,
  shots: ShotDraft[],
): GlobalDirective {
  const style = did?.visual_identity.art_style_anchor ?? "cinematic";
  const arc = did?.emotional_arc.structure ?? "linear";
  const palette = did?.visual_identity.color_palette.dominant ?? "";
  const tempo = did?.rhythm_blueprint.overall_tempo ?? "";
  const lightPhil = did?.visual_identity.lighting_philosophy ?? "";

  // Camera philosophy from shot patterns
  const camFreq = new Map<string, number>();
  for (const s of shots) {
    const c = s.camera_movement || "static";
    camFreq.set(c, (camFreq.get(c) ?? 0) + 1);
  }
  const top3 = [...camFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const camPhil = top3.map(([k, v]) => `${k}(${v})`).join(", ");

  // Style anchor
  const anchorTags: string[] = [];
  if (palette) anchorTags.push(palette);
  if (did?.visual_identity.color_palette.accent) anchorTags.push(`accent: ${did.visual_identity.color_palette.accent}`);
  if (lightPhil) anchorTags.push(lightPhil);
  if (did?.visual_identity.era_and_texture) anchorTags.push(did.visual_identity.era_and_texture);
  if (did?.lens_philosophy.style_reference) anchorTags.push(`ref: ${did.lens_philosophy.style_reference}`);
  if (did?.visual_identity.color_palette.shadow_tone) anchorTags.push(`shadows: ${did.visual_identity.color_palette.shadow_tone}`);
  const styleAnchor = anchorTags.length > 0 ? anchorTags.join(" | ") : "";

  // Compose the global header prompt
  const headerParts = [`[STYLE: ${style}]`, `[DURATION: ${targetDuration}s]`];
  if (palette) headerParts.push(`[PALETTE: ${palette}]`);
  if (arc) headerParts.push(`[ARC: ${arc}]`);
  if (tempo) headerParts.push(`[TEMPO: ${tempo}]`);
  const header = headerParts.join(" ");

  const promptLines = [header];
  if (camPhil) promptLines.push(`Camera: ${camPhil}`);
  if (styleAnchor) promptLines.push(`[STYLE ANCHOR: ${styleAnchor}]`);

  return {
    style,
    duration: targetDuration,
    camera_philosophy: camPhil,
    arc,
    palette,
    tempo,
    style_anchor: styleAnchor,
    prompt: promptLines.join("\n"),
  };
}

/* ── Per-Shot Prompt Composer ──────────────────────────── */

/**
 * Compose the final structured prompt for a single shot.
 *
 * Structure:
 *   Tier 1 (global header — 2-3 lines)
 *   Tier 2 (segment context — 1 line)
 *   Tier 3 (micro-beat timeline — N lines, one per beat)
 */
function composePerShotPrompt(
  global: GlobalDirective,
  segment: Segment,
  shot: ShotDraft,
  shotPrompt: ShotPromptDraft | undefined,
): string {
  const lines: string[] = [];

  // Tier 1: Global (compact)
  lines.push(global.prompt);

  // Tier 2: Segment context
  lines.push(segment.prompt);

  // Tier 3: Micro-beats for THIS shot only
  const shotBeats = segment.beats.filter((b) => {
    // Find beats that belong to this shot by offset range
    let cumOffset = 0;
    for (const idx of segment.shot_indices) {
      if (idx === shot.sequence_number) {
        return b.offset >= cumOffset && b.offset < cumOffset + shot.duration;
      }
      // Find the shot's duration from the segment
      const segShot = segment.shot_indices.indexOf(idx);
      if (segShot >= 0) {
        // We need to look up duration — use a simple heuristic based on beat offsets
        break;
      }
    }
    return false;
  });

  // If beat filtering is ambiguous, decompose fresh for this shot
  const beats = shotBeats.length > 0
    ? shotBeats
    : decomposeShotToBeats(shot, shotPrompt);

  if (beats.length === 1) {
    // Atomic shot — single beat, use the LLM-polished video_prompt directly
    const beat = beats[0];
    const focalTag = beat.focal_mm ? ` ${beat.focal_mm}mm` : "";
    const dofTag = beat.dof ? ` ${beat.dof}-dof` : "";
    lines.push(`[${beat.phase}${focalTag}${dofTag}] ${shotPrompt?.video_prompt || beat.action} | ${beat.camera}`);
  } else {
    // Multi-beat — structured timeline within the shot
    const shotStart = findShotAbsoluteStart(segment, shot.sequence_number);
    for (const beat of beats) {
      const absStart = shotStart + beat.offset;
      const absEnd = absStart + beat.duration;
      const focalTag = beat.focal_mm ? ` ${beat.focal_mm}mm` : "";
      const dofTag = beat.dof ? ` ${beat.dof}-dof` : "";
      const intensityBar = "▓".repeat(Math.min(beat.intensity, 10));
      lines.push(
        `[${formatTime(absStart)}-${formatTime(absEnd)}] (${beat.phase}${focalTag}${dofTag}) ${beat.action} | ${beat.camera} ${intensityBar}`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * Find the absolute start time of a shot within its segment.
 */
function findShotAbsoluteStart(segment: Segment, _shotSeq: number): number {
  // The segment.start is the absolute start of the segment.
  // Individual shot offsets within the segment are tracked via beat.offset.
  return segment.start;
}

/* ── Full Prompt Composer (Mode A) ─────────────────────── */

function composeFullPrompt(
  global: GlobalDirective,
  segments: Segment[],
): string {
  const lines: string[] = [];

  // Tier 1
  lines.push(global.prompt);
  lines.push("");

  // Tier 2 + Tier 3 for each segment
  for (const seg of segments) {
    lines.push(`--- ${seg.scene_name.toUpperCase()} [${formatTime(seg.start)}-${formatTime(seg.end)}] ---`);
    lines.push(seg.prompt);

    // Micro-beats
    for (const beat of seg.beats) {
      const absStart = seg.start + beat.offset;
      const absEnd = absStart + beat.duration;
      const focalTag = beat.focal_mm ? ` ${beat.focal_mm}mm` : "";
      const dofTag = beat.dof ? ` ${beat.dof}-dof` : "";
      lines.push(
        `  [${formatTime(absStart)}-${formatTime(absEnd)}] (${beat.phase}${focalTag}${dofTag}) ${beat.action} | ${beat.camera}`,
      );
    }

    if (seg.exit_transition !== "cut") {
      lines.push(`  → ${seg.exit_transition}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/* ── Helpers ───────────────────────────────────────────── */

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* ── Camera Pattern Analysis (legacy compat) ───────────── */

export function analyzeDominantCameraPattern(
  shots: ShotDraft[],
): { dominant: string; frequency: number; pattern_description: string } {
  const freq = new Map<string, number>();
  for (const s of shots) {
    const cm = s.camera_movement || "static";
    freq.set(cm, (freq.get(cm) ?? 0) + 1);
  }

  let dominant = "static";
  let maxCount = 0;
  for (const [k, v] of freq) {
    if (v > maxCount) { dominant = k; maxCount = v; }
  }

  const ratio = shots.length > 0 ? maxCount / shots.length : 0;
  let pattern_description: string;
  if (ratio > 0.6) {
    pattern_description = `predominantly ${dominant} camera work (${Math.round(ratio * 100)}%)`;
  } else {
    const top3 = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    pattern_description = `mixed camera: ${top3.map(([k, v]) => `${k}(${v})`).join(", ")}`;
  }

  return { dominant, frequency: maxCount, pattern_description };
}

/* ── Main Entry Point ──────────────────────────────────── */

/**
 * Compose the final three-tier structured video prompt.
 *
 * Returns:
 * - global: Tier 1 directive
 * - segments: Tier 2 segments with embedded Tier 3 micro-beats
 * - full: Mode A flattened prompt for long-video models
 * - perShotPrompts: Mode B per-shot structured prompts (Tier1 + Tier2 + Tier3)
 * - prefix: Legacy compat (= global.prompt)
 */
export function composeFinalVideoPrompt(
  shots: ShotDraft[],
  prompts: ShotPromptDraft[],
  scenes: SceneDraft[],
  did: DirectorIntent | undefined,
  targetDuration: number,
): FinalVideoPrompt {
  const promptMap = new Map(prompts.map((p) => [p.shot_sequence, p]));

  // Tier 1: Global directive
  const global = buildGlobalDirective(did, targetDuration, shots);

  // Tier 2 + Tier 3: Segments with micro-beats
  const segments = buildSegments(shots, prompts, scenes);

  // Mode A: Full flattened prompt
  const full = composeFullPrompt(global, segments);

  // Mode B: Per-shot structured prompts
  const perShotPrompts = new Map<number, string>();
  const sorted = [...shots].sort((a, b) => a.sequence_number - b.sequence_number);

  for (const shot of sorted) {
    // Find which segment this shot belongs to
    const segment = segments.find((seg) => seg.shot_indices.includes(shot.sequence_number));
    if (!segment) continue;

    const shotPrompt = promptMap.get(shot.sequence_number);
    const composed = composePerShotPrompt(global, segment, shot, shotPrompt);
    perShotPrompts.set(shot.sequence_number, composed);
  }

  return {
    global,
    segments,
    full,
    perShotPrompts,
    prefix: global.prompt,
  };
}

/* ── Legacy Compat Exports ─────────────────────────────── */

/** @deprecated Use Segment instead */
export type TimeSegment = Segment;

/** @deprecated Use composeFinalVideoPrompt instead */
export function buildTimeSegments(
  shots: ShotDraft[],
  prompts: ShotPromptDraft[],
): Segment[] {
  return buildSegments(shots, prompts, []);
}
