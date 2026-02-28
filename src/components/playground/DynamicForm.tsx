import { useMemo, useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Model } from "@/types/model";
import {
  schemaToFormFields,
  getDefaultValues,
  getSingleImageFromValues,
  type FormFieldConfig,
} from "@/lib/schemaToForm";
import { FormField } from "./FormField";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

interface DynamicFormProps {
  model: Model;
  values: Record<string, unknown>;
  validationErrors?: Record<string, string>;
  onChange: (key: string, value: unknown) => void;
  onSetDefaults: (defaults: Record<string, unknown>) => void;
  onFieldsChange?: (fields: FormFieldConfig[]) => void;
  disabled?: boolean;
  onUploadingChange?: (isUploading: boolean) => void;
  collapsible?: boolean;
  /** When false, render form content only (no ScrollArea); parent is the scroll container. Used in Playground for mobile. */
  scrollable?: boolean;
}

export function DynamicForm({
  model,
  values,
  validationErrors = {},
  onChange,
  onSetDefaults,
  onFieldsChange,
  disabled = false,
  onUploadingChange,
  collapsible = false,
  scrollable = true,
}: DynamicFormProps) {
  const { t } = useTranslation();
  // Track which hidden fields are enabled
  const [enabledHiddenFields, setEnabledHiddenFields] = useState<Set<string>>(
    new Set(),
  );

  // Track if advanced settings section is expanded
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Track if we've initialized defaults for this model instance
  const initializedRef = useRef<string | null>(null);

  // Extract schema from model
  const fields = useMemo<FormFieldConfig[]>(() => {
    // The API returns schema in api_schema.api_schemas[0].request_schema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiSchemas = (model.api_schema as any)?.api_schemas as
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
    if (!requestSchema?.properties) {
      return [];
    }
    return schemaToFormFields(
      requestSchema.properties as Record<
        string,
        import("@/types/model").SchemaProperty
      >,
      requestSchema.required || [],
      requestSchema["x-order-properties"],
    );
  }, [model]);

  // Split fields into primary (always visible) and advanced (collapsible)
  // Primary: required fields
  // Advanced: hidden fields + optional fields
  const { primaryFields, advancedFields } = useMemo(() => {
    const primary: FormFieldConfig[] = [];
    const advanced: FormFieldConfig[] = [];
    for (const field of fields) {
      if (field.hidden) {
        advanced.push(field);
      } else if (field.required) {
        primary.push(field);
      } else {
        advanced.push(field);
      }
    }
    return { primaryFields: primary, advancedFields: advanced };
  }, [fields]);

  // Reset enabled hidden fields and collapse advanced when model changes
  useEffect(() => {
    setEnabledHiddenFields(new Set());
    setShowAdvanced(false);
  }, [model.model_id]);

  // Register fields and set defaults when model changes
  useEffect(() => {
    onFieldsChange?.(fields);

    // Only set defaults if this is a new model (not just remount)
    // Check if we already have values for this model
    const hasExistingValues = Object.keys(values).some(
      (key) =>
        values[key] !== undefined &&
        values[key] !== "" &&
        !(Array.isArray(values[key]) && values[key].length === 0),
    );

    // Set defaults only if model changed AND no existing values
    if (initializedRef.current !== model.model_id && !hasExistingValues) {
      const defaults = getDefaultValues(fields);
      onSetDefaults(defaults);
    }
    initializedRef.current = model.model_id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, model.model_id, onFieldsChange, onSetDefaults]);

  // Toggle a hidden field
  const toggleHiddenField = (fieldName: string) => {
    setEnabledHiddenFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldName)) {
        next.delete(fieldName);
        // Clear the value when disabling
        onChange(fieldName, undefined);
      } else {
        next.add(fieldName);
      }
      return next;
    });
  };

  const renderField = (field: FormFieldConfig, index?: number) => {
    const animStyle =
      index !== undefined ? { animationDelay: `${index * 50}ms` } : undefined;

    // Hidden fields render with a toggle
    if (field.hidden) {
      const isEnabled = enabledHiddenFields.has(field.name);
      return (
        <div
          key={field.name}
          className={cn("space-y-2", collapsible && "field-animate")}
          style={animStyle}
        >
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => toggleHiddenField(field.name)}
              disabled={disabled}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200",
                "border shadow-sm",
                isEnabled
                  ? "bg-primary text-primary-foreground border-primary shadow-primary/20 shadow-md"
                  : "bg-background hover:bg-muted border-input hover:shadow-md",
              )}
            >
              <div
                className={cn(
                  "w-3 h-3 rounded-full border-2 transition-all duration-200",
                  isEnabled
                    ? "bg-primary-foreground border-primary-foreground scale-110"
                    : "border-muted-foreground",
                )}
              />
              {field.label}
            </button>
            {field.description && !isEnabled && (
              <p className="text-xs text-muted-foreground">
                {field.description}
              </p>
            )}
          </div>
          {isEnabled && (
            <div className="pl-4 border-l-2 border-primary/50 ml-2">
              <FormField
                field={field}
                value={values[field.name]}
                onChange={(value) => onChange(field.name, value)}
                disabled={disabled}
                error={validationErrors[field.name]}
                modelType={model.type}
                imageValue={
                  field.name === "prompt"
                    ? getSingleImageFromValues(values)
                    : undefined
                }
                hideLabel
                formValues={values}
                onUploadingChange={onUploadingChange}
                tooltipDescription
              />
            </div>
          )}
        </div>
      );
    }

    // Regular visible fields - wrap in hover card when collapsible
    if (collapsible) {
      return (
        <div
          key={field.name}
          className={cn("field-hover", animStyle && "field-animate")}
          style={animStyle}
        >
          <FormField
            field={field}
            value={values[field.name]}
            onChange={(value) => onChange(field.name, value)}
            disabled={disabled}
            error={validationErrors[field.name]}
            modelType={model.type}
            imageValue={
              field.name === "prompt"
                ? getSingleImageFromValues(values)
                : undefined
            }
            formValues={values}
            onUploadingChange={onUploadingChange}
            tooltipDescription
          />
        </div>
      );
    }

    return (
      <FormField
        key={field.name}
        field={field}
        value={values[field.name]}
        onChange={(value) => onChange(field.name, value)}
        disabled={disabled}
        error={validationErrors[field.name]}
        modelType={model.type}
        imageValue={
          field.name === "prompt" ? getSingleImageFromValues(values) : undefined
        }
        formValues={values}
        onUploadingChange={onUploadingChange}
      />
    );
  };

  if (fields.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No configurable parameters for this model.</p>
        <p className="text-sm mt-2">You can run this model directly.</p>
      </div>
    );
  }

  // When not collapsible, render all fields flat (original behavior)
  if (!collapsible) {
    const formContent = (
      <div className="space-y-4 pr-4 py-2">{fields.map(renderField)}</div>
    );
    if (!scrollable) return formContent;
    return <ScrollArea className="h-full">{formContent}</ScrollArea>;
  }

  // Collapsible: primary fields always visible, advanced fields in collapsible section
  const formContent = (
    <div className="space-y-4 pr-4 py-2">
      {/* Primary fields - always visible */}
      {primaryFields.map(renderField)}

      {/* Advanced fields - collapsible with smooth animation */}
      {advancedFields.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={cn(
              "btn-shimmer flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200",
              showAdvanced
                ? "bg-primary/10 text-primary hover:bg-primary/15 shadow-sm shadow-primary/10"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground hover:shadow-sm",
            )}
          >
            <SlidersHorizontal
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-transform duration-300",
                showAdvanced && "rotate-90",
              )}
            />
            <span>
              {showAdvanced
                ? t("playground.advancedSettings.less", "Less")
                : t("playground.advancedSettings.more", "More")}
            </span>
            <span
              className={cn(
                "ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold transition-colors duration-200",
                showAdvanced ? "bg-primary/20 text-primary" : "bg-background",
              )}
            >
              {advancedFields.length}
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 ml-auto transition-transform duration-300",
                showAdvanced && "rotate-180",
              )}
            />
          </button>
          <div className={cn("grid-collapse", showAdvanced && "open")}>
            <div>
              <div className="space-y-4 rounded-lg bg-muted/30 p-3 -mx-1 border border-border/40">
                {showAdvanced &&
                  advancedFields.map((field, i) => renderField(field, i))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  if (!scrollable) return formContent;
  return <ScrollArea className="h-full">{formContent}</ScrollArea>;
}
