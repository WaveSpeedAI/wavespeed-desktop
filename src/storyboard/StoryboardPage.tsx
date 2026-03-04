/**
 * Main Storyboard page — cinematic AI video storyboard editor.
 */
import { useEffect, useState } from "react";
import { useStoryboardStore } from "./stores/storyboard.store";
import { useAgentActivityStore } from "./stores/agent-activity.store";
import { TopBar } from "./components/TopBar";
import { LeftPanel } from "./components/LeftPanel";
import { FlowCanvas } from "./components/FlowCanvas";
import { RightPanel } from "./components/RightPanel";
import { ChatBar } from "./components/ChatBar";
import { AgentActivityPanel } from "./components/AgentActivityPanel";
import { VideoPreview } from "./components/VideoPreview";
import { STORAGE_KEY_LLM } from "./components/LlmSettings";

export function StoryboardPage() {
  const setLlmConfig = useStoryboardStore((s) => s.setLlmConfig);
  const project = useStoryboardStore((s) => s.project);
  const selectedShotId = useStoryboardStore((s) => s.selectedShotId);
  const isAgentWorking = useStoryboardStore((s) => s.isAgentWorking);
  const agentPhases = useAgentActivityStore((s) => s.phases);
  const [showPreview, setShowPreview] = useState(false);

  // Restore LLM config from localStorage (user sets it via TopBar → LLM button)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_LLM);
      if (saved) {
        const config = JSON.parse(saved);
        setLlmConfig(config);
      }
    } catch {
      // ignore parse errors
    }
  }, [setLlmConfig]);

  const selectedCharacterId = useStoryboardStore((s) => s.selectedCharacterId);
  const selectedSceneId = useStoryboardStore((s) => s.selectedSceneId);

  const hasAgentActivity = isAgentWorking || agentPhases.length > 0;
  const hasSelection = !!selectedShotId || !!selectedCharacterId || !!selectedSceneId;
  const showEditor = hasSelection && !isAgentWorking;

  // Right panel priority: editor (shot/char/scene) > agent activity
  const showRightPanel = showEditor || hasAgentActivity;

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      <TopBar onPreview={() => setShowPreview(true)} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {project && <LeftPanel />}
        <FlowCanvas />
        {showRightPanel && (
          <div className="w-80 border-l flex flex-col shrink-0 overflow-hidden bg-card/50">
            {showEditor ? <RightPanel /> : <AgentActivityPanel />}
          </div>
        )}
      </div>
      <ChatBar />
      {showPreview && <VideoPreview onClose={() => setShowPreview(false)} />}
    </div>
  );
}
