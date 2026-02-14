import * as templateRepo from '../db/template.repo'

const TEMPLATES_STORAGE_KEY = 'wavespeed_templates'
const MIGRATION_FLAG_KEY = 'wavespeed_templates_migrated'

interface LegacyTemplate {
  id: string
  name: string
  modelId: string
  modelName: string
  values: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export async function migrateTemplatesFromLocalStorage(): Promise<{ migrated: number; skipped: number }> {
  // Note: This function runs in main process, so we can't access localStorage directly
  // Migration will be triggered from renderer process via IPC
  console.log('[Template Migration] Migration should be triggered from renderer process')
  return { migrated: 0, skipped: 0 }
}

export function migrateTemplatesSync(legacyTemplatesJson: string, migrationComplete: boolean): { migrated: number; skipped: number } {
  if (migrationComplete) {
    console.log('[Template Migration] Already completed, skipping')
    return { migrated: 0, skipped: 0 }
  }
  
  let migrated = 0
  let skipped = 0
  
  try {
    if (!legacyTemplatesJson) {
      console.log('[Template Migration] No legacy templates found')
      return { migrated: 0, skipped: 0 }
    }
    
    const legacyTemplates: LegacyTemplate[] = JSON.parse(legacyTemplatesJson)
    console.log(`[Template Migration] Found ${legacyTemplates.length} legacy templates`)
    
    // Migrate each template
    for (const legacy of legacyTemplates) {
      try {
        templateRepo.createTemplate({
          name: legacy.name,
          description: null,
          tags: [],
          type: 'custom',
          templateType: 'playground',
          author: null,
          thumbnail: null,
          playgroundData: {
            modelId: legacy.modelId,
            modelName: legacy.modelName,
            values: legacy.values
          },
          workflowData: null
        })
        migrated++
      } catch (error) {
        console.error(`[Template Migration] Failed to migrate template ${legacy.id}:`, error)
        skipped++
      }
    }
    
    console.log(`[Template Migration] Complete: ${migrated} migrated, ${skipped} skipped`)
    
  } catch (error) {
    console.error('[Template Migration] Migration failed:', error)
    throw error
  }
  
  return { migrated, skipped }
}
