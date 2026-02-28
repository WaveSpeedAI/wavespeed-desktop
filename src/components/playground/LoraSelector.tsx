import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { X, Plus } from "lucide-react";

export interface LoraItem {
  path: string;
  scale: number;
}

interface LoraSelectorProps {
  value: LoraItem[];
  onChange: (value: LoraItem[]) => void;
  maxItems?: number;
  disabled?: boolean;
}

export function LoraSelector({
  value = [],
  onChange,
  maxItems = 3,
  disabled = false,
}: LoraSelectorProps) {
  const [customPath, setCustomPath] = useState("");

  const addLora = (lora: LoraItem) => {
    if (value.length >= maxItems) return;
    // Check if already added
    if (value.some((v) => v.path === lora.path)) return;
    onChange([...value, lora]);
  };

  const removeLora = (index: number) => {
    const newValue = [...value];
    newValue.splice(index, 1);
    onChange(newValue);
  };

  const updateScale = (index: number, scale: number) => {
    const newValue = [...value];
    newValue[index] = { ...newValue[index], scale };
    onChange(newValue);
  };

  const handleAddCustom = () => {
    if (!customPath.trim()) return;
    addLora({ path: customPath.trim(), scale: 1 });
    setCustomPath("");
  };

  return (
    <div className="space-y-4">
      {/* Selected LoRAs with scale sliders */}
      {value.length > 0 && (
        <div className="space-y-3">
          <Label className="text-xs text-muted-foreground">
            Selected LoRAs ({value.length}/{maxItems})
          </Label>
          {value.map((lora, index) => (
            <div
              key={lora.path}
              className="space-y-2 p-3 bg-muted/50 rounded-lg"
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className="text-sm font-medium break-all flex-1"
                  title={lora.path}
                >
                  {lora.path}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => removeLora(index)}
                  disabled={disabled}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <Label className="text-xs w-12">Scale</Label>
                <Slider
                  value={[lora.scale]}
                  onValueChange={([v]) => updateScale(index, v)}
                  min={0}
                  max={4}
                  step={0.1}
                  disabled={disabled}
                  className="flex-1"
                />
                <span className="text-xs w-8 text-right">
                  {lora.scale.toFixed(1)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Custom LoRA input */}
      {value.length < maxItems && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            Add Custom LoRA
          </Label>
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="user/repo or https://.../*.safetensors"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              disabled={disabled}
              className="flex-1"
              onKeyDown={(e) =>
                e.key === "Enter" && (e.preventDefault(), handleAddCustom())
              }
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleAddCustom}
              disabled={disabled || !customPath.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            HuggingFace format (user/repo) or any .safetensors URL
          </p>
        </div>
      )}
    </div>
  );
}
