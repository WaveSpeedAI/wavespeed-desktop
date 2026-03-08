import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "./FormField";
import type { FormFieldConfig } from "@/lib/schemaToForm";
import { getDefaultValues } from "@/lib/schemaToForm";

interface ObjectArrayFieldProps {
  itemFields: FormFieldConfig[];
  value: Record<string, unknown>[];
  onChange: (value: Record<string, unknown>[]) => void;
  maxItems?: number;
  disabled?: boolean;
}

export function ObjectArrayField({
  itemFields,
  value,
  onChange,
  maxItems,
  disabled,
}: ObjectArrayFieldProps) {
  const { t } = useTranslation();
  const items = Array.isArray(value) ? value : [];

  const addItem = () => {
    if (maxItems && items.length >= maxItems) return;
    const defaults = getDefaultValues(itemFields);
    onChange([...items, defaults]);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, key: string, val: unknown) => {
    const next = items.map((item, i) =>
      i === index ? { ...item, [key]: val } : item,
    );
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={index}
          className="relative flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-2.5"
        >
          <div className="flex-1 space-y-2">
            {itemFields.map((field) => (
              <FormField
                key={field.name}
                field={field}
                value={item[field.name]}
                onChange={(val) => updateItem(index, field.name, val)}
                disabled={disabled}
                hideLabel={itemFields.length === 1}
              />
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => removeItem(index)}
            disabled={disabled}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={addItem}
        disabled={
          disabled || (maxItems !== undefined && items.length >= maxItems)
        }
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        {t("common.add")}
        {maxItems ? ` (${items.length}/${maxItems})` : ""}
      </Button>
    </div>
  );
}
