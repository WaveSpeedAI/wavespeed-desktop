import { nodeRegistry } from './registry'
import { mediaUploadDef, MediaUploadHandler } from './input/media-upload'
import { aiTaskDef, AITaskHandler } from './ai-task/ai-task'

export function registerAllNodes(): void {
  nodeRegistry.register(mediaUploadDef, new MediaUploadHandler())
  nodeRegistry.register(aiTaskDef, new AITaskHandler())
  console.log(`[Registry] Registered ${nodeRegistry.getAll().length} node types`)
}
