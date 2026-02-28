import { useState, useCallback, useMemo } from "react";
import type {
  PhaseConfig,
  ProcessingPhase,
  MultiPhaseProgress,
  ProgressDetail,
  PhaseStatus,
} from "@/types/progress";
import { formatTime } from "@/types/progress";

interface UseMultiPhaseProgressOptions {
  phases: PhaseConfig[];
}

export function useMultiPhaseProgress(options: UseMultiPhaseProgressOptions) {
  const [phases, setPhases] = useState<ProcessingPhase[]>(() =>
    options.phases.map((config) => ({
      ...config,
      progress: 0,
      status: "pending" as PhaseStatus,
    })),
  );
  const [startTime, setStartTime] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(false);

  // Calculate overall progress from weighted phases
  const overallProgress = useMemo(() => {
    // If all phases are completed, return exactly 100 to avoid floating point issues
    const allCompleted = phases.every((p) => p.status === "completed");
    if (allCompleted && phases.length > 0) {
      return 100;
    }

    let totalWeight = 0;
    let weightedProgress = 0;

    phases.forEach((phase) => {
      totalWeight += phase.weight;
      if (phase.status === "completed") {
        weightedProgress += phase.weight * 100;
      } else if (phase.status === "active") {
        weightedProgress += phase.weight * phase.progress;
      }
    });

    return totalWeight > 0 ? weightedProgress / totalWeight : 0;
  }, [phases]);

  // Calculate ETA based on elapsed time and progress
  const eta = useMemo(() => {
    if (!startTime || overallProgress < 5) return null;
    const elapsed = (Date.now() - startTime) / 1000; // seconds
    const totalEstimated = elapsed / (overallProgress / 100);
    const remaining = totalEstimated - elapsed;
    if (remaining <= 0 || !isFinite(remaining)) return null;
    return formatTime(remaining);
  }, [startTime, overallProgress]);

  // Get current phase index
  const currentPhaseIndex = useMemo(() => {
    const activeIndex = phases.findIndex((p) => p.status === "active");
    if (activeIndex >= 0) return activeIndex;
    // If no active phase, return last completed or first pending
    const lastCompleted = phases.reduce(
      (lastIdx: number, p: ProcessingPhase, idx: number) =>
        p.status === "completed" ? idx : lastIdx,
      -1,
    );
    return lastCompleted >= 0 ? lastCompleted : 0;
  }, [phases]);

  // Start a specific phase (completes all previous phases)
  const startPhase = useCallback((phaseId: string) => {
    setPhases((prev) => {
      const phaseIndex = prev.findIndex((p) => p.id === phaseId);
      return prev.map((phase, idx) => {
        if (phase.id === phaseId) {
          return { ...phase, status: "active", progress: 0 };
        }
        // Complete all phases before the new one
        if (idx < phaseIndex && phase.status !== "completed") {
          return { ...phase, status: "completed", progress: 100 };
        }
        return phase;
      });
    });
    setIsActive(true);
    setStartTime((prev) => prev ?? Date.now());
  }, []);

  // Update progress for a specific phase
  const updatePhase = useCallback(
    (phaseId: string, progress: number, detail?: ProgressDetail) => {
      setPhases((prev) =>
        prev.map((phase) => {
          if (phase.id === phaseId) {
            return {
              ...phase,
              progress: Math.min(100, Math.max(0, progress)),
              detail,
              status: phase.status === "pending" ? "active" : phase.status,
            };
          }
          return phase;
        }),
      );
    },
    [],
  );

  // Complete a specific phase
  const completePhase = useCallback((phaseId: string) => {
    setPhases((prev) =>
      prev.map((phase) => {
        if (phase.id === phaseId) {
          return { ...phase, status: "completed", progress: 100 };
        }
        return phase;
      }),
    );
  }, []);

  // Set error on a specific phase
  const setError = useCallback((phaseId: string) => {
    setPhases((prev) =>
      prev.map((phase) => {
        if (phase.id === phaseId) {
          return { ...phase, status: "error" };
        }
        return phase;
      }),
    );
    setIsActive(false);
  }, []);

  // Reset all progress
  const reset = useCallback(() => {
    setPhases(
      options.phases.map((config) => ({
        ...config,
        progress: 0,
        status: "pending" as PhaseStatus,
        detail: undefined,
      })),
    );
    setStartTime(null);
    setIsActive(false);
  }, [options.phases]);

  // Reset and start a specific phase atomically (useful for re-running)
  const resetAndStart = useCallback(
    (phaseId: string) => {
      setPhases(
        options.phases.map((config) => ({
          ...config,
          progress: 0,
          status:
            config.id === phaseId
              ? ("active" as PhaseStatus)
              : ("pending" as PhaseStatus),
          detail: undefined,
        })),
      );
      setStartTime(Date.now());
      setIsActive(true);
    },
    [options.phases],
  );

  // Complete all phases (finish processing)
  const complete = useCallback(() => {
    setPhases((prev) =>
      prev.map((phase) => ({
        ...phase,
        status: "completed",
        progress: 100,
      })),
    );
    setIsActive(false);
  }, []);

  const progress: MultiPhaseProgress = {
    phases,
    currentPhaseIndex,
    overallProgress,
    startTime,
    eta,
    isActive,
  };

  return {
    progress,
    startPhase,
    updatePhase,
    completePhase,
    setError,
    reset,
    resetAndStart,
    complete,
  };
}
