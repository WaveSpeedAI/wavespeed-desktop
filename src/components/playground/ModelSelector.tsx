import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Search, Check, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fuzzySearch } from "@/lib/fuzzySearch";
import { Label } from "@/components/ui/label";
import type { Model } from "@/types/model";

interface ModelSelectorProps {
  models: Model[];
  value: string | undefined;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

/** First two path segments = family. e.g. "bytedance/seedream-v5.0-lite/edit" → "bytedance/seedream-v5.0-lite" */
function getModelFamily(modelId: string): string {
  const parts = modelId.split("/");
  if (parts.length <= 2) return modelId;
  return parts.slice(0, 2).join("/");
}

/**
 * Get the "base family" for grouping related models.
 * Only strips clear speed-variant suffixes (-fast, -turbo) that indicate
 * the same model at different speed tiers. Does NOT strip quality/size
 * suffixes like -pro, -ultra, -lite which are distinct model variants.
 */
function getBaseFamily(modelId: string): string {
  const family = getModelFamily(modelId);
  const parts = family.split("/");
  if (parts.length < 2) return family;
  const baseName = parts[1].replace(/-(fast|turbo)$/i, "");
  return `${parts[0]}/${baseName}`;
}

/** Provider = first segment. e.g. "bytedance/seedream-v5.0-lite" → "bytedance" */
function getProvider(modelId: string): string {
  return modelId.split("/")[0] || modelId;
}

/** Family short name = second segment. e.g. "bytedance/seedream-v5.0-lite" → "seedream-v5.0-lite" */
function getFamilyName(modelId: string): string {
  const parts = modelId.split("/");
  return parts[1] || parts[0];
}

/** Readable type label: "text-to-video" → "Text To Video" */
function formatType(type: string): string {
  return type
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Get a short display label for a variant within its base family group.
 * Shows the distinguishing parts: family suffix + path suffix.
 * e.g. for base "wavespeed-ai/infinitetalk":
 *   "wavespeed-ai/infinitetalk/video-to-video" → "video-to-video"
 *   "wavespeed-ai/infinitetalk-fast/video-to-video" → "fast / video-to-video"
 *   "wavespeed-ai/infinitetalk" → "infinitetalk"
 */
function getVariantLabel(modelId: string, baseFamily: string): string {
  const family = getModelFamily(modelId);
  const baseParts = baseFamily.split("/");
  const familyParts = family.split("/");

  // Difference in the second segment (e.g. "infinitetalk-fast" vs base "infinitetalk" → "fast")
  const baseName = baseParts[1] || "";
  const familyName = familyParts[1] || "";
  let speedSuffix = "";
  if (familyName !== baseName && familyName.startsWith(baseName)) {
    speedSuffix = familyName.slice(baseName.length + 1); // strip the leading "-"
  }

  // Path suffix after the family (e.g. "/video-to-video")
  const pathSuffix =
    modelId.length > family.length ? modelId.slice(family.length + 1) : "";

  if (speedSuffix && pathSuffix) return `${speedSuffix} / ${pathSuffix}`;
  if (speedSuffix) return speedSuffix;
  if (pathSuffix) return pathSuffix;
  return familyName;
}

export function ModelSelector({
  models,
  value,
  onChange,
  disabled,
}: ModelSelectorProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [variantOpen, setVariantOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const variantRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedModel = models.find((m) => m.model_id === value);
  const currentBaseFamily = value ? getBaseFamily(value) : "";

  // Family variants: all models sharing the same base family (includes speed variants like -fast, -turbo)
  const familyVariants = useMemo(() => {
    if (!value) return [];
    const base = getBaseFamily(value);
    return models
      .filter((m) => getBaseFamily(m.model_id) === base)
      .sort((a, b) => a.model_id.localeCompare(b.model_id));
  }, [models, value]);

  // Group variants by model.type for the dropdown optgroups
  const variantsByType = useMemo(() => {
    const groups = new Map<string, Model[]>();
    for (const v of familyVariants) {
      const type = v.type || "other";
      const arr = groups.get(type) ?? [];
      arr.push(v);
      groups.set(type, arr);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [familyVariants]);

  // Breadcrumb parts for the selected model
  const breadcrumb = useMemo(() => {
    if (!value) return null;
    const provider = getProvider(value);
    const familyName = getFamilyName(value);
    return { provider, familyName };
  }, [value]);

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => setDebouncedSearch(localSearch),
      150,
    );
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localSearch]);

  // Unique families: one representative model per base family
  const familyModels = useMemo(() => {
    const seen = new Set<string>();
    return models.filter((m) => {
      const family = getBaseFamily(m.model_id);
      if (seen.has(family)) return false;
      seen.add(family);
      return true;
    });
  }, [models]);

  const filteredModels = useMemo(() => {
    if (!debouncedSearch.trim()) {
      return [...familyModels].sort((a, b) =>
        getModelFamily(a.model_id).localeCompare(getModelFamily(b.model_id)),
      );
    }
    // Search against family name only (short, e.g. "google/nano-banana-pro")
    return fuzzySearch(familyModels, debouncedSearch, (model) => [
      getModelFamily(model.model_id),
    ]).map((r) => r.item);
  }, [familyModels, debouncedSearch]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setLocalSearch("");
        setDebouncedSearch("");
      }
      if (
        variantRef.current &&
        !variantRef.current.contains(e.target as Node)
      ) {
        setVariantOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) inputRef.current.focus();
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        setLocalSearch("");
        setDebouncedSearch("");
      } else if (e.key === "Enter" && filteredModels.length > 0) {
        onChange(filteredModels[0].model_id);
        setIsOpen(false);
        setLocalSearch("");
        setDebouncedSearch("");
      }
    },
    [filteredModels, onChange],
  );

  const handleSelect = useCallback(
    (modelId: string) => {
      onChange(modelId);
      setIsOpen(false);
      setLocalSearch("");
      setDebouncedSearch("");
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    setLocalSearch("");
    setDebouncedSearch("");
    inputRef.current?.focus();
  }, []);

  return (
    <div ref={containerRef}>
      {/* Title — outside the card */}
      <Label className="mt-2 mb-1.5 block">
        {t("playground.modelSelector", "Model Selector")}
      </Label>

      {/* Card container */}
      <div className="rounded-lg border border-border/60 bg-card/50 p-3 space-y-2">
        {/* Row 1: Breadcrumb / search trigger */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              if (!disabled) {
                setIsOpen(!isOpen);
                setVariantOpen(false);
              }
            }}
            disabled={disabled}
            className={cn(
              "flex h-10 w-full items-center gap-1 rounded-lg border border-input/80 bg-muted/40 px-3 text-sm transition-all",
              "hover:bg-muted/60",
              "disabled:cursor-not-allowed disabled:opacity-50",
              isOpen && "border-primary/50 ring-2 ring-primary/10",
            )}
          >
            {breadcrumb ? (
              <span className="flex items-center gap-1 min-w-0 flex-1 text-left">
                <span className="font-semibold text-foreground shrink-0">
                  {breadcrumb.provider}
                </span>
                <span className="text-muted-foreground shrink-0">/</span>
                <span className="font-medium text-foreground truncate">
                  {breadcrumb.familyName}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground flex-1 text-left">
                {t("playground.selectModel")}
              </span>
            )}
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-auto" />
          </button>

          {/* Search dropdown */}
          {isOpen && (
            <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-border/80 bg-popover shadow-xl animate-in fade-in-0 zoom-in-95">
              <div className="flex items-center border-b px-3">
                <Search className="h-4 w-4 shrink-0 opacity-50" />
                <input
                  ref={inputRef}
                  type="text"
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t("playground.searchModels")}
                  className="flex h-10 w-full bg-transparent px-2 py-3 text-sm outline-none placeholder:text-muted-foreground"
                />
                {localSearch && (
                  <button
                    onClick={handleClear}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="max-h-72 overflow-auto p-1.5">
                {filteredModels.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {t("models.noResults")}
                  </div>
                ) : (
                  filteredModels.map((model) => {
                    const family = getModelFamily(model.model_id);
                    const isSelected =
                      value &&
                      getBaseFamily(value) === getBaseFamily(model.model_id);
                    return (
                      <button
                        key={model.model_id}
                        type="button"
                        onClick={() => handleSelect(model.model_id)}
                        className={cn(
                          "relative flex w-full cursor-pointer select-none items-center rounded-lg px-2.5 py-2 text-sm outline-none",
                          "hover:bg-accent hover:text-accent-foreground",
                          isSelected && "bg-primary/10 text-foreground",
                        )}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4 shrink-0",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="truncate">{family}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Row 2: Variant dropdown — custom popover */}
        {selectedModel && familyVariants.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground whitespace-nowrap shrink-0">
              {t("playground.specificFunction", "Specific Model Function")}
            </label>
            <div ref={variantRef} className="relative flex-1 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setVariantOpen(!variantOpen);
                  setIsOpen(false);
                }}
                className={cn(
                  "flex h-8 w-full items-center gap-1 rounded-lg border border-input/80 bg-muted/40 px-2.5 text-xs transition-all cursor-pointer",
                  "hover:bg-muted/60",
                  variantOpen && "border-primary/50 ring-2 ring-primary/10",
                )}
              >
                <span className="flex-1 text-left truncate">
                  {getVariantLabel(value!, currentBaseFamily)}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform",
                    variantOpen && "rotate-180",
                  )}
                />
              </button>

              {variantOpen && (
                <div className="absolute z-50 mt-1 w-full rounded-xl border border-border/80 bg-popover shadow-xl animate-in fade-in-0 zoom-in-95">
                  <div className="max-h-60 overflow-auto p-1">
                    {variantsByType.length === 1
                      ? familyVariants.map((variant) => (
                          <button
                            key={variant.model_id}
                            type="button"
                            onClick={() => {
                              onChange(variant.model_id);
                              setVariantOpen(false);
                            }}
                            className={cn(
                              "relative flex w-full cursor-pointer select-none items-center rounded-lg px-2.5 py-1.5 text-xs outline-none",
                              "hover:bg-accent hover:text-accent-foreground",
                              variant.model_id === value &&
                                "bg-primary/10 text-foreground font-medium",
                            )}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-3.5 w-3.5 shrink-0",
                                variant.model_id === value
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <span className="truncate">
                              {getVariantLabel(
                                variant.model_id,
                                currentBaseFamily,
                              )}
                            </span>
                          </button>
                        ))
                      : variantsByType.map(([type, variants]) => (
                          <div key={type}>
                            <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                              {formatType(type)}
                            </div>
                            {variants.map((variant) => (
                              <button
                                key={variant.model_id}
                                type="button"
                                onClick={() => {
                                  onChange(variant.model_id);
                                  setVariantOpen(false);
                                }}
                                className={cn(
                                  "relative flex w-full cursor-pointer select-none items-center rounded-lg px-2.5 py-1.5 text-xs outline-none",
                                  "hover:bg-accent hover:text-accent-foreground",
                                  variant.model_id === value &&
                                    "bg-primary/10 text-foreground font-medium",
                                )}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-3.5 w-3.5 shrink-0",
                                    variant.model_id === value
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                <span className="truncate">
                                  {getVariantLabel(
                                    variant.model_id,
                                    currentBaseFamily,
                                  )}
                                </span>
                              </button>
                            ))}
                          </div>
                        ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
