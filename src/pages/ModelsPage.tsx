import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useModelsStore } from "@/stores/modelsStore";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { ExplorePanel } from "@/components/playground/ExplorePanel";
import { Layers } from "lucide-react";

export function ModelsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { models } = useModelsStore();
  const { createTab } = usePlaygroundStore();

  const handleSelectModel = useCallback(
    (modelId: string) => {
      const model = models.find((m) => m.model_id === modelId);
      if (model) {
        createTab(model);
        navigate(`/playground/${encodeURIComponent(modelId)}`);
      }
    },
    [models, createTab, navigate],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page Title */}
      <div className="px-4 md:px-6 py-4 pt-14 md:pt-4 border-b border-border shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          {t("playground.rightPanel.models", "All Models")}
        </h1>
      </div>
      {/* ExplorePanel fills the rest */}
      <div
        className="flex-1 overflow-hidden animate-in fade-in duration-300 fill-mode-both"
        style={{ animationDelay: "100ms" }}
      >
        <ExplorePanel onSelectModel={handleSelectModel} />
      </div>
    </div>
  );
}
