import { nodeRegistry } from './registry'
import { mediaUploadDef, MediaUploadHandler } from './input/media-upload'
import { textInputDef, TextInputHandler } from './input/text-input'
import { aiTaskDef, AITaskHandler } from './ai-task/run'

export function registerAllNodes(): void {
  nodeRegistry.register(mediaUploadDef, new MediaUploadHandler())
  nodeRegistry.register(textInputDef, new TextInputHandler())
  nodeRegistry.register(aiTaskDef, new AITaskHandler())
  console.log(`[Registry] Registered ${nodeRegistry.getAll().length} node types`)
}
