import { useTranslation } from "react-i18next";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Play, Loader2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface BatchControlsProps {
  disabled?: boolean;
  isRunning?: boolean;
  isUploading?: boolean;
  onRun: () => void;
  runLabel: string;
  runningLabel: string;
  price?: string;
}

export function BatchControls({
  disabled,
  isRunning,
  isUploading,
  onRun,
  runLabel,
  runningLabel,
  price,
}: BatchControlsProps) {
  const { t } = useTranslation();
  const { getActiveTab, setBatchConfig } = usePlaygroundStore();
  const activeTab = getActiveTab();

  if (!activeTab) return null;

  const { batchConfig } = activeTab;
  const { enabled, repeatCount, randomizeSeed } = batchConfig;

  const handleEnabledChange = (checked: boolean) => {
    setBatchConfig({ enabled: checked });
  };

  const handleCountChange = (value: number[]) => {
    setBatchConfig({ repeatCount: value[0] });
  };

  const handleRandomizeSeedChange = (checked: boolean) => {
    setBatchConfig({ randomizeSeed: checked });
  };

  const displayLabel =
    enabled && repeatCount > 1 ? `${runLabel} (${repeatCount})` : runLabel;

  return (
    <div className="flex rounded-lg border border-transparent shadow-sm">
      {/* Main Run Button */}
      <Button
        className={cn(
          "flex-1 h-9 text-sm bg-blue-600 hover:bg-blue-700 text-white transition-colors",
          "rounded-r-none border-r border-r-white/20 shadow-none",
        )}
        onClick={onRun}
        disabled={disabled || isRunning || isUploading}
        title={isUploading ? t("playground.capture.uploading") : undefined}
      >
        {isRunning ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {runningLabel}
          </>
        ) : (
          <>
            <Play className="mr-2 h-4 w-4" />
            {displayLabel}
            {price && (
              <span className="ml-1.5 text-xs opacity-70">
                $
                {enabled && repeatCount > 1
                  ? (parseFloat(price) * repeatCount).toFixed(4)
                  : price}
              </span>
            )}
          </>
        )}
      </Button>

      {/* Dropdown Trigger */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className={cn(
              "bg-blue-600 hover:bg-blue-700 text-white transition-colors",
              "rounded-l-none px-1.5 h-9 shadow-none",
            )}
            disabled={disabled || isRunning || isUploading}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64 rounded-xl border border-border/80 p-4 shadow-xl"
        >
          <div className="space-y-4">
            {/* Header */}
            <div className="font-medium text-sm">
              {t("playground.batch.settings")}
            </div>

            {/* Animated batch settings */}
            <div
              className={cn(
                "grid transition-[grid-template-rows] duration-200 ease-out",
                enabled ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden">
                <div className="space-y-4 pt-1">
                  {/* Repeat Count */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">
                        {t("playground.batch.repeatCount")}
                      </Label>
                      <span className="text-sm font-medium">{repeatCount}</span>
                    </div>
                    <Slider
                      value={[repeatCount]}
                      onValueChange={handleCountChange}
                      min={2}
                      max={16}
                      step={1}
                      className="w-full"
                    />
                  </div>

                  {/* Randomize Seed */}
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="randomize-seed"
                      className="text-sm cursor-pointer"
                    >
                      {t("playground.batch.randomizeSeed")}
                    </Label>
                    <Switch
                      id="randomize-seed"
                      checked={randomizeSeed}
                      onCheckedChange={handleRandomizeSeedChange}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Enable Batch - at bottom so position stays fixed */}
            <div className="flex items-center justify-between pt-2 border-t">
              <Label htmlFor="batch-enabled" className="text-sm cursor-pointer">
                {t("playground.batch.enable")}
              </Label>
              <Switch
                id="batch-enabled"
                checked={enabled}
                onCheckedChange={handleEnabledChange}
              />
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
