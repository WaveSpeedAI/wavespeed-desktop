import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/useToast'
import { Search, FolderOpen, Play, Trash2, Pencil, MoreVertical, Plus, Download, Upload } from 'lucide-react'
import { fuzzyMatch } from '@/lib/fuzzySearch'

export function TemplatesPage() {
  const navigate = useNavigate()
  const { templates, loadTemplates, updateTemplate, deleteTemplate, exportTemplates, importTemplates, isLoaded } = useTemplateStore()
  const [searchQuery, setSearchQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Edit dialog state
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [editName, setEditName] = useState('')

  // Delete confirmation state
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null)

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
        title: 'No templates to export',
        description: 'Create some templates first',
        variant: 'destructive',
      })
      return
    }

    const data = exportTemplates()
    downloadJson(data, 'wavespeed-templates.json')
    toast({
      title: 'Templates exported',
      description: `Exported ${templates.length} template(s)`,
    })
  }

  // Export single template
  const handleExportSingle = (template: Template) => {
    const data = exportTemplates([template.id])
    const fileName = `${template.name.toLowerCase().replace(/\s+/g, '-')}.json`
    downloadJson(data, fileName)
    toast({
      title: 'Template exported',
      description: `Exported "${template.name}"`,
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
          title: 'Invalid file',
          description: 'The selected file is not a valid templates export',
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
      toast({
        title: 'Templates imported',
        description: `Imported ${result.imported} template(s)${result.skipped > 0 ? `, ${result.skipped} skipped (duplicates)` : ''}`,
      })
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Unknown error',
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

  const modelIds = Object.keys(groupedTemplates)

  return (
    <div className="container py-8">
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-2xl font-bold">Templates</h1>
        <p className="text-muted-foreground text-sm">Manage your saved playground configurations</p>
      </div>

      {/* Search and Actions */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
          <Button variant="outline" onClick={handleExportAll} disabled={templates.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export All
          </Button>
          <Button onClick={handleCreateNew}>
            <Plus className="mr-2 h-4 w-4" />
            New Template
          </Button>
        </div>
      </div>

      {/* Templates List */}
      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <FolderOpen className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2">No templates yet</h3>
              <p className="mb-4">
                Save your playground configurations as templates for quick reuse
              </p>
              <Button onClick={handleCreateNew}>
                <Plus className="mr-2 h-4 w-4" />
                Go to Playground
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : modelIds.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Search className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2">No results found</h3>
              <p>Try a different search term</p>
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
                    {group.templates.length} template{group.templates.length !== 1 ? 's' : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {group.templates.map((template) => (
                      <div
                        key={template.id}
                        className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{template.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Last updated: {new Date(template.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <Button
                            size="sm"
                            onClick={() => handleUseTemplate(template)}
                          >
                            <Play className="mr-1 h-3 w-3" />
                            Use
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEditTemplate(template)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleExportSingle(template)}>
                                <Download className="mr-2 h-4 w-4" />
                                Export
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeletingTemplate(template)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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
            <DialogTitle>Rename Template</DialogTitle>
            <DialogDescription>
              Enter a new name for this template
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editTemplateName">Template Name</Label>
              <Input
                id="editTemplateName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="My template"
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
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={!editName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deletingTemplate} onOpenChange={(open) => !open && setDeletingTemplate(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Template</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deletingTemplate?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingTemplate(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteTemplate}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={!!importData} onOpenChange={(open) => !open && setImportData(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import Templates</DialogTitle>
            <DialogDescription>
              Found {importData?.templates.length || 0} template(s) to import.
              {importData?.exportedAt && (
                <span className="block mt-1 text-xs">
                  Exported on {new Date(importData.exportedAt).toLocaleString()}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <Label>Import Mode</Label>
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
                    <div className="font-medium">Merge</div>
                    <div className="text-sm text-muted-foreground">
                      Add imported templates, skip duplicates (same name + model)
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
                    <div className="font-medium">Replace All</div>
                    <div className="text-sm text-muted-foreground">
                      Delete existing templates and replace with imported ones
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportData(null)}>
              Cancel
            </Button>
            <Button onClick={handleImportConfirm}>
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
