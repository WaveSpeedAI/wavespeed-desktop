/**
 * DynamicFieldsEditor — visual editor for HTTP Trigger output fields
 * and HTTP Response input fields.
 *
 * Each field has: key (field name, also used as label) and type (data type).
 * When renderHandle is provided, a ReactFlow handle is rendered inline with each row.
 *
 * Uses the same shadcn/ui components (Input, Select, Button, Label) as
 * the WaveSpeed API node (FormField) for visual consistency.
 */
import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

  const options =
    direction === "input" ? RESPONSE_TYPE_OPTIONS : TYPE_OPTIONS;

  return (
    <div
      className="px-3 py-2 space-y-2 nodrag"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground flex-shrink-0">{dirLabel}</Label>
        <div className="flex-1" />
        <div
          role="button"
          tabIndex={0}
          onClick={addField}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") addField(); }}
          className="border-2 border-dashed rounded-lg px-4 py-1.5 cursor-pointer transition-all duration-200 flex items-center justify-center gap-1.5 hover:border-primary/50 hover:bg-muted/30 hover:shadow-sm min-h-[34px]"
        >
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {t("workflow.addField", "Add")}
          </span>
        </div>
      </div>
      {fields.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          {t(
            "workflow.noFieldsHint",
            "No fields defined. Click Add to create one.",
          )}
        </p>
      )}
      {fields.map((field, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <Input
            type="text"
            value={field.key}
            onChange={(e) =>
              updateField(idx, { key: e.target.value.replace(/\s/g, "_") })
            }
            placeholder="field name"
            className="flex-1 min-w-0 h-8 text-xs"
          />
          <Select
            value={field.type}
            onValueChange={(v) =>
              updateField(idx, { type: v as PortDataType })
            }
          >
            <SelectTrigger className="w-[80px] h-8 text-xs flex-shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {renderHandle && <div className="w-2" />}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => removeField(idx)}
            className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          {renderHandle && renderHandle(field.key)}
        </div>
      ))}
    </div>
  );
}
