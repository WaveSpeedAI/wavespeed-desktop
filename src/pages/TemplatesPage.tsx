import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useTemplateStore, type Template, type TemplateExport } from '@/stores/templateStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Search, FolderOpen, Play, Trash2, Pencil, Plus, Download, Upload } from 'lucide-react'
import { fuzzyMatch } from '@/lib/fuzzySearch'

export function TemplatesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { templates, loadTemplates, updateTemplate, deleteTemplate, deleteTemplates, exportTemplates, importTemplates, isLoaded } = useTemplateStore()
  const [searchQuery, setSearchQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Edit dialog state
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [editName, setEditName] = useState('')

  // Delete confirmation state
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null)

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBatchDeleteDialog, setShowBatchDeleteDialog] = useState(false)

  // Import dialog state
  const [importData, setImportData] = useState<TemplateExport | null>(null)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')

  // Load templates on mount
  useEffect(() => {
    if (!isLoaded) {
      loadTemplates()
    }
  }, [isLoaded, loadTemplates])

  // Export all templates
  const handleExportAll = () => {
    if (templates.length === 0) {
      toast({
        title: t('templates.noTemplatesToExport'),
        description: t('templates.createSomeFirst'),
        variant: 'destructive',
      })
      return
    }

    const data = exportTemplates()
    downloadJson(data, 'wavespeed-templates.json')
    toast({
      title: t('templates.templatesExported'),
      description: t('templates.exportedCount', { count: templates.length }),
    })
  }

  // Export single template
  const handleExportSingle = (template: Template) => {
    const data = exportTemplates([template.id])
    const fileName = `${template.name.toLowerCase().replace(/\s+/g, '-')}.json`
    downloadJson(data, fileName)
    toast({
      title: t('templates.templateExported'),
      description: t('templates.exported', { name: template.name }),
    })
  }

  // Download JSON helper
  const downloadJson = (data: TemplateExport, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Handle file selection for import
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string) as TemplateExport
        if (!data.templates || !Array.isArray(data.templates)) {
          throw new Error('Invalid file format')
        }
        setImportData(data)
      } catch {
        toast({
          title: t('templates.invalidFile'),
          description: t('templates.invalidFileDesc'),
          variant: 'destructive',
        })
      }
    }
    reader.readAsText(file)
    // Reset input so same file can be selected again
    e.target.value = ''
  }

  // Handle import confirmation
  const handleImportConfirm = () => {
    if (!importData) return

    try {
      const result = importTemplates(importData, importMode)
      const skippedText = result.skipped > 0 ? t('templates.skippedCount', { count: result.skipped }) : ''
      toast({
        title: t('templates.templatesImported'),
        description: t('templates.importedCount', { imported: result.imported, skipped: skippedText }),
      })
    } catch (err) {
      toast({
        title: t('templates.importFailed'),
        description: err instanceof Error ? err.message : t('common.error'),
        variant: 'destructive',
      })
    }
    setImportData(null)
  }

  // Group templates by model
  const groupedTemplates = useMemo(() => {
    const filtered = searchQuery
      ? templates.filter(t =>
          fuzzyMatch(searchQuery, t.name) ||
          fuzzyMatch(searchQuery, t.modelName)
        )
      : templates

    const groups: Record<string, { modelName: string; templates: Template[] }> = {}

    for (const template of filtered) {
      if (!groups[template.modelId]) {
        groups[template.modelId] = {
          modelName: template.modelName,
          templates: []
        }
      }
      groups[template.modelId].templates.push(template)
    }

    // Sort templates within each group by updatedAt (newest first)
    for (const group of Object.values(groups)) {
      group.templates.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
    }

    return groups
  }, [templates, searchQuery])

  const handleUseTemplate = (template: Template) => {
    // Navigate to playground with the template's model
    // The playground will need to load the template values
    navigate(`/playground/${encodeURIComponent(template.modelId)}?template=${template.id}`)
  }

  const handleEditTemplate = (template: Template) => {
    setEditingTemplate(template)
    setEditName(template.name)
  }

  const handleSaveEdit = () => {
    if (!editingTemplate || !editName.trim()) return

    updateTemplate(editingTemplate.id, { name: editName.trim() })
    toast({
      title: 'Template updated',
      description: `Renamed to "${editName.trim()}"`,
    })
    setEditingTemplate(null)
    setEditName('')
  }

  const handleDeleteTemplate = () => {
    if (!deletingTemplate) return

    deleteTemplate(deletingTemplate.id)
    toast({
      title: 'Template deleted',
      description: `Deleted "${deletingTemplate.name}"`,
    })
    setDeletingTemplate(null)
  }

  const handleCreateNew = () => {
    navigate('/playground')
  }

  // Batch selection helpers
  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    const allFilteredIds = Object.values(groupedTemplates).flatMap(g => g.templates.map(t => t.id))
    if (selectedIds.size === allFilteredIds.length && allFilteredIds.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allFilteredIds))
    }
  }

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return
    deleteTemplates(Array.from(selectedIds))
    toast({
      title: t('templates.templatesDeleted'),
      description: t('templates.deletedCount', { count: selectedIds.size }),
    })
    setSelectedIds(new Set())
    setShowBatchDeleteDialog(false)
  }

  const modelIds = Object.keys(groupedTemplates)
  const allFilteredIds = Object.values(groupedTemplates).flatMap(g => g.templates.map(t => t.id))
  const isAllSelected = allFilteredIds.length > 0 && selectedIds.size === allFilteredIds.length

  return (
    <div className="container px-4 md:px-8 py-6 md:py-8 pt-14 md:pt-8">
      <div className="flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-3 mb-6">
        <h1 className="text-xl md:text-2xl font-bold">{t('templates.title')}</h1>
        <p className="text-muted-foreground text-xs md:text-sm">{t('templates.description')}</p>
      </div>

      {/* Search and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-6">
        {templates.length > 0 && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isAllSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm text-muted-foreground">{t('common.selectAll')}</span>
          </label>
        )}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('templates.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button variant="destructive" onClick={() => setShowBatchDeleteDialog(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t('templates.deleteSelected', { count: selectedIds.size })}
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            {t('templates.import')}
          </Button>
          <Button variant="outline" onClick={handleExportAll} disabled={templates.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            {t('templates.exportAll')}
          </Button>
          <Button onClick={handleCreateNew}>
            <Plus className="mr-2 h-4 w-4" />
            {t('templates.newTemplate')}
          </Button>
        </div>
      </div>

      {/* Templates List */}
      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <FolderOpen className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2">{t('templates.noTemplates')}</h3>
              <p className="mb-4">
                {t('templates.noTemplatesDesc')}
              </p>
              <Button onClick={handleCreateNew}>
                <Plus className="mr-2 h-4 w-4" />
                {t('templates.goToPlayground')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : modelIds.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Search className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2">{t('templates.noResults')}</h3>
              <p>{t('templates.noResultsDesc')}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {modelIds.map((modelId) => {
            const group = groupedTemplates[modelId]
            return (
              <Card key={modelId}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">{group.modelName}</CardTitle>
                  <CardDescription>
                    {t('templates.templateCount', { count: group.templates.length })}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {group.templates.map((template) => (
                      <div
                        key={template.id}
                        className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(template.id)}
                            onChange={() => toggleSelection(template.id)}
                            className="h-4 w-4 rounded border-gray-300 shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{template.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {t('templates.lastUpdated')}: {new Date(template.updatedAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-4">
                          <Button
                            size="sm"
                            onClick={() => handleUseTemplate(template)}
                          >
                            <Play className="mr-1 h-3 w-3" />
                            {t('templates.use')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleEditTemplate(template)}
                            title={t('templates.rename')}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleExportSingle(template)}
                            title={t('templates.export')}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeletingTemplate(template)}
                            title={t('common.delete')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('templates.renameTemplate')}</DialogTitle>
            <DialogDescription>
              {t('templates.renameDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editTemplateName">{t('templates.templateName')}</Label>
              <Input
                id="editTemplateName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t('templates.templateNamePlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && editName.trim()) {
                    handleSaveEdit()
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTemplate(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSaveEdit} disabled={!editName.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
      <Dialog open={!!importData} onOpenChange={(open) => !open && setImportData(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('templates.importTemplates')}</DialogTitle>
            <DialogDescription>
              {t('templates.foundTemplates', { count: importData?.templates.length || 0 })}
              {importData?.exportedAt && (
                <span className="block mt-1 text-xs">
                  {t('templates.exportedOn', { date: new Date(importData.exportedAt).toLocaleString() })}
                </span>
              )}
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
            <Button variant="outline" onClick={() => setImportData(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleImportConfirm}>
              <Upload className="mr-2 h-4 w-4" />
              {t('templates.import')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Delete Confirmation Dialog */}
      <Dialog open={showBatchDeleteDialog} onOpenChange={setShowBatchDeleteDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('templates.deleteTemplates')}</DialogTitle>
            <DialogDescription>
              {t('templates.batchDeleteConfirm', { count: selectedIds.size })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatchDeleteDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleBatchDelete}>
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
