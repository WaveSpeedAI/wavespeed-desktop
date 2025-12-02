import { useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePlaygroundStore } from '@/stores/playgroundStore'
import { useModelsStore } from '@/stores/modelsStore'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { DynamicForm } from '@/components/playground/DynamicForm'
import { OutputDisplay } from '@/components/playground/OutputDisplay'
import { ApiKeyRequired } from '@/components/shared/ApiKeyRequired'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Play, RotateCcw, Loader2, DollarSign } from 'lucide-react'

export function PlaygroundPage() {
  const { modelId } = useParams()
  const navigate = useNavigate()
  const { models } = useModelsStore()
  const { isLoading: isLoadingApiKey, apiKey } = useApiKeyStore()
  const {
    selectedModel,
    formValues,
    validationErrors,
    isRunning,
    currentPrediction,
    error,
    outputs,
    setSelectedModel,
    setFormValue,
    setFormValues,
    setFormFields,
    resetForm,
    runPrediction,
  } = usePlaygroundStore()

  // Set model from URL param
  useEffect(() => {
    if (modelId && models.length > 0) {
      const decodedId = decodeURIComponent(modelId)
      const model = models.find(m => m.model_id === decodedId)
      if (model) {
        setSelectedModel(model)
      }
    }
  }, [modelId, models, setSelectedModel])

  const handleModelChange = (modelId: string) => {
    const model = models.find(m => m.model_id === modelId)
    if (model) {
      setSelectedModel(model)
      navigate(`/playground/${encodeURIComponent(modelId)}`)
    }
  }

  const handleSetDefaults = useCallback((defaults: Record<string, unknown>) => {
    setFormValues(defaults)
  }, [setFormValues])

  const handleRun = async () => {
    await runPrediction()
  }

  const handleReset = () => {
    resetForm()
  }

  // Show loading state while API key is being loaded from storage
  if (isLoadingApiKey) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!apiKey) {
    return <ApiKeyRequired description="Please configure your WaveSpeed API key in Settings to use the playground." />
  }

  return (
    <div className="flex h-full">
      {/* Left Panel - Configuration */}
      <div className="w-96 flex flex-col border-r">
        {/* Model Selector */}
        <div className="p-4 border-b">
          <label className="text-sm font-medium mb-2 block">Model</label>
          <Select
            value={selectedModel?.model_id || ''}
            onValueChange={handleModelChange}
            disabled={isRunning}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model.model_id} value={model.model_id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Parameters */}
        <div className="flex-1 overflow-hidden p-4">
          {selectedModel ? (
            <DynamicForm
              model={selectedModel}
              values={formValues}
              validationErrors={validationErrors}
              onChange={setFormValue}
              onSetDefaults={handleSetDefaults}
              onFieldsChange={setFormFields}
              disabled={isRunning}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>Select a model to configure parameters</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 border-t">
          {selectedModel?.base_price !== undefined && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
              <DollarSign className="h-4 w-4" />
              <span>${selectedModel.base_price.toFixed(4)} per run</span>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={handleRun}
              disabled={!selectedModel || isRunning}
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Run
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isRunning}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Right Panel - Output */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-semibold">Output</h2>
          {selectedModel && (
            <p className="text-sm text-muted-foreground">{selectedModel.name}</p>
          )}
        </div>
        <div className="flex-1 p-4 overflow-hidden">
          <OutputDisplay
            prediction={currentPrediction}
            outputs={outputs}
            error={error}
            isLoading={isRunning}
          />
        </div>
      </div>
    </div>
  )
}
