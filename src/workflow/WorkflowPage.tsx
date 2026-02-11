/**
 * WorkflowPage — top-level page component for the /workflow route.
 *
 * Top bar: Workflow tabs (like browser tabs) + Run All + Save + Settings
 * Right sidebar: Config + Results tabs
 */
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkflowCanvas } from './components/canvas/WorkflowCanvas'
import { NodePalette } from './components/canvas/NodePalette'
import { NodeConfigPanel } from './components/panels/NodeConfigPanel'
import { ResultsPanel } from './components/panels/ResultsPanel'
import { WorkflowList } from './components/WorkflowList'
import { RunMonitor } from './components/canvas/RunMonitor'
import { useWorkflowStore } from './stores/workflow.store'
import { useExecutionStore } from './stores/execution.store'
import { useUIStore } from './stores/ui.store'
import { registryIpc, modelsIpc, storageIpc, costIpc, workflowIpc } from './ipc/ipc-client'
import { useFreeToolListener } from './hooks/useFreeToolListener'
import { useModelsStore } from '@/stores/modelsStore'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { NodeTypeDefinition } from '@/workflow/types/node-defs'

type ModelSyncStatus = 'idle' | 'loading' | 'synced' | 'error' | 'no-key'

/* ── Tab snapshot for multi-tab support ─────────────────────────────── */
interface TabSnapshot {
  tabId: string
  workflowId: string | null
  workflowName: string
  nodes: unknown[]
  edges: unknown[]
  isDirty: boolean
}

interface PersistedWorkflowSession {
  version: 1
  activeTabId: string
  tabIdCounter: number
  tabs: TabSnapshot[]
}

const WORKFLOW_SESSION_STORAGE_KEY = 'wavespeed_workflow_session_v1'

function parseTabIndex(tabId: string): number {
  const m = /^tab-(\d+)$/.exec(tabId)
  return m ? Number(m[1]) : 1
}

function sanitizeTabSnapshots(input: unknown): TabSnapshot[] {
  if (!Array.isArray(input)) return []
  const tabs: TabSnapshot[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (typeof r.tabId !== 'string') continue
    tabs.push({
      tabId: r.tabId,
      workflowId: typeof r.workflowId === 'string' ? r.workflowId : null,
      workflowName: typeof r.workflowName === 'string' ? r.workflowName : 'Untitled Workflow',
      nodes: Array.isArray(r.nodes) ? r.nodes : [],
      edges: Array.isArray(r.edges) ? r.edges : [],
      isDirty: Boolean(r.isDirty)
    })
  }
  return tabs
}

let tabIdCounter = 1

export function WorkflowPage() {
  const { t } = useTranslation()
  const [nodeDefs, setNodeDefs] = useState<NodeTypeDefinition[]>([])
  const [showWorkflowList, setShowWorkflowList] = useState(false)
  const workflowName = useWorkflowStore(s => s.workflowName)
  const workflowId = useWorkflowStore(s => s.workflowId)
  const isDirty = useWorkflowStore(s => s.isDirty)
  const nodes = useWorkflowStore(s => s.nodes)
  const edges = useWorkflowStore(s => s.edges)
  const saveWorkflow = useWorkflowStore(s => s.saveWorkflow)
  const loadWorkflow = useWorkflowStore(s => s.loadWorkflow)
  const { showNodePalette,
    toggleNodePalette, selectedNodeId, previewSrc, previewItems, previewIndex, prevPreview, nextPreview, closePreview,
    showNamingDialog, namingDialogDefault, resolveNamingDialog } = useUIStore()
  const { runAll, runNode, cancelAll, activeExecutions } = useExecutionStore()
  const initListeners = useExecutionStore(s => s.initListeners)
  const wasRunning = useExecutionStore(s => s._wasRunning)
  const nodeStatuses = useExecutionStore(s => s.nodeStatuses)
  const isRunning = activeExecutions.size > 0
  const [rightTab, setRightTab] = useState<'config' | 'results'>('config')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [saveToast, setSaveToast] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveToastMsg, setSaveToastMsg] = useState('')
  const [execToast, setExecToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [runCount, setRunCount] = useState(1)
  const [runTarget, setRunTarget] = useState<'all' | 'selected'>('all')
  const [showRunTargetMenu, setShowRunTargetMenu] = useState(false)
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const runCancelRef = useRef(false)
  const normalizedPreviewSrc = useMemo(() => {
    if (!previewSrc) return ''
    if (/^local-asset:\/\//i.test(previewSrc)) {
      try {
        return decodeURIComponent(previewSrc.replace(/^local-asset:\/\//i, ''))
      } catch {
        return previewSrc
      }
    }
    return previewSrc
  }, [previewSrc])
  const previewIsImage = Boolean(normalizedPreviewSrc && normalizedPreviewSrc.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)(\?.*)?$/i))
  const canNavigatePreview = previewIsImage && previewItems.length > 1

  useEffect(() => {
    if (!previewSrc) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closePreview()
        return
      }
      if (!canNavigatePreview) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prevPreview()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        nextPreview()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [previewSrc, canNavigatePreview, prevPreview, nextPreview, closePreview])

  // Unified save handler with visual feedback
  const handleSave = useCallback(async () => {
    setSaveToast('saving')
    setSaveToastMsg('')
    try {
      await saveWorkflow()
      setLastSavedAt(new Date())
      invalidateWorkflowListCache()
      setSaveToast('saved')
      setTimeout(() => setSaveToast('idle'), 2000)
    } catch (err) {
      // User cancelled naming dialog — not an error
      const msg = err instanceof Error ? err.message : String(err)
      if (msg) {
        setSaveToast('error')
        setSaveToastMsg(msg)
        setTimeout(() => setSaveToast('idle'), 3000)
      } else {
        setSaveToast('idle')
      }
    }
  }, [saveWorkflow])

  // ── Multi-tab state ────────────────────────────────────────────────
  const [tabs, setTabs] = useState<TabSnapshot[]>([
    { tabId: `tab-${tabIdCounter}`, workflowId: null, workflowName: 'Untitled Workflow', nodes: [], edges: [], isDirty: false }
  ])
  const [activeTabId, setActiveTabId] = useState(`tab-${tabIdCounter}`)
  const [startupSessionReady, setStartupSessionReady] = useState(false)
  const [restoredFromPersistedSession, setRestoredFromPersistedSession] = useState(false)
  const [hasRestoredLastWorkflow, setHasRestoredLastWorkflow] = useState(false)

  // Save current store state into the active tab snapshot
  const saveCurrentTabSnapshot = useCallback(() => {
    const state = useWorkflowStore.getState()
    setTabs(prev => prev.map(t =>
      t.tabId === activeTabId
        ? { ...t, workflowId: state.workflowId, workflowName: state.workflowName, nodes: state.nodes, edges: state.edges, isDirty: state.isDirty }
        : t
    ))
  }, [activeTabId])

  // Switch to a tab: save current → restore target
  const switchTab = useCallback((tabId: string) => {
    if (tabId === activeTabId) return
    saveCurrentTabSnapshot()
    const target = tabs.find(t => t.tabId === tabId)
    if (!target) return
    // Restore store state from snapshot
    useWorkflowStore.setState({
      workflowId: target.workflowId,
      workflowName: target.workflowName,
      nodes: target.nodes as ReturnType<typeof useWorkflowStore.getState>['nodes'],
      edges: target.edges as ReturnType<typeof useWorkflowStore.getState>['edges'],
      isDirty: target.isDirty
    })
    setActiveTabId(tabId)
  }, [activeTabId, tabs, saveCurrentTabSnapshot])

  // New tab
  const addTab = useCallback(() => {
    saveCurrentTabSnapshot()
    tabIdCounter++
    const newTabId = `tab-${tabIdCounter}`
    setTabs(prev => [...prev, { tabId: newTabId, workflowId: null, workflowName: 'Untitled Workflow', nodes: [], edges: [], isDirty: false }])
    useWorkflowStore.setState({ workflowId: null, workflowName: 'Untitled Workflow', nodes: [], edges: [], isDirty: false })
    setActiveTabId(newTabId)
  }, [saveCurrentTabSnapshot])

  // Close tab — with unsaved changes confirmation
  const [confirmCloseTabId, setConfirmCloseTabId] = useState<string | null>(null)

  const doCloseTab = useCallback((tabId: string) => {
    if (tabs.length <= 1) return
    const remaining = tabs.filter(t => t.tabId !== tabId)
    setTabs(remaining)
    if (tabId === activeTabId) {
      const target = remaining[remaining.length - 1]
      useWorkflowStore.setState({
        workflowId: target.workflowId,
        workflowName: target.workflowName,
        nodes: target.nodes as ReturnType<typeof useWorkflowStore.getState>['nodes'],
        edges: target.edges as ReturnType<typeof useWorkflowStore.getState>['edges'],
        isDirty: target.isDirty
      })
      setActiveTabId(target.tabId)
    }
  }, [tabs, activeTabId])

  const closeTab = useCallback((tabId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (tabs.length <= 1) return
    const tab = tabs.find(t => t.tabId === tabId)
    if (tab?.isDirty) {
      setConfirmCloseTabId(tabId)
    } else {
      doCloseTab(tabId)
    }
  }, [tabs, doCloseTab])

  // Restore previous editing session (tabs + active tab + canvas state) on startup.
  useEffect(() => {
    if (startupSessionReady) return

    let restored = false
    try {
      const raw = localStorage.getItem(WORKFLOW_SESSION_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedWorkflowSession>
        const restoredTabs = sanitizeTabSnapshots(parsed.tabs)
        if (restoredTabs.length > 0) {
          const restoredActiveTabId = typeof parsed.activeTabId === 'string' &&
            restoredTabs.some(t => t.tabId === parsed.activeTabId)
            ? parsed.activeTabId
            : restoredTabs[0].tabId

          setTabs(restoredTabs)
          setActiveTabId(restoredActiveTabId)

          const active = restoredTabs.find(t => t.tabId === restoredActiveTabId) ?? restoredTabs[0]
          useWorkflowStore.setState({
            workflowId: active.workflowId,
            workflowName: active.workflowName,
            nodes: active.nodes as ReturnType<typeof useWorkflowStore.getState>['nodes'],
            edges: active.edges as ReturnType<typeof useWorkflowStore.getState>['edges'],
            isDirty: active.isDirty
          })

          const maxTabIndex = restoredTabs.reduce((max, t) => Math.max(max, parseTabIndex(t.tabId)), 1)
          const persistedCounter = typeof parsed.tabIdCounter === 'number' ? parsed.tabIdCounter : 1
          tabIdCounter = Math.max(tabIdCounter, maxTabIndex, persistedCounter)
          restored = true
        }
      }
    } catch {
      // Ignore malformed localStorage data and fallback to normal startup flow.
    }

    setRestoredFromPersistedSession(restored)
    setStartupSessionReady(true)
  }, [startupSessionReady])

  // Keep active tab snapshot in sync
  useEffect(() => {
    setTabs(prev => prev.map(t =>
      t.tabId === activeTabId
        ? { ...t, workflowId, workflowName, nodes, edges, isDirty }
        : t
    ))
  }, [activeTabId, workflowId, workflowName, nodes, edges, isDirty])

  // Persist current editing session for next app restart.
  useEffect(() => {
    if (!startupSessionReady) return
    const timer = setTimeout(() => {
      const payload: PersistedWorkflowSession = {
        version: 1,
        activeTabId,
        tabIdCounter,
        tabs
      }
      localStorage.setItem(WORKFLOW_SESSION_STORAGE_KEY, JSON.stringify(payload))
    }, 300)
    return () => clearTimeout(timer)
  }, [startupSessionReady, tabs, activeTabId])

  // Auto-restore last workflow on first mount
  useEffect(() => {
    if (!startupSessionReady || restoredFromPersistedSession) return
    if (hasRestoredLastWorkflow) return
    setHasRestoredLastWorkflow(true)
    const lastId = localStorage.getItem('wavespeed_last_workflow_id')
    if (lastId) {
      loadWorkflow(lastId).catch(() => {
        // Last workflow may have been deleted, ignore
        localStorage.removeItem('wavespeed_last_workflow_id')
      })
    }
  }, [startupSessionReady, restoredFromPersistedSession, hasRestoredLastWorkflow, loadWorkflow])

  // Persist current workflow ID for next session restore
  useEffect(() => {
    if (workflowId) {
      localStorage.setItem('wavespeed_last_workflow_id', workflowId)
    }
  }, [workflowId])

  // Auto-save: when workflow has a name and is dirty, save after 2s debounce
  // Triggers on: param changes, connections, model switches, node adds/removes
  useEffect(() => {
    if (!isDirty || !workflowId || !workflowName || workflowName === 'Untitled Workflow') return
    const timer = setTimeout(async () => {
      try {
        await saveWorkflow()
        setLastSavedAt(new Date())
      } catch { /* naming dialog may cancel */ }
    }, 2000)
    return () => clearTimeout(timer)
  }, [isDirty, workflowId, workflowName, nodes, edges, saveWorkflow])

  // Auto-save after execution completes
  useEffect(() => {
    if (!isRunning && workflowId && workflowName && workflowName !== 'Untitled Workflow') {
      saveWorkflow().then(() => setLastSavedAt(new Date())).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning])

  // Show in-canvas toast when ALL executions finish (wasRunning transitions to false)
  const prevWasRunning = useRef(false)
  useEffect(() => {
    if (prevWasRunning.current && !wasRunning && !isRunning) {
      const hasError = Object.values(nodeStatuses).some(s => s === 'error')
      setExecToast({
        type: hasError ? 'error' : 'success',
        msg: hasError ? 'Workflow completed with errors' : 'All nodes executed successfully'
      })
      setTimeout(() => setExecToast(null), 4000)
    }
    prevWasRunning.current = wasRunning
  }, [wasRunning, isRunning, nodeStatuses])

  // Model loading state
  const [modelSyncStatus, setModelSyncStatus] = useState<ModelSyncStatus>('idle')
  const [modelSyncError, setModelSyncError] = useState('')
  const [, setModelCount] = useState(0)

  // Cost display
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null)
  // Daily spend tracking — data fetched for future budget display
  const [, setDailySpend] = useState(0)
  const [, setDailyLimit] = useState(100)
  const estimateNodeIdsSignature = useMemo(
    () => [...nodes.map(n => n.id)].sort().join('|'),
    [nodes]
  )
  const costEstimateSignature = useMemo(() => {
    // Only include cost-relevant node fields and ignore UI-only/internal keys
    // so moving/resizing nodes won't trigger cost re-estimation.
    return nodes
      .map((n) => {
        const rawParams = (n.data?.params ?? {}) as Record<string, unknown>
        const sanitizedEntries = Object.entries(rawParams)
          .filter(([key]) => !key.startsWith('__'))
          .sort(([a], [b]) => a.localeCompare(b))
        return JSON.stringify({
          id: n.id,
          nodeType: n.data?.nodeType ?? '',
          params: sanitizedEntries
        })
      })
      .sort()
      .join('|')
  }, [nodes])

  // API key state
  const apiKey = useApiKeyStore(s => s.apiKey)
  const hasAttemptedLoad = useApiKeyStore(s => s.hasAttemptedLoad)
  const loadApiKey = useApiKeyStore(s => s.loadApiKey)

  // Global Ctrl+S handler (works even when focus is in input/textarea)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrlOrCmd = navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? e.metaKey : e.ctrlKey
      if (ctrlOrCmd && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown, true) // capture phase
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [handleSave])

  // Init
  useFreeToolListener()

  useEffect(() => {
    registryIpc.getAll().then(defs => setNodeDefs(defs ?? [])).catch(console.error)
    initListeners()
    loadApiKey()
  }, [initListeners, loadApiKey])

  // Model sync
  const desktopModels = useModelsStore(s => s.models)
  const isLoadingModels = useModelsStore(s => s.isLoading)
  const modelsError = useModelsStore(s => s.error)
  const fetchModels = useModelsStore(s => s.fetchModels)

  const syncModels = useCallback(async () => {
    if (!apiKey) { setModelSyncStatus('no-key'); return }
    setModelSyncStatus('loading'); setModelSyncError('')
    try { await fetchModels(true) } catch (err) {
      setModelSyncStatus('error'); setModelSyncError(err instanceof Error ? err.message : 'Failed')
    }
  }, [apiKey, fetchModels])

  useEffect(() => {
    if (hasAttemptedLoad) {
      if (!apiKey) setModelSyncStatus('no-key')
      else if (desktopModels.length === 0 && !isLoadingModels) syncModels()
    }
  }, [hasAttemptedLoad, apiKey, desktopModels.length, isLoadingModels, syncModels])

  useEffect(() => {
    if (desktopModels.length > 0) {
      modelsIpc.sync(desktopModels).then(() => { setModelSyncStatus('synced'); setModelCount(desktopModels.length) })
        .catch(err => { setModelSyncStatus('error'); setModelSyncError(err instanceof Error ? err.message : 'Sync failed') })
    }
  }, [desktopModels])

  useEffect(() => { if (modelsError) { setModelSyncStatus('error'); setModelSyncError(modelsError) } }, [modelsError])

  // Cost estimate (debounced)
  useEffect(() => {
    const nodeIds = estimateNodeIdsSignature ? estimateNodeIdsSignature.split('|') : []
    if (!workflowId || nodeIds.length === 0) { setEstimatedCost(null); return }
    const t = setTimeout(async () => {
      try {
        const est = await costIpc.estimate(workflowId, nodeIds)
        setEstimatedCost(est.totalEstimated)
      } catch { setEstimatedCost(null) }
    }, 800)
    return () => clearTimeout(t)
  }, [workflowId, estimateNodeIdsSignature, costEstimateSignature])

  useEffect(() => {
    if (!workflowId) return
    costIpc.getDailySpend().then(setDailySpend).catch(() => {})
    costIpc.getBudget().then(b => setDailyLimit(b.dailyLimit)).catch(() => {})
  }, [workflowId, isRunning])

  // Param defs for selected node
  const selectedNode = nodes.find(n => n.id === selectedNodeId)
  const paramDefs = selectedNode?.data?.paramDefinitions ?? []
  const showRightPanel = selectedNodeId !== null

  // Run All — with node labels for monitor
  const handleRunAll = async (times = 1) => {
    let wfId = workflowId
    let workflowExists = false
    if (wfId) {
      try {
        await workflowIpc.load(wfId)
        workflowExists = true
      } catch {
        workflowExists = false
      }
    }
    // Executor reads from persisted workflow DB, so save first when dirty.
    if (!wfId || isDirty || !workflowExists) {
      if (nodes.length === 0) return
      await saveWorkflow()
      wfId = useWorkflowStore.getState().workflowId
      if (!wfId) return
    }
    const runTimes = Math.max(1, Math.min(99, Math.floor(times || 1)))
    runCancelRef.current = false
    setIsBatchRunning(true)
    try {
      for (let i = 0; i < runTimes; i++) {
        if (runCancelRef.current) break
        if (runTarget === 'selected') {
          if (!selectedNodeId) break
          await runNode(wfId, selectedNodeId)
        } else {
          const nodeLabels: Record<string, string> = {}
          for (const n of nodes) { nodeLabels[n.id] = n.data?.label || n.data?.nodeType || n.id.slice(0, 8) }
          await runAll(wfId, workflowName, nodeLabels)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setExecToast({
        type: 'error',
        msg: message || t('workflow.runFailed', 'Run failed')
      })
      setTimeout(() => setExecToast(null), 4000)
    } finally {
      setIsBatchRunning(false)
    }
  }

  const handleFitView = useCallback(() => {
    window.dispatchEvent(new Event('workflow:fit-view'))
  }, [])

  // Import / Export with toast feedback
  const [ioToast, setIoToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const showIoToast = (type: 'success' | 'error', msg: string) => {
    setIoToast({ type, msg })
    setTimeout(() => setIoToast(null), 3000)
  }

  const handleImport = useCallback(async () => {
    try {
      const result = await storageIpc.importWorkflowJson() as { id?: string; name?: string; error?: string } | null
      if (!result) return // user cancelled
      if (result.error) {
        showIoToast('error', result.error)
        return
      }
      if (result.id) {
        // Open in new tab
        saveCurrentTabSnapshot()
        tabIdCounter++
        const newTabId = `tab-${tabIdCounter}`
        setTabs(prev => [...prev, { tabId: newTabId, workflowId: null, workflowName: 'Loading...', nodes: [], edges: [], isDirty: false }])
        setActiveTabId(newTabId)
        await loadWorkflow(result.id)
        showIoToast('success', `${t('workflow.imported', 'Imported')} "${result.name}"`)
        invalidateWorkflowListCache()
      }
    } catch (err) {
      console.error('Import failed:', err)
      showIoToast('error', t('workflow.importFailed', 'Import failed'))
    }
  }, [loadWorkflow, saveCurrentTabSnapshot, t])

  const handleExport = useCallback(async () => {
    if (!workflowId) return
    try {
      const wfNodes = nodes.map(n => ({ id: n.id, nodeType: n.data.nodeType, position: n.position, params: n.data.params ?? {} }))
      const wfEdges = useWorkflowStore.getState().edges.map(e => ({ id: e.id, sourceNodeId: e.source, targetNodeId: e.target, sourceOutputKey: e.sourceHandle ?? 'output', targetInputKey: e.targetHandle ?? 'input' }))
      await storageIpc.exportWorkflowJson(workflowId, workflowName, { nodes: wfNodes, edges: wfEdges })
      showIoToast('success', t('workflow.exported', 'Exported successfully'))
    } catch (err) {
      console.error('Export failed:', err)
      showIoToast('error', t('workflow.exportFailed', 'Export failed'))
    }
  }, [workflowId, workflowName, nodes, t])

  return (
    <div className="flex flex-col h-full relative">
      {/* ── Status banner ──────────────────────────────────────── */}
      {modelSyncStatus === 'no-key' && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-orange-500/10 border-b border-orange-500/30 text-xs text-orange-400">
          <span>API key not set.</span>
        </div>
      )}
      {modelSyncStatus === 'loading' && (
        <div className="px-4 py-1.5 bg-blue-500/10 border-b border-blue-500/30 text-xs text-blue-400 animate-pulse">Loading models...</div>
      )}
      {modelSyncStatus === 'error' && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-red-500/10 border-b border-red-500/30 text-xs text-red-400">
          <span>Models failed: {modelSyncError}</span>
          <button onClick={syncModels} className="underline hover:text-red-300">Retry</button>
        </div>
      )}

      {/* ── Tab bar (Chrome-style) ─────────────────────────────── */}
      <div className="flex items-end bg-[hsl(var(--background))] pt-1 px-1 gap-px min-h-[36px]">
        {/* History dropdown */}
        <HistoryDropdown onOpen={async (id) => {
          // If already open in a tab, switch to it
          const existingTab = tabs.find(t => t.workflowId === id)
          if (existingTab) {
            switchTab(existingTab.tabId)
            return
          }
          // Otherwise open in a new tab
          saveCurrentTabSnapshot()
          tabIdCounter++
          const newTabId = `tab-${tabIdCounter}`
          setTabs(prev => [...prev, { tabId: newTabId, workflowId: null, workflowName: 'Loading...', nodes: [], edges: [], isDirty: false }])
          setActiveTabId(newTabId)
          await loadWorkflow(id)
        }} />

        {tabs.map(tab => {
          const isActive = tab.tabId === activeTabId
          return (
            <div key={tab.tabId}
              onClick={() => switchTab(tab.tabId)}
              className={`group flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-t-lg cursor-pointer text-xs select-none min-w-[120px] max-w-[200px] transition-colors
                ${isActive
                  ? 'bg-[hsl(var(--card))] text-foreground'
                  : 'bg-transparent text-muted-foreground hover:bg-[hsl(var(--muted))] hover:text-foreground'}`}
            >
              <span className="truncate flex-1">{tab.workflowName}</span>
              {tab.isDirty && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />}
              {tabs.length > 1 && (
                <button onClick={(e) => closeTab(tab.tabId, e)}
                  className="w-4 h-4 flex items-center justify-center rounded-sm text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/80 opacity-0 group-hover:opacity-100 transition-opacity">
                  ✕
                </button>
              )}
            </div>
          )
        })}
        {/* New tab button */}
        <button onClick={addTab}
          className="flex items-center justify-center w-7 h-7 mb-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--muted))] transition-colors text-sm"
          title="New workflow tab">
          +
        </button>
      </div>

      {/* ── Toolbar ────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-border bg-card px-3 py-1 gap-1.5 min-h-[36px]">
        {/* Left: Panel toggles */}
        <button onClick={toggleNodePalette}
          className={`px-2 py-1 text-xs transition-colors ${showNodePalette ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
          {t('workflow.nodes', 'Nodes')}
        </button>
        <button onClick={() => setShowWorkflowList(true)}
          className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          {t('workflow.workflows', 'Workflows')}
        </button>
        <div className="w-px h-5 bg-border mx-1" />

        {/* Last saved indicator */}
        {lastSavedAt && (
          <span className="text-[10px] text-muted-foreground">
            {t('workflow.savedAt', 'Saved')} {lastSavedAt.toLocaleTimeString()}
          </span>
        )}
        {isDirty && workflowId && (
          <span className="text-[10px] text-orange-400">{t('workflow.unsaved', 'unsaved')}</span>
        )}

        {/* Cost info */}
        {estimatedCost !== null && estimatedCost > 0 && (
          <span className="text-[11px] text-muted-foreground ml-2">
            {t('workflow.estimated', 'Est.')}{' '}
            <span className="font-medium text-blue-400">${estimatedCost.toFixed(4)}</span>
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: Run controls */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40">
            <button
              className="h-8 px-3 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={nodes.length === 0 || isRunning || isBatchRunning || (runTarget === 'selected' && !selectedNodeId)}
              onClick={() => handleRunAll(runCount)}
            >
              {isRunning || isBatchRunning ? t('workflow.running', 'Running...') : t('workflow.run', 'Run')}
            </button>
            <button
              className="h-8 w-7 border-l border-[hsl(var(--border))] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              onClick={() => setShowRunTargetMenu(v => !v)}
              title={t('workflow.runTarget', 'Run target')}
            >
              ▾
            </button>
            {showRunTargetMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowRunTargetMenu(false)} />
                <div className="absolute right-0 top-[36px] z-50 w-40 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-xl py-1">
                  <button
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent ${runTarget === 'all' ? 'text-primary font-medium' : 'text-foreground'}`}
                    onClick={() => { setRunTarget('all'); setShowRunTargetMenu(false) }}
                  >
                    {t('workflow.runTargetAll', 'Run All Nodes')}
                  </button>
                  <button
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent ${runTarget === 'selected' ? 'text-primary font-medium' : 'text-foreground'}`}
                    onClick={() => { setRunTarget('selected'); setShowRunTargetMenu(false) }}
                  >
                    {t('workflow.runTargetSelected', 'Run Selected Node')}
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center rounded-md border border-[hsl(var(--border))] overflow-hidden h-8">
            <input
              type="number"
              min={1}
              max={99}
              value={runCount}
              onChange={e => setRunCount(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
              className="w-14 h-full bg-transparent px-2 text-xs text-center focus:outline-none"
              title={t('workflow.runCount', 'Run count')}
            />
          </div>
          {(isRunning || isBatchRunning) && (
            <button
              className="h-8 w-8 rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              onClick={() => {
                runCancelRef.current = true
                if (workflowId) cancelAll(workflowId)
              }}
              title={t('workflow.cancelAll', 'Cancel All')}
            >
              ✕
            </button>
          )}
          <button
            onClick={handleFitView}
            className="h-8 px-2 rounded-md border border-[hsl(var(--border))] text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title={t('workflow.fitView', 'Fit View')}
          >
            {t('workflow.fitView', 'Fit View')}
          </button>
        </div>

        {/* Monitor toggle */}
        <MonitorToggleBtn />

        <div className="w-px h-5 bg-border mx-1" />

        <button onClick={handleImport} className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors">{t('workflow.import', 'Import')}</button>
        {workflowId && <button onClick={handleExport} className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors">{t('workflow.export', 'Export')}</button>}
        <button onClick={handleSave}
          className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors">{t('workflow.save', 'Save')}</button>
      </div>

      {/* ── Run Monitor panel ─────────────────────────────────── */}
      <RunMonitor workflowId={workflowId} />

      {/* ── Main content ───────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Node palette as overlay so it doesn't shift the canvas layout */}
        {showNodePalette && (
          <div className="absolute top-0 left-0 bottom-0 z-30">
            <NodePalette definitions={nodeDefs} />
          </div>
        )}
        <WorkflowCanvas nodeDefs={nodeDefs} />
        {showRightPanel && <ResizableSidebar>
          {selectedNodeId ? (
            <>
              <div className="flex border-b border-border flex-shrink-0">
                <button onClick={() => setRightTab('config')}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${rightTab === 'config' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                  {t('workflow.config', 'Model')}
                </button>
                <button onClick={() => setRightTab('results')}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${rightTab === 'results' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                  {t('workflow.results', 'Results')}
                </button>
              </div>
              <div className="flex-1 overflow-hidden min-w-0">
                <ScrollArea className="h-full w-full">
                  {rightTab === 'config' && <NodeConfigPanel paramDefs={paramDefs} />}
                  {rightTab === 'results' && <ResultsPanel />}
                </ScrollArea>
              </div>
            </>
          ) : null}
        </ResizableSidebar>}
      </div>

      {showWorkflowList && <WorkflowList onClose={() => setShowWorkflowList(false)} onOpen={async (id) => {
        const existingTab = tabs.find(t => t.workflowId === id)
        if (existingTab) {
          switchTab(existingTab.tabId)
        } else {
          saveCurrentTabSnapshot()
          tabIdCounter++
          const newTabId = `tab-${tabIdCounter}`
          setTabs(prev => [...prev, { tabId: newTabId, workflowId: null, workflowName: 'Loading...', nodes: [], edges: [], isDirty: false }])
          setActiveTabId(newTabId)
          await loadWorkflow(id)
        }
        setShowWorkflowList(false)
      }} />}

      {/* Preview overlay — covers the canvas area only (absolute within the page) */}
      {previewSrc && (
        <div className="absolute inset-0 z-[999] flex flex-col bg-black/85"
          onClick={closePreview} style={{ cursor: 'default' }}>
          <div className="flex-1 flex items-center justify-center p-6 min-h-0">
            {normalizedPreviewSrc.match(/\.(glb|gltf)(\?.*)?$/i) ? (
              <ModelViewerOverlay src={previewSrc} />
            ) : normalizedPreviewSrc.match(/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i) ? (
              <video src={previewSrc} controls autoPlay
                className="max-w-[80%] max-h-full rounded-xl shadow-2xl" onClick={e => e.stopPropagation()} />
            ) : normalizedPreviewSrc.match(/\.(mp3|wav|ogg|flac|aac|m4a)(\?.*)?$/i) ? (
              <div className="w-[80%] max-w-[700px] rounded-xl shadow-2xl bg-[hsl(var(--card))] p-6" onClick={e => e.stopPropagation()}>
                <audio src={previewSrc} controls autoPlay className="w-full" />
              </div>
            ) : (
              <div className="relative max-w-[80%] max-h-full" onClick={e => e.stopPropagation()}>
                {canNavigatePreview && (
                  <button
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/45 text-white hover:bg-black/65 transition-colors"
                    onClick={e => { e.stopPropagation(); prevPreview() }}
                    title={t('workflow.previousImage', 'Previous image')}
                  >
                    ←
                  </button>
                )}
                <img src={previewSrc} alt="Preview"
                  className="max-w-full max-h-full rounded-xl shadow-2xl object-contain" />
                {canNavigatePreview && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/45 text-white hover:bg-black/65 transition-colors"
                    onClick={e => { e.stopPropagation(); nextPreview() }}
                    title={t('workflow.nextImage', 'Next image')}
                  >
                    →
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="py-3 text-center text-white/40 text-xs select-none flex-shrink-0">
            {canNavigatePreview
              ? t('workflow.previewNavHint', { current: previewIndex + 1, total: previewItems.length, defaultValue: 'Use ← / → to navigate images ({{current}}/{{total}})' })
              : t('workflow.clickAnywhereToClose', 'Click anywhere to close')}
          </div>
        </div>
      )}

      {/* Naming dialog */}
      {showNamingDialog && <NamingDialog defaultValue={namingDialogDefault} onConfirm={resolveNamingDialog} />}

      {/* Close tab confirmation dialog */}
      {confirmCloseTabId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => setConfirmCloseTabId(null)}>
          <div className="w-[340px] rounded-xl border border-border bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-1">Unsaved Changes</h3>
            <p className="text-xs text-muted-foreground mb-4">This workflow has unsaved changes. Are you sure you want to close it?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmCloseTabId(null)}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                Cancel
              </button>
              <button onClick={() => { doCloseTab(confirmCloseTabId); setConfirmCloseTabId(null) }}
                className="px-4 py-1.5 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors">
                Discard & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts — stacked at bottom center */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2">
        {saveToast !== 'idle' && (
          <div className={`px-4 py-2 rounded-lg shadow-lg text-xs font-medium
            ${saveToast === 'saving' ? 'bg-blue-500/90 text-white' :
              saveToast === 'saved' ? 'bg-green-500/90 text-white' :
              'bg-red-500/90 text-white'}`}>
            {saveToast === 'saving' && t('workflow.saving', 'Saving...')}
            {saveToast === 'saved' && `✓ ${t('workflow.saved', 'Saved')}`}
            {saveToast === 'error' && `✕ ${t('workflow.saveFailed', 'Save failed')}${saveToastMsg ? `: ${saveToastMsg}` : ''}`}
          </div>
        )}
        {execToast && (
          <div className={`px-4 py-2.5 rounded-lg shadow-lg text-xs font-medium flex items-center gap-2
            ${execToast.type === 'success' ? 'bg-green-500/90 text-white' : 'bg-red-500/90 text-white'}`}>
            <span>{execToast.type === 'success' ? '✓' : '⚠'}</span>
            <span>{execToast.msg}</span>
            <button onClick={() => setExecToast(null)} className="ml-1 opacity-70 hover:opacity-100">✕</button>
          </div>
        )}
        {ioToast && (
          <div className={`px-4 py-2 rounded-lg shadow-lg text-xs font-medium
            ${ioToast.type === 'success' ? 'bg-green-500/90 text-white' : 'bg-red-500/90 text-white'}`}>
            {ioToast.type === 'success' ? '✓' : '✕'} {ioToast.msg}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Resizable Sidebar ─────────────────────────────────────────────── */

function ResizableSidebar({ children }: { children: React.ReactNode }) {
  const [basis, setBasis] = useState(320)
  const [dragging, setDragging] = useState(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startBasis = basis

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX
      setBasis(Math.max(320, Math.min(600, startBasis + delta)))
    }
    const onUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [basis])

  return (
    <div
      className="flex flex-col bg-card overflow-hidden border-l border-border relative flex-shrink-0"
      style={{ width: basis, minWidth: 360 }}
    >
      <div
        onMouseDown={onMouseDown}
        className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors ${dragging ? 'bg-primary' : 'hover:bg-primary/50'}`}
      />
      {children}
    </div>
  )
}

/* ── Naming Dialog Component ───────────────────────────────────────── */

function NamingDialog({ defaultValue, onConfirm }: { defaultValue: string; onConfirm: (name: string | null) => void }) {
  const [value, setValue] = useState(defaultValue === 'Untitled Workflow' ? '' : defaultValue)

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onConfirm(trimmed)
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => onConfirm(null)}>
      <div className="w-[360px] rounded-xl border border-border bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold mb-1">Name your workflow</h3>
        <p className="text-xs text-muted-foreground mb-3">Give it a name to save to disk and enable execution.</p>
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="e.g. Product Image Pipeline"
          autoFocus
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary mb-3"
        />
        <div className="flex justify-end gap-2">
          <button onClick={() => onConfirm(null)}
            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!value.trim()}
            className="px-4 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── History Dropdown — quick switch to saved workflows ─────────────── */

/** Module-level cache so the list persists across open/close cycles */
let _workflowListCache: Array<{ id: string; name: string; updatedAt: string }> | null = null
let _workflowListCacheTime = 0
const CACHE_TTL = 30_000 // refresh after 30 seconds

/** Call this to invalidate the cache after save/create/delete */
export function invalidateWorkflowListCache() {
  _workflowListCache = null
  _workflowListCacheTime = 0
}

function HistoryDropdown({ onOpen }: { onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string; updatedAt: string }>>(_workflowListCache ?? [])
  const [loading, setLoading] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const fetchList = () => {
    setLoading(true)
    import('./ipc/ipc-client').then(({ workflowIpc }) => {
      workflowIpc.list().then(list => {
        const mapped = (list ?? []).map(w => ({ id: w.id, name: w.name, updatedAt: w.updatedAt }))
        _workflowListCache = mapped
        _workflowListCacheTime = Date.now()
        setWorkflows(mapped)
        setLoading(false)
      })
    })
  }

  useEffect(() => {
    if (!open) return
    const isFresh = _workflowListCache && (Date.now() - _workflowListCacheTime < CACHE_TTL)
    if (isFresh) {
      setWorkflows(_workflowListCache!)
      return
    }
    fetchList()
  }, [open])

  const handleDelete = async (id: string) => {
    try {
      const { workflowIpc, storageIpc } = await import('./ipc/ipc-client')
      await workflowIpc.delete(id)
      await storageIpc.deleteWorkflowFiles(id).catch(() => {})
      invalidateWorkflowListCache()
      setConfirmDeleteId(null)
      fetchList()
    } catch (err) { console.error('Delete failed:', err) }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center w-7 h-7 mb-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--muted))] transition-colors text-sm"
        title="Open saved workflow">
        ☰
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 w-[260px] rounded-lg border border-border bg-card shadow-xl py-1 max-h-[300px] overflow-y-auto">
            {loading && workflows.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground animate-pulse">Loading...</div>
            )}
            {!loading && workflows.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">No saved workflows</div>
            )}
            {workflows.map(wf => (
              <div key={wf.id} className="flex items-center hover:bg-accent transition-colors group">
                <button
                  onClick={() => { onOpen(wf.id); setOpen(false) }}
                  className="flex-1 text-left px-3 py-1.5 text-xs min-w-0">
                  <div className="font-medium truncate">{wf.name}</div>
                  <div className="text-[10px] text-muted-foreground">{new Date(wf.updatedAt).toLocaleString()}</div>
                </button>
                <button onClick={e => { e.stopPropagation(); setConfirmDeleteId(wf.id) }}
                  className="px-2 py-1 text-muted-foreground/40 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                  title="Delete workflow">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Delete confirmation */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => setConfirmDeleteId(null)}>
          <div className="w-[340px] rounded-xl border border-border bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-1">Delete Workflow</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Are you sure you want to delete "{workflows.find(w => w.id === confirmDeleteId)?.name}"? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDeleteId(null)}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
              <button onClick={() => handleDelete(confirmDeleteId)}
                className="px-4 py-1.5 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Monitor Toggle Button ─────────────────────────────────────────── */
function MonitorToggleBtn() {
  const toggleRunMonitor = useExecutionStore(s => s.toggleRunMonitor)
  const showRunMonitor = useExecutionStore(s => s.showRunMonitor)
  const runSessions = useExecutionStore(s => s.runSessions)
  const activeRuns = runSessions.filter(s => s.status === 'running').length

  return (
    <button onClick={toggleRunMonitor}
      className={`relative px-2 py-1 text-xs transition-colors ${showRunMonitor ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
      title="Execution monitor">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>
      </svg>
      {activeRuns > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-blue-500 text-white text-[8px] flex items-center justify-center font-bold animate-pulse">
          {activeRuns}
        </span>
      )}
    </button>
  )
}

/* ── 3D Model Viewer for preview overlay ───────────────────────────── */
function ModelViewerOverlay({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    import('@google/model-viewer').catch(() => {})
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const el = document.createElement('model-viewer') as HTMLElement
    el.setAttribute('src', src)
    el.setAttribute('camera-controls', '')
    el.setAttribute('auto-rotate', '')
    el.setAttribute('shadow-intensity', '1')
    el.setAttribute('environment-image', 'neutral')
    el.style.width = '100%'
    el.style.height = '100%'
    el.style.borderRadius = '12px'
    el.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)'
    containerRef.current.innerHTML = ''
    containerRef.current.appendChild(el)
    return () => { if (containerRef.current) containerRef.current.innerHTML = '' }
  }, [src])

  return (
    <div ref={containerRef} onClick={e => e.stopPropagation()}
      className="w-[80%] max-w-[800px] h-[70vh] rounded-xl shadow-2xl overflow-hidden" />
  )
}
