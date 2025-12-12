import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
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
import { FormField } from '@/components/playground/FormField'
import { ScrollArea } from '@/components/ui/scroll-area'

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
  const { t } = useTranslation()
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
      setError(t('playground.optimizer.enterPromptError'))
      return
    }

    setIsOptimizing(true)
    setError(null)

    try {
      const optimizedPrompt = await apiClient.optimizePrompt(values)
      onOptimized(optimizedPrompt)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('playground.optimizer.failedError'))
    } finally {
      setIsOptimizing(false)
    }
  }

  return (
    <>
      {/* Mobile: More visible button with text label */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2 gap-1 text-xs shrink-0 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-purple-500/30 hover:border-purple-500/50 hover:from-purple-500/20 hover:to-pink-500/20"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        <Sparkles className="h-3 w-3 text-purple-500" />
        <span className="text-purple-600 dark:text-purple-400">AI</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              {t('playground.optimizer.title')}
              {optimizerModel?.base_price !== undefined && (
                <span className="text-sm font-normal text-muted-foreground">
                  (${optimizerModel.base_price.toFixed(3)}/{t('playground.optimizer.perRun')})
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {!optimizerModel ? (
            <div className="py-8 text-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              <p>{t('playground.optimizer.loading')}</p>
            </div>
          ) : fields.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>{t('playground.optimizer.loadError')}</p>
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

          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setOpen(false)} disabled={isOptimizing}>
              {t('common.cancel')}
            </Button>
            <Button className="flex-1" onClick={handleOptimize} disabled={isOptimizing || !optimizerModel}>
              {isOptimizing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('playground.optimizer.optimizing')}
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t('playground.optimizer.optimize')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
