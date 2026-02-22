import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useSmartGenerateStore } from '@/stores/smartGenerateStore'
import { TRAINER_MODELS, getTrainerAdapter } from '@/lib/smartGenerateUtils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Upload,
  X,
  Loader2,
  Settings2,
  ChevronDown,
  ChevronUp,
  Dna,
  AlertTriangle,
} from 'lucide-react'

const MAX_ZIP_SIZE = 100 * 1024 * 1024 // 100 MB

interface TrainerConfigProps {
  onStart: () => void
  className?: string
}

export function TrainerConfig({ onStart, className }: TrainerConfigProps) {
  const { t } = useTranslation()
  const [showAdvanced, setShowAdvanced] = useState(false)

  const {
    trainingImages,
    trainingPreviews,
    addTrainingImages,
    removeTrainingImage,
    triggerWord,
    setTriggerWord,
    selectedTrainerId,
    setSelectedTrainerId,
    trainerSteps,
    setTrainerSteps,
    trainerLearningRate,
    setTrainerLearningRate,
    trainerLoraRank,
    setTrainerLoraRank,
    isLocked,
    cancelRequested,
    cancelPipeline,
  } = useSmartGenerateStore()

  const isRunning = isLocked
  const totalSize = trainingImages.reduce((sum, f) => sum + f.size, 0)
  const totalSizeMB = totalSize / (1024 * 1024)
  const isOverSize = totalSize > MAX_ZIP_SIZE
  const canStart = trainingImages.length > 0 && triggerWord.trim() && !isRunning && !isOverSize

  const trainerId = selectedTrainerId || TRAINER_MODELS[0].modelId
  const trainer = getTrainerAdapter(trainerId)

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    addTrainingImages(Array.from(files))
    e.target.value = ''
  }, [addTrainingImages])

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {/* Training Images */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t('smartGenerate.trainer.images')}</Label>
            {trainingPreviews.length > 0 && (
              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-1">
                {trainingPreviews.map((preview, idx) => (
                  <div key={idx} className="relative rounded-lg overflow-hidden border w-20 h-20">
                    <img src={preview} alt="" className="w-full h-full object-cover" />
                    {!isRunning && (
                      <button
                        onClick={() => removeTrainingImage(idx)}
                        className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 hover:bg-background"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    <span className="absolute bottom-0.5 left-0.5 text-[9px] bg-black/60 text-white px-1 rounded">
                      {idx + 1}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {!isRunning && (
              <label className={cn(
                "flex items-center justify-center h-14 rounded-lg border-2 border-dashed transition-colors cursor-pointer hover:bg-muted/30"
              )}>
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Upload className="h-4 w-4" />
                  <span>{trainingImages.length === 0
                    ? t('smartGenerate.trainer.uploadImages')
                    : t('smartGenerate.trainer.addMore')
                  }</span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            )}
            {/* Size info */}
            {trainingImages.length > 0 && (
              <div className={cn(
                "text-xs flex items-center gap-1",
                isOverSize ? "text-destructive" : "text-muted-foreground"
              )}>
                {isOverSize && <AlertTriangle className="h-3 w-3" />}
                <span>
                  {trainingImages.length} {t('smartGenerate.trainer.imageCount')} · {totalSizeMB.toFixed(1)} MB
                  {isOverSize && ` — ${t('smartGenerate.trainer.overSize')}`}
                </span>
              </div>
            )}
          </div>

          {/* Trigger Word */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t('smartGenerate.trainer.triggerWord')}</Label>
            <Input
              value={triggerWord}
              onChange={(e) => setTriggerWord(e.target.value)}
              disabled={isRunning}
              placeholder="p3r5on"
              className="h-9 text-sm"
            />
          </div>

          {/* Trainer Model */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t('smartGenerate.trainer.model')}</Label>
            <Select
              value={trainerId}
              onValueChange={setSelectedTrainerId}
              disabled={isRunning}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRAINER_MODELS.map((m) => (
                  <SelectItem key={m.modelId} value={m.modelId}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Advanced Settings */}
          <div className="space-y-1.5">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span className="font-medium">{t('smartGenerate.config.advanced')}</span>
              {showAdvanced
                ? <ChevronUp className="h-3.5 w-3.5 ml-auto" />
                : <ChevronDown className="h-3.5 w-3.5 ml-auto" />
              }
            </button>

            {showAdvanced && trainer && (
              <div className="space-y-3 pt-1">
                {/* Steps */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">{t('smartGenerate.trainer.steps')}</Label>
                    <Input
                      type="number"
                      value={trainerSteps}
                      onChange={(e) => setTrainerSteps(Math.max(trainer.stepRange.min, Math.min(trainer.stepRange.max, parseInt(e.target.value) || trainer.defaults.steps)))}
                      disabled={isRunning}
                      className="h-7 w-20 text-xs text-right"
                    />
                  </div>
                  <Slider
                    value={[trainerSteps]}
                    onValueChange={([v]) => setTrainerSteps(v)}
                    min={trainer.stepRange.min}
                    max={trainer.stepRange.max}
                    step={100}
                    disabled={isRunning}
                  />
                </div>

                {/* Learning Rate */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">{t('smartGenerate.trainer.learningRate')}</Label>
                    <Input
                      type="number"
                      value={trainerLearningRate}
                      onChange={(e) => setTrainerLearningRate(parseFloat(e.target.value) || trainer.defaults.learningRate)}
                      disabled={isRunning}
                      step={0.0001}
                      className="h-7 w-24 text-xs text-right font-mono"
                    />
                  </div>
                </div>

                {/* LoRA Rank */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">{t('smartGenerate.trainer.loraRank')}</Label>
                    <Input
                      type="number"
                      value={trainerLoraRank}
                      onChange={(e) => setTrainerLoraRank(Math.max(trainer.rankRange.min, Math.min(trainer.rankRange.max, parseInt(e.target.value) || trainer.defaults.loraRank)))}
                      disabled={isRunning}
                      className="h-7 w-20 text-xs text-right"
                    />
                  </div>
                  <Slider
                    value={[trainerLoraRank]}
                    onValueChange={([v]) => setTrainerLoraRank(v)}
                    min={trainer.rankRange.min}
                    max={trainer.rankRange.max}
                    step={4}
                    disabled={isRunning}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Start / Cancel button */}
      <div className="border-t bg-background/80 p-3 shrink-0">
        {isRunning ? (
          <Button
            variant="destructive"
            className="w-full"
            disabled={cancelRequested}
            onClick={() => cancelPipeline()}
          >
            {cancelRequested ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('smartGenerate.cancelling')}
              </>
            ) : (
              <>
                <X className="mr-2 h-4 w-4" />
                {t('smartGenerate.cancel')}
              </>
            )}
          </Button>
        ) : (
          <Button
            className="w-full"
            disabled={!canStart}
            onClick={onStart}
          >
            <Dna className="mr-2 h-4 w-4" />
            {t('smartGenerate.trainer.startTraining')}
          </Button>
        )}
      </div>
    </div>
  )
}
