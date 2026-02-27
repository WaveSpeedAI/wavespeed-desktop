import { ipcMain } from 'electron'
import * as templateRepo from '../db/template.repo'
import { migrateTemplatesSync } from '../services/template-migration'
import { getFileTemplates, getFileTemplateById } from '../services/template-init'
import type { 
  Template, 
  TemplateFilter, 
  CreateTemplateInput,
  TemplateExport 
} from '../../../src/types/template'

export function registerTemplateIpc(): void {
  ipcMain.handle('template:migrate', async (_event, args: { legacyTemplatesJson: string; migrationComplete: boolean }) => {
    return migrateTemplatesSync(args.legacyTemplatesJson, args.migrationComplete)
  })
  
  ipcMain.handle('template:create', async (_event, input: CreateTemplateInput): Promise<Template> => {
    validateCreateInput(input)
    return templateRepo.createTemplate(input)
  })
  
  ipcMain.handle('template:get', async (_event, args: { id: string }): Promise<Template | null> => {
    // Check file templates first, then database
    return getFileTemplateById(args.id) || templateRepo.getTemplateById(args.id)
  })
  
  ipcMain.handle('template:query', async (_event, filter?: TemplateFilter): Promise<Template[]> => {
    const dbTemplates = templateRepo.queryTemplates(filter)
    const fileTemps = getFileTemplates(filter)
    // Deduplicate: file templates take priority over DB templates with the same name
    const fileNames = new Set(fileTemps.map(t => t.name))
    const dedupedDb = dbTemplates.filter(t => !fileNames.has(t.name))
    return [...fileTemps, ...dedupedDb]
  })
  
  ipcMain.handle('template:update', async (_event, args: { id: string; updates: Partial<Template> }): Promise<void> => {
    return templateRepo.updateTemplate(args.id, args.updates)
  })
  
  ipcMain.handle('template:toggleFavorite', async (_event, args: { id: string }): Promise<boolean> => {
    return templateRepo.toggleFavorite(args.id)
  })
  
  ipcMain.handle('template:incrementUseCount', async (_event, args: { id: string }): Promise<void> => {
    return templateRepo.incrementUseCount(args.id)
  })
  
  ipcMain.handle('template:delete', async (_event, args: { id: string }): Promise<void> => {
    if (args.id.startsWith('file-')) return // file templates cannot be deleted
    return templateRepo.deleteTemplate(args.id)
  })
  
  ipcMain.handle('template:deleteMany', async (_event, args: { ids: string[] }): Promise<void> => {
    const deletable = args.ids.filter(id => !id.startsWith('file-'))
    if (deletable.length === 0) return
    return templateRepo.deleteTemplates(deletable)
  })
  
  ipcMain.handle('template:export', async (_event, args: { ids?: string[] }): Promise<TemplateExport> => {
    const templates = args.ids 
      ? args.ids.map(id => templateRepo.getTemplateById(id)).filter(Boolean) as Template[]
      : templateRepo.queryTemplates()
    
    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      templates
    }
  })
  
  ipcMain.handle('template:import', async (_event, args: { data: TemplateExport; mode: 'merge' | 'replace' }): Promise<{ imported: number; skipped: number }> => {
    validateImportData(args.data)
    
    if (args.mode === 'replace') {
      const existing = templateRepo.queryTemplates({ type: 'custom' })
      templateRepo.deleteTemplates(existing.map(t => t.id))
    }
    
    let imported = 0
    let skipped = 0
    
    const existingKeys = new Set(
      templateRepo.queryTemplates().map(t => `${t.templateType}:${t.name}`)
    )
    
    for (const template of args.data.templates) {
      const key = `${template.templateType}:${template.name}`
      if (args.mode === 'merge' && existingKeys.has(key)) {
        skipped++
      } else {
        templateRepo.createTemplate({
          name: template.name,
          description: template.description,
          tags: template.tags,
          type: 'custom',
          templateType: template.templateType,
          author: template.author,
          thumbnail: template.thumbnail,
          playgroundData: template.playgroundData,
          workflowData: template.workflowData
        })
        imported++
      }
    }
    
    return { imported, skipped }
  })
}

function validateCreateInput(input: CreateTemplateInput): void {
  if (!input.name || input.name.trim() === '') {
    throw new Error('Template name is required')
  }
  
  if (!['playground', 'workflow'].includes(input.templateType)) {
    throw new Error('Invalid templateType')
  }
  
  if (!['public', 'custom'].includes(input.type)) {
    throw new Error('Invalid type')
  }
  
  if (input.templateType === 'playground' && !input.playgroundData) {
    throw new Error('playgroundData is required for playground templates')
  }
  
  if (input.templateType === 'workflow' && !input.workflowData) {
    throw new Error('workflowData is required for workflow templates')
  }
  
  if (input.tags && !Array.isArray(input.tags)) {
    throw new Error('tags must be an array')
  }
}

function validateImportData(data: TemplateExport): void {
  if (!data.templates || !Array.isArray(data.templates)) {
    throw new Error('Invalid import data: missing templates array')
  }
  
  if (!data.version) {
    throw new Error('Invalid import data: missing version')
  }
}
