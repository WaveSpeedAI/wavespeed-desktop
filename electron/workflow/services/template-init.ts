/**
 * Template initialization service — loads default templates from files into memory.
 * File-based templates are NOT written to the database.
 */
import { v4 as uuid } from 'uuid'
import type { Template, TemplateFilter } from '../../../src/types/template'
import { loadTemplatesFromFiles } from './template-loader'
import * as templateRepo from '../db/template.repo'

let fileTemplates: Template[] = []

/**
 * Load file templates into memory (called once at startup)
 */
export function initializeDefaultTemplates(): void {
  try {
    const inputs = loadTemplatesFromFiles()
    const now = new Date().toISOString()

    fileTemplates = inputs.map(input => ({
      id: `file-${uuid()}`,
      name: input.name,
      i18nKey: input.i18nKey || undefined,
      _searchText: input._searchText || '',
      description: input.description || null,
      tags: input.tags || [],
      type: 'public' as const,
      templateType: 'workflow' as const,
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
      author: input.author || 'WaveSpeed',
      useCount: 0,
      thumbnail: input.thumbnail || null,
      playgroundData: null,
      workflowData: input.workflowData || null
    }))

    console.log(`[TemplateInit] Loaded ${fileTemplates.length} file templates into memory`)

    // One-time cleanup: remove old public templates from DB that now exist as file templates
    cleanupOldPublicTemplates()
  } catch (error) {
    console.error('[TemplateInit] Failed to load file templates:', error)
  }
}

/**
 * Remove old public templates from DB whose names match file-based templates.
 * This cleans up duplicates from the previous approach that wrote templates to DB.
 */
function cleanupOldPublicTemplates(): void {
  try {
    const fileNames = new Set(fileTemplates.map(t => t.name))
    const dbPublic = templateRepo.queryTemplates({ type: 'public', templateType: 'workflow' })
    const toDelete = dbPublic.filter(t => fileNames.has(t.name))
    if (toDelete.length > 0) {
      templateRepo.deleteTemplates(toDelete.map(t => t.id))
      console.log(`[TemplateInit] Cleaned up ${toDelete.length} old public templates from DB: [${toDelete.map(t => t.name).join(', ')}]`)
    }
  } catch (error) {
    console.error('[TemplateInit] Cleanup failed (non-fatal):', error)
  }
}

/**
 * Get all file-based templates, optionally filtered
 */
export function getFileTemplates(filter?: TemplateFilter): Template[] {
  let results = [...fileTemplates]

  if (filter?.templateType && filter.templateType !== 'workflow') {
    return []
  }

  if (filter?.type === 'custom') {
    return []
  }

  if (filter?.isFavorite) {
    return []
  }

  if (filter?.category) {
    results = results.filter(t => t.workflowData?.category === filter.category)
  }

  if (filter?.search) {
    const s = filter.search.toLowerCase()
    results = results.filter(t =>
      t.name.toLowerCase().includes(s) ||
      (t.description && t.description.toLowerCase().includes(s)) ||
      t.tags.some(tag => tag.toLowerCase().includes(s)) ||
      (t._searchText && t._searchText.toLowerCase().includes(s))
    )
  }

  return results
}

/**
 * Get a file template by ID
 */
export function getFileTemplateById(id: string): Template | null {
  return fileTemplates.find(t => t.id === id) || null
}
