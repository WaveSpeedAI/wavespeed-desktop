/**
 * DynamicFieldsEditor — visual editor for HTTP Trigger output fields
 * and HTTP Response input fields.
 *
 * Each field has: key (field name, also used as label) and type (data type).
 * When renderHandle is provided, a ReactFlow handle is rendered inline with each row.
 */
import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import type { PortDataType } from "@/workflow/types/node-defs";

export interface FieldConfig {
  key: string;
  label: string;
  type: PortDataType;
}

interface DynamicFieldsEditorProps {
  fields: FieldConfig[];
  onChange: (fields: FieldConfig[]) => void;
  direction: "output" | "input";
  /** Render a ReactFlow handle anchor for a given field key */
  renderHandle?: (fieldKey: string) => ReactNode;
}

const TYPE_OPTIONS: { value: PortDataType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "url", label: "URL" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "any", label: "Any" },
];

/** Response fields use plain data types (no media-specific types) */
const RESPONSE_TYPE_OPTIONS: { value: PortDataType; label: string }[] = [
  { value: "text", label: "String" },
  { value: "any", label: "JSON" },
  { value: "number" as PortDataType, label: "Number" },
];

export function DynamicFieldsEditor({
  fields,
  onChange,
  direction,
  renderHandle,
}: DynamicFieldsEditorProps) {
  const { t } = useTranslation();

  const addField = useCallback(() => {
    const idx = fields.length + 1;
    const key = `field_${idx}`;
    onChange([...fields, { key, label: key, type: "text" }]);
  }, [fields, onChange]);

  const removeField = useCallback(
    (index: number) => onChange(fields.filter((_, i) => i !== index)),
    [fields, onChange],
  );

  const updateField = useCallback(
    (index: number, patch: Partial<FieldConfig>) => {
      onChange(
        fields.map((f, i) => {
          if (i !== index) return f;
          const updated = { ...f, ...patch };
          // Keep label in sync with key
          if (patch.key !== undefined) updated.label = patch.key;
          return updated;
        }),
      );
    },
    [fields, onChange],
  );

  const dirLabel =
    direction === "output"
      ? t("workflow.httpTriggerFields", "API Input Fields")
      : t("workflow.httpResponseFields", "API Response Fields");

  return (
    <div
      className="px-3 py-2 space-y-2 nodrag"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          {dirLabel}
        </span>
        <button
          type="button"
          onClick={addField}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
          {t("workflow.addField", "Add")}
        </button>
      </div>
      {fields.length === 0 && (
        <div className="text-[10px] text-muted-foreground/60 text-center py-2">
          {t(
            "workflow.noFieldsHint",
            "No fields defined. Click Add to create one.",
          )}
        </div>
      )}
      {fields.map((field, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <input
            type="text"
            value={field.key}
            onChange={(e) =>
              updateField(idx, { key: e.target.value.replace(/\s/g, "_") })
            }
            placeholder="field name"
            className="flex-1 min-w-0 px-2 py-1 rounded border border-border bg-background text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <select
            value={field.type}
            onChange={(e) =>
              updateField(idx, { type: e.target.value as PortDataType })
            }
            className="w-16 px-1 py-1 rounded border border-border bg-background text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            {(direction === "input" ? RESPONSE_TYPE_OPTIONS : TYPE_OPTIONS).map(
              (opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ),
            )}
          </select>
          <button
            type="button"
            onClick={() => removeField(idx)}
            className="p-1 rounded text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
          >
            <Trash2 className="w-3 h-3" />
          </button>
          {renderHandle && renderHandle(field.key)}
        </div>
      ))}
    </div>
  );
}
