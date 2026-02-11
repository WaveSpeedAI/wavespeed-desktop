/**
 * WorkflowCanvas — ReactFlow wrapper with zoom, pan, drag-drop, and context menu.
 * Rewritten with Tailwind classes.
 */
import React, { useCallback, useRef, useState, useEffect, useMemo, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import ReactFlow, {
  ReactFlowProvider,
  type Connection, type ReactFlowInstance, type Node
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
  const { nodes, edges, onNodesChange, onEdgesChange, addEdge, addNode, removeNode, undo, redo, saveWorkflow } = useWorkflowStore()
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const selectNode = useUIStore(s => s.selectNode)
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

      if (event.key === 'Delete' && selectedNodeId) {
        event.preventDefault(); removeNode(selectedNodeId); selectNode(null)
      }
      if (ctrlOrCmd && event.key === 'c' && selectedNodeId) {
        event.preventDefault()
        const node = nodes.find(n => n.id === selectedNodeId)
        if (node) localStorage.setItem('copiedNode', JSON.stringify(node))
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
      if (ctrlOrCmd && event.key === 'v') {
        event.preventDefault()
        const copiedNode = localStorage.getItem('copiedNode')
        if (copiedNode && reactFlowInstance.current) {
          try {
            const node = JSON.parse(copiedNode)
            const center = reactFlowInstance.current.getViewport()
            addNode(node.data.nodeType, { x: -center.x / center.zoom + 100, y: -center.y / center.zoom + 100 },
              node.data.params, node.data.label, node.data.paramDefinitions ?? [], node.data.inputDefinitions ?? [], node.data.outputDefinitions ?? [])
            if (typeof node.data?.nodeType === 'string') recordRecentNodeType(node.data.nodeType)
          } catch (e) { console.error('Failed to paste node:', e) }
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeId, removeNode, selectNode, nodes, addNode, undo, redo, saveWorkflow, recordRecentNodeType])

  const onConnect = useCallback((connection: Connection) => addEdge(connection), [addEdge])
  const onNodeClick = useCallback((_: React.MouseEvent, node: { id: string }) => selectNode(node.id), [selectNode])
  const onPaneClick = useCallback(() => { selectNode(null); setContextMenu(null) }, [selectNode])

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

      // Run actions — always available, will auto-save/create workflow if needed
      const ensureAndRun = async (action: (wfId: string, nId: string) => Promise<void>) => {
        let wfId = useWorkflowStore.getState().workflowId
        if (!wfId) {
          await useWorkflowStore.getState().saveWorkflow()
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
      items.push({
        label: t('common.copy', 'Copy'), icon: '📋', shortcut: 'Ctrl+C',
        action: () => { const n = nodes.find(n => n.id === nodeId); if (n) localStorage.setItem('copiedNode', JSON.stringify(n)) }
      })
      items.push({ label: t('workflow.delete', 'Delete'), icon: '🗑️', shortcut: 'Del', action: () => removeNode(nodeId), destructive: true })
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
  }, [contextMenu, removeNode, nodes, addNode, openAddNodeMenu, t, recordRecentNodeType])

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
    addNode(nodeType, position, defaultParams, def ? `${def.icon} ${def.label}` : nodeType, def?.params ?? [], def?.inputs ?? [], def?.outputs ?? [])
    recordRecentNodeType(nodeType)
  }, [addNode, nodeDefs, recordRecentNodeType])

  useEffect(() => {
    const handleFitView = () => {
      reactFlowInstance.current?.fitView({ padding: 0.2, duration: 300, minZoom: 0.05, maxZoom: 1.5 })
    }
    window.addEventListener('workflow:fit-view', handleFitView)
    return () => window.removeEventListener('workflow:fit-view', handleFitView)
  }, [])

  return (
    <ReactFlowProvider>
      <div ref={reactFlowWrapper} className="flex-1 h-full">
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onNodeClick={onNodeClick} onPaneClick={onPaneClick}
          onNodeContextMenu={onNodeContextMenu} onEdgeContextMenu={onEdgeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          proOptions={{ hideAttribution: true }}
          onDragOver={onDragOver} onDrop={onDrop}
          onInit={instance => { reactFlowInstance.current = instance }}
          nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          minZoom={0.05}
          maxZoom={2.5}
          fitView
          className="bg-background"
        />
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
                  placeholder={t('workflow.searchNodesPlaceholder', 'Search nodes (fzf syntax)...')}
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
