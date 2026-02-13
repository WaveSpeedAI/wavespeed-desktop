/**
 * Settings panel — model refresh only.
 * API keys are managed via Desktop's main Settings page.
 */
import { modelsIpc } from '../../ipc/ipc-client'
import { useModelsStore } from '@/stores/modelsStore'
import { Button } from '@/components/ui/button'

export function SettingsPanel() {
  const models = useModelsStore(s => s.models)
  const isLoading = useModelsStore(s => s.isLoading)
  const error = useModelsStore(s => s.error)
  const hasFetched = useModelsStore(s => s.hasFetched)
  const fetchModels = useModelsStore(s => s.fetchModels)

  const handleRefreshModels = async () => {
    try {
      await fetchModels(true)
      const latestModels = useModelsStore.getState().models
      if (latestModels.length > 0) {
        await modelsIpc.sync(latestModels)
      }
    } catch (err) {
      console.error('Model refresh failed:', err)
    }
  }

  return (
    <div className="p-3">
      <h3 className="text-sm font-semibold mb-3">Settings</h3>

      {/* Model Catalog */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold">Model Catalog</h4>
          {hasFetched && <span className="text-[10px] text-muted-foreground">{models.length} models</span>}
        </div>
        <Button variant="outline" size="sm" onClick={handleRefreshModels} disabled={isLoading} className="w-full">
          {isLoading ? 'Loading...' : 'Refresh Models'}
        </Button>
        {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
        {hasFetched && !error && (
          <div className="mt-2 text-[10px] text-green-400">{models.length} models loaded and synced</div>
        )}
        <div className="mt-1.5 text-[10px] text-muted-foreground leading-relaxed">
          Shared with Models page and Playground. API keys are managed in the main Settings page.
        </div>
      </div>
    </div>
  )
}
