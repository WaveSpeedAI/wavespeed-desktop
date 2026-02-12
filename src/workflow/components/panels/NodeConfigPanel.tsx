/**
 * Node configuration panel — model selection for AI Task nodes.
 * Includes recent models list (Opt 24).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowStore } from '../../stores/workflow.store'
import { useExecutionStore } from '../../stores/execution.store'
import { useUIStore } from '../../stores/ui.store'
import { modelsIpc } from '../../ipc/ipc-client'
import { useModelsStore } from '@/stores/modelsStore'
import { Input } from '@/components/ui/input'
import type { ParamDefinition, WaveSpeedModel } from '@/workflow/types/node-defs'
import { fuzzySearch } from '@/lib/fuzzySearch'

/* ── Category color mapping ─────────────────────────────────────────── */

function getCategoryColor(cat: string): { idle: string; active: string } {
  const c = cat.toLowerCase()
  // Image-related: blue
  if (c.includes('image') || c === 'ai-remover' || c === 'upscaler' || c === 'portrait-transfer')
    return { idle: 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25', active: 'bg-blue-500 text-white' }
  // Video-related: purple
  if (c.includes('video'))
    return { idle: 'bg-purple-500/15 text-purple-400 hover:bg-purple-500/25', active: 'bg-purple-500 text-white' }
  // Audio-related: amber
  if (c.includes('audio') || c.includes('speech') || c === 'video-dubbing')
    return { idle: 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25', active: 'bg-amber-500 text-white' }
  // 3D-related: cyan
  if (c.includes('3d') || c === 'digital-human')
    return { idle: 'bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25', active: 'bg-cyan-500 text-white' }
  // Text/LLM: green
  if (c.includes('text') || c === 'llm' || c === 'content-moderation')
    return { idle: 'bg-green-500/15 text-green-400 hover:bg-green-500/25', active: 'bg-green-500 text-white' }
  // Training/LoRA: rose
  if (c === 'lora-support' || c === 'training' || c === 'motion-control')
    return { idle: 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25', active: 'bg-rose-500 text-white' }
  // All / default
  if (c === 'all')
    return { idle: 'bg-[hsl(var(--muted))] text-muted-foreground hover:text-foreground hover:bg-accent', active: 'bg-primary text-primary-foreground' }
  // Fallback
  return { idle: 'bg-[hsl(var(--muted))] text-muted-foreground hover:bg-accent', active: 'bg-primary text-primary-foreground' }
}

/* ── Recent models localStorage helper (Opt 24) ────────────────────── */

const RECENT_KEY = 'wavespeed_workflow_recent_models'
const MAX_RECENT = 5

function getRecentModels(): Array<{ modelId: string; displayName: string; category: string }> {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  } catch { return [] }
}

function pushRecentModel(model: WaveSpeedModel) {
  const recent = getRecentModels().filter(m => m.modelId !== model.modelId)
  recent.unshift({ modelId: model.modelId, displayName: model.displayName, category: model.category })
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)))
}

/* ── Main panel ─────────────────────────────────────────────────────── */

interface NodeConfigPanelProps {
  paramDefs: ParamDefinition[]
}

export function NodeConfigPanel({ paramDefs }: NodeConfigPanelProps) {
  const { t } = useTranslation()
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const nodes = useWorkflowStore(s => s.nodes)
  const updateNodeParams = useWorkflowStore(s => s.updateNodeParams)

  const node = nodes.find(n => n.id === selectedNodeId)
  if (!node || !selectedNodeId) {
    return <div className="p-3 text-muted-foreground text-sm">{t('workflow.selectNode', 'Select a node to configure')}</div>
  }

  // Annotation nodes
  if (node.data.nodeType === 'annotation') {
    return <div className="p-3 text-muted-foreground text-sm">{t('workflow.annotationHint', 'Double-click the note on the canvas to edit it.')}</div>
  }

  const isAITask = node.data.nodeType === 'ai-task/run'
  const params = node.data.params ?? {}
  const handleChange = (key: string, value: unknown) => updateNodeParams(selectedNodeId, { ...params, [key]: value })

  return (
    <div className="p-3 overflow-hidden w-full min-w-0">
      <h3 className="text-sm font-semibold mb-3">
        {isAITask ? t('workflow.modelSelection', 'Model Selection') : t('workflow.config', 'Configuration')}
      </h3>
      {isAITask ? (
        <AITaskModelSelector params={params} onChange={handleChange} />
      ) : (
        <StaticParamForm nodeType={node.data.nodeType} paramDefs={paramDefs} params={params} onChange={handleChange} />
      )}
    </div>
  )
}

/* ── AI Task Model Selector ─────────────────────────────────────────── */

function AITaskModelSelector({ params, onChange }: { params: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
  const { t } = useTranslation()
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const updateNodeData = useWorkflowStore(s => s.updateNodeData)
  const [searchQuery, setSearchQuery] = useState('')
  const [models, setModels] = useState<WaveSpeedModel[]>([])
  const [selectedModel, setSelectedModel] = useState<WaveSpeedModel | null>(null)
  const allCategoryLabel = t('workflow.modelSelector.allCategory', 'All')
  const [selectedCategory, setSelectedCategory] = useState(allCategoryLabel)
  const [loading, setLoading] = useState(true)
  const [refreshingCatalog, setRefreshingCatalog] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recentModels, setRecentModels] = useState(getRecentModels())
  const currentModelId = String(params.modelId ?? '')
  const fetchModels = useModelsStore(s => s.fetchModels)
  const hasSearchQuery = searchQuery.trim().length > 0

  const loadModelsFromRegistry = useCallback(async () => {
    const m = await modelsIpc.list()
    setModels(m ?? [])
    if (currentModelId) {
      const found = (m ?? []).find(model => model.modelId === currentModelId)
      if (found) setSelectedModel(found)
    }
    if (!m || m.length === 0) setError(t('workflow.modelSelector.noModelsLoaded', 'No models loaded. Click "Refresh Models" below.'))
  }, [currentModelId])

  // Load models with retry — first attempt may be empty if sync is still in progress
  useEffect(() => {
    let retryCount = 0
    let cancelled = false

    const tryLoad = () => {
      setLoading(true); setError(null)
      modelsIpc.list().then(m => {
        if (cancelled) return
        if ((!m || m.length === 0) && retryCount < 3) {
          // Sync may still be in progress — retry after a short delay
          retryCount++
          setTimeout(tryLoad, 1500)
          return
        }
        setModels(m ?? []); setLoading(false)
        if (currentModelId) {
          const found = (m ?? []).find(model => model.modelId === currentModelId)
          if (found) setSelectedModel(found)
        }
        if (!m || m.length === 0) setError(t('workflow.modelSelector.noModelsLoaded', 'No models loaded. Click "Refresh Models" below.'))
      }).catch(() => {
        if (cancelled) return
        if (retryCount < 3) { retryCount++; setTimeout(tryLoad, 1500); return }
        setError(t('workflow.modelSelector.loadFailed', 'Failed to load models.')); setLoading(false)
      })
    }
    tryLoad()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentModelId])

  const handleRefreshModels = useCallback(async () => {
    try {
      setRefreshingCatalog(true)
      setError(null)
      await fetchModels(true)
      const latestModels = useModelsStore.getState().models
      if (latestModels.length > 0) {
        await modelsIpc.sync(latestModels)
      }
      await loadModelsFromRegistry()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workflow.modelSelector.refreshFailed', 'Failed to refresh models.'))
    } finally {
      setRefreshingCatalog(false)
    }
  }, [fetchModels, loadModelsFromRegistry, t])

  const categoryFilteredModels = useMemo(() => {
    if (selectedCategory === allCategoryLabel) return models
    return models.filter(m => m.category === selectedCategory)
  }, [models, selectedCategory, allCategoryLabel])

  const fzfResults = useMemo(() => {
    const q = searchQuery.trim()
    if (!q) return []
    return fuzzySearch(models, q, (m) => [
      m.displayName,
      m.modelId,
      m.category,
      m.provider
    ]).map(r => r.item)
  }, [models, searchQuery])

  const displayResults = hasSearchQuery ? fzfResults : categoryFilteredModels

  const edges = useWorkflowStore(s => s.edges)
  const removeEdgesByIds = useWorkflowStore(s => s.removeEdgesByIds)
  const [switchBlockedMsg, setSwitchBlockedMsg] = useState(false)

  const handleSelectModel = useCallback((model: WaveSpeedModel) => {
    // Smart edge pruning: keep edges whose param name exists in the new model, remove the rest
    if (selectedNodeId && currentModelId) {
      const newParamNames = new Set(model.inputSchema.map(p => p.name))
      const edgesToRemove = edges.filter(e => {
        // Output edges (this node is source): always keep
        if (e.source === selectedNodeId) return false
        // Input edges (this node is target)
        if (e.target === selectedNodeId) {
          const th = e.targetHandle ?? ''
          // Static input handles (input-xxx): always keep
          if (th.startsWith('input-')) return false
          // Model param handles (param-xxx): keep if new model has the same param name
          if (th.startsWith('param-')) {
            const paramName = th.slice('param-'.length)
            return !newParamNames.has(paramName)
          }
        }
        return false
      })
      if (edgesToRemove.length > 0) {
        removeEdgesByIds(edgesToRemove.map(e => e.id))
      }
    }

    setSelectedModel(model); setSearchQuery('')

    if (selectedNodeId) {
      // Build fresh params: only keep internal __ keys, set new model defaults
      const oldParams = useWorkflowStore.getState().nodes.find(n => n.id === selectedNodeId)?.data?.params as Record<string, unknown> ?? {}
      const internalParams: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(oldParams)) {
        if (k.startsWith('__')) internalParams[k] = v
      }
      // Remove old hidden runs since they belong to old model's results
      delete internalParams.__hiddenRuns

      // Set defaults from new model schema
      const newParams: Record<string, unknown> = { ...internalParams, modelId: model.modelId }
      for (const p of model.inputSchema) {
        if (p.default !== undefined) newParams[p.name] = p.default
      }

      // Update node: new schema + clean params
      useWorkflowStore.getState().updateNodeParams(selectedNodeId, newParams)

      // Auto-deduplicate label when multiple nodes use the same model
      const allNodes = useWorkflowStore.getState().nodes
      const baseName = model.displayName
      const otherLabels = allNodes
        .filter(n => n.id !== selectedNodeId && n.data?.nodeType === 'ai-task/run')
        .map(n => String(n.data?.label ?? ''))
      let finalLabel = `🤖 ${baseName}`
      if (otherLabels.includes(finalLabel)) {
        let idx = 2
        while (otherLabels.includes(`🤖 ${baseName} (${idx})`)) idx++
        finalLabel = `🤖 ${baseName} (${idx})`
      }

      updateNodeData(selectedNodeId, {
        modelInputSchema: model.inputSchema,
        label: finalLabel
      })

      // Clear results and status for this node
      const execStore = useExecutionStore.getState()
      execStore.updateNodeStatus(selectedNodeId, 'idle')
      // Remove cached results for this node
      useExecutionStore.setState(s => {
        const newResults = { ...s.lastResults }
        delete newResults[selectedNodeId]
        const newFetched = new Set(s._fetchedNodes)
        newFetched.delete(selectedNodeId)
        return { lastResults: newResults, _fetchedNodes: newFetched }
      })
    }

    onChange('modelId', model.modelId)
    pushRecentModel(model)
    setRecentModels(getRecentModels())
  }, [onChange, selectedNodeId, updateNodeData, edges, currentModelId, removeEdgesByIds])

  // Opt 24: Resolve recent model IDs to full objects
  const resolvedRecent = useMemo(() => {
    if (models.length === 0) return recentModels.map(r => ({ ...r, costPerRun: undefined as number | undefined }))
    return recentModels.map(r => {
      const full = models.find(m => m.modelId === r.modelId)
      return full ? { ...r, displayName: full.displayName, category: full.category, costPerRun: full.costPerRun } : { ...r, costPerRun: undefined as number | undefined }
    })
  }, [recentModels, models])

  const resolvedSelectedModel = useMemo(() => {
    if (selectedModel) return selectedModel
    if (!currentModelId) return null
    return models.find(m => m.modelId === currentModelId) ?? null
  }, [selectedModel, models, currentModelId])

  const categories = useMemo(() => [allCategoryLabel, ...[...new Set(models.map(m => m.category))].sort()], [models, allCategoryLabel])

  useEffect(() => {
    if (!categories.includes(selectedCategory)) {
      setSelectedCategory(allCategoryLabel)
    }
  }, [categories, selectedCategory, allCategoryLabel])

  // Full loading state — show a proper skeleton/placeholder while models load
  if (loading && models.length === 0) {
    return (
      <div className="overflow-hidden min-w-0">
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          <div className="text-xs text-muted-foreground">{t('workflow.modelSelector.loadingModels', 'Loading models...')}</div>
          <div className="text-[10px] text-muted-foreground/60">{t('workflow.modelSelector.loadingHint', 'This may take a few seconds on first launch')}</div>
        </div>
        {/* Still show recent models while loading — they're from localStorage */}
        {resolvedRecent.length > 0 && (
          <div className="px-1">
            <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1 px-1">
              {t('workflow.modelSelector.recent', 'Recent')}
            </div>
            {resolvedRecent.map(r => (
              <div key={r.modelId} className="p-1.5 rounded-md text-xs border border-transparent opacity-50">
                <div className="font-medium truncate">{r.displayName}</div>
                <div className="text-muted-foreground text-[10px] truncate">{r.category}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="overflow-hidden min-w-0 w-full">
      {error && <div className="text-destructive text-xs p-2 mb-3 rounded border border-destructive bg-destructive/10">{error}</div>}

      {/* Top-level model search */}
      <div className="flex items-center gap-1.5 mb-2">
        <div className="relative flex-1 min-w-0">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <Input
            placeholder={t('workflow.modelSelector.searchAllPlaceholder', 'Search all models...')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-8 text-xs pl-8"
          />
        </div>
        <button
          onClick={handleRefreshModels}
          disabled={loading || refreshingCatalog}
          className="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded-md border border-[hsl(var(--border))] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={refreshingCatalog ? t('workflow.modelSelector.refreshing', 'Refreshing...') : t('workflow.refreshModels', 'Refresh Models')}
        >
          <svg className={refreshingCatalog ? 'animate-spin' : ''} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/><path d="M2 11.5a10 10 0 0 1 18.8-4.3"/><path d="M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
        </button>
      </div>

      {/* Currently selected model */}
      {(resolvedSelectedModel || currentModelId) && (
        <div className="p-2 rounded-md border border-border bg-muted/50 mb-3 overflow-hidden">
          <div className="text-[10px] text-muted-foreground mb-0.5">{t('workflow.currentModel', 'Current model')}</div>
          <div className="font-semibold text-xs truncate">
            {resolvedSelectedModel?.displayName ?? currentModelId}
          </div>
          {(resolvedSelectedModel || currentModelId) && (
            <div className="text-[10px] text-muted-foreground truncate">
              {resolvedSelectedModel ? `${resolvedSelectedModel.category} · ${resolvedSelectedModel.provider}` : currentModelId}
            </div>
          )}
        </div>
      )}

      {/* Recent models */}
      {!hasSearchQuery && resolvedRecent.length > 0 && (
        <div className="mb-2">
          <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1 px-1">
            {t('workflow.modelSelector.recent', 'Recent')}
          </div>
          {resolvedRecent.map(r => (
            <div key={r.modelId}
              onClick={() => { const full = models.find(m => m.modelId === r.modelId); if (full) handleSelectModel(full) }}
              className={`p-1.5 rounded-md cursor-pointer text-xs hover:bg-accent overflow-hidden
                ${selectedModel?.modelId === r.modelId ? 'bg-primary/10 border border-primary/30' : 'border border-transparent'}`}>
              <div className="font-medium truncate">{r.displayName}</div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-[10px] truncate">{r.category}</span>
                {r.costPerRun != null && <span className="text-[10px] text-blue-600 dark:text-blue-400 flex-shrink-0">${r.costPerRun.toFixed(4)}</span>}
              </div>
            </div>
          ))}
          <div className="border-b border-border mt-2 mb-2" />
        </div>
      )}

      {/* Category tags — color-coded by type */}
      {!hasSearchQuery && (
        <>
          <div className="mb-2 pb-1 max-h-[140px] overflow-y-auto scrollbar-auto-hide">
            <div className="flex gap-1 flex-wrap pr-1">
              {categories.map(cat => {
                const colors = getCategoryColor(cat)
                return (
                  <button key={cat} onClick={() => setSelectedCategory(cat)}
                    className={`px-2 py-0.5 rounded-full text-[10px] whitespace-nowrap transition-colors font-medium
                      ${selectedCategory === cat ? colors.active : colors.idle}`}>
                    {cat}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="border-b border-border mb-2" />
        </>
      )}

      {/* Model list */}
      <div className="h-[260px] overflow-y-auto overflow-x-hidden scrollbar-auto-hide">
        {loading && <div className="text-[10px] text-blue-400 animate-pulse px-2 py-1">{t('workflow.modelSelector.refreshing', 'Refreshing...')}</div>}
        {displayResults.slice(0, 50).map(model => (
          <div key={model.modelId} onClick={() => handleSelectModel(model)}
            title={model.displayName}
            className={`p-2 rounded-md cursor-pointer text-xs transition-colors mb-0.5 overflow-hidden
              ${resolvedSelectedModel?.modelId === model.modelId
                ? 'bg-primary/10 border border-primary/40'
                : 'border border-transparent hover:bg-accent'}`}>
            <div className="font-medium truncate">{model.displayName}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-muted-foreground truncate">{model.category}</span>
              {model.costPerRun != null && <span className="text-[10px] text-blue-600 dark:text-blue-400 flex-shrink-0">${model.costPerRun.toFixed(4)}</span>}
            </div>
          </div>
        ))}
        {!loading && displayResults.length === 0 && (
          <div className="text-muted-foreground text-xs p-4 text-center">
            {hasSearchQuery ? t('workflow.modelSelector.noModelsFound', 'No models found') : t('workflow.modelSelector.selectCategory', 'Select a category')}
          </div>
        )}
      </div>

      {/* Switch blocked dialog */}
      {switchBlockedMsg && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => setSwitchBlockedMsg(false)}>
          <div className="w-[360px] rounded-xl border border-border bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">⚠️</span>
              <h3 className="text-sm font-semibold">{t('workflow.modelSelector.cannotSwitchTitle', 'Cannot Switch Model')}</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              {t(
                'workflow.modelSelector.cannotSwitchDesc',
                'This node has active connections. Please disconnect all edges before switching models, as the parameter schema will change and existing connections may become invalid.'
              )}
            </p>
            <div className="flex justify-end">
              <button onClick={() => setSwitchBlockedMsg(false)}
                className="px-4 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                {t('common.ok', 'OK')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Static Param Form (non-AI nodes) ───────────────────────────────── */

function StaticParamForm({ nodeType, paramDefs, params, onChange }: { nodeType: string; paramDefs: ParamDefinition[]; params: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
  const { t } = useTranslation()
  const cls = 'w-full rounded border border-input bg-background px-2 py-1.5 text-xs'
  return (
    <>
      {paramDefs.map(def => (
        <div key={def.key} className="mb-2.5">
          <label className="block text-xs text-muted-foreground mb-1">
            {t(`workflow.nodeDefs.${nodeType}.params.${def.key}.label`, def.label)}
          </label>
          {def.type === 'select' ? (
            <select value={String(params[def.key] ?? def.default ?? '')} onChange={e => onChange(def.key, e.target.value)} className={cls}>
              {def.options?.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {t(`workflow.nodeDefs.${nodeType}.params.${def.key}.options.${opt.value}`, opt.label)}
                </option>
              ))}
            </select>
          ) : def.type === 'boolean' ? (
            <input type="checkbox" checked={Boolean(params[def.key] ?? def.default)} onChange={e => onChange(def.key, e.target.checked)} />
          ) : def.type === 'number' || def.type === 'slider' ? (
            <input type="number" value={Number(params[def.key] ?? def.default ?? 0)} min={def.validation?.min} max={def.validation?.max}
              step={def.validation?.step} onChange={e => onChange(def.key, Number(e.target.value))} className={cls} />
          ) : def.type === 'textarea' ? (
            <textarea value={String(params[def.key] ?? def.default ?? '')} onChange={e => onChange(def.key, e.target.value)} className={`${cls} min-h-[60px] resize-y`} />
          ) : (
            <input type="text" value={String(params[def.key] ?? def.default ?? '')} onChange={e => onChange(def.key, e.target.value)} className={cls} />
          )}
        </div>
      ))}
    </>
  )
}
