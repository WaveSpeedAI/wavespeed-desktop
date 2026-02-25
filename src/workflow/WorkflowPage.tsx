/**
 * WorkflowPage — top-level page component for the /workflow route.
 *
 * Top bar: Workflow tabs (like browser tabs) + Run All + Save + Settings.
 * Config and Results are shown inside the selected node card on the canvas (no right sidebar).
 */
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WorkflowCanvas } from './components/canvas/WorkflowCanvas'
import { NodePalette } from './components/canvas/NodePalette'
import { WorkflowList } from './components/WorkflowList'
import { RunMonitor } from './components/canvas/RunMonitor'
import { WorkflowResultsPanel } from './components/panels/WorkflowResultsPanel'
import { useWorkflowStore, getDefaultNewWorkflowContent } from './stores/workflow.store'
import { useExecutionStore } from './stores/execution.store'
import { useUIStore } from './stores/ui.store'
import { registryIpc, modelsIpc, storageIpc, workflowIpc } from './ipc/ipc-client'
import { useModelsStore } from '@/stores/modelsStore'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { useTemplateStore } from '@/stores/templateStore'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { PanelRight, PanelBottom, Workflow } from 'lucide-react'
import { TemplatePickerDialog } from '@/components/templates/TemplatePickerDialog'
import { TemplateDialog } from '@/components/templates/TemplateDialog'
import { WorkflowGuide, useWorkflowGuide } from './components/WorkflowGuide'
import { persistentStorage } from '@/lib/storage'
import type { Template } from '@/types/template'
import type { NodeTypeDefinition } from '@/workflow/types/node-defs'

type ModelSyncStatus = 'idle' | 'loading' | 'synced' | 'error' | 'no-key' | 'unavailable'
const WORKFLOW_API_UNAVAILABLE_MSG = 'Workflow API not available (run in Electron)'
function isWorkflowApiUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes(WORKFLOW_API_UNAVAILABLE_MSG)
}

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

/* ── Synchronous session hydration (avoids FOUC) ─────────────────────── */
function hydrateSessionSync(): { tabs: TabSnapshot[]; activeTabId: string; restored: boolean } {
  const parsed = persistentStorage.getSync<Partial<PersistedWorkflowSession>>(WORKFLOW_SESSION_STORAGE_KEY)
  if (parsed) {
    const restoredTabs = sanitizeTabSnapshots(parsed.tabs)
    if (restoredTabs.length > 0) {
      const restoredActiveTabId = typeof parsed.activeTabId === 'string' &&
        restoredTabs.some(t => t.tabId === parsed.activeTabId)
        ? parsed.activeTabId
        : restoredTabs[0].tabId

      const maxTabIndex = restoredTabs.reduce((max, t) => Math.max(max, parseTabIndex(t.tabId)), 1)
      const persistedCounter = typeof parsed.tabIdCounter === 'number' ? parsed.tabIdCounter : 1
      tabIdCounter = Math.max(tabIdCounter, maxTabIndex, persistedCounter)

      const active = restoredTabs.find(t => t.tabId === restoredActiveTabId) ?? restoredTabs[0]
      useWorkflowStore.setState({
        workflowId: active.workflowId,
        workflowName: active.workflowName,
        nodes: active.nodes as ReturnType<typeof useWorkflowStore.getState>['nodes'],
        edges: active.edges as ReturnType<typeof useWorkflowStore.getState>['edges'],
        isDirty: active.isDirty
      })

      return { tabs: restoredTabs, activeTabId: restoredActiveTabId, restored: true }
    }
  }

  const { nodes, edges } = getDefaultNewWorkflowContent()
  const defaultTab: TabSnapshot = { tabId: `tab-${tabIdCounter}`, workflowId: null, workflowName: 'Untitled Workflow', nodes, edges, isDirty: false }
  useWorkflowStore.setState({ workflowId: null, workflowName: 'Untitled Workflow', nodes, edges, isDirty: false })
  return { tabs: [defaultTab], activeTabId: defaultTab.tabId, restored: false }
}

const _initialSession = hydrateSessionSync()

export function WorkflowPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [nodeDefs, setNodeDefs] = useState<NodeTypeDefinition[]>([])
  const workflowName = useWorkflowStore(s => s.workflowName)
  const workflowId = useWorkflowStore(s => s.workflowId)
  const isDirty = useWorkflowStore(s => s.isDirty)
  const nodes = useWorkflowStore(s => s.nodes)
  const edges = useWorkflowStore(s => s.edges)
  const saveWorkflow = useWorkflowStore(s => s.saveWorkflow)
  const loadWorkflow = useWorkflowStore(s => s.loadWorkflow)
  const { loadTemplates, useTemplate, createTemplate } = useTemplateStore()
  const { showNodePalette, showWorkflowPanel, showWorkflowResultsPanel, toggleWorkflowResultsPanel,
    toggleNodePalette, toggleWorkflowPanel, selectedNodeId, previewSrc, previewItems, previewIndex, prevPreview, nextPreview, closePreview,
    showNamingDialog, namingDialogDefault, resolveNamingDialog } = useUIStore()
  const [showTemplateDialog, setShowTemplateDialog] = useState(false)
  const guide = useWorkflowGuide()
  const [guideStepKey, setGuideStepKey] = useState<string | null>(null)
  const { runAll, runNode, cancelAll, activeExecutions } = useExecutionStore()
  const initListeners = useExecutionStore(s => s.initListeners)
  const wasRunning = useExecutionStore(s => s._wasRunning)
  const nodeStatuses = useExecutionStore(s => s.nodeStatuses)
  const isRunning = activeExecutions.size > 0
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [saveToast, setSaveToast] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveToastMsg, setSaveToastMsg] = useState('')
  const [execToast, setExecToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [runCount, setRunCount] = useState(1)
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
  const [tabs, setTabs] = useState<TabSnapshot[]>(() => _initialSession.tabs)
  const [activeTabId, setActiveTabId] = useState(() => _initialSession.activeTabId)
  const [startupSessionReady, setStartupSessionReady] = useState(true)
  const [restoredFromPersistedSession, setRestoredFromPersistedSession] = useState(_initialSession.restored)
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
    // Generate a unique name that doesn't collide with existing tabs or persisted workflows
    const baseName = 'Untitled Workflow'
    const existingTabNames = new Set(tabs.map(t => t.workflowName))
    let uniqueName = baseName
    if (existingTabNames.has(uniqueName)) {
      let counter = 2
      while (existingTabNames.has(`${baseName} ${counter}`)) counter++
      uniqueName = `${baseName} ${counter}`
    }
    const { nodes, edges } = getDefaultNewWorkflowContent()
    setTabs(prev => [...prev, { tabId: newTabId, workflowId: null, workflowName: uniqueName, nodes, edges, isDirty: false }])
    useWorkflowStore.setState({ workflowId: null, workflowName: uniqueName, nodes, edges, isDirty: false })
    setActiveTabId(newTabId)
  }, [saveCurrentTabSnapshot, tabs])

  // Tab rename — inline editing
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTabName, setEditingTabName] = useState('')
  const renameWorkflow = useWorkflowStore(s => s.renameWorkflow)

  const startRenameTab = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.tabId === tabId)
    if (!tab) return
    setEditingTabId(tabId)
    setEditingTabName(tab.workflowName)
  }, [tabs])

  const commitRenameTab = useCallback(async () => {
    if (!editingTabId) return
    const trimmed = editingTabName.trim()
    if (!trimmed) {
      setEditingTabId(null)
      return
    }

    // Check for duplicate name across all tabs (excluding self)
    const isDuplicate = tabs.some(t => t.tabId !== editingTabId && t.workflowName === trimmed)
    if (isDuplicate) {
      setEditingTabId(null)
      return
    }

    // If it's the active tab, also update the store and persist to backend
    if (editingTabId === activeTabId) {
      await renameWorkflow(trimmed)
      // Sync back the actual name (may have been deduplicated by backend)
      const actualName = useWorkflowStore.getState().workflowName
      setTabs(prev => prev.map(t => t.tabId === editingTabId ? { ...t, workflowName: actualName } : t))
      invalidateWorkflowListCache()
    } else {
      // For non-active tabs, persist directly via IPC if it has a workflowId
      const tab = tabs.find(t => t.tabId === editingTabId)
      if (tab?.workflowId) {
        const result = await workflowIpc.rename(tab.workflowId, trimmed) as unknown as { finalName: string } | void
        const actualName = (result && typeof result === 'object' && 'finalName' in result) ? result.finalName : trimmed
        setTabs(prev => prev.map(t => t.tabId === editingTabId ? { ...t, workflowName: actualName } : t))
        invalidateWorkflowListCache()
      } else {
        setTabs(prev => prev.map(t => t.tabId === editingTabId ? { ...t, workflowName: trimmed } : t))
      }
    }
    setEditingTabId(null)
  }, [editingTabId, editingTabName, activeTabId, renameWorkflow, tabs])

  const cancelRenameTab = useCallback(() => {
    setEditingTabId(null)
  }, [])

  // ── Tab drag-to-reorder (browser-style) ──
  const [dragTabId, setDragTabId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{ tabId: string; side: 'left' | 'right' } | null>(null)

  const handleTabDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    setDragTabId(tabId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', tabId)
  }, [])

  const handleTabDragOver = useCallback((e: React.DragEvent, tabId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragTabId || tabId === dragTabId) {
      setDropIndicator(null)
      return
    }
    // Determine left/right side based on mouse position within the tab
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const side = (e.clientX - rect.left) < rect.width / 2 ? 'left' : 'right'
    setDropIndicator({ tabId, side })
  }, [dragTabId])

  const handleTabDrop = useCallback((e: React.DragEvent, targetTabId: string) => {
    e.preventDefault()
    if (!dragTabId || dragTabId === targetTabId) {
      setDragTabId(null)
      setDropIndicator(null)
      return
    }
    const side = dropIndicator?.side ?? 'right'
    setTabs(prev => {
      const fromIdx = prev.findIndex(t => t.tabId === dragTabId)
      const toIdx = prev.findIndex(t => t.tabId === targetTabId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIdx, 1)
      // Adjust insertion index after removal
      const insertIdx = fromIdx < toIdx
        ? (side === 'left' ? toIdx - 1 : toIdx)
        : (side === 'left' ? toIdx : toIdx + 1)
      next.splice(Math.max(0, insertIdx), 0, moved)
      return next
    })
    setDragTabId(null)
    setDropIndicator(null)
  }, [dragTabId, dropIndicator])

  const handleTabDragEnd = useCallback(() => {
    setDragTabId(null)
    setDropIndicator(null)
  }, [])

  // Close tab — with unsaved changes confirmation
  const [confirmCloseTabId, setConfirmCloseTabId] = useState<string | null>(null)

  const doCloseTab = useCallback((tabId: string) => {
    if (tabs.length <= 1) {
      // Last tab — reset to a clean blank workflow (with default seed node)
      const blankName = 'Untitled Workflow'
      tabIdCounter++
      const newTabId = `tab-${tabIdCounter}`
      const { nodes, edges } = getDefaultNewWorkflowContent()
      useWorkflowStore.setState({ workflowId: null, workflowName: blankName, nodes, edges, isDirty: false })
      setTabs([{ tabId: newTabId, workflowId: null, workflowName: blankName, nodes, edges, isDirty: false }])
      setActiveTabId(newTabId)
      return
    }
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
    const tab = tabs.find(t => t.tabId === tabId)
    if (tab?.isDirty) {
      setConfirmCloseTabId(tabId)
    } else {
      doCloseTab(tabId)
    }
  }, [tabs, doCloseTab])

  // ── Tab context menu (right-click) ──────────────────────────────────
  const [tabContextMenu, setTabContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const tabContextMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!tabContextMenu) return
    const handler = (e: MouseEvent) => {
      if (tabContextMenuRef.current && !tabContextMenuRef.current.contains(e.target as Node)) {
        setTabContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [tabContextMenu])

  const closeMultipleTabs = useCallback((tabIds: string[]) => {
    // Filter out tabs that would leave us with zero tabs
    const remaining = tabs.filter(t => !tabIds.includes(t.tabId))
    if (remaining.length === 0) return
    setTabs(remaining)
    if (tabIds.includes(activeTabId)) {
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

  const handleTabContextAction = useCallback((action: string) => {
    if (!tabContextMenu) return
    const { tabId } = tabContextMenu
    setTabContextMenu(null)

    switch (action) {
      case 'close':
        doCloseTab(tabId)
        break
      case 'closeOthers': {
        const others = tabs.filter(t => t.tabId !== tabId).map(t => t.tabId)
        closeMultipleTabs(others)
        break
      }
      case 'closeRight': {
        const idx = tabs.findIndex(t => t.tabId === tabId)
        const rightTabs = tabs.slice(idx + 1).map(t => t.tabId)
        if (rightTabs.length > 0) closeMultipleTabs(rightTabs)
        break
      }
      case 'closeSaved': {
        const savedTabs = tabs.filter(t => !t.isDirty && t.tabId !== tabId).map(t => t.tabId)
        if (savedTabs.length > 0) closeMultipleTabs(savedTabs)
        break
      }
      case 'closeAll': {
        // Keep one new tab with default seed node
        saveCurrentTabSnapshot()
        tabIdCounter++
        const newTabId = `tab-${tabIdCounter}`
        const { nodes, edges } = getDefaultNewWorkflowContent()
        const newTab: TabSnapshot = { tabId: newTabId, workflowId: null, workflowName: 'Untitled Workflow', nodes, edges, isDirty: false }
        setTabs([newTab])
        useWorkflowStore.setState({ workflowId: null, workflowName: 'Untitled Workflow', nodes, edges, isDirty: false })
        setActiveTabId(newTabId)
        break
      }
    }
  }, [tabContextMenu, tabs, doCloseTab, closeMultipleTabs, saveCurrentTabSnapshot])

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
      persistentStorage.set(WORKFLOW_SESSION_STORAGE_KEY, {
        version: 1,
        activeTabId,
        tabIdCounter,
        tabs
      } satisfies PersistedWorkflowSession)
    }, 300)
    return () => clearTimeout(timer)
  }, [startupSessionReady, tabs, activeTabId])

  // Auto-restore last workflow on first mount
  useEffect(() => {
    if (!startupSessionReady || restoredFromPersistedSession) return
    if (hasRestoredLastWorkflow) return
    setHasRestoredLastWorkflow(true)

    persistentStorage.get<string>('wavespeed_last_workflow_id').then(lastId => {
      if (lastId) {
        loadWorkflow(lastId).catch(() => {
          persistentStorage.remove('wavespeed_last_workflow_id')
        })
      }
    })
  }, [startupSessionReady, restoredFromPersistedSession, hasRestoredLastWorkflow, loadWorkflow])

  // Persist current workflow ID for next session restore
  useEffect(() => {
    if (workflowId) {
      persistentStorage.set('wavespeed_last_workflow_id', workflowId)
    }
  }, [workflowId])

  // Load template from URL query param
  useEffect(() => {
    const templateId = searchParams.get('template')
    if (!templateId || !startupSessionReady) return
    
    const loadTemplateData = async () => {
      try {
        // Load templates
        await loadTemplates({ templateType: 'workflow' })
        
        // Get the template by ID
        const result = await window.workflowAPI?.invoke('template:get', { id: templateId }) as Template | null
        if (!result || !result.workflowData) {
          showIoToast('error', t('workflow.templateNotFound', 'Template not found'))
          setSearchParams({}, { replace: true })
          return
        }
        
        // Increment use count
        await useTemplate(templateId)
        
        // Create new workflow from template — generate fresh IDs to avoid UNIQUE constraint conflicts
        const { graphDefinition } = result.workflowData
        const defMap = new Map(
          nodeDefs.map(def => [
            def.type,
            { params: def.params ?? [], inputs: def.inputs ?? [], outputs: def.outputs ?? [], label: def.label ?? def.type }
          ])
        )
        // Fetch models list to resolve modelInputSchema for ai-task nodes
        let modelMap = new Map<string, unknown[]>()
        try {
          const allModels = await modelsIpc.list()
          modelMap = new Map((allModels ?? []).map((m: any) => [m.modelId, m.inputSchema ?? []]))
        } catch { /* ignore */ }

        const idMap = new Map<string, string>()
        graphDefinition.nodes.forEach((n: any) => {
          idMap.set(String(n.id), crypto.randomUUID())
        })
        const wfNodes = graphDefinition.nodes.map((n: any) => {
          const def = defMap.get(n.nodeType)
          const meta = n.params?.__meta as Record<string, unknown> | undefined
          let modelInputSchema = (meta?.modelInputSchema as unknown[]) ?? []
          const label = (meta?.label as string) || (def ? def.label : n.nodeType)
          const { __meta: _, ...cleanParams } = (n.params ?? {}) as Record<string, unknown>
          // If modelInputSchema is empty but modelId exists, resolve from models list
          const modelId = cleanParams.modelId as string | undefined
          if ((!modelInputSchema || modelInputSchema.length === 0) && modelId) {
            modelInputSchema = (modelMap.get(modelId) as unknown[]) ?? []
          }
          return {
            id: idMap.get(String(n.id)) ?? n.id,
            type: 'custom',
            position: n.position,
            data: {
              nodeType: n.nodeType,
              label,
              params: cleanParams,
              paramDefinitions: def?.params ?? [],
              inputDefinitions: def?.inputs ?? [],
              outputDefinitions: def?.outputs ?? [],
              modelInputSchema,
            }
          }
        })
        const wfEdges = graphDefinition.edges.map((e: any) => ({
          id: crypto.randomUUID(),
          source: idMap.get(String(e.sourceNodeId)) ?? e.sourceNodeId,
          target: idMap.get(String(e.targetNodeId)) ?? e.targetNodeId,
          sourceHandle: e.sourceOutputKey,
          targetHandle: e.targetInputKey,
          type: 'custom',
        }))
        
        // Update workflow store
        useWorkflowStore.setState({
          workflowId: null,
          workflowName: result.name,
          nodes: wfNodes,
          edges: wfEdges,
          isDirty: true
        })
        
        showIoToast('success', `${t('workflow.templateLoaded', 'Template loaded')}: ${result.name}`)
        
        // Clear the query param
        setSearchParams({}, { replace: true })
      } catch (err) {
        console.error('Failed to load template:', err)
        showIoToast('error', t('workflow.templateLoadFailed', 'Failed to load template'))
        setSearchParams({}, { replace: true })
      }
    }
    
    loadTemplateData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, startupSessionReady]) // Only depend on searchParams and startupSessionReady

  // Auto-save: when workflow has a name and is dirty, save after 2s debounce
  // Triggers on: param changes, connections, model switches, node adds/removes
  useEffect(() => {
    if (!isDirty || !workflowId || !workflowName || /^Untitled Workflow(\s+\d+)?$/.test(workflowName)) return
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
    if (!isRunning && workflowId && workflowName && !/^Untitled Workflow(\s+\d+)?$/.test(workflowName)) {
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

  // Global Ctrl/Cmd+W handler — close active tab
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrlOrCmd = navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? e.metaKey : e.ctrlKey
      if (ctrlOrCmd && e.key === 'w') {
        e.preventDefault()
        const tab = tabs.find(t => t.tabId === activeTabId)
        if (tab?.isDirty) {
          setConfirmCloseTabId(activeTabId)
        } else {
          doCloseTab(activeTabId)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [tabs, activeTabId, doCloseTab])

  // Init
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
      if (isWorkflowApiUnavailable(err)) {
        setModelSyncStatus('unavailable')
      } else {
        setModelSyncStatus('error'); setModelSyncError(err instanceof Error ? err.message : 'Failed')
      }
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
        .catch(err => {
          if (isWorkflowApiUnavailable(err)) setModelSyncStatus('unavailable')
          else { setModelSyncStatus('error'); setModelSyncError(err instanceof Error ? err.message : 'Sync failed') }
        })
    }
  }, [desktopModels])

  useEffect(() => {
    if (modelsError) {
      if (modelsError.includes(WORKFLOW_API_UNAVAILABLE_MSG)) setModelSyncStatus('unavailable')
      else { setModelSyncStatus('error'); setModelSyncError(modelsError) }
    }
  }, [modelsError])



  // Run All — browser execution only (in-process via runAllInBrowser)
  const handleRunAll = async (times = 1) => {
    if (nodes.length === 0) return
    const runAllInBrowser = useExecutionStore.getState().runAllInBrowser
    const browserNodes = nodes.map(n => ({
      id: n.id,
      data: {
        nodeType: n.data?.nodeType ?? '',
        params: { ...(n.data?.params ?? {}), __meta: { modelInputSchema: n.data?.modelInputSchema ?? [] } },
        label: n.data?.label
      }
    }))
    const browserEdges = edges.map(e => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined }))
    const runTimes = Math.max(1, Math.min(99, Math.floor(times || 1)))
    runCancelRef.current = false
    setIsBatchRunning(true)
    try {
      for (let i = 0; i < runTimes; i++) {
        if (runCancelRef.current) break
        await runAllInBrowser(browserNodes, browserEdges)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setExecToast({ type: 'error', msg: msg || t('workflow.runFailed', 'Run failed') })
      setTimeout(() => setExecToast(null), 4000)
    } finally {
      setIsBatchRunning(false)
    }
  }


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
    try {
      const wfNodes = nodes.map(n => ({
        id: n.id, nodeType: n.data.nodeType, position: n.position,
        params: { ...(n.data.params ?? {}), __meta: { label: n.data.label, modelInputSchema: n.data.modelInputSchema ?? [] } }
      }))
      const wfEdges = useWorkflowStore.getState().edges.map(e => ({ id: e.id, sourceNodeId: e.source, targetNodeId: e.target, sourceOutputKey: e.sourceHandle ?? 'output', targetInputKey: e.targetHandle ?? 'input' }))
      const idForExport = workflowId ?? ''
      const nameForExport = workflowName || 'Untitled Workflow'
      await storageIpc.exportWorkflowJson(idForExport, nameForExport, { nodes: wfNodes, edges: wfEdges })
      showIoToast('success', t('workflow.exported', 'Exported successfully'))
    } catch (err) {
      console.error('Export failed:', err)
      showIoToast('error', t('workflow.exportFailed', 'Export failed'))
    }
  }, [workflowId, workflowName, nodes, t])

  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false)

  const handleSaveAsTemplate = useCallback(() => {
    if (!workflowId) return
    setShowSaveTemplateDialog(true)
  }, [workflowId])

  const handleSaveTemplateConfirm = useCallback(async (data: import('@/components/templates/TemplateDialog').TemplateFormData) => {
    try {
      const wfNodes = nodes.map(n => ({
        id: n.id, nodeType: n.data.nodeType, position: n.position,
        params: { ...(n.data.params ?? {}), __meta: { label: n.data.label, modelInputSchema: n.data.modelInputSchema ?? [] } }
      }))
      const wfEdges = useWorkflowStore.getState().edges.map(e => ({ id: e.id, sourceNodeId: e.source, targetNodeId: e.target, sourceOutputKey: e.sourceHandle ?? 'output', targetInputKey: e.targetHandle ?? 'input' }))
      const nodeTypes = Array.from(new Set(nodes.map(n => n.data.nodeType)))

      await createTemplate({
        name: data.name,
        description: data.description || null,
        tags: data.tags,
        thumbnail: data.thumbnail || null,
        type: 'custom',
        templateType: 'workflow',
        workflowData: {
          category: data.category || 'ai-generation',
          graphDefinition: { nodes: wfNodes, edges: wfEdges },
          nodeTypes,
          nodeCount: nodes.length,
          useCases: []
        }
      })
      showIoToast('success', t('workflow.templateSaved', 'Saved as template'))
    } catch (err) {
      console.error('Save template failed:', err)
      showIoToast('error', t('workflow.saveTemplateFailed', 'Failed to save template'))
    }
  }, [nodes, createTemplate, t])

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
      {modelSyncStatus === 'unavailable' && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/50 border-b border-border text-xs text-muted-foreground">
          <span>{t('workflow.modelSyncDesktopOnly', 'Model sync is available in the WaveSpeed Desktop app.')}</span>
        </div>
      )}
      {modelSyncStatus === 'error' && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-red-500/10 border-b border-red-500/30 text-xs text-red-400">
          <span>Models failed: {modelSyncError}</span>
          <button onClick={syncModels} className="underline hover:text-red-300">Retry</button>
        </div>
      )}

      {/* ── Toolbar — unified header ──────────────────────────── */}
      <div className="flex items-center border-b border-border bg-card py-1.5 px-2 gap-1.5 min-h-[40px]">
        {/* Left: Panel toggles */}
        <div className="flex items-center gap-3">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button onClick={toggleWorkflowPanel}
                className={`h-7 w-7 rounded-md text-xs font-medium transition-colors flex items-center justify-center ${showWorkflowPanel ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}>
                <Workflow className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('workflow.workflows', 'Workflows')}</TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button onClick={toggleNodePalette}
                data-guide="node-palette-btn"
                className={`h-7 w-7 rounded-md text-xs font-medium transition-colors flex items-center justify-center ${showNodePalette ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v3a3 3 0 0 0 3 3h3"/><path d="M15 15l3 3"/>
                </svg>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('workflow.nodes', 'Nodes')}</TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button onClick={() => setShowTemplateDialog(true)}
                className={`h-7 w-7 rounded-md text-xs font-medium transition-colors flex items-center justify-center ${showTemplateDialog ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/><path d="M13 13h4"/><path d="M13 17h4"/>
                </svg>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('templates.title', 'Templates')}</TooltipContent>
          </Tooltip>
        </div>
        <div className="w-px h-5 bg-border mx-1" />

        {/* Tabs — inline, scrollable */}
        <div className="flex items-center gap-px overflow-x-auto flex-shrink min-w-0">
          {tabs.map(tab => {
            const isActive = tab.tabId === activeTabId
            const isEditing = editingTabId === tab.tabId
            return (
              <div key={tab.tabId}
                draggable={!isEditing}
                onDragStart={e => handleTabDragStart(e, tab.tabId)}
                onDragOver={e => handleTabDragOver(e, tab.tabId)}
                onDrop={e => handleTabDrop(e, tab.tabId)}
                onDragEnd={handleTabDragEnd}
                onClick={() => switchTab(tab.tabId)}
                onContextMenu={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  setTabContextMenu({ tabId: tab.tabId, x: e.clientX, y: e.clientY })
                }}
                className={`group relative flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-md cursor-pointer text-xs select-none min-w-[72px] max-w-[160px] transition-colors
                  ${dragTabId === tab.tabId ? 'opacity-40' : ''}
                  ${isActive
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                {/* Drop indicator line */}
                {dropIndicator?.tabId === tab.tabId && dropIndicator.side === 'left' && (
                  <div className="absolute -left-px top-1 bottom-1 w-0.5 rounded-full bg-primary" />
                )}
                {dropIndicator?.tabId === tab.tabId && dropIndicator.side === 'right' && (
                  <div className="absolute -right-px top-1 bottom-1 w-0.5 rounded-full bg-primary" />
                )}
                {isEditing ? (
                  <input
                    type="text"
                    value={editingTabName}
                    onChange={e => setEditingTabName(e.target.value)}
                    onBlur={commitRenameTab}
                    onKeyDown={e => {
                      e.stopPropagation()
                      if (e.key === 'Enter') commitRenameTab()
                      if (e.key === 'Escape') cancelRenameTab()
                    }}
                    onClick={e => e.stopPropagation()}
                    autoFocus
                    className={`flex-1 min-w-0 bg-transparent border-b text-xs outline-none px-0 py-0 ${
                      editingTabName.trim() && tabs.some(t => t.tabId !== editingTabId && t.workflowName === editingTabName.trim())
                        ? 'border-red-500 text-red-400'
                        : 'border-primary'
                    }`}
                  />
                ) : (
                  <span className="truncate flex-1" onDoubleClick={e => { e.stopPropagation(); startRenameTab(tab.tabId) }}>{tab.workflowName}</span>
                )}
                {!isEditing && tab.isDirty && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />}
                {!isEditing && (
                  <button onClick={(e) => closeTab(tab.tabId, e)}
                    className="w-4 h-4 flex items-center justify-center rounded-sm text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/80 opacity-0 group-hover:opacity-100 transition-opacity">
                    ✕
                  </button>
                )}
              </div>
            )
          })}
          <button onClick={addTab}
            className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-sm flex-shrink-0"
            title={t('workflow.newTab', 'New tab')}>
            +
          </button>
        </div>

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

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: Run controls */}
        <div className="flex items-center gap-1.5" data-guide="run-controls">
          <div className="flex items-center rounded-lg overflow-hidden shadow-sm">
            {/* Run button — disabled in browser (no execution API) */}
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  className="h-8 px-3.5 flex items-center gap-1.5 bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={nodes.length === 0 || isRunning || isBatchRunning}
                  onClick={() => handleRunAll(runCount)}
                >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <polygon points="6,3 20,12 6,21" />
              </svg>
                  {isRunning || isBatchRunning ? t('workflow.running', 'Running...') : t('workflow.runWorkflow', 'Run')}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {nodes.length === 0 ? t('workflow.addNodesToRun', 'Add nodes to run') : t('workflow.runWorkflow', 'Run')}
              </TooltipContent>
            </Tooltip>
            {/* Run count */}
            <div className="h-8 flex items-center bg-[hsl(var(--muted))] border-l border-[hsl(var(--border))]">
              <input
                type="number"
                min={1}
                max={99}
                value={runCount}
                onChange={e => setRunCount(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                className="w-10 h-full bg-transparent px-1 text-xs text-center text-foreground focus:outline-none dark:[color-scheme:dark]"
                title={t('workflow.runCount', 'Run count')}
              />
            </div>
          </div>
          {/* Cancel button */}
          {(isRunning || isBatchRunning) && (
            <button
              className="h-8 w-8 rounded-lg flex items-center justify-center bg-red-900/60 text-red-300 hover:bg-red-800/70 transition-colors"
              onClick={() => {
                runCancelRef.current = true
                if (workflowId) cancelAll(workflowId)
              }}
              title={t('workflow.cancelAll', 'Cancel All')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
        {/* Monitor toggle */}
        <MonitorToggleBtn />

        {/* Workflow Results panel (right) toggle */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              onClick={toggleWorkflowResultsPanel}
              className={`h-8 w-8 rounded-md border transition-colors flex items-center justify-center ${
                showWorkflowResultsPanel
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-[hsl(var(--border))] text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <PanelRight className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t('workflow.workflowResults', 'Workflow Results')}
          </TooltipContent>
        </Tooltip>

        {/* Help / Guide button */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              onClick={guide.show}
              className="h-8 w-8 rounded-md border border-[hsl(var(--border))] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('workflow.guide.welcome.title', 'Guide')}</TooltipContent>
        </Tooltip>

        {/* ── More menu (Import / Export / Save) ─────────────── */}
        <MoreMenu
          workflowId={workflowId}
          onImport={handleImport}
          onExport={handleExport}
          onSave={handleSave}
          className="mr-1"
          onSaveAsTemplate={handleSaveAsTemplate}
          data-guide="toolbar-more"
        />
      </div>

      {/* ── Main content ───────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Left panels as overlay so they don't shift the canvas layout */}
        {showNodePalette && (
          <div className="absolute top-0 left-0 bottom-0 z-30 h-full">
            <NodePalette definitions={nodeDefs} />
          </div>
        )}
        {showWorkflowPanel && (
          <div className="absolute top-0 left-0 bottom-0 z-30 h-full">
            <WorkflowList onOpen={async (id) => {
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
            }} onDelete={(deletedId) => {
              // Close any tab that has this workflow open
              const tabToClose = tabs.find(t => t.workflowId === deletedId)
              if (tabToClose) {
                if (tabs.length <= 1) {
                  // Last tab — reset to blank with default seed node instead of closing
                  const blankName = 'Untitled Workflow'
                  const { nodes, edges } = getDefaultNewWorkflowContent()
                  useWorkflowStore.setState({ workflowId: null, workflowName: blankName, nodes, edges, isDirty: false })
                  setTabs([{ ...tabToClose, workflowId: null, workflowName: blankName, nodes, edges, isDirty: false }])
                } else {
                  doCloseTab(tabToClose.tabId)
                }
              }
              invalidateWorkflowListCache()
            }} />
          </div>
        )}
        <div data-guide="canvas" className="flex-1 h-full min-w-0">
          <WorkflowCanvas nodeDefs={nodeDefs} />
        </div>
        {showWorkflowResultsPanel && <WorkflowResultsPanel />}
      </div>

      {/* ── Execution Monitor (bottom, collapsible) ───────────────── */}
      <RunMonitor workflowId={workflowId} />

      {/* Preview overlay — covers the canvas area only (absolute within the page) */}
      {previewSrc && (
        <div className="absolute inset-0 z-[999] flex flex-col bg-black/85"
          onClick={closePreview} style={{ cursor: 'default' }}>
          <div className="flex-1 flex items-center justify-center p-6 min-h-0 overflow-hidden">
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
              <div className="relative max-w-[80%] max-h-full flex items-center justify-center" onClick={e => e.stopPropagation()}>
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
                  className="max-w-full rounded-xl shadow-2xl object-contain" style={{ maxHeight: 'calc(100vh - 120px)' }} />
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

      {/* Workflow Template Picker Dialog */}
      <TemplatePickerDialog
        open={showTemplateDialog}
        onOpenChange={setShowTemplateDialog}
        templateType="workflow"
        onUseTemplate={async (template) => {
          if (template.workflowData?.graphDefinition) {
            saveCurrentTabSnapshot()
            tabIdCounter++
            const newTabId = `tab-${tabIdCounter}`
            setTabs(prev => [...prev, { tabId: newTabId, workflowId: null, workflowName: template.name, nodes: [], edges: [], isDirty: false }])
            setActiveTabId(newTabId)

            // Build a definition map from already-loaded nodeDefs
            const defMap = new Map(
              nodeDefs.map(def => [
                def.type,
                { params: def.params ?? [], inputs: def.inputs ?? [], outputs: def.outputs ?? [], label: def.label ?? def.type }
              ])
            )

            // Fetch models list to resolve modelInputSchema for ai-task nodes
            let modelMap = new Map<string, unknown[]>()
            try {
              const allModels = await modelsIpc.list()
              modelMap = new Map((allModels ?? []).map((m: any) => [m.modelId, m.inputSchema ?? []]))
            } catch { /* ignore — schemas will be empty */ }

            const gd = template.workflowData.graphDefinition
            const idMap = new Map<string, string>()
            const newNodes = (gd.nodes ?? []).map((n: any) => {
              const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
              idMap.set(n.id, newId)
              const def = defMap.get(n.nodeType)
              // Extract __meta (same as loadWorkflow does)
              const meta = n.params?.__meta as Record<string, unknown> | undefined
              let modelInputSchema = (meta?.modelInputSchema as unknown[]) ?? []
              const label = (meta?.label as string) || (def ? def.label : n.nodeType)
              const { __meta: _, ...cleanParams } = (n.params ?? {}) as Record<string, unknown>
              // If modelInputSchema is empty but modelId exists, resolve from models list
              const modelId = cleanParams.modelId as string | undefined
              if ((!modelInputSchema || modelInputSchema.length === 0) && modelId) {
                modelInputSchema = (modelMap.get(modelId) as unknown[]) ?? []
              }
              return {
                id: newId,
                type: 'custom',
                position: n.position ?? { x: 0, y: 0 },
                data: {
                  nodeType: n.nodeType,
                  label,
                  params: cleanParams,
                  paramDefinitions: def?.params ?? [],
                  inputDefinitions: def?.inputs ?? [],
                  outputDefinitions: def?.outputs ?? [],
                  modelInputSchema,
                }
              }
            })
            const newEdges = (gd.edges ?? []).map((e: any) => ({
              id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              source: idMap.get(e.sourceNodeId) ?? e.sourceNodeId,
              target: idMap.get(e.targetNodeId) ?? e.targetNodeId,
              sourceHandle: e.sourceOutputKey ?? 'output',
              targetHandle: e.targetInputKey ?? 'input',
              type: 'custom',
            }))

            useWorkflowStore.setState({
              workflowId: null,
              workflowName: template.name,
              nodes: newNodes,
              edges: newEdges,
              isDirty: true,
            })
            showIoToast('success', `${t('workflow.templateLoaded', 'Loaded template')} "${template.name}"`)
          }
        }}
      />

      {/* Save as Template Dialog */}
      <TemplateDialog
        open={showSaveTemplateDialog}
        onOpenChange={setShowSaveTemplateDialog}
        mode="create"
        defaultName={workflowName}
        isWorkflow
        onSave={handleSaveTemplateConfirm}
      />

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

      {/* Tab context menu (right-click) */}
      {tabContextMenu && (() => {
        const idx = tabs.findIndex(t => t.tabId === tabContextMenu.tabId)
        const hasRight = idx < tabs.length - 1
        const hasSaved = tabs.some(t => !t.isDirty && t.tabId !== tabContextMenu.tabId)
        return (
          <div ref={tabContextMenuRef}
            className="fixed z-[9999] w-48 rounded-lg border border-border bg-popover shadow-xl py-1 text-xs"
            style={{ left: tabContextMenu.x, top: tabContextMenu.y }}>
            <button onClick={() => handleTabContextAction('close')}
              className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors">
              {t('workflow.tabClose', 'Close')}
            </button>
            <button onClick={() => handleTabContextAction('closeOthers')} disabled={tabs.length <= 1}
              className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {t('workflow.tabCloseOthers', 'Close Others')}
            </button>
            <button onClick={() => handleTabContextAction('closeRight')} disabled={!hasRight}
              className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {t('workflow.tabCloseRight', 'Close to the Right')}
            </button>
            <button onClick={() => handleTabContextAction('closeSaved')} disabled={!hasSaved}
              className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {t('workflow.tabCloseSaved', 'Close Saved')}
            </button>
            <div className="border-t border-border my-1" />
            <button onClick={() => handleTabContextAction('closeAll')}
              className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors text-red-500 dark:text-red-400">
              {t('workflow.tabCloseAll', 'Close All')}
            </button>
          </div>
        )
      })()}

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

      {/* Workflow Guide */}
      <WorkflowGuide open={guide.open} onClose={guide.dismiss} onStepChange={setGuideStepKey} />
    </div>
  )
}

/* ── Naming Dialog Component ───────────────────────────────────────── */

/** Same format as auto-name in workflow.store when saving forRun (so dialog can pre-fill). */
function defaultWorkflowName() {
  return `Workflow ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`
}

function NamingDialog({ defaultValue, onConfirm }: { defaultValue: string; onConfirm: (result: { name: string; overwriteId?: string } | null) => void }) {
  const { t } = useTranslation()
  const [value, setValue] = useState(() => {
    const d = defaultValue
    if (!d || /^Untitled Workflow(\s+\d+)?$/.test(d)) return defaultWorkflowName()
    return d
  })
  const [existingWorkflows, setExistingWorkflows] = useState<Array<{ id: string; name: string }>>([])
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false)
  const currentWorkflowId = useWorkflowStore(s => s.workflowId)

  // Load existing workflow names on mount
  useEffect(() => {
    workflowIpc.list().then(list => {
      setExistingWorkflows((list ?? []).filter(w => w.id !== currentWorkflowId).map(w => ({ id: w.id, name: w.name })))
    }).catch(() => {})
  }, [currentWorkflowId])

  const trimmed = value.trim()
  const duplicateWorkflow = trimmed.length > 0 ? existingWorkflows.find(w => w.name === trimmed) : undefined

  const handleSubmit = () => {
    if (!trimmed) return
    if (duplicateWorkflow) {
      setShowOverwriteConfirm(true)
      return
    }
    onConfirm({ name: trimmed })
  }

  const handleOverwrite = () => {
    if (duplicateWorkflow) {
      onConfirm({ name: trimmed, overwriteId: duplicateWorkflow.id })
    }
  }

  if (showOverwriteConfirm && duplicateWorkflow) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => setShowOverwriteConfirm(false)}>
        <div className="w-[360px] rounded-xl border border-border bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
          <h3 className="text-sm font-semibold mb-1">{t('workflow.overwriteWorkflow', 'Overwrite Workflow')}</h3>
          <p className="text-xs text-muted-foreground mb-4">
            {t('workflow.overwriteConfirm', { name: trimmed, defaultValue: 'A workflow named "{{name}}" already exists. Do you want to overwrite it?' })}
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowOverwriteConfirm(false)}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t('workflow.cancel', 'Cancel')}
            </button>
            <button onClick={handleOverwrite}
              className="px-4 py-1.5 rounded-md text-xs font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors">
              {t('workflow.overwrite', 'Overwrite')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => onConfirm(null)}>
      <div className="w-[360px] rounded-xl border border-border bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold mb-1">{t('workflow.nameYourWorkflow', 'Name your workflow')}</h3>
        <p className="text-xs text-muted-foreground mb-3">{t('workflow.nameYourWorkflowDesc', 'Give it a name to save to disk.')}</p>
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder={t('workflow.nameYourWorkflowPlaceholder', 'e.g. Product Image Pipeline')}
          autoFocus
          className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 mb-1 ${duplicateWorkflow ? 'border-orange-500 focus:ring-orange-500/50' : 'border-input focus:ring-primary'}`}
        />
        {duplicateWorkflow && (
          <p className="text-[11px] text-orange-400 mb-2">{t('workflow.nameExists', 'A workflow with this name already exists. Saving will overwrite it.')}</p>
        )}
        {!duplicateWorkflow && <div className="mb-2" />}
        <div className="flex justify-end gap-2">
          <button onClick={() => onConfirm(null)}
            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            {t('workflow.cancel', 'Cancel')}
          </button>
          <button onClick={handleSubmit} disabled={!trimmed}
            className="px-4 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {t('workflow.save', 'Save')}
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

/* ── Monitor Toggle Button ─────────────────────────────────────────── */
function MonitorToggleBtn() {
  const { t } = useTranslation()
  const toggleRunMonitor = useExecutionStore(s => s.toggleRunMonitor)
  const showRunMonitor = useExecutionStore(s => s.showRunMonitor)
  const runSessions = useExecutionStore(s => s.runSessions)
  const activeRuns = runSessions.filter(s => s.status === 'running').length

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          onClick={toggleRunMonitor}
          className={`relative h-8 w-8 rounded-md border transition-colors flex items-center justify-center ${
            showRunMonitor
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-[hsl(var(--border))] text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          <PanelBottom className="w-4 h-4" />
          {activeRuns > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-blue-500 text-white text-[8px] flex items-center justify-center font-bold animate-pulse">
              {activeRuns}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t('workflow.executionMonitor', 'Execution Monitor')}</TooltipContent>
    </Tooltip>
  )
}

/* ── More Menu — collapsed Import / Export / Save ──────────────────── */
function MoreMenu({ workflowId, onImport, onExport, onSave, onSaveAsTemplate, className, 'data-guide': dataGuide }: {
  workflowId: string | null
  onImport: () => void
  onExport: () => void
  onSave: () => void
  onSaveAsTemplate: () => void
  className?: string
  'data-guide'?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', handler, true)
    window.addEventListener('keydown', keyHandler)
    return () => {
      window.removeEventListener('pointerdown', handler, true)
      window.removeEventListener('keydown', keyHandler)
    }
  }, [open])

  return (
    <div className={`relative ${className ?? ''}`} ref={ref} data-guide={dataGuide}>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button
            onClick={() => setOpen(!open)}
            className={`h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ${open ? 'bg-accent text-foreground' : ''}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
            </svg>
          </button>
        </TooltipTrigger>
        {!open && <TooltipContent side="bottom">{t('workflow.more', 'More')}</TooltipContent>}
      </Tooltip>
      {open && (
        <div className="absolute top-8 right-0 z-[100] w-36 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-xl py-1">
          <button onClick={() => { onImport(); setOpen(false) }}
            className="w-full px-3 py-1.5 text-xs text-left hover:bg-[hsl(var(--accent))] transition-colors flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {t('workflow.import', 'Import')}
          </button>
          <button onClick={() => { onExport(); setOpen(false) }}
            className="w-full px-3 py-1.5 text-xs text-left hover:bg-[hsl(var(--accent))] transition-colors flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            {t('workflow.export', 'Export')}
          </button>
          {workflowId && (
            <button onClick={() => { onSaveAsTemplate(); setOpen(false) }}
              className="w-full px-3 py-1.5 text-xs text-left hover:bg-[hsl(var(--accent))] transition-colors flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
              </svg>
              {t('workflow.saveAsTemplate', 'Save as Template')}
            </button>
          )}
          <button onClick={() => { onSave(); setOpen(false) }}
            className="w-full px-3 py-1.5 text-xs text-left hover:bg-[hsl(var(--accent))] transition-colors flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
            </svg>
            {t('workflow.save', 'Save')}
          </button>
        </div>
      )}
    </div>
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
