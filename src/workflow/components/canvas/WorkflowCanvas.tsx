/**
 * WorkflowCanvas — ReactFlow wrapper with zoom, pan, drag-drop, and context menu.
 * Rewritten with Tailwind classes.
 */
import React, { useCallback, useRef, useState, useEffect, useMemo, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import ReactFlow, {
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  SelectionMode,
  type Connection, type ReactFlowInstance, type Node, type NodeChange, type OnSelectionChangeParams
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useWorkflowStore } from '../../stores/workflow.store'
import { useExecutionStore } from '../../stores/execution.store'
import { useUIStore } from '../../stores/ui.store'
import { CustomNode } from './CustomNode'
import { CustomEdge } from './CustomEdge'
import { AnnotationNode } from './AnnotationNode'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import type { NodeTypeDefinition, NodeCategory } from '@/workflow/types/node-defs'
import { fuzzySearch } from '@/lib/fuzzySearch'

const CATEGORY_ORDER: NodeCategory[] = ['input', 'ai-task', 'ai-generation', 'free-tool', 'processing', 'control', 'output']
const RECENT_NODE_TYPES_KEY = 'workflowRecentNodeTypes'
const MAX_RECENT_NODE_TYPES = 8

function loadRecentNodeTypes(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(RECENT_NODE_TYPES_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function saveRecentNodeTypes(types: string[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(RECENT_NODE_TYPES_KEY, JSON.stringify(types))
  } catch {
    // noop
  }
}

const nodeTypes = { custom: CustomNode, annotation: AnnotationNode }
const edgeTypes = { custom: CustomEdge }

interface WorkflowCanvasProps {
  nodeDefs?: NodeTypeDefinition[]
}

export function WorkflowCanvas({ nodeDefs = [] }: WorkflowCanvasProps) {
  const { t } = useTranslation()
  const { nodes, edges, onNodesChange, onEdgesChange, addEdge, addNode, removeNode, removeNodes, undo, redo, saveWorkflow } = useWorkflowStore()
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const selectedNodeIds = useUIStore(s => s.selectedNodeIds)
  const selectNode = useUIStore(s => s.selectNode)
  const selectNodes = useUIStore(s => s.selectNodes)
  const interactionMode = useUIStore(s => s.interactionMode)
  const setInteractionMode = useUIStore(s => s.setInteractionMode)
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; type: 'node' | 'canvas' | 'addNode' | 'edge'; nodeId?: string; edgeId?: string
  } | null>(null)
  const [addNodeQuery, setAddNodeQuery] = useState('')
  const [addNodeCollapsed, setAddNodeCollapsed] = useState<Record<string, boolean>>({})
  const [recentNodeTypes, setRecentNodeTypes] = useState<string[]>(() => loadRecentNodeTypes())

  const recordRecentNodeType = useCallback((nodeType: string) => {
    setRecentNodeTypes(prev => {
      const next = [nodeType, ...prev.filter(t => t !== nodeType)].slice(0, MAX_RECENT_NODE_TYPES)
      saveRecentNodeTypes(next)
      return next
    })
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
      const ctrlOrCmd = navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? event.metaKey : event.ctrlKey

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNodeIds.size > 0) {
        event.preventDefault()
        if (selectedNodeIds.size === 1) {
          removeNode([...selectedNodeIds][0]); selectNode(null)
        } else {
          removeNodes([...selectedNodeIds]); selectNode(null)
        }
      }
      if (ctrlOrCmd && event.key === 'c' && selectedNodeId) {
        event.preventDefault()
        const node = nodes.find(n => n.id === selectedNodeId)
        if (node) localStorage.setItem('copiedNode', JSON.stringify(node))
      }
      if (ctrlOrCmd && event.key === 'a') {
        event.preventDefault()
        selectNodes(nodes.map(n => n.id))
      }
      if (ctrlOrCmd && event.key === 's') {
        event.preventDefault(); saveWorkflow().catch(console.error)
      }
      if (ctrlOrCmd && event.key === 'z' && !event.shiftKey) {
        event.preventDefault(); undo()
      }
      if (ctrlOrCmd && event.key === 'z' && event.shiftKey) {
        event.preventDefault(); redo()
      }
      if (ctrlOrCmd && event.key === 'y') {
        event.preventDefault(); redo()
      }
      // V = Select mode, H = Hand (pan) mode
      if (event.key === 'v' || event.key === 'V') {
        if (!ctrlOrCmd) { setInteractionMode('select') }
      }
      if (event.key === 'h' || event.key === 'H') {
        if (!ctrlOrCmd) { setInteractionMode('hand') }
      }
      if (ctrlOrCmd && event.key === 'v') {
        event.preventDefault()
        const copiedNode = localStorage.getItem('copiedNode')
        if (copiedNode && reactFlowInstance.current) {
          try {
            const node = JSON.parse(copiedNode)
            const center = useUIStore.getState().getViewportCenter()
            addNode(node.data.nodeType, { x: center.x + (Math.random() - 0.5) * 60, y: center.y + (Math.random() - 0.5) * 60 },
              node.data.params, node.data.label, node.data.paramDefinitions ?? [], node.data.inputDefinitions ?? [], node.data.outputDefinitions ?? [])
            if (typeof node.data?.nodeType === 'string') recordRecentNodeType(node.data.nodeType)
          } catch (e) { console.error('Failed to paste node:', e) }
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeId, selectedNodeIds, removeNode, removeNodes, selectNode, selectNodes, nodes, addNode, undo, redo, saveWorkflow, recordRecentNodeType])

  const onConnect = useCallback((connection: Connection) => addEdge(connection), [addEdge])
  const onNodeClick = useCallback((_: React.MouseEvent, node: { id: string }) => selectNode(node.id), [selectNode])
  const onPaneClick = useCallback(() => { selectNode(null); setContextMenu(null) }, [selectNode])

  const onSelectionChange = useCallback(({ nodes: selectedNodes }: OnSelectionChangeParams) => {
    const ids = selectedNodes.map(n => n.id)
    if (ids.length === 0) return // pane click handles deselect
    selectNodes(ids)
  }, [selectNodes])

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY, type: 'node', nodeId: node.id })
  }, [])

  const onPaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY, type: 'canvas' })
  }, [])

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: { id: string }) => {
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY, type: 'edge', edgeId: edge.id })
  }, [])

  const openAddNodeMenu = useCallback((x: number, y: number) => {
    setAddNodeQuery('')
    setContextMenu({ x, y, type: 'addNode' })
  }, [])

  const projectMenuPosition = useCallback((x: number, y: number) => {
    if (!reactFlowInstance.current || !reactFlowWrapper.current) return { x, y }
    const bounds = reactFlowWrapper.current.getBoundingClientRect()
    return reactFlowInstance.current.project({ x: x - bounds.left, y: y - bounds.top })
  }, [])

  const addNodeAtMenuPosition = useCallback((def: NodeTypeDefinition) => {
    if (!contextMenu) return
    const position = projectMenuPosition(contextMenu.x, contextMenu.y)
    const defaultParams: Record<string, unknown> = {}
    for (const p of def.params) {
      if (p.default !== undefined) defaultParams[p.key] = p.default
    }
    const localizedLabel = t(`workflow.nodeDefs.${def.type}.label`, def.label)
    addNode(def.type, position, defaultParams, `${def.icon} ${localizedLabel}`, def.params, def.inputs, def.outputs)
    recordRecentNodeType(def.type)
    setContextMenu(null)
  }, [addNode, contextMenu, projectMenuPosition, t, recordRecentNodeType])

  const addNodeDisplayDefs = useMemo(() => {
    const q = addNodeQuery.trim()
    if (!q) return nodeDefs
    return fuzzySearch(nodeDefs, q, (def) => [
      def.type,
      def.category,
      def.label,
      t(`workflow.nodeDefs.${def.type}.label`, def.label)
    ]).map(r => r.item)
  }, [addNodeQuery, nodeDefs, t])

  const groupedAddNodeDefs = useMemo(() => {
    const recentVisible = recentNodeTypes
      .map(type => nodeDefs.find(def => def.type === type))
      .filter((def): def is NodeTypeDefinition => Boolean(def))
      .filter(def => addNodeDisplayDefs.some(visible => visible.type === def.type))
    const recentTypeSet = new Set(recentVisible.map(def => def.type))

    const groups = new Map<string, NodeTypeDefinition[]>()
    for (const def of addNodeDisplayDefs) {
      if (recentTypeSet.has(def.type)) continue
      const arr = groups.get(def.category) ?? []
      arr.push(def)
      groups.set(def.category, arr)
    }

    const sorted = [...groups.entries()].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a[0] as NodeCategory)
      const bi = CATEGORY_ORDER.indexOf(b[0] as NodeCategory)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
    if (recentVisible.length > 0) {
      return [['recent', recentVisible] as [string, NodeTypeDefinition[]], ...sorted]
    }
    return sorted
  }, [addNodeDisplayDefs, nodeDefs, recentNodeTypes])

  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    if (!contextMenu) return []

    if (contextMenu.type === 'edge' && contextMenu.edgeId) {
      const edgeId = contextMenu.edgeId
      return [{ label: t('workflow.deleteConnection', 'Delete Connection'), icon: '✕', action: () => useWorkflowStore.getState().removeEdge(edgeId), destructive: true }]
    }

    if (contextMenu.type === 'node' && contextMenu.nodeId) {
      const nodeId = contextMenu.nodeId
      const { runNode: rn, cancelNode: cn, continueFrom: cf, retryNode: rt, activeExecutions, nodeStatuses } = useExecutionStore.getState()
      const isRunning = activeExecutions.has(nodeId)
      const nodeStatus = nodeStatuses[nodeId]
      const items: ContextMenuItem[] = []

      // Run actions — always available, will auto-save/create workflow if needed (forRun: true = no name prompt)
      const ensureAndRun = async (action: (wfId: string, nId: string) => Promise<void>) => {
        let wfId = useWorkflowStore.getState().workflowId
        if (!wfId) {
          await useWorkflowStore.getState().saveWorkflow({ forRun: true })
          wfId = useWorkflowStore.getState().workflowId
          if (!wfId) return
        }
        action(wfId, nodeId)
      }

      if (isRunning) {
        items.push({ label: t('workflow.cancel', 'Cancel'), icon: '⏹', action: () => {
          const wfId = useWorkflowStore.getState().workflowId
          if (wfId) cn(wfId, nodeId)
        }})
      } else {
        items.push({ label: t('workflow.runNode', 'Run Node'), icon: '▶', action: () => ensureAndRun(rn) })
        items.push({ label: t('workflow.continueFrom', 'Continue From'), icon: '⏩', action: () => ensureAndRun(cf) })
        if (nodeStatus === 'error') {
          items.push({ label: t('workflow.retry', 'Retry'), icon: '🔄', action: () => ensureAndRun(rt) })
        }
      }

      items.push({ label: '', action: () => {}, divider: true })
      // Clear results + delete files — only show when node has results
      const hasResults = (useExecutionStore.getState().lastResults[nodeId] ?? []).length > 0
      if (hasResults) {
        items.push({
          label: t('workflow.clearResults', 'Clear Results'), icon: '🧹',
          action: async () => {
            try {
              const { historyIpc } = await import('../../ipc/ipc-client')
              await historyIpc.deleteAll(nodeId)
            } catch { /* best-effort */ }
            useExecutionStore.getState().clearNodeResults(nodeId)
            // Also clear hidden runs metadata from node params
            const node = useWorkflowStore.getState().nodes.find(n => n.id === nodeId)
            if (node) {
              const { __hiddenRuns: _, __showLatestOnly: _2, ...rest } = node.data.params as Record<string, unknown>
              useWorkflowStore.getState().updateNodeParams(nodeId, rest)
            }
          }
        })
      }
      items.push({
        label: t('common.copy', 'Copy'), icon: '📋', shortcut: 'Ctrl+C',
        action: () => { const n = nodes.find(n => n.id === nodeId); if (n) localStorage.setItem('copiedNode', JSON.stringify(n)) }
      })
      if (selectedNodeIds.size > 1 && selectedNodeIds.has(nodeId)) {
        items.push({ label: t('workflow.deleteSelected', 'Delete Selected ({{count}})', { count: selectedNodeIds.size }), icon: '🗑️', shortcut: 'Del', action: () => { removeNodes([...selectedNodeIds]); selectNode(null) }, destructive: true })
      } else {
        items.push({ label: t('workflow.delete', 'Delete'), icon: '🗑️', shortcut: 'Del', action: () => removeNode(nodeId), destructive: true })
      }
      return items
    }

    /** Convert context menu screen coords to flow position, accounting for wrapper offset */
    const menuToFlowPosition = () => {
      if (!reactFlowInstance.current || !reactFlowWrapper.current) return { x: contextMenu.x, y: contextMenu.y }
      const bounds = reactFlowWrapper.current.getBoundingClientRect()
      return reactFlowInstance.current.project({ x: contextMenu.x - bounds.left, y: contextMenu.y - bounds.top })
    }

    if (contextMenu.type === 'addNode') return []

    // Canvas context menu
    const copiedNode = localStorage.getItem('copiedNode')
    const items: ContextMenuItem[] = [
      { label: t('workflow.addNode', 'Add Node'), icon: '➕', keepOpen: true, action: () => openAddNodeMenu(contextMenu.x, contextMenu.y) },
      { label: t('workflow.addNote', 'Add Note'), icon: '📝', action: () => {
        const position = menuToFlowPosition()
        const noteId = uuidv4()
        useWorkflowStore.setState(state => ({
          nodes: [...state.nodes, { id: noteId, type: 'annotation', position, data: { nodeType: 'annotation', params: { title: '', body: '', color: 'hsl(var(--muted))' }, label: t('workflow.note', 'Note') } }],
          isDirty: true
        }))
      }}
    ]
    if (copiedNode) {
      items.push({
        label: t('workflow.paste', 'Paste'), icon: '📋', shortcut: 'Ctrl+V',
        action: () => {
          try {
            const node = JSON.parse(copiedNode)
            const position = menuToFlowPosition()
            addNode(node.data.nodeType, position, node.data.params, node.data.label, node.data.paramDefinitions ?? [], node.data.inputDefinitions ?? [], node.data.outputDefinitions ?? [])
            if (typeof node.data?.nodeType === 'string') recordRecentNodeType(node.data.nodeType)
          } catch (e) { console.error('Failed to paste node:', e) }
        }
      })
    }
    return items
  }, [contextMenu, removeNode, removeNodes, selectedNodeIds, selectNode, nodes, addNode, openAddNodeMenu, t, recordRecentNodeType])

  const onDragOver = useCallback((event: DragEvent) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }, [])

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault()
    const nodeType = event.dataTransfer.getData('application/reactflow-nodetype')
    if (!nodeType || !reactFlowInstance.current || !reactFlowWrapper.current) return
    const bounds = reactFlowWrapper.current.getBoundingClientRect()
    const position = reactFlowInstance.current.project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
    const def = nodeDefs.find(d => d.type === nodeType)
    const defaultParams: Record<string, unknown> = {}
    if (def) { for (const p of def.params) { if (p.default !== undefined) defaultParams[p.key] = p.default } }
    const newNodeId = addNode(nodeType, position, defaultParams, def ? `${def.icon} ${t(`workflow.nodeDefs.${def.type}.label`, def.label)}` : nodeType, def?.params ?? [], def?.inputs ?? [], def?.outputs ?? [])
    recordRecentNodeType(nodeType)
    // Auto-select the newly dropped node so the right config panel opens
    selectNode(newNodeId)
  }, [addNode, nodeDefs, recordRecentNodeType, selectNode, t])

  useEffect(() => {
    const handleFitView = () => {
      reactFlowInstance.current?.fitView({ padding: 0.2, duration: 300, minZoom: 0.05, maxZoom: 1.5 })
    }
    window.addEventListener('workflow:fit-view', handleFitView)
    return () => window.removeEventListener('workflow:fit-view', handleFitView)
  }, [])

  // Auto-layout: arrange nodes in a clean left-to-right DAG layout
  // Uses actual DOM measurements for node sizes to prevent overlap
  useEffect(() => {
    const handleAutoLayout = () => {
      const { nodes: currentNodes, edges: currentEdges, onNodesChange: applyChanges } = useWorkflowStore.getState()
      if (currentNodes.length === 0) return

      // ── Measure actual node sizes from DOM ──
      const nodeSize = new Map<string, { w: number; h: number }>()
      for (const n of currentNodes) {
        const el = document.querySelector(`[data-id="${n.id}"]`) as HTMLElement | null
        if (el) {
          nodeSize.set(n.id, { w: el.offsetWidth, h: el.offsetHeight })
        } else {
          // Fallback: use saved width or default
          const w = (n.data?.params?.__nodeWidth as number) ?? 380
          nodeSize.set(n.id, { w, h: 200 })
        }
      }

      // ── Build adjacency ──
      const outgoing = new Map<string, string[]>()
      const incoming = new Map<string, string[]>()
      for (const n of currentNodes) {
        outgoing.set(n.id, [])
        incoming.set(n.id, [])
      }
      for (const e of currentEdges) {
        outgoing.get(e.source)?.push(e.target)
        incoming.get(e.target)?.push(e.source)
      }

      // ── Assign layers via longest-path (ensures proper depth) ──
      const layer = new Map<string, number>()
      const visited = new Set<string>()

      function assignLayer(id: string): number {
        if (layer.has(id)) return layer.get(id)!
        if (visited.has(id)) return 0 // cycle guard
        visited.add(id)
        const parents = incoming.get(id) ?? []
        const depth = parents.length === 0 ? 0 : Math.max(...parents.map(p => assignLayer(p) + 1))
        layer.set(id, depth)
        return depth
      }
      for (const n of currentNodes) assignLayer(n.id)

      // ── Group by layer ──
      const layers = new Map<number, string[]>()
      for (const [id, l] of layer) {
        if (!layers.has(l)) layers.set(l, [])
        layers.get(l)!.push(id)
      }

      // Sort layers by key
      const sortedLayerKeys = [...layers.keys()].sort((a, b) => a - b)

      // ── Barycenter ordering to minimize edge crossings ──
      // For each layer (except the first), sort nodes by the average Y position
      // of their connected nodes in the previous layer.
      // Run multiple passes for better results.
      const nodeOrder = new Map<string, number>()
      // Initialize order by original position (top to bottom)
      for (const l of sortedLayerKeys) {
        const ids = layers.get(l)!
        ids.sort((a, b) => {
          const na = currentNodes.find(n => n.id === a)
          const nb = currentNodes.find(n => n.id === b)
          return (na?.position?.y ?? 0) - (nb?.position?.y ?? 0)
        })
        ids.forEach((id, i) => nodeOrder.set(id, i))
      }

      // Barycenter passes (forward + backward)
      for (let pass = 0; pass < 4; pass++) {
        const keys = pass % 2 === 0 ? sortedLayerKeys : [...sortedLayerKeys].reverse()
        for (const l of keys) {
          const ids = layers.get(l)!
          const bary = new Map<string, number>()
          for (const id of ids) {
            const neighbors = pass % 2 === 0
              ? (incoming.get(id) ?? [])
              : (outgoing.get(id) ?? [])
            if (neighbors.length > 0) {
              const avg = neighbors.reduce((sum, nid) => sum + (nodeOrder.get(nid) ?? 0), 0) / neighbors.length
              bary.set(id, avg)
            } else {
              bary.set(id, nodeOrder.get(id) ?? 0)
            }
          }
          ids.sort((a, b) => (bary.get(a) ?? 0) - (bary.get(b) ?? 0))
          ids.forEach((id, i) => nodeOrder.set(id, i))
        }
      }

      // ── Compute column X positions based on max width per layer ──
      const H_GAP = 100 // horizontal gap between columns
      const V_GAP = 60  // vertical gap between nodes in same column
      const layerX = new Map<number, number>()
      let currentX = 0
      for (const l of sortedLayerKeys) {
        layerX.set(l, currentX)
        const ids = layers.get(l)!
        const maxW = Math.max(...ids.map(id => nodeSize.get(id)?.w ?? 380))
        currentX += maxW + H_GAP
      }

      // ── Position nodes: center each column vertically ──
      const changes: NodeChange[] = []
      for (const l of sortedLayerKeys) {
        const ids = layers.get(l)!
        // Calculate total height of this column
        const heights = ids.map(id => nodeSize.get(id)?.h ?? 200)
        const totalHeight = heights.reduce((sum, h) => sum + h, 0) + (ids.length - 1) * V_GAP
        let y = -totalHeight / 2

        ids.forEach((id, i) => {
          changes.push({
            type: 'position',
            id,
            position: {
              x: layerX.get(l) ?? 0,
              y
            }
          } as NodeChange)
          y += heights[i] + V_GAP
        })
      }
      applyChanges(changes)

      // Fit view after layout
      setTimeout(() => {
        reactFlowInstance.current?.fitView({ padding: 0.2, duration: 300, minZoom: 0.05, maxZoom: 1.5 })
      }, 50)
    }
    window.addEventListener('workflow:auto-layout', handleAutoLayout)
    return () => window.removeEventListener('workflow:auto-layout', handleAutoLayout)
  }, [])

  return (
    <ReactFlowProvider>
      <div ref={reactFlowWrapper} className="flex-1 h-full">
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onNodeClick={onNodeClick} onPaneClick={onPaneClick}
          onSelectionChange={onSelectionChange}
          onNodeContextMenu={onNodeContextMenu} onEdgeContextMenu={onEdgeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          proOptions={{ hideAttribution: true }}
          onDragOver={onDragOver} onDrop={onDrop}
          onInit={instance => {
            reactFlowInstance.current = instance
            useUIStore.getState().setGetViewportCenter(() => {
              const vp = instance.getViewport()
              const el = reactFlowWrapper.current
              const w = el ? el.clientWidth : 800
              const h = el ? el.clientHeight : 600
              return {
                x: (-vp.x + w / 2) / vp.zoom,
                y: (-vp.y + h / 2) / vp.zoom,
              }
            })
          }}
          nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          selectionOnDrag={interactionMode === 'select'}
          selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode="Shift"
          panOnDrag={interactionMode === 'hand'}
          deleteKeyCode={null}
          minZoom={0.05}
          maxZoom={2.5}
          fitView
          className="bg-background"
        >
          <Background variant={BackgroundVariant.Lines} gap={20} lineWidth={1} color="hsl(var(--border))" />
        </ReactFlow>
        {contextMenu && contextMenu.type !== 'addNode' && (
          <ContextMenu x={contextMenu.x} y={contextMenu.y} items={getContextMenuItems()} onClose={() => setContextMenu(null)} />
        )}
        {contextMenu && contextMenu.type === 'addNode' && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            width={320}
            estimatedHeight={420}
          >
            <div className="w-[320px] max-h-[420px] flex flex-col">
              <div className="px-3 py-2 border-b border-border">
                <div className="text-xs font-semibold mb-1.5">{t('workflow.addNode', 'Add Node')}</div>
                <input
                  autoFocus
                  type="text"
                  value={addNodeQuery}
                  onChange={e => setAddNodeQuery(e.target.value)}
                  placeholder={t('workflow.searchNodesPlaceholder', 'Search nodes...')}
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                />
              </div>
              <div className="overflow-y-auto py-1.5">
                {groupedAddNodeDefs.map(([category, defs]) => {
                  const isCollapsed = addNodeCollapsed[category] ?? false
                  return (
                    <div key={category} className="mb-1">
                      <button
                        onClick={() => setAddNodeCollapsed(prev => ({ ...prev, [category]: !isCollapsed }))}
                        className="w-full flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
                      >
                        <span className="text-[9px]">{isCollapsed ? '▶' : '▼'}</span>
                        <span>{t(`workflow.nodeCategory.${category}`, category)}</span>
                        <span className="ml-auto text-[10px] opacity-70">{defs.length}</span>
                      </button>
                      {!isCollapsed && defs.map(def => (
                        <button
                          key={def.type}
                          onClick={() => addNodeAtMenuPosition(def)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                          title={t('workflow.dragOrClickToAdd', 'Drag to canvas or click to add')}
                        >
                          <span className="text-base leading-none">{def.icon}</span>
                          <span>{t(`workflow.nodeDefs.${def.type}.label`, def.label)}</span>
                        </button>
                      ))}
                    </div>
                  )
                })}
                {addNodeDisplayDefs.length === 0 && (
                  <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                    {t('workflow.noNodesAvailable', 'No nodes available')}
                  </div>
                )}
              </div>
            </div>
          </ContextMenu>
        )}
      </div>
    </ReactFlowProvider>
  )
}
