/**
 * Agent Activity Store — tracks real-time agent work for UI visualization.
 * Each agent step is a "task" with streaming output, status, and timing.
 */
import { create } from "zustand";
import { v4 as uuid } from "uuid";

export type AgentName = "orchestrator" | "story" | "asset" | "production";
export type TaskStatus = "queued" | "running" | "streaming" | "done" | "error";

export interface AgentTask {
  id: string;
  agent: AgentName;
  label: string;           // e.g. "解析用户意图", "生成角色设定", "构建镜头序列"
  status: TaskStatus;
  streamingText: string;   // real-time LLM output
  result: string;          // final result summary
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  tokens: number;          // token count
}

export interface AgentPhase {
  id: string;
  name: string;            // e.g. "阶段一：对话创作"
  tasks: AgentTask[];
  status: TaskStatus;
}

interface AgentActivityState {
  phases: AgentPhase[];
  currentPhaseId: string | null;
  currentTaskId: string | null;
  isActive: boolean;
  totalTokens: number;
  panelOpen: boolean;

  // Actions
  startPhase: (name: string) => string;
  completePhase: (phaseId: string) => void;
  startTask: (phaseId: string, agent: AgentName, label: string) => string;
  appendStream: (taskId: string, chunk: string) => void;
  completeTask: (taskId: string, result: string) => void;
  failTask: (taskId: string, error: string) => void;
  togglePanel: () => void;
  reset: () => void;
}

export const useAgentActivityStore = create<AgentActivityState>((set) => ({
  phases: [],
  currentPhaseId: null,
  currentTaskId: null,
  isActive: false,
  totalTokens: 0,
  panelOpen: true,

  startPhase: (name) => {
    const id = uuid();
    const phase: AgentPhase = { id, name, tasks: [], status: "running" };
    set((s) => ({
      phases: [...s.phases, phase],
      currentPhaseId: id,
      isActive: true,
    }));
    return id;
  },

  completePhase: (phaseId) =>
    set((s) => {
      const updated = s.phases.map((p) =>
        p.id === phaseId ? { ...p, status: "done" as TaskStatus } : p,
      );
      // isActive = false only when ALL phases are done
      const allDone = updated.every((p) => p.status === "done" || p.status === "error");
      return {
        phases: updated,
        currentPhaseId: null,
        isActive: !allDone,
      };
    }),

  startTask: (phaseId, agent, label) => {
    const id = uuid();
    const task: AgentTask = {
      id,
      agent,
      label,
      status: "running",
      streamingText: "",
      result: "",
      startedAt: Date.now(),
      completedAt: null,
      error: null,
      tokens: 0,
    };
    set((s) => ({
      phases: s.phases.map((p) =>
        p.id === phaseId ? { ...p, tasks: [...p.tasks, task] } : p,
      ),
      currentTaskId: id,
    }));
    return id;
  },

  appendStream: (taskId, chunk) =>
    set((s) => ({
      phases: s.phases.map((p) => ({
        ...p,
        tasks: p.tasks.map((t) =>
          t.id === taskId
            ? { ...t, status: "streaming" as TaskStatus, streamingText: t.streamingText + chunk, tokens: t.tokens + 1 }
            : t,
        ),
      })),
      totalTokens: s.totalTokens + 1,
    })),

  completeTask: (taskId, result) =>
    set((s) => ({
      phases: s.phases.map((p) => ({
        ...p,
        tasks: p.tasks.map((t) =>
          t.id === taskId
            ? { ...t, status: "done" as TaskStatus, result, completedAt: Date.now() }
            : t,
        ),
      })),
      currentTaskId: null,
    })),

  failTask: (taskId, error) =>
    set((s) => ({
      phases: s.phases.map((p) => ({
        ...p,
        tasks: p.tasks.map((t) =>
          t.id === taskId
            ? { ...t, status: "error" as TaskStatus, error, completedAt: Date.now() }
            : t,
        ),
      })),
      currentTaskId: null,
    })),

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  reset: () =>
    set({
      phases: [],
      currentPhaseId: null,
      currentTaskId: null,
      isActive: false,
      totalTokens: 0,
    }),
}));
