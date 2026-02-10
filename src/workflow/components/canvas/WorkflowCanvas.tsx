/**
 * WorkflowCanvas — ReactFlow wrapper with zoom, pan, drag-drop, and context menu.
 * Rewritten with Tailwind classes.
 */
import React, { useCallback, useRef, useState, useEffect, type DragEvent } from 'react'
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

const CATEGORY_ORDER: NodeCategory[] = ['input', 'ai-task', 'ai-generation', 'processing', 'control', 'output']
const nodeTypes = { custom: CustomNode, annotation: AnnotationNode }
const edgeTypes = { custom: CustomEdge }

interface WorkflowCanvasProps {
  nodeDefs?: NodeTypeDefinition[]
}

export function WorkflowCanvas({ nodeDefs = [] }: WorkflowCanvasProps) {
  const { nodes, edges, onNodesChange, onEdgesChange, addEdge, addNode, removeNode, undo, redo, saveWorkflow } = useWorkflowStore()
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const selectNode = useUIStore(s => s.selectNode)
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; type: 'node' | 'canvas' | 'addNode' | 'edge'; nodeId?: string; edgeId?: string
  } | null>(null)

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
          } catch (e) { console.error('Failed to paste node:', e) }
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeId, removeNode, selectNode, nodes, addNode, undo, redo, saveWorkflow])

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

  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    if (!contextMenu) return []

    if (contextMenu.type === 'edge' && contextMenu.edgeId) {
      const edgeId = contextMenu.edgeId
      return [{ label: 'Delete Connection', icon: '✕', action: () => useWorkflowStore.getState().removeEdge(edgeId), destructive: true }]
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
        items.push({ label: 'Cancel', icon: '⏹', action: () => {
          const wfId = useWorkflowStore.getState().workflowId
          if (wfId) cn(wfId, nodeId)
        }})
      } else {
        items.push({ label: 'Run Node', icon: '▶', action: () => ensureAndRun(rn) })
        items.push({ label: 'Run From Here', icon: '⏩', action: () => ensureAndRun(cf) })
        if (nodeStatus === 'error') {
          items.push({ label: 'Retry', icon: '🔄', action: () => ensureAndRun(rt) })
        }
      }

      items.push({ label: '', action: () => {}, divider: true })
      items.push({
        label: 'Copy', icon: '📋', shortcut: 'Ctrl+C',
        action: () => { const n = nodes.find(n => n.id === nodeId); if (n) localStorage.setItem('copiedNode', JSON.stringify(n)) }
      })
      items.push({ label: 'Delete', icon: '🗑️', shortcut: 'Del', action: () => removeNode(nodeId), destructive: true })
      return items
    }

    /** Convert context menu screen coords to flow position, accounting for wrapper offset */
    const menuToFlowPosition = () => {
      if (!reactFlowInstance.current || !reactFlowWrapper.current) return { x: contextMenu.x, y: contextMenu.y }
      const bounds = reactFlowWrapper.current.getBoundingClientRect()
      return reactFlowInstance.current.project({ x: contextMenu.x - bounds.left, y: contextMenu.y - bounds.top })
    }

    if (contextMenu.type === 'addNode') {
      const items: ContextMenuItem[] = []
      const grouped = CATEGORY_ORDER.map(cat => ({ category: cat, nodes: nodeDefs.filter(d => d.category === cat) })).filter(g => g.nodes.length > 0)
      grouped.forEach((group, gi) => {
        if (gi > 0) items.push({ label: '', action: () => {}, divider: true })
        group.nodes.forEach(def => {
          items.push({
            label: `${def.icon} ${def.label}`,
            action: () => {
              const position = menuToFlowPosition()
              const defaultParams: Record<string, unknown> = {}
              for (const p of def.params) { if (p.default !== undefined) defaultParams[p.key] = p.default }
              addNode(def.type, position, defaultParams, `${def.icon} ${def.label}`, def.params, def.inputs, def.outputs)
            }
          })
        })
      })
      return items
    }

    // Canvas context menu
    const copiedNode = localStorage.getItem('copiedNode')
    const items: ContextMenuItem[] = [
      { label: 'Add Node', icon: '➕', keepOpen: true, action: () => setContextMenu({ x: contextMenu.x, y: contextMenu.y, type: 'addNode' }) },
      { label: 'Add Note', icon: '📝', action: () => {
        const position = menuToFlowPosition()
        const noteId = uuidv4()
        useWorkflowStore.setState(state => ({
          nodes: [...state.nodes, { id: noteId, type: 'annotation', position, data: { nodeType: 'annotation', params: { title: '', body: '', color: 'hsl(var(--muted))' }, label: 'Note' } }],
          isDirty: true
        }))
      }}
    ]
    if (copiedNode) {
      items.push({
        label: 'Paste', icon: '📋', shortcut: 'Ctrl+V',
        action: () => {
          try {
            const node = JSON.parse(copiedNode)
            const position = menuToFlowPosition()
            addNode(node.data.nodeType, position, node.data.params, node.data.label, node.data.paramDefinitions ?? [], node.data.inputDefinitions ?? [], node.data.outputDefinitions ?? [])
          } catch (e) { console.error('Failed to paste node:', e) }
        }
      })
    }
    return items
  }, [contextMenu, removeNode, nodes, addNode, nodeDefs])

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
  }, [addNode, nodeDefs])

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
          fitView
          className="bg-background"
        />
        {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={getContextMenuItems()} onClose={() => setContextMenu(null)} />}
      </div>
    </ReactFlowProvider>
  )
}
