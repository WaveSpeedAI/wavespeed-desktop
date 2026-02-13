/**
 * Annotation node — a simple text note on the canvas with no handles.
 * Supports title and body text. Double-click to edit.
 */
import { memo, useState } from 'react'
import { type NodeProps } from 'reactflow'
import { useWorkflowStore } from '../../stores/workflow.store'
import { CompInput, CompTextarea } from './composition-input'

interface AnnotationData {
  nodeType: string
  params: { title?: string; body?: string; color?: string }
  label: string
}

const COLORS = [
  { name: 'Gray', value: 'hsl(var(--muted))' },
  { name: 'Blue', value: 'rgba(96,165,250,0.15)' },
  { name: 'Green', value: 'rgba(74,222,128,0.15)' },
  { name: 'Orange', value: 'rgba(251,146,60,0.15)' },
  { name: 'Purple', value: 'rgba(168,85,247,0.15)' },
  { name: 'Pink', value: 'rgba(244,114,182,0.15)' },
]

function AnnotationNodeComponent({ id, data, selected }: NodeProps<AnnotationData>) {
  const [editing, setEditing] = useState(false)
  const updateNodeParams = useWorkflowStore(s => s.updateNodeParams)
  const params = data.params ?? {}
  const title = params.title ?? ''
  const body = params.body ?? ''
  const bgColor = params.color ?? COLORS[0].value

  const setField = (key: string, value: string) => {
    updateNodeParams(id, { ...params, [key]: value })
  }

  return (
    <div
      onDoubleClick={e => { e.stopPropagation(); setEditing(true) }}
      className={`rounded-lg border-2 p-3 min-w-[200px] max-w-[350px] transition-shadow
        ${selected ? 'border-blue-500/50 ring-1 ring-blue-500/20' : 'border-transparent'}`}
      style={{ background: bgColor, fontSize: 13 }}
    >
      {editing ? (
        <div className="space-y-2" onClick={e => e.stopPropagation()}>
          <CompInput type="text" value={title} onChange={e => setField('title', e.target.value)}
            placeholder="Note title…" autoFocus
            className="w-full bg-transparent font-bold text-sm outline-none border-b border-[hsl(var(--border))] pb-1 text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]" />
          <CompTextarea value={body} onChange={e => setField('body', e.target.value)}
            placeholder="Write a note…" rows={3}
            className="w-full bg-transparent text-xs outline-none resize-y min-h-[40px] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]" />
          <div className="flex items-center gap-1">
            {COLORS.map(c => (
              <button key={c.name} onClick={() => setField('color', c.value)}
                title={c.name}
                className={`w-5 h-5 rounded-full border-2 transition-transform ${params.color === c.value ? 'border-blue-400 scale-110' : 'border-transparent hover:scale-105'}`}
                style={{ background: c.value }} />
            ))}
            <div className="flex-1" />
            <button onClick={() => setEditing(false)}
              className="text-[10px] text-blue-400 hover:underline">Done</button>
          </div>
        </div>
      ) : (
        <>
          {title && <div className="font-bold text-sm mb-1 text-[hsl(var(--foreground))]">{title}</div>}
          {body ? (
            <div className="text-xs text-[hsl(var(--muted-foreground))] whitespace-pre-wrap">{body}</div>
          ) : !title ? (
            <div className="text-xs text-[hsl(var(--muted-foreground))] italic">Double-click to add a note</div>
          ) : null}
        </>
      )}
    </div>
  )
}

export const AnnotationNode = memo(AnnotationNodeComponent)
