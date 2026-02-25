/**
 * Node palette — categorised list of available node types.
 * Drag to canvas or click to add. Resizable width via drag handle.
 */
import { type DragEvent, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '../../stores/ui.store'
import { useWorkflowStore } from '../../stores/workflow.store'
import type { NodeTypeDefinition } from '@/workflow/types/node-defs'
import { fuzzySearch } from '@/lib/fuzzySearch'
import { Search, X, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getNodeIcon } from './custom-node/NodeIcons'

/* ── category colour dots ─────────────────────────────────── */
const catDot: Record<string, string> = {
  'ai-task':    'bg-violet-500',
  'input':      'bg-blue-500',
  'output':     'bg-emerald-500',
  'processing': 'bg-amber-500',
  'free-tool':  'bg-rose-500',
  'control':    'bg-cyan-500',
}

const RECENT_NODE_TYPES_KEY = 'workflowRecentNodeTypes'
const MAX_RECENT_NODE_TYPES = 8

function recordRecentNodeType(nodeType: string) {
  try {
    const raw = localStorage.getItem(RECENT_NODE_TYPES_KEY)
    const prev = raw ? JSON.parse(raw) : []
    const list = Array.isArray(prev) ? prev.filter((v): v is string => typeof v === 'string') : []
    const next = [nodeType, ...list.filter(t => t !== nodeType)].slice(0, MAX_RECENT_NODE_TYPES)
    localStorage.setItem(RECENT_NODE_TYPES_KEY, JSON.stringify(next))
  } catch { /* noop */ }
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
    // Auto-close palette after adding a node
    toggleNodePalette()
  }, [addNode, t, toggleNodePalette])

  const categoryOrder = ['ai-task', 'input', 'output', 'processing', 'free-tool', 'control']
  const categoryLabel = useCallback((cat: string) => t(`workflow.nodeCategory.${cat}`, cat), [t])

  const displayDefs = useMemo(() => {
    const q = query.trim()
    if (!q) return definitions
    return fuzzySearch(definitions, q, (def) => [
      def.type, def.label, t(`workflow.nodeDefs.${def.type}.label`, def.label), def.category
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
    const onMove = (ev: MouseEvent) => setSidebarWidth(startWidth + (ev.clientX - startX))
    const onUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width, setSidebarWidth])

  /* ── render ──────────────────────────────────────────────── */
  return (
    <div
      className="border-r border-border/70 bg-background/95 backdrop-blur flex flex-col relative overflow-hidden h-full"
      data-guide="node-palette"
      style={{ width, minWidth: 0 }}
    >
      {/* ── header ── */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-border/70 shrink-0">
        <span className="font-semibold text-[13px] text-foreground">{t('workflow.nodes', 'Nodes')}</span>
        <button
          onClick={toggleNodePalette}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title={t('common.close', 'Close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── search ── */}
      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('workflow.searchNodesPlaceholder', 'Search nodes...')}
            className="w-full h-8 rounded-lg border border-border/70 bg-muted/40 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
          />
        </div>
      </div>

      {/* ── node list ── */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {groupedDefs.map(([category, defs]) => {
          const isCollapsed = collapsed[category] ?? false
          const dot = catDot[category] ?? 'bg-gray-400'
          return (
            <div key={category} className="mb-0.5">
              {/* category header */}
              <button
                onClick={() => setCollapsed(prev => ({ ...prev, [category]: !isCollapsed }))}
                className="w-full flex items-center gap-2 px-2 h-7 rounded-lg text-muted-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dot)} />
                <span className="text-[11px] font-semibold uppercase tracking-wide">{categoryLabel(category)}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/50 tabular-nums mr-0.5">{defs.length}</span>
                <ChevronDown className={cn(
                  'w-3 h-3 text-muted-foreground/40 transition-transform duration-200',
                  isCollapsed && '-rotate-90'
                )} />
              </button>

              {/* node items */}
              {!isCollapsed && (
                <div className="py-0.5">
                  {defs.map(def => {
                    const isAiTask = def.category === 'ai-task'
                    return (
                      <div
                        key={def.type}
                        draggable
                        onDragStart={e => onDragStart(e, def.type)}
                        onClick={() => handleClick(def)}
                        className={cn(
                          'flex items-center gap-2 h-8 px-2 rounded-lg cursor-grab select-none',
                          'text-[12px] text-foreground/70 transition-colors duration-100',
                          'hover:bg-muted hover:text-foreground',
                          'active:cursor-grabbing active:bg-muted/80'
                        )}
                        title={t('workflow.dragOrClickToAdd', 'Drag to canvas or click to add')}
                      >
                        {(() => {
                          const Icon = getNodeIcon(def.type)
                          return Icon ? (
                            <div className="rounded-md bg-primary/10 p-1 flex-shrink-0">
                              <Icon className="w-3 h-3 text-primary" />
                            </div>
                          ) : null
                        })()}
                        <span className="truncate">{t(`workflow.nodeDefs.${def.type}.label`, def.label)}</span>
                        {isAiTask && (
                          <span className="ml-auto shrink-0 text-[9px] font-semibold text-violet-600 dark:text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded">AI</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {displayDefs.length === 0 && (
          <div className="px-3 py-6 text-xs text-muted-foreground/60 text-center">
            {t('workflow.noNodesAvailable', 'No nodes available')}
          </div>
        )}
      </div>

      {/* ── footer hint ── */}
      <div className="px-4 py-2 border-t border-border/70 text-[10px] text-muted-foreground/40">
        {t('workflow.dragOrClickToAdd', 'Drag to canvas or click to add')}
      </div>

      {/* ── resize handle ── */}
      <div
        onMouseDown={onResizeStart}
        className={cn(
          'absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors',
          dragging ? 'bg-primary' : 'hover:bg-primary/50'
        )}
      />
    </div>
  )
}
