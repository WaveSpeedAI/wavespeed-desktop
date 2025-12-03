import { useMemo, useEffect } from 'react'
import type { Model } from '@/types/model'
import { schemaToFormFields, getDefaultValues, type FormFieldConfig } from '@/lib/schemaToForm'
import { FormField } from './FormField'
import { ScrollArea } from '@/components/ui/scroll-area'

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

  // Set default values and register fields when model changes
  useEffect(() => {
    const defaults = getDefaultValues(fields)
    onSetDefaults(defaults)
    onFieldsChange?.(fields)
  }, [fields, onSetDefaults, onFieldsChange])

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
      <div className="space-y-4 pr-4">
        {fields.map((field) => (
          <FormField
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={(value) => onChange(field.name, value)}
            disabled={disabled}
            error={validationErrors[field.name]}
          />
        ))}
      </div>
    </ScrollArea>
  )
}
