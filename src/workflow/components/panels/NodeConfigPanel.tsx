/**
 * Node configuration panel — model selection for AI Task nodes.
 * Reuses the playground ModelSelector.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowStore } from '../../stores/workflow.store'
import { useExecutionStore } from '../../stores/execution.store'
import { useUIStore } from '../../stores/ui.store'
import { modelsIpc } from '../../ipc/ipc-client'
import { useModelsStore } from '@/stores/modelsStore'
import { convertDesktopModel } from '../../lib/model-converter'
import { ModelSelector } from '@/components/playground/ModelSelector'
import type { ParamDefinition, WaveSpeedModel } from '@/workflow/types/node-defs'

/* ── Recent models (localStorage) ──────────────────────────────────── */

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
  /** When true, render without title and with compact padding (e.g. inside node card) */
  embeddedInNode?: boolean
}

export function NodeConfigPanel({ paramDefs, embeddedInNode }: NodeConfigPanelProps) {
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
    <div className={embeddedInNode ? 'p-2 overflow-hidden w-full min-w-0 flex flex-col flex-1 min-h-0' : 'p-3 overflow-hidden w-full min-w-0 flex flex-col flex-1'}>
      {!embeddedInNode && (
        <h3 className="text-sm font-semibold mb-3 flex-shrink-0">
          {isAITask ? t('workflow.modelSelection', 'Model Selection') : t('workflow.config', 'Configuration')}
        </h3>
      )}
      {isAITask ? (
        <AITaskModelSelector params={params} onChange={handleChange} embedded={embeddedInNode} />
      ) : (
        <div className={embeddedInNode ? 'overflow-y-auto scrollbar-auto-hide max-h-[280px]' : 'flex-1 overflow-y-auto scrollbar-auto-hide'}>
          <StaticParamForm nodeType={node.data.nodeType} paramDefs={paramDefs} params={params} onChange={handleChange} />
        </div>
      )}
    </div>
  )
}

/* ── AI Task Model Selector ─────────────────────────────────────────── */

function AITaskModelSelector({ params, onChange, embedded }: { params: Record<string, unknown>; onChange: (key: string, value: unknown) => void; embedded?: boolean }) {
  const { t } = useTranslation()
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const updateNodeData = useWorkflowStore(s => s.updateNodeData)
  const edges = useWorkflowStore(s => s.edges)
  const removeEdgesByIds = useWorkflowStore(s => s.removeEdgesByIds)
  const currentModelId = String(params.modelId ?? '')
  const models = useModelsStore(s => s.models)
  const isLoading = useModelsStore(s => s.isLoading)
  const storeError = useModelsStore(s => s.error)
  const fetchModels = useModelsStore(s => s.fetchModels)
  const getModelById = useModelsStore(s => s.getModelById)
  const [refreshingCatalog, setRefreshingCatalog] = useState(false)
  const error = storeError
    ? (typeof storeError === 'string' ? storeError : t('workflow.modelSelector.loadFailed', 'Failed to load models.'))
    : (models.length === 0 && !isLoading ? t('workflow.modelSelector.noModelsLoaded', 'No models loaded. Click "Refresh Models" below.') : null)

  useEffect(() => {
    if (models.length === 0) fetchModels()
  }, [models.length, fetchModels])

  const handleRefreshModels = useCallback(async () => {
    try {
      setRefreshingCatalog(true)
      await fetchModels(true)
      const latestModels = useModelsStore.getState().models
      if (latestModels.length > 0 && typeof window !== 'undefined' && window.workflowAPI) {
        await modelsIpc.sync(latestModels)
      }
    } catch {
      // error comes from store
    } finally {
      setRefreshingCatalog(false)
    }
  }, [fetchModels])

  const applyModelSelection = useCallback((model: WaveSpeedModel) => {
    if (selectedNodeId && currentModelId) {
      const newParamNames = new Set(model.inputSchema.map(p => p.name))
      const edgesToRemove = edges.filter(e => {
        if (e.source === selectedNodeId) return false
        if (e.target === selectedNodeId) {
          const th = e.targetHandle ?? ''
          if (th.startsWith('input-')) return false
          if (th.startsWith('param-')) {
            const paramName = th.slice('param-'.length)
            return !newParamNames.has(paramName)
          }
        }
        return false
      })
      if (edgesToRemove.length > 0) removeEdgesByIds(edgesToRemove.map(e => e.id))
    }

    if (selectedNodeId) {
      const oldParams = useWorkflowStore.getState().nodes.find(n => n.id === selectedNodeId)?.data?.params as Record<string, unknown> ?? {}
      const internalParams: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(oldParams)) {
        if (k.startsWith('__')) internalParams[k] = v
      }
      delete internalParams.__hiddenRuns
      const newParams: Record<string, unknown> = { ...internalParams, modelId: model.modelId }
      for (const p of model.inputSchema) {
        if (p.default !== undefined) newParams[p.name] = p.default
      }
      useWorkflowStore.getState().updateNodeParams(selectedNodeId, newParams)

      const allNodes = useWorkflowStore.getState().nodes
      const baseName = model.displayName
      const otherLabels = allNodes
        .filter(n => n.id !== selectedNodeId && n.data?.nodeType === 'ai-task/run')
        .map(n => String(n.data?.label ?? '').trim())
      let finalLabel = baseName
      if (otherLabels.includes(finalLabel)) {
        let idx = 2
        while (otherLabels.includes(`${baseName} (${idx})`)) idx++
        finalLabel = `${baseName} (${idx})`
      }
      updateNodeData(selectedNodeId, { modelInputSchema: model.inputSchema, label: finalLabel })

      useExecutionStore.getState().updateNodeStatus(selectedNodeId, 'idle')
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
  }, [onChange, selectedNodeId, updateNodeData, edges, currentModelId, removeEdgesByIds])

  const handleModelChange = useCallback((modelId: string) => {
    const storeModel = getModelById(modelId)
    if (!storeModel) return
    const model = convertDesktopModel(storeModel)
    applyModelSelection(model)
  }, [getModelById, applyModelSelection])

  if (isLoading && models.length === 0) {
    return (
      <div className="overflow-hidden min-w-0">
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          <div className="text-xs text-muted-foreground">{t('workflow.modelSelector.loadingModels', 'Loading models...')}</div>
          <div className="text-[10px] text-muted-foreground/60">{t('workflow.modelSelector.loadingHint', 'This may take a few seconds on first launch')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className={`overflow-hidden min-w-0 w-full flex flex-col ${embedded ? 'flex-1 min-h-0' : 'flex-1'}`}>
      {error && <div className="text-destructive text-xs p-2 mb-3 rounded border border-destructive bg-destructive/10">{error}</div>}
      <div className="flex items-center gap-1.5 mb-2">
        <div className="flex-1 min-w-0">
          <ModelSelector
            models={models}
            value={currentModelId || undefined}
            onChange={handleModelChange}
            disabled={isLoading || refreshingCatalog}
          />
        </div>
        <button
          onClick={handleRefreshModels}
          disabled={isLoading || refreshingCatalog}
          className="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded-md border border-[hsl(var(--border))] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={refreshingCatalog ? t('workflow.modelSelector.refreshing', 'Refreshing...') : t('workflow.refreshModels', 'Refresh Models')}
        >
          <svg className={refreshingCatalog ? 'animate-spin' : ''} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h-6"/><path d="M2 11.5a10 10 0 0 1 18.8-4.3"/><path d="M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
        </button>
      </div>
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
