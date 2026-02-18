import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSmartGenerateStore } from '@/stores/smartGenerateStore'
import { getModelAdapter } from '@/lib/smartGenerateUtils'
import { toast } from '@/hooks/useToast'

interface SaveTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SaveTemplateDialog({ open, onOpenChange }: SaveTemplateDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const { mode, selectedModelId, userPrompt, promptVariants, targetScore, parallelCount, budgetLimit, saveAsTemplate } = useSmartGenerateStore()

  const adapter = selectedModelId ? getModelAdapter(selectedModelId) : null

  const handleSave = () => {
    if (!name.trim()) return
    saveAsTemplate(name.trim())
    toast({
      title: t('smartGenerate.template.saved'),
      description: t('smartGenerate.template.savedDesc', { name: name.trim() }),
    })
    setName('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('smartGenerate.template.saveTitle')}</DialogTitle>
          <DialogDescription>{t('smartGenerate.template.saveDesc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tplName">{t('smartGenerate.template.name')}</Label>
            <Input
              id="tplName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('smartGenerate.template.namePlaceholder')}
              onKeyDown={(e) => e.key === 'Enter' && name.trim() && handleSave()}
            />
          </div>

          {/* Preview */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('smartGenerate.template.mode')}</span>
              <span className="font-medium">{t(`smartGenerate.mode.${mode}`)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('smartGenerate.template.model')}</span>
              <span className="font-medium truncate ml-2">{adapter?.label || selectedModelId}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('smartGenerate.template.prompt')}</span>
              <p className="mt-1 text-xs line-clamp-2">{userPrompt}</p>
            </div>
            {promptVariants.length > 0 && (
              <div>
                <span className="text-muted-foreground">{t('smartGenerate.template.variants')}</span>
                <p className="mt-1 text-xs text-muted-foreground">{promptVariants.length} {t('smartGenerate.template.variantsCount')}</p>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('smartGenerate.template.settings')}</span>
              <span className="text-xs">
                {t('smartGenerate.target')}: {targetScore} · {parallelCount}x · ${budgetLimit.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setName(''); onOpenChange(false) }}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
