import { useState, useEffect, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Sparkles, Loader2 } from 'lucide-react'
import { useModelsStore } from '@/stores/modelsStore'
import { apiClient } from '@/api/client'
import { schemaToFormFields, getDefaultValues, type FormFieldConfig } from '@/lib/schemaToForm'
import { FormField } from './FormField'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface PromptOptimizerProps {
  currentPrompt: string
  onOptimized: (optimizedPrompt: string) => void
  disabled?: boolean
  modelType?: string
  imageValue?: string
}

// Detect if a model is a video model based on its type
function isVideoModel(modelType?: string): boolean {
  if (!modelType) return false
  return modelType.toLowerCase().includes('video')
}

const PROMPT_OPTIMIZER_MODEL = 'wavespeed-ai/prompt-optimizer'

export function PromptOptimizer({ currentPrompt, onOptimized, disabled, modelType, imageValue }: PromptOptimizerProps) {
  const [open, setOpen] = useState(false)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)

  const { models, fetchModels } = useModelsStore()

  // Determine default mode based on current model type
  const defaultMode = isVideoModel(modelType) ? 'video' : 'image'

  // Find the prompt optimizer model
  const optimizerModel = useMemo(() => {
    return models.find(m => m.name === PROMPT_OPTIMIZER_MODEL)
  }, [models])

  // Extract form fields from model schema
  const fields = useMemo<FormFieldConfig[]>(() => {
    if (!optimizerModel) return []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiSchemas = (optimizerModel.api_schema as any)?.api_schemas as Array<{
      type: string
      request_schema?: {
        properties?: Record<string, unknown>
        required?: string[]
        'x-order-properties'?: string[]
      }
    }> | undefined

    const requestSchema = apiSchemas?.find(s => s.type === 'model_run')?.request_schema
    if (!requestSchema?.properties) return []

    return schemaToFormFields(
      requestSchema.properties as Record<string, import('@/types/model').SchemaProperty>,
      requestSchema.required || [],
      requestSchema['x-order-properties']
    )
  }, [optimizerModel])

  // Set default values when dialog opens
  useEffect(() => {
    if (open && fields.length > 0) {
      const defaults = getDefaultValues(fields)
      // Pre-fill text field with current prompt, mode based on model type, and image if available
      setValues({
        ...defaults,
        text: currentPrompt,
        mode: defaultMode,
        ...(imageValue ? { image: imageValue } : {})
      })
      setError(null)
    }
  }, [open, fields, currentPrompt, defaultMode, imageValue])

  // Fetch models if not loaded
  useEffect(() => {
    if (open && models.length === 0) {
      fetchModels()
    }
  }, [open, models.length, fetchModels])

  const handleChange = useCallback((key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleOptimize = async () => {
    if (!values.text && !values.image) {
      setError('Please enter a prompt or provide an image')
      return
    }

    setIsOptimizing(true)
    setError(null)

    try {
      const optimizedPrompt = await apiClient.optimizePrompt(values)
      onOptimized(optimizedPrompt)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to optimize prompt')
    } finally {
      setIsOptimizing(false)
    }
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => setOpen(true)}
            disabled={disabled}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Optimize prompt with AI</p>
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Optimize Prompt
              {optimizerModel?.base_price !== undefined && (
                <span className="text-sm font-normal text-muted-foreground">
                  (${optimizerModel.base_price.toFixed(3)}/run)
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {!optimizerModel ? (
            <div className="py-8 text-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              <p>Loading optimizer...</p>
            </div>
          ) : fields.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>Unable to load optimizer configuration</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4 pr-4">
                {fields.map((field) => (
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

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isOptimizing}>
              Cancel
            </Button>
            <Button onClick={handleOptimize} disabled={isOptimizing || !optimizerModel}>
              {isOptimizing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Optimizing...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Optimize
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
