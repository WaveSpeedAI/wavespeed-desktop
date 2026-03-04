/**
 * Strategy Router — determines the optimal generation strategy for each shot.
 *
 * 4 strategy types based on 2 dimensions:
 *   scene continuity (same vs cross) × duration (short vs long)
 *
 * A1: same-scene + short + continuous action → weak frame reference
 * A2: same-scene + short + angle change → no frame reference
 * B:  same-scene + long → segmented with frame chain
 * C:  cross-scene + short → fully independent (parallel)
 * D:  cross-scene + long → first segment independent, rest chained
 */
import type { Shot, Scene, Character, ShotStrategy, StrategyType } from "../types";

/** Maximum duration (seconds) a single model call can generate */
const MODEL_MAX_SEGMENT = 12;

/** How often to do a correction pass in segmented generation */
const DEFAULT_CORRECTION_INTERVAL = 3;

/**
 * Route a shot to its optimal generation strategy.
 */
export function routeStrategy(
  current: Shot,
  previous: Shot | null,
  allShots: Shot[],
  characters: Character[],
  scenes: Scene[],
): ShotStrategy {
  const scene = scenes.find((s) => s.scene_id === current.scene_id);
  const isSameScene = previous != null && previous.scene_id === current.scene_id;
  const isLong = current.duration > MODEL_MAX_SEGMENT;
  const segments = isLong ? Math.ceil(current.duration / MODEL_MAX_SEGMENT) : 1;

  // Is this the first shot in its scene?
  const sceneShotsSorted = allShots
    .filter((s) => s.scene_id === current.scene_id)
    .sort((a, b) => a.sequence_number - b.sequence_number);
  const isSceneAnchor = sceneShotsSorted[0]?.shot_id === current.shot_id;

  // Collect character reference images for this shot
  const charRefs = characters
    .filter((c) => current.character_ids.includes(c.character_id))
    .map((c) => c.anchor_images.front)
    .filter(Boolean) as string[];

  const sceneRef = scene?.anchor_image ?? null;

  // Apply user override if present
  const override = current.user_strategy_override;

  // Determine strategy type (auto-detect, then apply user override)
  let strategyType: StrategyType;
  if (override?.strategy_type) {
    // User explicitly chose a strategy — respect it
    strategyType = override.strategy_type;
  } else if (!isSameScene) {
    strategyType = isLong ? "D" : "C";
  } else {
    if (isLong) {
      strategyType = "B";
    } else {
      // A1 vs A2: check if continuous action (same characters + same shot_type)
      const charOverlap =
        previous != null &&
        current.character_ids.some((id) => previous.character_ids.includes(id));
      const sameShotType = previous != null && current.shot_type === previous.shot_type;
      strategyType = charOverlap && sameShotType ? "A1" : "A2";
    }
  }

  // Determine frame chain usage based on final strategy type
  let useFrameChain = false;
  let frameChainSource: string | null = null;

  if ((strategyType === "A1" || strategyType === "B" || strategyType === "D") && previous) {
    useFrameChain = true;
    frameChainSource = previous.generated_assets.last_frame_path ?? null;
  }

  const strategy: ShotStrategy = {
    strategy_type: strategyType,
    use_frame_chain: override?.use_frame_chain ?? useFrameChain,
    frame_chain_source: override?.frame_chain_source ?? frameChainSource,
    character_refs: override?.character_refs ?? charRefs,
    scene_ref: override?.scene_ref ?? sceneRef,
    style_ref: null, // reserved for future style embedding injection
    segments,
    correction_interval: override?.correction_interval ?? DEFAULT_CORRECTION_INTERVAL,
    is_scene_anchor_shot: override?.is_scene_anchor_shot ?? isSceneAnchor,
    parallel_eligible: override?.parallel_eligible ?? (strategyType === "C" || strategyType === "A2"),
  };

  return strategy;
}

/**
 * Build a generation schedule from routed strategies.
 * Returns shots grouped into: parallel batch first, then sequential queue.
 *
 * Scheduling rules:
 * - Scene anchor shots → sequential (must complete before same-scene shots)
 * - A1, B, D → sequential (frame chain dependencies)
 * - C → parallel (fully independent, no scene anchor dependency)
 * - A2 → parallel only if its scene anchor is already generated or in sequential queue ahead
 */
export function buildSchedule(
  shots: Shot[],
  strategies: Map<string, ShotStrategy>,
): { parallel: Shot[]; sequential: Shot[] } {
  const parallel: Shot[] = [];
  const sequential: Shot[] = [];

  // Build a map: sceneId → anchor shot id
  const sceneAnchorMap = new Map<string, string>();
  for (const [shotId, strategy] of strategies) {
    if (strategy.is_scene_anchor_shot) {
      const shot = shots.find((s) => s.shot_id === shotId);
      if (shot) sceneAnchorMap.set(shot.scene_id, shotId);
    }
  }

  const sorted = [...shots].sort((a, b) => a.sequence_number - b.sequence_number);

  for (const shot of sorted) {
    const strategy = strategies.get(shot.shot_id);
    if (!strategy) {
      sequential.push(shot);
      continue;
    }

    // Scene anchor shots are always sequential (other shots depend on them)
    if (strategy.is_scene_anchor_shot) {
      sequential.push(shot);
      continue;
    }

    // A1, B, D are sequential (frame chain dependencies)
    if (strategy.strategy_type === "A1" || strategy.strategy_type === "B" || strategy.strategy_type === "D") {
      sequential.push(shot);
      continue;
    }

    // C-type: fully independent, always parallel
    if (strategy.strategy_type === "C") {
      parallel.push(shot);
      continue;
    }

    // A2-type: parallel only if scene anchor exists in sequential queue
    // (scene anchor runs first in sequential, so by the time parallel batch runs, it's done)
    const sceneAnchorId = sceneAnchorMap.get(shot.scene_id);
    const anchorInSequential = sceneAnchorId && sequential.some((s) => s.shot_id === sceneAnchorId);
    if (strategy.parallel_eligible && anchorInSequential) {
      parallel.push(shot);
    } else {
      sequential.push(shot);
    }
  }

  return { parallel, sequential };
}
