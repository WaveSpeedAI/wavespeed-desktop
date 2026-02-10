/**
 * Node palette — flat list of available node types.
 * Drag to canvas or click to add. Resizable width via drag handle.
 */
import { type DragEvent, useCallback, useState } from 'react'
import { useUIStore } from '../../stores/ui.store'
import { useWorkflowStore } from '../../stores/workflow.store'
import type { NodeTypeDefinition } from '@/workflow/types/node-defs'

interface NodePaletteProps {
  definitions: NodeTypeDefinition[]
}

export function NodePalette({ definitions }: NodePaletteProps) {
  const toggleNodePalette = useUIStore(s => s.toggleNodePalette)
  const addNode = useWorkflowStore(s => s.addNode)
  const [width, setWidth] = useState(180)
  const [dragging, setDragging] = useState(false)

  const onDragStart = (event: DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow-nodetype', nodeType)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleClick = useCallback((def: NodeTypeDefinition) => {
    const defaultParams: Record<string, unknown> = {}
    for (const p of def.params) { if (p.default !== undefined) defaultParams[p.key] = p.default }
    const x = 200 + Math.random() * 100
    const y = 150 + Math.random() * 100
    addNode(def.type, { x, y }, defaultParams, `${def.icon} ${def.label}`, def.params, def.inputs, def.outputs)
  }, [addNode])

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(140, Math.min(360, startWidth + (ev.clientX - startX)))
      setWidth(newWidth)
    }
    const onUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width])

  return (
    <div className="border-r border-border bg-card text-card-foreground flex flex-col relative overflow-hidden"
      style={{ flexBasis: width, flexShrink: 1, flexGrow: 0, minWidth: 0 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="font-semibold text-xs">Nodes</span>
        <button onClick={toggleNodePalette} className="text-muted-foreground hover:text-foreground text-xs px-1" title="Close">
          ✕
        </button>
      </div>

      {/* Node list */}
      <div className="flex-1 overflow-y-auto py-1.5">
        {definitions.map(def => (
          <div
            key={def.type}
            draggable
            onDragStart={e => onDragStart(e, def.type)}
            onClick={() => handleClick(def)}
            className="flex items-center gap-2 px-3 py-2 mx-1.5 rounded-md cursor-grab
              text-xs text-muted-foreground
              hover:bg-accent hover:text-foreground
              active:cursor-grabbing active:bg-accent/80
              transition-colors select-none"
            title="Drag to canvas or click to add"
          >
            <span className="text-base leading-none">{def.icon}</span>
            <span>{def.label}</span>
          </div>
        ))}

        {definitions.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            No nodes available
          </div>
        )}
      </div>

      {/* Hint */}
      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground/60 leading-tight">
        Drag to canvas or click to add
      </div>

      {/* Resize handle on the right edge */}
      <div
        onMouseDown={onResizeStart}
        className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors ${dragging ? 'bg-primary' : 'hover:bg-primary/50'}`}
      />
    </div>
  )
}
