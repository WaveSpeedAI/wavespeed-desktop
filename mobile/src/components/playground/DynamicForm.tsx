import { useMemo, useEffect, useState, useRef } from 'react'
import type { Model } from '@/types/model'
import { schemaToFormFields, getDefaultValues, type FormFieldConfig } from '@/lib/schemaToForm'
import { FormField } from './FormField'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface DynamicFormProps {
  model: Model
  values: Record<string, unknown>
  validationErrors?: Record<string, string>
  onChange: (key: string, value: unknown) => void
  onSetDefaults: (defaults: Record<string, unknown>) => void
  onFieldsChange?: (fields: FormFieldConfig[]) => void
  disabled?: boolean
}

export function DynamicForm({
  model,
  values,
  validationErrors = {},
  onChange,
  onSetDefaults,
  onFieldsChange,
  disabled = false
}: DynamicFormProps) {
  // Track which hidden fields are enabled
  const [enabledHiddenFields, setEnabledHiddenFields] = useState<Set<string>>(new Set())

  // Track if we've initialized defaults for this model instance
  const initializedRef = useRef<string | null>(null)

  // Extract schema from model
  const fields = useMemo<FormFieldConfig[]>(() => {
    // The API returns schema in api_schema.api_schemas[0].request_schema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiSchemas = (model.api_schema as any)?.api_schemas as Array<{
      type: string
      request_schema?: {
        properties?: Record<string, unknown>
        required?: string[]
        'x-order-properties'?: string[]
      }
    }> | undefined

    const requestSchema = apiSchemas?.find(s => s.type === 'model_run')?.request_schema
    if (!requestSchema?.properties) {
      return []
    }
    return schemaToFormFields(
      requestSchema.properties as Record<string, import('@/types/model').SchemaProperty>,
      requestSchema.required || [],
      requestSchema['x-order-properties']
    )
  }, [model])

  // Reset enabled hidden fields when model changes
  useEffect(() => {
    setEnabledHiddenFields(new Set())
  }, [model.model_id])

  // Register fields and set defaults when model changes
  useEffect(() => {
    onFieldsChange?.(fields)

    // Only set defaults if this is a new model (not just remount)
    // Check if we already have values for this model
    const hasExistingValues = Object.keys(values).some(key =>
      values[key] !== undefined && values[key] !== '' &&
      !(Array.isArray(values[key]) && values[key].length === 0)
    )

    // Set defaults only if model changed AND no existing values
    if (initializedRef.current !== model.model_id && !hasExistingValues) {
      const defaults = getDefaultValues(fields)
      onSetDefaults(defaults)
    }
    initializedRef.current = model.model_id
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, model.model_id, onFieldsChange, onSetDefaults])

  // Toggle a hidden field
  const toggleHiddenField = (fieldName: string) => {
    setEnabledHiddenFields(prev => {
      const next = new Set(prev)
      if (next.has(fieldName)) {
        next.delete(fieldName)
        // Clear the value when disabling
        onChange(fieldName, undefined)
      } else {
        next.add(fieldName)
      }
      return next
    })
  }


  if (fields.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No configurable parameters for this model.</p>
        <p className="text-sm mt-2">You can run this model directly.</p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 pr-4 py-2">
        {fields.map((field) => {
          // Hidden fields render with a toggle
          if (field.hidden) {
            const isEnabled = enabledHiddenFields.has(field.name)
            return (
              <div key={field.name} className="space-y-2">
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => toggleHiddenField(field.name)}
                    disabled={disabled}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                      "border shadow-sm",
                      isEnabled
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-muted border-input"
                    )}
                  >
                    <div className={cn(
                      "w-3 h-3 rounded-full border-2 transition-colors",
                      isEnabled ? "bg-primary-foreground border-primary-foreground" : "border-muted-foreground"
                    )} />
                    {field.label}
                  </button>
                  {field.description && !isEnabled && (
                    <p className="text-xs text-muted-foreground">{field.description}</p>
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
                      imageValue={field.name === 'prompt' ? (values['image'] as string) : undefined}
                      hideLabel
                      formValues={values}
                    />
                  </div>
                )}
              </div>
            )
          }

          // Regular visible fields
          return (
            <FormField
              key={field.name}
              field={field}
              value={values[field.name]}
              onChange={(value) => onChange(field.name, value)}
              disabled={disabled}
              error={validationErrors[field.name]}
              modelType={model.type}
              imageValue={field.name === 'prompt' ? (values['image'] as string) : undefined}
              formValues={values}
            />
          )
        })}
      </div>
    </ScrollArea>
  )
}
