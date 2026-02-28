/**
 * Workflow-specific Prompt Optimizer — Split Button with Quick / Image modes.
 *
 * Independent from playground's PromptOptimizer. Only used in workflow nodes.
 *
 * Quick mode:  Click ✨ → instant optimize with saved quick settings
 * Dropdown:    Click ▾ → view/edit quick settings + "Optimize with Image" entry
 *
 * Quick settings dynamically loads all non-image fields from the optimizer model
 * schema (mode, style, etc.) and persists them in node params.
 *
 * "Optimize with Image" opens a dialog for image-to-prompt generation.
 */
import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { useTranslation } from "react-i18next";
import { useModelsStore } from "@/stores/modelsStore";
import { apiClient } from "@/api/client";
import {
  schemaToFormFields,
  getDefaultValues,
  type FormFieldConfig,
} from "@/lib/schemaToForm";
import { FormField } from "@/components/playground/FormField";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SchemaProperty } from "@/types/model";

const OPTIMIZER_MODEL = "wavespeed-ai/prompt-optimizer";

/* ── Props ────────────────────────────────────────────────────────────── */

interface WorkflowPromptOptimizerProps {
  currentPrompt: string;
  onOptimized: (optimizedPrompt: string) => void;
  /** Persisted quick settings object (mode, style, etc.) */
  quickSettings?: Record<string, unknown>;
  onQuickSettingsChange?: (settings: Record<string, unknown>) => void;
  /** Workflow-only: optimize automatically when Run is clicked */
  optimizeOnRun?: boolean;
  onOptimizeOnRunChange?: (enabled: boolean) => void;
  /** UI visibility controls */
  showRunToggle?: boolean;
  showQuickOptimize?: boolean;
  menuLabel?: string;
  /** Render params panel directly in node body */
  inlinePanel?: boolean;
  /** Hide optimizer text field (use parent text input only) */
  hideTextField?: boolean;
  /** Show as inactive preset style when optimization is off */
  inactive?: boolean;
  disabled?: boolean;
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

/** Extract optimizer model schema fields */
function useOptimizerFields() {
  const { models, fetchModels } = useModelsStore();

  useEffect(() => {
    if (models.length === 0) fetchModels();
  }, [models.length, fetchModels]);

  const optimizerModel = useMemo(
    () => models.find((m) => m.name === OPTIMIZER_MODEL),
    [models],
  );

  const allFields = useMemo<FormFieldConfig[]>(() => {
    if (!optimizerModel) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiSchemas = (optimizerModel.api_schema as any)?.api_schemas as
      | Array<{
          type: string;
          request_schema?: {
            properties?: Record<string, unknown>;
            required?: string[];
            "x-order-properties"?: string[];
          };
        }>
      | undefined;
    const requestSchema = apiSchemas?.find(
      (s) => s.type === "model_run",
    )?.request_schema;
    if (!requestSchema?.properties) return [];
    return schemaToFormFields(
      requestSchema.properties as Record<string, SchemaProperty>,
      requestSchema.required || [],
      requestSchema["x-order-properties"],
    );
  }, [optimizerModel]);

  // Quick fields: everything except text/image (those are handled separately)
  const quickFields = useMemo(
    () => allFields.filter((f) => f.name !== "text" && f.name !== "image"),
    [allFields],
  );

  const textField = useMemo(
    () => allFields.find((f) => f.name === "text"),
    [allFields],
  );

  const defaults = useMemo(() => getDefaultValues(allFields), [allFields]);

  return { optimizerModel, allFields, quickFields, textField, defaults };
}

/* ══════════════════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════════════════ */

export function WorkflowPromptOptimizer({
  currentPrompt,
  onOptimized,
  quickSettings = {},
  onQuickSettingsChange,
  optimizeOnRun = false,
  onOptimizeOnRunChange,
  showRunToggle = true,
  showQuickOptimize = true,
  menuLabel,
  inlinePanel = false,
  hideTextField = false,
  inactive = false,
  disabled,
}: WorkflowPromptOptimizerProps) {
  const { t } = useTranslation();
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { optimizerModel, quickFields, textField, defaults } =
    useOptimizerFields();

  // Build the resolved quick settings (saved values merged with defaults)
  // Includes 'text' field — all settings persisted via quickSettings
  const resolvedSettings = useMemo(() => {
    const merged: Record<string, unknown> = {};
    for (const f of quickFields) {
      merged[f.name] = quickSettings[f.name] ?? defaults[f.name];
    }
    // text field: persisted separately, defaults to empty (NOT currentPrompt)
    merged.text = quickSettings.text ?? "";
    return merged;
  }, [quickFields, quickSettings, defaults]);

  // The optimizer text: use saved text if set, otherwise fall back to currentPrompt
  const optimizerText = String(resolvedSettings.text || "");

  // Persist a single quick setting
  const setSetting = useCallback(
    (key: string, value: unknown) => {
      onQuickSettingsChange?.({ ...quickSettings, [key]: value });
    },
    [quickSettings, onQuickSettingsChange],
  );

  // Close dropdown on outside pointer/key events
  useEffect(() => {
    if (!dropdownOpen) return;
    const pointerHandler = (e: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      )
        setDropdownOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    // capture=true prevents inner stopPropagation from blocking close
    window.addEventListener("pointerdown", pointerHandler, true);
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("pointerdown", pointerHandler, true);
      window.removeEventListener("keydown", keyHandler);
    };
  }, [dropdownOpen]);

  // Auto-clear error
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  // ── Quick Optimize (✨ click) ──
  // Uses saved optimizer text if set, otherwise falls back to currentPrompt
  const handleQuickOptimize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const textToSend = optimizerText || currentPrompt;
    if (!textToSend.trim() || isOptimizing || disabled) return;
    setIsOptimizing(true);
    setError(null);
    try {
      const result = await apiClient.optimizePrompt({
        ...resolvedSettings,
        text: textToSend,
      });
      onOptimized(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t(
              "workflow.promptOptimizer.optimizationFailed",
              "Optimization failed",
            ),
      );
    } finally {
      setIsOptimizing(false);
    }
  };

  // ── Optimize from dropdown button ──
  const handleDropdownOptimize = async () => {
    const textToSend = optimizerText || currentPrompt;
    if (!textToSend.trim() || isOptimizing) return;
    setIsOptimizing(true);
    setError(null);
    try {
      const result = await apiClient.optimizePrompt({
        ...resolvedSettings,
        text: textToSend,
      });
      onOptimized(result);
      setDropdownOpen(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t(
              "workflow.promptOptimizer.optimizationFailed",
              "Optimization failed",
            ),
      );
    } finally {
      setIsOptimizing(false);
    }
  };

  // Mode summary for tooltip
  const modeSummary = resolvedSettings.mode
    ? String(resolvedSettings.mode)
    : "image";

  // Inline mode: render settings directly (no dropdown trigger)
  if (inlinePanel) {
    return (
      <div
        className={`mt-1 rounded-lg border p-2 transition-opacity ${
          inactive
            ? "border-blue-500/20 bg-blue-500/5 opacity-70"
            : "border-blue-500/20 bg-blue-500/5"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            {inactive
              ? t(
                  "workflow.promptOptimizer.optimizeParamsPresetOnly",
                  "Optimize Params (preset only)",
                )
              : t("workflow.promptOptimizer.optimizeParams", "Optimize Params")}
          </span>
          {optimizerModel?.base_price !== undefined && (
            <span className="text-[10px] text-blue-400/80">
              ${optimizerModel.base_price.toFixed(3)}/
              {t("workflow.promptOptimizer.perRun", "run")}
            </span>
          )}
        </div>

        <div className="space-y-2">
          {quickFields.length > 0 ? (
            quickFields.map((field) => (
              <QuickField
                key={field.name}
                field={field}
                value={resolvedSettings[field.name]}
                onChange={(v) => setSetting(field.name, v)}
              />
            ))
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                {t("workflow.promptOptimizer.mode", "Mode")}
              </span>
              <PillToggle
                options={["image", "video"]}
                value={String(quickSettings.mode ?? "image")}
                onChange={(v) => setSetting("mode", v)}
              />
            </div>
          )}
        </div>

        {!hideTextField && (
          <div className="mt-2">
            <div className="mb-1 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
              {textField?.label || t("workflow.promptOptimizer.text", "Text")}
            </div>
            <textarea
              value={optimizerText}
              onChange={(e) => setSetting("text", e.target.value)}
              placeholder={
                textField?.placeholder ||
                textField?.description ||
                t(
                  "workflow.promptOptimizer.textPlaceholder",
                  "Text to expand or use as context...",
                )
              }
              rows={2}
              className="nodrag w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-[11px] text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-[hsl(var(--muted-foreground))] resize-y min-h-[40px] max-h-[120px]"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="relative inline-flex"
      ref={containerRef}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5">
        {/* ── Split Button (Optimize + Params) ───────────────────────────────────── */}
        <div
          className={`flex items-center rounded-md border overflow-hidden transition-colors
          ${isOptimizing ? "border-blue-500/50 bg-blue-500/10" : "border-[hsl(var(--border))] hover:border-blue-500/30"}`}
        >
          {showQuickOptimize ? (
            <>
              {/* Left: Quick Optimize */}
              <button
                onClick={handleQuickOptimize}
                disabled={disabled || isOptimizing || !currentPrompt.trim()}
                title={t("workflow.promptOptimizer.quickOptimizeTitle", {
                  mode: modeSummary,
                  defaultValue: `Quick Optimize (${modeSummary})`,
                })}
                className="flex items-center justify-center gap-1 h-5 px-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isOptimizing ? <SpinnerIcon /> : <SparklesIcon />}
                <span className="text-[10px] font-medium">
                  {t("workflow.promptOptimizer.quickOptimizeLabel", "Optimize")}
                </span>
              </button>
              <div className="w-px h-3.5 bg-[hsl(var(--border))]" />
            </>
          ) : (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDropdownOpen(!dropdownOpen);
                }}
                className={`h-5 px-2 text-[10px] font-semibold transition-colors ${
                  dropdownOpen
                    ? "text-blue-400 bg-blue-500/15"
                    : "text-[hsl(var(--muted-foreground))] hover:text-blue-400 hover:bg-blue-500/15"
                }`}
              >
                {menuLabel || t("workflow.promptOptimizer.params", "Params")}
              </button>
              <div className="w-px h-3.5 bg-[hsl(var(--border))]" />
            </>
          )}

          {/* Right: Dropdown Toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDropdownOpen(!dropdownOpen);
            }}
            className={`flex items-center justify-center w-4 h-5 transition-colors
              ${dropdownOpen ? "text-blue-400 bg-blue-500/15" : "text-[hsl(var(--muted-foreground))] hover:text-blue-400 hover:bg-blue-500/15"}`}
          >
            <ChevronIcon />
          </button>
        </div>

        {/* Optimize on Run — after Optimize */}
        {showRunToggle && (
          <button
            type="button"
            onClick={() => onOptimizeOnRunChange?.(!optimizeOnRun)}
            title={t(
              "workflow.promptOptimizer.autoOnRunTitle",
              "Optimize automatically when clicking Run",
            )}
            className={`h-5 rounded-md border px-2.5 text-[10px] font-semibold transition-colors ${
              optimizeOnRun
                ? "border-blue-500/50 bg-blue-500/20 text-blue-300"
                : "border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            }`}
          >
            {t("workflow.promptOptimizer.autoOnRun", "Optimize On Run")}
          </button>
        )}
      </div>

      {/* ── Error Toast ────────────────────────────────────── */}
      {error && (
        <div
          className="absolute top-7 left-0 z-[101] w-48 px-2.5 py-1.5 rounded-md border border-red-500/30 bg-[hsl(var(--popover))] text-[10px] text-red-400 shadow-lg cursor-pointer"
          onClick={() => setError(null)}
        >
          {error}
        </div>
      )}

      {/* ── Dropdown Panel ─────────────────────────────────── */}
      {dropdownOpen && (
        <div
          className="absolute top-7 left-0 z-[100] w-56 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Prompt Preview (readonly) */}
          <div className="px-3 pt-2.5 pb-1">
            <div className="text-[10px] text-[hsl(var(--muted-foreground))] font-medium mb-1">
              {t("workflow.promptOptimizer.prompt", "Prompt")}
            </div>
            <div className="text-[11px] leading-snug text-[hsl(var(--foreground))] line-clamp-2 break-words opacity-70 italic">
              {currentPrompt.trim()
                ? `"${currentPrompt.slice(0, 80)}${currentPrompt.length > 80 ? "..." : ""}"`
                : t("workflow.promptOptimizer.emptyPrompt", "(empty)")}
            </div>
          </div>

          <div className="mx-2 my-1.5 h-px bg-[hsl(var(--border))]" />

          {/* Quick Settings Fields (style, mode, etc.) */}
          <div className="px-3 pb-1 space-y-2">
            {quickFields.length > 0 ? (
              quickFields.map((field) => (
                <QuickField
                  key={field.name}
                  field={field}
                  value={resolvedSettings[field.name]}
                  onChange={(v) => setSetting(field.name, v)}
                />
              ))
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("workflow.promptOptimizer.mode", "Mode")}
                </span>
                <PillToggle
                  options={["image", "video"]}
                  value={String(quickSettings.mode ?? "image")}
                  onChange={(v) => setSetting("mode", v)}
                />
              </div>
            )}
          </div>

          {/* Optimizer Text param (persisted, defaults to empty) */}
          <div className="px-3 pb-2">
            <div className="text-[10px] text-[hsl(var(--muted-foreground))] font-medium mb-1">
              {textField?.label || t("workflow.promptOptimizer.text", "Text")}
            </div>
            <textarea
              value={optimizerText}
              onChange={(e) => setSetting("text", e.target.value)}
              placeholder={
                textField?.placeholder ||
                textField?.description ||
                t(
                  "workflow.promptOptimizer.textPlaceholder",
                  "Text to expand or use as context...",
                )
              }
              rows={2}
              className="nodrag w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-[11px] text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-[hsl(var(--muted-foreground))] resize-y min-h-[40px] max-h-[120px]"
            />
            {textField?.description && (
              <p className="mt-0.5 text-[9px] text-[hsl(var(--muted-foreground))] leading-tight">
                {textField.description}
              </p>
            )}
          </div>

          {/* Optimize Button + Price */}
          <div className="px-3 pb-2">
            <button
              onClick={handleDropdownOptimize}
              disabled={
                isOptimizing || (!optimizerText.trim() && !currentPrompt.trim())
              }
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-blue-500 text-white text-[11px] font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors"
            >
              {isOptimizing ? (
                <>
                  <SpinnerIcon />{" "}
                  {t("workflow.promptOptimizer.optimizing", "Optimizing...")}
                </>
              ) : (
                <>
                  <SparklesIcon />{" "}
                  {t("workflow.promptOptimizer.optimize", "Optimize")}
                </>
              )}
              {!isOptimizing && optimizerModel?.base_price !== undefined && (
                <span className="opacity-70 text-[10px] font-normal">
                  (${optimizerModel.base_price.toFixed(3)})
                </span>
              )}
            </button>
          </div>

          <div className="mx-2 h-px bg-[hsl(var(--border))]" />

          {/* Image-to-Prompt entry */}
          <button
            onClick={() => {
              setDropdownOpen(false);
              setImageDialogOpen(true);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-[hsl(var(--accent))] transition-colors rounded-b-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          >
            <ImageIcon />
            <span>
              {t(
                "workflow.promptOptimizer.optimizeWithImage",
                "Optimize with Image...",
              )}
            </span>
          </button>
        </div>
      )}

      {/* ── Image-to-Prompt Dialog ─────────────────────────── */}
      {imageDialogOpen && (
        <ImageOptimizeDialog
          currentPrompt={currentPrompt}
          defaultMode={String(resolvedSettings.mode ?? "image")}
          onOptimized={(result) => {
            onOptimized(result);
            setImageDialogOpen(false);
          }}
          onClose={() => setImageDialogOpen(false)}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   QuickField — compact inline field for dropdown
   ══════════════════════════════════════════════════════════════════════ */

function QuickField({
  field,
  value,
  onChange,
}: {
  field: FormFieldConfig;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const cur = value ?? field.default;
  const hasOptions = field.options && field.options.length > 0;

  // Enum with few options → pill toggle
  if (hasOptions && field.options!.length <= 4) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[hsl(var(--muted-foreground))] flex-shrink-0">
          {field.label || field.name}
        </span>
        <PillToggle
          options={field.options!.map(String)}
          value={String(cur ?? "")}
          onChange={onChange}
        />
      </div>
    );
  }

  // Enum with many options → dropdown select
  if (hasOptions) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[hsl(var(--muted-foreground))] flex-shrink-0">
          {field.label || field.name}
        </span>
        <select
          value={String(cur ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-500/50 max-w-[120px]"
        >
          {field.options!.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Boolean → toggle
  if (field.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
          {field.label || field.name}
        </span>
        <button
          type="button"
          onClick={() => onChange(!cur)}
          className={`relative inline-flex h-4 w-7 flex-shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${cur ? "bg-blue-500" : "bg-[hsl(var(--muted))]"}`}
        >
          <span
            className={`pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform ${cur ? "translate-x-3" : "translate-x-0"}`}
          />
        </button>
      </div>
    );
  }

  // Number → compact input
  if (field.type === "number" || field.type === "slider") {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[hsl(var(--muted-foreground))] flex-shrink-0">
          {field.label || field.name}
        </span>
        <input
          type="number"
          value={cur !== undefined && cur !== null ? Number(cur) : ""}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
          className="w-16 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-[10px] text-right focus:outline-none focus:ring-1 focus:ring-blue-500/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>
    );
  }

  // Text → compact input
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-[hsl(var(--muted-foreground))] flex-shrink-0">
        {field.label || field.name}
      </span>
      <input
        type="text"
        value={String(cur ?? "")}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder || ""}
        className="flex-1 min-w-0 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-500/50 max-w-[120px]"
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PillToggle — small segmented toggle (Image/Video, etc.)
   ══════════════════════════════════════════════════════════════════════ */

function PillToggle({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex rounded-md border border-[hsl(var(--border))] overflow-hidden">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`px-2 py-0.5 text-[10px] font-medium transition-colors capitalize
            ${value === o ? "bg-blue-500 text-white" : "hover:bg-[hsl(var(--accent))]"}`}
        >
          {t(`workflow.promptOptimizer.modeOptions.${o}`, o)}
        </button>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Image Optimize Dialog — full model schema form (reuses all params)
   ══════════════════════════════════════════════════════════════════════ */

function ImageOptimizeDialog({
  currentPrompt,
  defaultMode,
  onOptimized,
  onClose,
}: {
  currentPrompt: string;
  defaultMode: string;
  onOptimized: (result: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const { optimizerModel, allFields, defaults } = useOptimizerFields();

  // Pre-fill values when fields load
  useEffect(() => {
    if (allFields.length > 0) {
      setValues({ ...defaults, text: "", mode: defaultMode });
    }
  }, [allFields, defaults, currentPrompt, defaultMode]);

  const handleChange = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleOptimize = async () => {
    if (!values.text && !values.image) {
      setError(
        t(
          "workflow.promptOptimizer.imageDialog.enterTextOrImage",
          "Please enter text or provide an image",
        ),
      );
      return;
    }
    setIsOptimizing(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v !== undefined && v !== null && v !== "") params[k] = v;
      }
      const result = await apiClient.optimizePrompt(params);
      onOptimized(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t(
              "workflow.promptOptimizer.imageDialog.optimizeFailed",
              "Failed to optimize",
            ),
      );
    } finally {
      setIsOptimizing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-md mx-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[hsl(var(--border))]">
          <ImageIcon size={18} className="text-green-400" />
          <span className="font-semibold text-sm">
            {t(
              "workflow.promptOptimizer.imageDialog.title",
              "Optimize with Image",
            )}
          </span>
          {optimizerModel?.base_price !== undefined && (
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
              (${optimizerModel.base_price.toFixed(3)}/
              {t("workflow.promptOptimizer.perRun", "run")})
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body — uses playground FormField for full model schema rendering */}
        {!optimizerModel ? (
          <div className="px-5 py-8 text-center text-[hsl(var(--muted-foreground))]">
            <SpinnerIcon size={20} className="mx-auto mb-2" />
            <p className="text-xs">
              {t(
                "workflow.promptOptimizer.imageDialog.loadingOptimizer",
                "Loading optimizer...",
              )}
            </p>
          </div>
        ) : allFields.length === 0 ? (
          <div className="px-5 py-8 text-center text-[hsl(var(--muted-foreground))] text-xs">
            {t(
              "workflow.promptOptimizer.imageDialog.loadConfigFailed",
              "Unable to load optimizer configuration",
            )}
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 px-5 py-4">
              {allFields.map((field) => (
                <FormField
                  key={field.name}
                  field={field}
                  value={values[field.name]}
                  onChange={(value) => handleChange(field.name, value)}
                  disabled={isOptimizing}
                />
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Error */}
        {error && <div className="px-5 pb-2 text-xs text-red-400">{error}</div>}

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[hsl(var(--border))]">
          <button
            onClick={onClose}
            disabled={isOptimizing}
            className="px-3 py-1.5 rounded-md border border-[hsl(var(--border))] text-xs hover:bg-[hsl(var(--accent))] transition-colors disabled:opacity-50"
          >
            {t("workflow.cancel", "Cancel")}
          </button>
          <button
            onClick={handleOptimize}
            disabled={isOptimizing}
            className="px-4 py-1.5 rounded-md bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {isOptimizing ? (
              <>
                <SpinnerIcon size={12} />{" "}
                {t("workflow.promptOptimizer.optimizing", "Optimizing...")}
              </>
            ) : (
              <>
                <ImageIcon size={12} />{" "}
                {t("workflow.promptOptimizer.optimize", "Optimize")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Inline SVG icons — no external dependency
   ══════════════════════════════════════════════════════════════════════ */

function SparklesIcon({
  size = 12,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}

function SpinnerIcon({
  size = 12,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        strokeDasharray="60"
        strokeDashoffset="20"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="6,9 18,9 12,15" />
    </svg>
  );
}

function ImageIcon({
  size = 12,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
