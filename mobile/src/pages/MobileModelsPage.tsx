import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useModelsStore } from "@/stores/modelsStore";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { FeaturedModelsPanel } from "@/components/playground/FeaturedModelsPanel";
import { ExplorePanel } from "@/components/playground/ExplorePanel";
import { Compass, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

type ModelsTab = "featured" | "all";

export function MobileModelsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { models } = useModelsStore();
  const { createTab } = usePlaygroundStore();
  const [activeTab, setActiveTab] = useState<ModelsTab>("featured");

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
    <div className="mobile-models-page h-full flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="tab-bar">
        <button
          className={cn("tab-item", activeTab === "featured" && "active")}
          onClick={() => setActiveTab("featured")}
        >
          <Compass className="h-4 w-4 inline-block mr-1.5" />
          {t("playground.rightPanel.featuredModels", "Featured Models")}
        </button>
        <button
          className={cn("tab-item", activeTab === "all" && "active")}
          onClick={() => setActiveTab("all")}
        >
          <Layers className="h-4 w-4 inline-block mr-1.5" />
          {t("playground.rightPanel.models", "All Models")}
        </button>
      </div>

      {/* Content */}
      {activeTab === "featured" ? (
        <div className="flex-1 overflow-auto">
          <FeaturedModelsPanel
            onSelectFeatured={handleSelectModel}
            models={models}
            mobile
          />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <ExplorePanel onSelectModel={handleSelectModel} mobile />
        </div>
      )}
    </div>
  );
}
