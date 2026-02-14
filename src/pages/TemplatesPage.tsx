import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useTemplateStore } from '@/stores/templateStore'
import { TemplateBrowser } from '@/components/templates/TemplateBrowser'
import { TemplateDialog, type TemplateFormData } from '@/components/templates/TemplateDialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/useToast'
import { Upload, GitBranch, PlayCircle, LayoutTemplate } from 'lucide-react'
import type { Template } from '@/types/template'

export function TemplatesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { updateTemplate, deleteTemplate, exportTemplates, importTemplates, useTemplate } = useTemplateStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Edit dialog state
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)

  // Delete confirmation state
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null)

  // Import dialog state
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')

  // Template type filter (for top tabs)
  const [templateType, setTemplateType] = useState<'playground' | 'workflow'>('playground')

  const handleUseTemplate = async (template: Template) => {
    if (template.playgroundData) {
      // Increment use count
      await useTemplate(template.id)
      // Navigate to playground with the template's model
      navigate(`/playground/${encodeURIComponent(template.playgroundData.modelId)}?template=${template.id}`)
    } else if (template.workflowData) {
      // Navigate to workflow editor with template
      navigate(`/workflow?template=${template.id}`)
    }
  }

  const handleEditTemplate = (template: Template) => {
    setEditingTemplate(template)
  }

  const handleSaveEdit = async (data: TemplateFormData) => {
    if (!editingTemplate) return

    try {
      await updateTemplate(editingTemplate.id, {
        name: data.name,
        description: data.description,
        tags: data.tags,
        thumbnail: data.thumbnail ?? null,
      })
      toast({
        title: t('templates.templateUpdated'),
        description: t('templates.updatedSuccessfully', { name: data.name }),
      })
      setEditingTemplate(null)
    } catch (error) {
      toast({
        title: t('common.error'),
        description: (error as Error).message,
        variant: 'destructive'
      })
    }
  }

  const handleDeleteTemplate = async () => {
    if (!deletingTemplate) return

    try {
      await deleteTemplate(deletingTemplate.id)
      toast({
        title: t('templates.templateDeleted'),
        description: t('templates.deletedSuccessfully', { name: deletingTemplate.name }),
      })
      setDeletingTemplate(null)
    } catch (error) {
      toast({
        title: t('common.error'),
        description: (error as Error).message,
        variant: 'destructive'
      })
    }
  }

  const handleExportTemplate = async (template: Template) => {
    try {
      await exportTemplates([template.id])
      toast({
        title: t('templates.templateExported'),
        description: t('templates.exportedSuccessfully', { name: template.name }),
      })
    } catch (error) {
      toast({
        title: t('common.error'),
        description: (error as Error).message,
        variant: 'destructive'
      })
    }
  }


  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFile(file)
    e.target.value = ''
  }

  const handleImportConfirm = async () => {
    if (!importFile) return

    try {
      const result = await importTemplates(importFile, importMode)
      toast({
        title: t('templates.templatesImported'),
        description: t('templates.importedSuccessfully', { 
          imported: result.imported, 
          skipped: result.skipped 
        }),
      })
      setImportFile(null)
    } catch (err) {
      toast({
        title: t('templates.importFailed'),
        description: err instanceof Error ? err.message : t('common.error'),
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header + Top Bar */}
      <div className="px-4 md:px-8 pt-14 md:pt-8 pb-4">
        <h1 className="text-2xl font-bold mb-5 flex items-center gap-2">
          <LayoutTemplate className="h-6 w-6" />
          {t('templates.title')}
        </h1>

        {/* Top Bar: Template Type + Actions in one row */}
        <div className="flex items-center gap-4">
          {/* Template Type Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTemplateType('playground')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                templateType === 'playground'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <PlayCircle className="h-4 w-4" />
              {t('templates.playground')}
            </button>
            <button
              onClick={() => setTemplateType('workflow')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                templateType === 'workflow'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <GitBranch className="h-4 w-4" />
              {t('templates.workflow')}
            </button>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Hidden file input for import */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden border-t border-border/50">
        <TemplateBrowser
          templateType={templateType}
          onUseTemplate={handleUseTemplate}
          onEditTemplate={handleEditTemplate}
          onDeleteTemplate={setDeletingTemplate}
          onExportTemplate={handleExportTemplate}
        />
      </div>

      {/* Edit Dialog */}
      <TemplateDialog
        open={!!editingTemplate}
        onOpenChange={(open) => !open && setEditingTemplate(null)}
        template={editingTemplate}
        onSave={handleSaveEdit}
        mode="edit"
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deletingTemplate} onOpenChange={(open) => !open && setDeletingTemplate(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('templates.deleteTemplate')}</DialogTitle>
            <DialogDescription>
              {t('templates.deleteConfirm', { name: deletingTemplate?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingTemplate(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDeleteTemplate}>
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={!!importFile} onOpenChange={(open) => !open && setImportFile(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('templates.importTemplates')}</DialogTitle>
            <DialogDescription>
              {t('templates.importDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <Label>{t('templates.importMode')}</Label>
              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50">
                  <input
                    type="radio"
                    name="importMode"
                    value="merge"
                    checked={importMode === 'merge'}
                    onChange={() => setImportMode('merge')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium">{t('templates.merge')}</div>
                    <div className="text-sm text-muted-foreground">
                      {t('templates.mergeDesc')}
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50">
                  <input
                    type="radio"
                    name="importMode"
                    value="replace"
                    checked={importMode === 'replace'}
                    onChange={() => setImportMode('replace')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium">{t('templates.replaceAll')}</div>
                    <div className="text-sm text-muted-foreground">
                      {t('templates.replaceAllDesc')}
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportFile(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleImportConfirm}>
              <Upload className="mr-2 h-4 w-4" />
              {t('templates.import')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
