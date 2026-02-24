/**
 * Node palette — flat list of available node types.
 * Drag to canvas or click to add. Resizable width via drag handle.
 */
import { type DragEvent, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '../../stores/ui.store'
import { useWorkflowStore } from '../../stores/workflow.store'
import type { NodeTypeDefinition } from '@/workflow/types/node-defs'
import { fuzzySearch } from '@/lib/fuzzySearch'

const RECENT_NODE_TYPES_KEY = 'workflowRecentNodeTypes'
const MAX_RECENT_NODE_TYPES = 8

function recordRecentNodeType(nodeType: string) {
  try {
    const raw = localStorage.getItem(RECENT_NODE_TYPES_KEY)
    const prev = raw ? JSON.parse(raw) : []
    const list = Array.isArray(prev) ? prev.filter((v): v is string => typeof v === 'string') : []
    const next = [nodeType, ...list.filter(t => t !== nodeType)].slice(0, MAX_RECENT_NODE_TYPES)
    localStorage.setItem(RECENT_NODE_TYPES_KEY, JSON.stringify(next))
  } catch {
    // noop
  }
}

interface NodePaletteProps {
  definitions: NodeTypeDefinition[]
}

export function NodePalette({ definitions }: NodePaletteProps) {
  const { t } = useTranslation()
  const toggleNodePalette = useUIStore(s => s.toggleNodePalette)
  const addNode = useWorkflowStore(s => s.addNode)
  const width = useUIStore(s => s.sidebarWidth)
  const setSidebarWidth = useUIStore(s => s.setSidebarWidth)
  const [dragging, setDragging] = useState(false)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const onDragStart = (event: DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow-nodetype', nodeType)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleClick = useCallback((def: NodeTypeDefinition) => {
    const defaultParams: Record<string, unknown> = {}
    for (const p of def.params) { if (p.default !== undefined) defaultParams[p.key] = p.default }
    const center = useUIStore.getState().getViewportCenter()
    const x = center.x + (Math.random() - 0.5) * 60
    const y = center.y + (Math.random() - 0.5) * 60
    const localizedLabel = t(`workflow.nodeDefs.${def.type}.label`, def.label)
    addNode(def.type, { x, y }, defaultParams, localizedLabel, def.params, def.inputs, def.outputs)
    recordRecentNodeType(def.type)
  }, [addNode, t])

  const categoryOrder = ['ai-task', 'input', 'output', 'processing', 'free-tool', 'control']
  const categoryLabel = useCallback((cat: string) => {
    return t(`workflow.nodeCategory.${cat}`, cat)
  }, [t])

  const displayDefs = useMemo(() => {
    const q = query.trim()
    if (!q) return definitions
    return fuzzySearch(definitions, q, (def) => [
      def.type,
      def.label,
      t(`workflow.nodeDefs.${def.type}.label`, def.label),
      def.category
    ]).map(r => r.item)
  }, [definitions, query, t])

  const groupedDefs = useMemo(() => {
    const groups = new Map<string, NodeTypeDefinition[]>()
    for (const def of displayDefs) {
      const arr = groups.get(def.category) ?? []
      arr.push(def)
      groups.set(def.category, arr)
    }
    return [...groups.entries()].sort((a, b) => {
      const ai = categoryOrder.indexOf(a[0])
      const bi = categoryOrder.indexOf(b[0])
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  }, [displayDefs])

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev: MouseEvent) => {
      setSidebarWidth(startWidth + (ev.clientX - startX))
    }
    const onUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width, setSidebarWidth])

  return (
    <div className="border-r border-border bg-card text-card-foreground flex flex-col relative overflow-hidden h-full"
      data-guide="node-palette"
      style={{ width, minWidth: 0 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="font-semibold text-xs">{t('workflow.nodes', 'Nodes')}</span>
        <button onClick={toggleNodePalette} className="text-muted-foreground hover:text-foreground text-xs px-1" title={t('common.close', 'Close')}>
          ✕
        </button>
      </div>

      <div className="px-2.5 py-2 border-b border-border">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('workflow.searchNodesPlaceholder', 'Search nodes...')}
          className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        />
      </div>

      {/* Node list */}
      <div className="flex-1 overflow-y-auto py-1.5">
        {groupedDefs.map(([category, defs]) => {
          const isCollapsed = collapsed[category] ?? false
          return (
            <div key={category} className="mb-1">
              <button
                onClick={() => setCollapsed(prev => ({ ...prev, [category]: !isCollapsed }))}
                className="w-full flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                <span className="text-[9px]">{isCollapsed ? '▶' : '▼'}</span>
                <span>{categoryLabel(category)}</span>
                <span className="ml-auto text-[10px] opacity-70">{defs.length}</span>
              </button>
              {!isCollapsed && defs.map(def => {
                const isAiTask = def.category === 'ai-task'
                return (
                  <div
                    key={def.type}
                    draggable
                    onDragStart={e => onDragStart(e, def.type)}
                    onClick={() => handleClick(def)}
                    className="flex items-center gap-2 px-3 py-2 mx-1.5 rounded-md cursor-grab
                      text-xs text-muted-foreground select-none transition-colors
                      hover:bg-accent hover:text-foreground
                      active:cursor-grabbing active:bg-accent/80"
                    title={t('workflow.dragOrClickToAdd', 'Drag to canvas or click to add')}
                  >
                    <span>{t(`workflow.nodeDefs.${def.type}.label`, def.label)}</span>
                    {isAiTask && (
                      <span className="ml-auto text-[9px] font-semibold text-primary bg-primary/25 px-1.5 py-0.5 rounded">AI</span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}

        {displayDefs.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            {t('workflow.noNodesAvailable', 'No nodes available')}
          </div>
        )}
      </div>

      {/* Hint */}
      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground/60 leading-tight">
        {t('workflow.dragOrClickToAdd', 'Drag to canvas or click to add')}
      </div>

      {/* Resize handle on the right edge */}
      <div
        onMouseDown={onResizeStart}
        className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors ${dragging ? 'bg-primary' : 'hover:bg-primary/50'}`}
      />
    </div>
  )
}
