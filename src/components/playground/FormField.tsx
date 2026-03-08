import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FormFieldConfig } from "@/lib/schemaToForm";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileUpload } from "./FileUpload";
import { SizeSelector } from "./SizeSelector";
import { LoraSelector, type LoraItem } from "./LoraSelector";
import { ObjectArrayField } from "./ObjectArrayField";
import { PromptOptimizer } from "./PromptOptimizer";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TouchTooltip,
} from "@/components/ui/tooltip";
import { Dices, Info, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  field: FormFieldConfig;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  error?: string;
  modelType?: string;
  imageValue?: string;
  hideLabel?: boolean;
  formValues?: Record<string, unknown>;
  onUploadingChange?: (isUploading: boolean) => void;
  tooltipDescription?: boolean;
  /** When provided (e.g. workflow), file uploads use this instead of API. */
  onUploadFile?: (file: File) => Promise<string>;
  /** Optional React node rendered inside the label row (e.g. a connection handle anchor). */
  handleAnchor?: React.ReactNode;
}

// Generate a random seed (0 to 65535)
const generateRandomSeed = () => Math.floor(Math.random() * 65536);

export function FormField({
  field,
  value,
  onChange,
  disabled = false,
  error,
  modelType,
  imageValue,
  hideLabel = false,
  formValues,
  onUploadingChange,
  tooltipDescription = false,
  onUploadFile,
  handleAnchor,
}: FormFieldProps) {
  const { t } = useTranslation();
  // Check if this is a seed field
  const isSeedField = field.name.toLowerCase() === "seed";
  const isNumericField = field.type === "number" || field.type === "slider";
  const isNumberField = field.type === "number";
  const allowEmptyNumber =
    isNumberField && !field.required && field.default === undefined;
  const numericFallback =
    value !== undefined && value !== null
      ? Number(value)
      : ((field.default as number | undefined) ?? field.min ?? 0);
  const [numericInput, setNumericInput] = useState(() => {
    if (!isNumericField) return "";
    if (allowEmptyNumber && (value === undefined || value === null)) return "";
    return String(numericFallback);
  });

  useEffect(() => {
    if (!isNumericField) return;
    if (allowEmptyNumber && (value === undefined || value === null)) {
      setNumericInput("");
      return;
    }
    const next =
      value !== undefined && value !== null
        ? Number(value)
        : ((field.default as number | undefined) ?? field.min ?? 0);
    setNumericInput(String(next));
  }, [isNumericField, value, field.default, field.min, allowEmptyNumber]);

  const isIntegerField = field.schemaType === "integer";

  const clampNumeric = (n: number) => {
    let next = isIntegerField ? Math.round(n) : n;
    if (field.min !== undefined) next = Math.max(field.min, next);
    if (field.max !== undefined) next = Math.min(field.max, next);
    return next;
  };

  const commitNumeric = (raw: string) => {
    if (raw.trim() === "" || Number.isNaN(Number(raw))) {
      if (allowEmptyNumber) {
        onChange(undefined);
        setNumericInput("");
        return;
      }
      const fallback = (field.default as number | undefined) ?? field.min ?? 0;
      onChange(fallback);
      setNumericInput(String(fallback));
      return;
    }

    const parsed = Number(raw);
    const clamped = clampNumeric(parsed);
    onChange(clamped);
    setNumericInput(String(clamped));
  };

  const renderInput = () => {
    switch (field.type) {
      case "text":
        return (
          <Input
            id={field.name}
            type="text"
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              field.description || `Enter ${field.label.toLowerCase()}`
            }
            disabled={disabled}
          />
        );

      case "textarea":
        return (
          <Textarea
            id={field.name}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              field.description || `Enter ${field.label.toLowerCase()}`
            }
            disabled={disabled}
            rows={4}
            className="nodrag nowheel"
          />
        );

      case "number": {
        // Show slider + input when default, min, and max are all defined
        const hasSliderRange =
          field.default !== undefined &&
          field.min !== undefined &&
          field.max !== undefined;
        const currentValue =
          value !== undefined && value !== null
            ? Number(value)
            : ((field.default as number) ?? field.min ?? 0);

        if (hasSliderRange) {
          return (
            <div className="flex items-center gap-3">
              <Slider
                value={[currentValue]}
                onValueChange={([v]) => {
                  const coerced = isIntegerField ? Math.round(v) : v;
                  onChange(coerced);
                  setNumericInput(String(coerced));
                }}
                min={field.min}
                max={field.max}
                step={field.step ?? 1}
                disabled={disabled}
                className="flex-1"
              />
              <Input
                id={field.name}
                type="number"
                value={numericInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setNumericInput(val);
                  if (val === "" || Number.isNaN(Number(val))) {
                    if (allowEmptyNumber) onChange(undefined);
                    return;
                  }
                  const n = Number(val);
                  onChange(isIntegerField ? Math.round(n) : n);
                }}
                onBlur={() => commitNumeric(numericInput)}
                min={field.min}
                max={field.max}
                step={field.step}
                disabled={disabled}
                className="w-24 h-8 text-sm"
              />
            </div>
          );
        }

        return (
          <div className="flex items-center gap-2">
            <Input
              id={field.name}
              type="number"
              value={numericInput}
              onChange={(e) => {
                const val = e.target.value;
                setNumericInput(val);
                if (val === "" || Number.isNaN(Number(val))) {
                  if (allowEmptyNumber) onChange(undefined);
                  return;
                }
                const n = Number(val);
                onChange(isIntegerField ? Math.round(n) : n);
              }}
              onBlur={() => commitNumeric(numericInput)}
              min={field.min}
              max={field.max}
              step={field.step}
              placeholder={
                field.default !== undefined
                  ? `Default: ${field.default}`
                  : undefined
              }
              disabled={disabled}
              className={isSeedField ? "flex-1" : undefined}
            />
            {isSeedField && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      const next = generateRandomSeed();
                      onChange(next);
                      setNumericInput(String(next));
                    }}
                    disabled={disabled}
                  >
                    <Dices className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{t("playground.randomSeed")}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        );
      }

      case "slider": {
        const currentValue =
          value !== undefined && value !== null
            ? Number(value)
            : ((field.default as number) ?? field.min ?? 0);
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Slider
                value={[currentValue]}
                onValueChange={([v]) => {
                  const coerced = isIntegerField ? Math.round(v) : v;
                  onChange(coerced);
                  setNumericInput(String(coerced));
                }}
                min={field.min ?? 0}
                max={field.max ?? 100}
                step={field.step ?? 1}
                disabled={disabled}
                className="flex-1"
              />
              <Input
                type="number"
                value={numericInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setNumericInput(val);
                  if (val === "" || Number.isNaN(Number(val))) return;
                  const n = Number(val);
                  onChange(isIntegerField ? Math.round(n) : n);
                }}
                onBlur={() => commitNumeric(numericInput)}
                min={field.min}
                max={field.max}
                step={field.step}
                disabled={disabled}
                className="w-24 h-8 text-sm"
              />
            </div>
          </div>
        );
      }

      case "boolean":
        return (
          <div className="flex items-center space-x-2">
            <Switch
              id={field.name}
              checked={Boolean(value)}
              onCheckedChange={onChange}
              disabled={disabled}
            />
            <Label
              htmlFor={field.name}
              className="text-sm text-muted-foreground"
            >
              {value ? "Enabled" : "Disabled"}
            </Label>
          </div>
        );

      case "select": {
        const selectValue =
          value !== undefined && value !== null && value !== ""
            ? String(value)
            : field.default !== undefined
              ? String(field.default)
              : "__empty__";
        return (
          <Select
            value={selectValue}
            onValueChange={(v) => {
              if (v === "__empty__") {
                onChange(undefined);
                return;
              }
              // Try to preserve the original type (number if it was a number)
              const originalOption = field.options?.find(
                (opt) => String(opt) === v,
              );
              onChange(originalOption !== undefined ? originalOption : v);
            }}
            disabled={disabled}
          >
            <SelectTrigger id={field.name}>
              <SelectValue
                placeholder={`Select ${field.label.toLowerCase()}`}
              />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={String(option)} value={String(option)}>
                  {String(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      case "size":
        return (
          <SizeSelector
            value={
              (value as string) || (field.default as string) || "1024*1024"
            }
            onChange={(v) => onChange(v)}
            disabled={disabled}
            min={field.min}
            max={field.max}
          />
        );

      case "file":
      case "file-array":
        return (
          <FileUpload
            accept={field.accept || "*/*"}
            multiple={field.type === "file-array"}
            maxFiles={field.maxFiles || 1}
            value={
              (value as string | string[]) ||
              (field.type === "file-array" ? [] : "")
            }
            onChange={onChange}
            disabled={disabled}
            placeholder={field.placeholder}
            isMaskField={[
              "mask_image",
              "mask_image_url",
              "mask_images",
              "mask_image_urls",
            ].includes(field.name)}
            formValues={formValues}
            onUploadingChange={onUploadingChange}
            onUploadFile={onUploadFile}
          />
        );

      case "multi-select": {
        // Value is stored as plain string[] internally; wrapKey wrapping happens at submission time
        const selected = Array.isArray(value) ? (value as string[]) : [];
        const options = field.options ?? [];
        return (
          <div className="flex flex-wrap gap-1.5">
            {options.map((opt) => {
              const optStr = String(opt);
              const isActive = selected.includes(optStr);
              return (
                <button
                  key={optStr}
                  type="button"
                  disabled={
                    disabled ||
                    (!isActive &&
                      field.max !== undefined &&
                      selected.length >= field.max)
                  }
                  onClick={() => {
                    const next = isActive
                      ? selected.filter((v) => v !== optStr)
                      : [...selected, optStr];
                    onChange(next);
                  }}
                  className={cn(
                    "px-2.5 py-1 text-xs rounded-md border transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/50 text-muted-foreground border-border hover:bg-muted",
                    disabled && "opacity-50 cursor-not-allowed",
                  )}
                >
                  {optStr}
                </button>
              );
            })}
          </div>
        );
      }

      case "object-array":
        return (
          <ObjectArrayField
            itemFields={field.itemFields || []}
            value={(value as Record<string, unknown>[]) || []}
            onChange={(v) => onChange(v)}
            maxItems={field.max}
            disabled={disabled}
          />
        );

      case "loras":
        return (
          <LoraSelector
            value={(value as LoraItem[]) || []}
            onChange={onChange}
            maxItems={field.maxFiles || 3}
            disabled={disabled}
          />
        );

      case "string-array": {
        const items = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={item}
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = e.target.value;
                    onChange(next);
                  }}
                  disabled={disabled}
                  placeholder={`Item ${i + 1}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                  disabled={disabled}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange([...items, ""])}
              disabled={
                disabled ||
                (field.maxFiles ? items.length >= field.maxFiles : false)
              }
            >
              <Plus className="h-4 w-4 mr-1" />
              {t("common.addItem", "Add Item")}
            </Button>
          </div>
        );
      }

      default:
        return (
          <Input
            id={field.name}
            type="text"
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        );
    }
  };

  // Check if this is a prompt field that can be optimized (only main "prompt", not negative_prompt)
  const isOptimizablePrompt =
    field.name === "prompt" && field.type === "textarea";

  return (
    <div className="space-y-2">
      {!hideLabel && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center">
            {handleAnchor}
            <Label
              htmlFor={field.name}
              className={cn(
                field.required &&
                  "after:content-['*'] after:ml-0.5 after:text-destructive",
                error && "text-destructive",
              )}
            >
              {field.label}
            </Label>
          </span>
          {tooltipDescription &&
            field.description &&
            field.type !== "text" &&
            field.type !== "textarea" && (
              <TouchTooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 translate-y-px cursor-pointer" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[280px]">
                  <p className="text-xs">
                    {field.description}
                    {field.min !== undefined && field.max !== undefined
                      ? ` (${field.min} - ${field.max})`
                      : ""}
                  </p>
                </TooltipContent>
              </TouchTooltip>
            )}
          {isOptimizablePrompt && (
            <PromptOptimizer
              currentPrompt={(value as string) || ""}
              onOptimized={(optimized) => onChange(optimized)}
              disabled={disabled}
              modelType={modelType}
              imageValue={imageValue}
            />
          )}
          {field.min !== undefined &&
            field.max !== undefined &&
            (tooltipDescription ? !field.description : true) && (
              <span className="text-xs text-muted-foreground">
                ({field.min} - {field.max})
              </span>
            )}
        </div>
      )}
      <div
        className={cn(
          field.type !== "loras" &&
            field.type !== "file" &&
            field.type !== "file-array" &&
            field.type !== "string-array" &&
            field.type !== "object-array" &&
            "overflow-hidden",
          error &&
            "[&_input]:border-destructive [&_textarea]:border-destructive",
        )}
      >
        {renderInput()}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!tooltipDescription &&
        !error &&
        field.description &&
        field.type !== "text" &&
        field.type !== "textarea" && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
    </div>
  );
}
