import type { FormFieldConfig } from '@/lib/schemaToForm'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FileUpload } from './FileUpload'
import { SizeSelector } from './SizeSelector'
import { LoraSelector, type LoraItem } from './LoraSelector'
import { cn } from '@/lib/utils'

interface FormFieldProps {
  field: FormFieldConfig
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  error?: string
}

export function FormField({ field, value, onChange, disabled = false, error }: FormFieldProps) {
  const renderInput = () => {
    switch (field.type) {
      case 'text':
        return (
          <Input
            id={field.name}
            type="text"
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.description || `Enter ${field.label.toLowerCase()}`}
            disabled={disabled}
          />
        )

      case 'textarea':
        return (
          <Textarea
            id={field.name}
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.description || `Enter ${field.label.toLowerCase()}`}
            disabled={disabled}
            rows={4}
          />
        )

      case 'number':
        return (
          <Input
            id={field.name}
            type="number"
            value={value !== undefined && value !== null ? String(value) : ''}
            onChange={(e) => {
              const val = e.target.value
              if (val === '') {
                onChange(field.default)
              } else {
                onChange(Number(val))
              }
            }}
            min={field.min}
            max={field.max}
            step={field.step}
            placeholder={field.default !== undefined ? `Default: ${field.default}` : undefined}
            disabled={disabled}
          />
        )

      case 'slider': {
        const currentValue = value !== undefined && value !== null ? Number(value) : (field.default as number) ?? field.min ?? 0
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Slider
                value={[currentValue]}
                onValueChange={([v]) => onChange(v)}
                min={field.min ?? 0}
                max={field.max ?? 100}
                step={field.step ?? 1}
                disabled={disabled}
                className="flex-1"
              />
              <Input
                type="number"
                value={currentValue}
                onChange={(e) => onChange(Number(e.target.value))}
                min={field.min}
                max={field.max}
                step={field.step}
                disabled={disabled}
                className="w-24 h-8 text-sm"
              />
            </div>
          </div>
        )
      }

      case 'boolean':
        return (
          <div className="flex items-center space-x-2">
            <Switch
              id={field.name}
              checked={Boolean(value)}
              onCheckedChange={onChange}
              disabled={disabled}
            />
            <Label htmlFor={field.name} className="text-sm text-muted-foreground">
              {value ? 'Enabled' : 'Disabled'}
            </Label>
          </div>
        )

      case 'select':
        return (
          <Select
            value={value !== undefined && value !== null ? String(value) : (field.default !== undefined ? String(field.default) : '')}
            onValueChange={(v) => {
              // Try to preserve the original type (number if it was a number)
              const originalOption = field.options?.find(opt => String(opt) === v)
              onChange(originalOption !== undefined ? originalOption : v)
            }}
            disabled={disabled}
          >
            <SelectTrigger id={field.name}>
              <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={String(option)} value={String(option)}>
                  {String(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

      case 'size':
        return (
          <SizeSelector
            value={(value as string) || field.default as string || '1024*1024'}
            onChange={(v) => onChange(v)}
            disabled={disabled}
            min={field.min}
            max={field.max}
          />
        )

      case 'file':
      case 'file-array':
        return (
          <FileUpload
            accept={field.accept || '*/*'}
            multiple={field.type === 'file-array'}
            maxFiles={field.maxFiles || 1}
            value={(value as string | string[]) || (field.type === 'file-array' ? [] : '')}
            onChange={onChange}
            disabled={disabled}
            placeholder={field.placeholder}
          />
        )

      case 'loras':
        return (
          <LoraSelector
            value={(value as LoraItem[]) || []}
            onChange={onChange}
            maxItems={field.maxFiles || 3}
            disabled={disabled}
          />
        )

      default:
        return (
          <Input
            id={field.name}
            type="text"
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        )
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label
          htmlFor={field.name}
          className={cn(
            field.required && "after:content-['*'] after:ml-0.5 after:text-destructive",
            error && "text-destructive"
          )}
        >
          {field.label}
        </Label>
        {field.min !== undefined && field.max !== undefined && (
          <span className="text-xs text-muted-foreground">
            ({field.min} - {field.max})
          </span>
        )}
      </div>
      <div className={cn(error && "[&_input]:border-destructive [&_textarea]:border-destructive")}>
        {renderInput()}
      </div>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      {!error && field.description && field.type !== 'text' && field.type !== 'textarea' && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}
    </div>
  )
}
