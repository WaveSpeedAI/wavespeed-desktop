/**
 * Custom node component — ComfyUI-inspired inline parameter editing.
 *
 * Each parameter is a row with a left Handle, label, and inline control.
 * Media fields support file upload with progress/error states and click-to-preview.
 */
import React, { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from 'reactflow'
import { useExecutionStore } from '../../stores/execution.store'
import { useWorkflowStore } from '../../stores/workflow.store'
import { useUIStore } from '../../stores/ui.store'
import { WorkflowPromptOptimizer } from './WorkflowPromptOptimizer'
// Status constants (kept for edge component compatibility)
// import { NODE_STATUS_COLORS, NODE_STATUS_BORDER } from '@/workflow/constants'
import type { NodeStatus } from '@/workflow/types/execution'
import type { ParamDefinition, PortDefinition, ModelParamSchema } from '@/workflow/types/node-defs'

/* ── types ───────────────────────────────────────────────────────────── */

interface CustomNodeData {
  nodeType: string
  params: Record<string, unknown>
  label: string
  paramDefinitions?: ParamDefinition[]
  inputDefinitions?: PortDefinition[]
  outputDefinitions?: PortDefinition[]
  modelInputSchema?: ModelParamSchema[]
}

/* ── constants ───────────────────────────────────────────────────────── */

const HANDLE_SIZE = 14
const ACCENT = '#60a5fa'
const ACCENT_MEDIA = '#4ade80'

const TEXTAREA_NAMES = new Set([
  'prompt', 'negative_prompt', 'text', 'description', 'content', 'system_prompt',
])

/* ── handle styles ───────────────────────────────────────────────────── */

/** Left-side input handle — absolute positioned to sit on the node border */
const handleLeft = (_connected: boolean, media = false): React.CSSProperties => ({
  width: HANDLE_SIZE, height: HANDLE_SIZE, borderRadius: '50%',
  border: '2px solid hsl(var(--background))',
  background: media ? ACCENT_MEDIA : ACCENT,
  left: -HANDLE_SIZE / 2 - 1,
  top: '50%', transform: 'translateY(-50%)',
  position: 'absolute',
})

/** Right-side output handle */
const handleRight = (): React.CSSProperties => ({
  width: HANDLE_SIZE, height: HANDLE_SIZE, borderRadius: '50%',
  border: '2px solid hsl(var(--background))',
  background: ACCENT,
  right: -HANDLE_SIZE / 2 - 1,
  top: '50%', transform: 'translateY(-50%)',
  position: 'absolute',
})

/* ── main component ──────────────────────────────────────────────────── */

const MIN_NODE_WIDTH = 300
const MIN_NODE_HEIGHT = 80
const DEFAULT_NODE_WIDTH = 380

function CustomNodeComponent({ id, data, selected }: NodeProps<CustomNodeData>) {
  const status = useExecutionStore(s => s.nodeStatuses[id] ?? 'idle') as NodeStatus
  const progress = useExecutionStore(s => s.progressMap[id])
  const errorMessage = useExecutionStore(s => s.errorMessages[id])
  const edges = useWorkflowStore(s => s.edges)
  const updateNodeParams = useWorkflowStore(s => s.updateNodeParams)
  const workflowId = useWorkflowStore(s => s.workflowId)
  const { runNode, cancelNode, retryNode } = useExecutionStore()
  const openPreview = useUIStore(s => s.openPreview)
  const [hovered, setHovered] = useState(false)

  // ── Resizable dimensions (use ref + direct DOM for zero-lag) ──
  const savedWidth = (data.params.__nodeWidth as number) ?? DEFAULT_NODE_WIDTH
  const savedHeight = (data.params.__nodeHeight as number | undefined) ?? undefined
  const nodeRef = useRef<HTMLDivElement>(null)
  const [resizing, setResizing] = useState(false)
  const { getViewport, setNodes } = useReactFlow()

  /**
   * Resize handler for edges and corners.
   *   xDir:  1 = right,  -1 = left,  0 = none
   *   yDir:  1 = bottom, -1 = top,   0 = none
   *
   * For right/bottom: just change size, node origin stays.
   * For left/top:     change size AND shift node position so the
   *                   opposite edge stays fixed.
   */
  const onEdgeResizeStart = useCallback((e: React.MouseEvent, xDir: number, yDir: number) => {
    e.stopPropagation()
    e.preventDefault()
    const el = nodeRef.current
    if (!el) return
    setResizing(true)

    const startX = e.clientX
    const startY = e.clientY
    const startW = el.offsetWidth
    const startH = el.offsetHeight
    const zoom = getViewport().zoom

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (xDir !== 0) {
        el.style.width = `${Math.max(MIN_NODE_WIDTH, startW + dx * xDir)}px`
      }
      if (yDir !== 0) {
        el.style.minHeight = `${Math.max(MIN_NODE_HEIGHT, startH + dy * yDir)}px`
      }
      // For left/top: visually shift the node via translate so opposite edge stays put
      if (xDir === -1 || yDir === -1) {
        const tx = xDir === -1 ? dx : 0
        const ty = yDir === -1 ? dy : 0
        el.style.transform = `translate(${tx}px, ${ty}px)`
      }
    }

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      // Reset visual overrides — let React take over with committed values
      el.style.transform = ''
      el.style.width = ''
      el.style.minHeight = ''
      setResizing(false)

      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      const newWidth = xDir !== 0 ? Math.max(MIN_NODE_WIDTH, startW + dx * xDir) : undefined
      const newHeight = yDir !== 0 ? Math.max(MIN_NODE_HEIGHT, startH + dy * yDir) : undefined

      // Commit size + position in a single setNodes pass so ReactFlow
      // recalculates handle positions immediately.
      setNodes(nodes => nodes.map(n => {
        if (n.id !== id) return n
        const pos = { ...n.position }
        if (xDir === -1) pos.x += dx / zoom
        if (yDir === -1) pos.y += dy / zoom
        const updatedParams = { ...n.data.params }
        if (newWidth !== undefined) updatedParams.__nodeWidth = newWidth
        if (newHeight !== undefined) updatedParams.__nodeHeight = newHeight
        return { ...n, position: pos, data: { ...n.data, params: updatedParams } }
      }))

      // Also mark store dirty so auto-save picks it up
      useWorkflowStore.setState({ isDirty: true })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [id, getViewport, setNodes])

  const running = status === 'running'

  const connectedSet = useMemo(() => {
    const s = new Set<string>()
    edges.filter(e => e.target === id).forEach(e => { if (e.targetHandle) s.add(e.targetHandle) })
    return s
  }, [edges, id])

  const setParam = useCallback(
    (key: string, value: unknown) => updateNodeParams(id, { ...data.params, [key]: value }),
    [updateNodeParams, id, data.params],
  )

  const paramDefs = data.paramDefinitions ?? []
  const inputDefs = data.inputDefinitions ?? []
  const schema = data.modelInputSchema ?? []

  const isAITask = data.nodeType === 'ai-task/run'
  const hasSchema = schema.length > 0

  const mediaParams = useMemo(() => schema.filter(p => p.mediaType && p.fieldType !== 'loras'), [schema])
  const loraParams = useMemo(() => schema.filter(p => p.fieldType === 'loras'), [schema])
  const jsonParams = useMemo(() => schema.filter(p => p.fieldType === 'json'), [schema])
  const requiredParams = useMemo(() => schema.filter(p => !p.mediaType && p.fieldType !== 'loras' && p.fieldType !== 'json' && p.name !== 'modelId' && (p.required || !p.hidden)), [schema])
  const optionalParams = useMemo(() => schema.filter(p => !p.mediaType && p.fieldType !== 'loras' && p.fieldType !== 'json' && p.name !== 'modelId' && !p.required && p.hidden), [schema])
  const defParams = paramDefs.filter(p => p.connectable !== false && p.key !== 'modelId' && p.dataType !== undefined)
  const [showOptional, setShowOptional] = useState(false)

  // All execution result groups for inline preview (newest first)
  const resultGroups = useExecutionStore(s => s.lastResults[id]) ?? []
  // Hidden run timestamps — persisted in node params so they survive remount/tab switch
  const hiddenRunTimes = (data.params.__hiddenRuns as string[]) ?? []
  const hiddenSet = useMemo(() => new Set(hiddenRunTimes), [hiddenRunTimes])
  const visibleGroups = resultGroups.filter(g => !hiddenSet.has(g.time))
  const hideRun = useCallback((time: string) => {
    updateNodeParams(id, { ...data.params, __hiddenRuns: [...hiddenRunTimes, time] })
  }, [id, data.params, hiddenRunTimes, updateNodeParams])
  /** Show all: clear ALL hidden + turn OFF latest — single atomic update */
  const showAllRuns = useCallback(() => {
    const { __hiddenRuns: _, __showLatestOnly: _2, ...rest } = data.params as Record<string, unknown>
    updateNodeParams(id, { ...rest, __showLatestOnly: false })
  }, [id, data.params, updateNodeParams])

  // Opt 3: Download result
  const handleDownload = useCallback((url: string) => {
    const filename = url.split('/').pop() || 'result'
    if (window.electronAPI?.downloadFile) {
      window.electronAPI.downloadFile(url, filename)
    } else {
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    }
  }, [])

  const saveWorkflow = useWorkflowStore(s => s.saveWorkflow)
  const removeNode = useWorkflowStore(s => s.removeNode)
  const { continueFrom } = useExecutionStore()

  const ensureWorkflowId = async () => {
    let wfId = workflowId
    if (!wfId) {
      await saveWorkflow()
      wfId = useWorkflowStore.getState().workflowId
    }
    return wfId
  }

  const onRun = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const wfId = await ensureWorkflowId()
    if (!wfId) return
    running ? cancelNode(wfId, id) : runNode(wfId, id)
  }

  const onRunFromHere = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const wfId = await ensureWorkflowId()
    if (!wfId) return
    continueFrom(wfId, id)
  }

  const onDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    removeNode(id)
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative"
    >
      {/* Invisible hover extension above the node so mouse can reach the toolbar */}
      <div className="absolute -top-10 left-0 right-0 h-10" />

      {/* ── Hover toolbar — floats above node ────────────────────── */}
      {hovered && (
        <div className="absolute -top-9 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1">
          {running ? (
            <button onClick={onRun}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-medium shadow-lg backdrop-blur-sm bg-red-500 text-white hover:bg-red-600 transition-all">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg> Stop
            </button>
          ) : (
            <>
              <button onClick={onRun}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-medium shadow-lg backdrop-blur-sm bg-blue-500 text-white hover:bg-blue-600 transition-all"
                title="Run this node">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg> Run
              </button>
              <button onClick={onRunFromHere}
                className="flex items-center justify-center w-8 h-8 rounded-full shadow-lg backdrop-blur-sm bg-green-600 text-white hover:bg-green-700 transition-all"
                title="Run from here (this node + all downstream)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="4,4 14,12 4,20"/><polygon points="12,4 22,12 12,20"/></svg>
              </button>
              <button onClick={onDelete}
                className="flex items-center justify-center w-8 h-8 rounded-full shadow-lg backdrop-blur-sm bg-[hsl(var(--muted))] text-muted-foreground hover:bg-red-500/20 hover:text-red-400 transition-all"
                title="Delete node">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
                </svg>
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Node body ──────────────────────────────────────────── */}
      <div
        ref={nodeRef}
        className={`
          relative rounded-xl
          bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]
          border-2
          ${resizing ? '' : 'transition-all duration-300'}
          ${running ? 'border-blue-500 animate-pulse-subtle' : ''}
          ${!running && selected ? 'border-blue-500 shadow-[0_0_20px_rgba(96,165,250,.25)] ring-1 ring-blue-500/30' : ''}
          ${!running && !selected && status === 'confirmed' ? 'border-green-500/70' : ''}
          ${!running && !selected && status === 'unconfirmed' ? 'border-orange-500/70' : ''}
          ${!running && !selected && status === 'error' ? 'border-red-500/70' : ''}
          ${!running && !selected && status === 'idle' ? (hovered ? 'border-[hsl(var(--border))] shadow-lg' : 'border-[hsl(var(--border))] shadow-md') : ''}
        `}
        style={{ width: savedWidth, minHeight: savedHeight, fontSize: 13 }}
      >

      {/* ── Title bar — color-coded background by status ──────────── */}
      <div className={`flex items-center gap-2 px-3 py-2 pr-16 select-none
        ${running ? 'bg-blue-500/10' : status === 'confirmed' ? 'bg-green-500/8' : status === 'error' ? 'bg-red-500/8' : ''}`}>
        {/* Status dot */}
        <span className={`w-2 h-2 rounded-full flex-shrink-0
          ${running ? 'bg-blue-500 animate-pulse' :
            status === 'confirmed' ? 'bg-green-500' :
            status === 'error' ? 'bg-red-500' :
            status === 'unconfirmed' ? 'bg-orange-500' :
            'bg-[hsl(var(--muted-foreground))] opacity-30'}`} />
        <span className="font-semibold text-[13px] flex-1 truncate">{data.label}</span>
      </div>

      {/* ── Running status bar — prominent, always visible when running ── */}
      {running && (
        <div className="px-3 py-1.5 bg-blue-500/5">
          <div className="flex items-center gap-2 mb-1">
            <svg className="animate-spin flex-shrink-0 text-blue-400" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
            </svg>
            <span className="text-[11px] text-blue-400 font-medium flex-1">
              {progress?.message || 'Running...'}
            </span>
            {progress && <span className="text-[10px] text-blue-400/70">{Math.round(progress.progress)}%</span>}
          </div>
          <div className="h-1.5 rounded-full bg-blue-500/20 overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-300 ease-out rounded-full"
              style={{ width: `${progress?.progress ?? 0}%` }} />
          </div>
        </div>
      )}

      {/* ── Error details + Retry ─────────────────────────────────── */}
      {status === 'error' && errorMessage && (
        <div className="px-3 py-1.5 bg-red-500/5">
          <div className="flex items-start gap-1.5 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <span className="text-red-400 text-[10px] mt-0.5 flex-shrink-0">⚠</span>
            <span className="text-[10px] text-red-400/90 leading-tight line-clamp-3 break-words flex-1" title={errorMessage}>
              {errorMessage}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); if (workflowId) retryNode(workflowId, id) }}
              className="text-[10px] text-red-400 font-medium hover:text-red-300 transition-colors flex items-center gap-1 flex-shrink-0 ml-1"
              title="Click to retry"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              Retry
            </button>
          </div>
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div className="px-1 py-2 space-y-px">
        {/* Media Upload node — special UI */}
        {data.nodeType === 'input/media-upload' && (
          <MediaUploadBody
            params={data.params}
            onBatchChange={(updates) => {
              const newParams = { ...data.params, ...updates }
              updateNodeParams(id, newParams)
            }}
            onPreview={openPreview}
          />
        )}

        {/* Text Input node — special UI */}
        {data.nodeType === 'input/text-input' && (
          <TextInputBody
            params={data.params}
            onParamChange={(updates) => {
              const newParams = { ...data.params, ...updates }
              updateNodeParams(id, newParams)
            }}
          />
        )}

        {isAITask && !hasSchema && (
          <div className="mx-2 text-center py-4 text-[hsl(var(--muted-foreground))] text-xs italic border border-dashed border-[hsl(var(--border))] rounded-lg my-1">
            Click this node, then select a model →
          </div>
        )}

        {mediaParams.map(p => (
          <MediaRow key={p.name} nodeId={id} schema={p} value={data.params[p.name]}
            connected={connectedSet.has(`param-${p.name}`)} connectedSet={connectedSet}
            edges={edges} nodes={useWorkflowStore.getState().nodes}
            onChange={v => setParam(p.name, v)} onPreview={openPreview} />
        ))}

        {loraParams.map(p => (
          <LoraRow key={p.name} schema={p} value={data.params[p.name]} onChange={v => setParam(p.name, v)} />
        ))}

        {jsonParams.map(p => (
          <JsonRow key={p.name} nodeId={id} schema={p} value={data.params[p.name]}
            connected={connectedSet.has(`param-${p.name}`)}
            edges={edges} nodes={useWorkflowStore.getState().nodes}
            onChange={v => setParam(p.name, v)} />
        ))}

        {requiredParams.map(p => {
          const hid = `param-${p.name}`
          return (
            <ParamRow key={p.name} nodeId={id} schema={p} value={data.params[p.name]}
              connected={connectedSet.has(hid)}
              edges={edges} nodes={useWorkflowStore.getState().nodes}
              onDisconnect={() => {
                const edge = edges.find(e => e.target === id && e.targetHandle === hid)
                if (edge) useWorkflowStore.getState().removeEdge(edge.id)
              }}
              onChange={v => setParam(p.name, v)}
              optimizerSettings={(data.params.__optimizerSettings as Record<string, unknown>) ?? {}}
              onOptimizerSettingsChange={v => setParam('__optimizerSettings', v)} />
          )
        })}

        {/* Collapsible optional/hidden params */}
        {optionalParams.length > 0 && (
          <>
            <div className="px-3 py-1">
              <button onClick={e => { e.stopPropagation(); setShowOptional(!showOptional) }}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                <span className="text-[8px]">{showOptional ? '▼' : '▶'}</span>
                {showOptional ? 'Hide' : 'Show'} {optionalParams.length} optional
              </button>
            </div>
            {showOptional && optionalParams.map(p => {
              const hid = `param-${p.name}`
              return (
                <ParamRow key={p.name} nodeId={id} schema={p} value={data.params[p.name]}
                  connected={connectedSet.has(hid)}
                  edges={edges} nodes={useWorkflowStore.getState().nodes}
                  onDisconnect={() => {
                    const edge = edges.find(e => e.target === id && e.targetHandle === hid)
                    if (edge) useWorkflowStore.getState().removeEdge(edge.id)
                  }}
                  onChange={v => setParam(p.name, v)}
              optimizerSettings={(data.params.__optimizerSettings as Record<string, unknown>) ?? {}}
              onOptimizerSettingsChange={v => setParam('__optimizerSettings', v)} />
              )
            })}
          </>
        )}

        {inputDefs.map(inp => {
          const hid = `input-${inp.key}`
          const conn = connectedSet.has(hid)
          return (
            <Row key={inp.key} handleId={hid} handleType="target" connected={conn} media>
              <span className={`text-xs ${conn ? 'text-green-400 font-semibold' : 'text-[hsl(var(--muted-foreground))]'}`}>
                {inp.label}{inp.required && <span className="text-red-400"> *</span>}
              </span>
            </Row>
          )
        })}

        {/* Hide defParams for nodes with custom body UI */}
        {data.nodeType !== 'input/media-upload' && data.nodeType !== 'input/text-input' && defParams.map(p => {
          const hid = `param-${p.key}`
          const conn = connectedSet.has(hid)
          return (
            <Row key={p.key} handleId={hid} handleType="target" connected={conn}>
              <div className="flex items-center justify-between gap-2 w-full">
                <span className="text-xs text-[hsl(var(--muted-foreground))] flex-shrink-0">{p.label}</span>
                {conn ? <LinkedBadge nodeId={id} handleId={hid} edges={edges} nodes={useWorkflowStore.getState().nodes} /> : <DefParamControl param={p} value={data.params[p.key]} onChange={v => setParam(p.key, v)} />}
              </div>
            </Row>
          )
        })}
      </div>

      {/* ── Results — grouped by execution run ─────────────────── */}
      {resultGroups.length > 0 && (() => {
        /*
         * Results display logic:
         *
         * latestOnly ON:
         *   - Show ONLY resultGroups[0] (the absolute newest, regardless of hidden)
         *   - ✕ hides it → show "Latest result hidden" + "Show all"
         *   - "Show all" clears hidden + turns OFF latest → shows everything
         *   - "Latest" label only on resultGroups[0]
         *
         * latestOnly OFF:
         *   - Show all visibleGroups (hidden ones filtered out)
         *   - ✕ hides individual results
         *   - "Show all" clears all hidden
         *   - "Latest" label on resultGroups[0] if visible
         *
         * "Show all" button: ALWAYS clickable. Clears hidden + turns off latest (atomic).
         * "Latest" toggle: ON→OFF just switches mode. OFF→ON just switches mode.
         */
        const latestOnly = data.params.__showLatestOnly !== false
        const toggleLatest = (e: React.MouseEvent) => {
          e.stopPropagation()
          updateNodeParams(id, { ...data.params, __showLatestOnly: !latestOnly })
        }

        const newestGroup = resultGroups[0]
        const newestHidden = newestGroup ? hiddenSet.has(newestGroup.time) : false

        // What to actually display
        let displayGroups: typeof resultGroups
        if (latestOnly) {
          displayGroups = newestGroup && !newestHidden ? [newestGroup] : []
        } else {
          displayGroups = visibleGroups
        }

        return (
          <div className="px-3 pb-2 pt-1 border-t border-[hsl(var(--border))]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px] text-green-400 font-medium">
                Results ({displayGroups.length}/{resultGroups.length})
              </span>
              <div className="flex-1" />
              {/* Show all — always clickable, clears hidden + turns off latest */}
              <button onClick={e => { e.stopPropagation(); showAllRuns() }}
                className="text-[9px] text-blue-400 hover:text-blue-300 transition-colors">
                Show all
              </button>
              {/* Latest-only toggle */}
              <button onClick={toggleLatest}
                className={`flex items-center gap-1 text-[9px] transition-colors ${latestOnly ? 'text-blue-400' : 'text-muted-foreground hover:text-foreground'}`}
                title={latestOnly ? 'Show all runs' : 'Show latest only'}>
                <span className={`w-6 h-3 rounded-full relative transition-colors ${latestOnly ? 'bg-blue-500' : 'bg-muted-foreground/30'}`}>
                  <span className={`absolute top-0.5 w-2 h-2 rounded-full bg-white transition-transform ${latestOnly ? 'left-3.5' : 'left-0.5'}`} />
                </span>
                <span>Latest</span>
              </button>
            </div>
            <div className="space-y-2">
              {displayGroups.map((group) => {
                const isNewest = group === newestGroup
                return (
                  <div key={group.time} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] overflow-hidden">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[hsl(var(--muted))]">
                      {isNewest && <span className="text-[10px] text-green-400 font-semibold">Latest</span>}
                      <span className="text-[10px] text-foreground/80 font-medium">
                        {new Date(group.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      {group.durationMs != null && <span className="text-[10px] text-blue-400/80 font-medium">⏱ {(group.durationMs / 1000).toFixed(1)}s</span>}
                      {group.cost != null && group.cost > 0 && <span className="text-[10px] text-amber-400/80 font-medium">💰 ${group.cost.toFixed(4)}</span>}
                      <div className="flex-1" />
                      <button onClick={e => { e.stopPropagation(); hideRun(group.time) }}
                        className="text-[10px] text-muted-foreground hover:text-red-400 transition-colors" title="Hide this run">
                        ✕
                      </button>
                    </div>
                    <div className="p-1.5 flex gap-1.5 flex-wrap">
                      {group.urls.map((url, ui) => (
                        <ResultThumb key={`${url}-${ui}`} url={url} onPreview={openPreview} onDownload={handleDownload} />
                      ))}
                    </div>
                  </div>
                )
              })}
              {/* Empty state */}
              {displayGroups.length === 0 && (
                <div className="text-center py-3 text-[10px] text-muted-foreground">
                  {latestOnly && newestHidden ? 'Latest result hidden.' : 'No visible results.'}
                  <button onClick={e => { e.stopPropagation(); showAllRuns() }}
                    className="text-blue-400 hover:text-blue-300 ml-1">Show all</button>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── Output handle — top-right, aligned with title bar ───── */}
      <Handle type="source" position={Position.Right} id="output"
        style={{ ...handleRight(), top: 22 }}
        title="Output" />
      <div className="absolute top-[14px] right-5 text-[11px] font-medium text-blue-400/80">output</div>

      {/* ── Resize handles — 4 edges + 4 corners ────────────────── */}
      {/* Edges */}
      <div onMouseDown={e => onEdgeResizeStart(e,  1,  0)} className="nodrag absolute top-2 right-0 bottom-2 w-[5px] cursor-ew-resize z-20 hover:bg-blue-500/20" />
      <div onMouseDown={e => onEdgeResizeStart(e, -1,  0)} className="nodrag absolute top-2 left-0  bottom-2 w-[5px] cursor-ew-resize z-20 hover:bg-blue-500/20" />
      <div onMouseDown={e => onEdgeResizeStart(e,  0,  1)} className="nodrag absolute bottom-0 left-2 right-2  h-[5px] cursor-ns-resize z-20 hover:bg-blue-500/20" />
      <div onMouseDown={e => onEdgeResizeStart(e,  0, -1)} className="nodrag absolute top-0    left-2 right-2  h-[5px] cursor-ns-resize z-20 hover:bg-blue-500/20" />
      {/* Corners */}
      <div onMouseDown={e => onEdgeResizeStart(e,  1,  1)} className="nodrag absolute bottom-0 right-0 w-3 h-3 cursor-se-resize z-30" />
      <div onMouseDown={e => onEdgeResizeStart(e, -1,  1)} className="nodrag absolute bottom-0 left-0  w-3 h-3 cursor-sw-resize z-30" />
      <div onMouseDown={e => onEdgeResizeStart(e,  1, -1)} className="nodrag absolute top-0    right-0 w-3 h-3 cursor-ne-resize z-30" />
      <div onMouseDown={e => onEdgeResizeStart(e, -1, -1)} className="nodrag absolute top-0    left-0  w-3 h-3 cursor-nw-resize z-30" />
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   Row — wrapper that positions a Handle aligned to center of the row
   ══════════════════════════════════════════════════════════════════════ */

function Row({ children, handleId, handleType, connected, media }: {
  children: React.ReactNode; handleId: string; handleType: 'target' | 'source'
  connected: boolean; media?: boolean
}) {
  const pos = handleType === 'target' ? Position.Left : Position.Right
  const style = handleType === 'target' ? handleLeft(connected, media) : handleRight()
  return (
    <div className="relative flex items-center min-h-[32px] px-3 py-1">
      <Handle type={handleType} position={pos} id={handleId} style={style} />
      <div className="pl-2 flex-1 min-w-0">{children}</div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   ParamRow — one row per regular (non-media) schema parameter
   ══════════════════════════════════════════════════════════════════════ */

function ParamRow({ nodeId, schema, value, connected, onChange, onDisconnect, edges, nodes, optimizerSettings, onOptimizerSettingsChange }: {
  nodeId: string; schema: ModelParamSchema; value: unknown; connected: boolean
  onChange: (v: unknown) => void
  onDisconnect?: () => void
  edges?: Array<{ id: string; source: string; target: string; targetHandle?: string | null }>
  nodes?: Array<{ id: string; data: { label?: string } }>
  optimizerSettings?: Record<string, unknown>
  onOptimizerSettingsChange?: (settings: Record<string, unknown>) => void
}) {
  const label = schema.label ?? formatLabel(schema.name)
  const ft = schema.fieldType ?? (TEXTAREA_NAMES.has(schema.name.toLowerCase()) ? 'textarea' : undefined)
  const isSeed = schema.name.toLowerCase() === 'seed'
  const handleId = `param-${schema.name}`
  const cur = value ?? schema.default
  // Connected = always locked, user must disconnect to edit
  const showEditor = !connected

  const inputCls = 'w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-[hsl(var(--muted-foreground))]'
  const selectCls = 'rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50'

  // ── Textarea: full-width below label ──
  if (ft === 'textarea') {
    const isPromptField = schema.name.toLowerCase() === 'prompt'
    return (
      <div className="relative px-3 py-1">
        <Handle type="target" position={Position.Left} id={handleId} style={{ ...handleLeft(connected), top: 16 }} />
        <label className="pl-2 flex items-center gap-1 mb-1 text-xs font-medium text-blue-400">
          {label}{schema.required && <span className="text-red-400">*</span>}
          {schema.description && <Tip text={schema.description} />}
          {isPromptField && !connected && (
            <WorkflowPromptOptimizer
              currentPrompt={String(cur ?? '')}
              onOptimized={v => onChange(v)}
              quickSettings={optimizerSettings}
              onQuickSettingsChange={onOptimizerSettingsChange}
            />
          )}
        </label>
        <div className="pl-2">
          {connected ? <LinkedBadge nodeId={nodeId} handleId={handleId} edges={edges} nodes={nodes} onDisconnect={onDisconnect} /> : (
            <textarea value={String(cur ?? '')} onChange={e => onChange(e.target.value)}
              placeholder={schema.placeholder ?? schema.description ?? label} rows={3}
              className={`nodrag ${inputCls} resize-y min-h-[60px] max-h-[300px]`}
              onClick={e => e.stopPropagation()} />
          )}
        </div>
      </div>
    )
  }

  // ── Slider: range input + number display ──
  if (ft === 'slider' && schema.min !== undefined && schema.max !== undefined) {
    const numVal = cur !== undefined && cur !== null ? Number(cur) : schema.min
    return (
      <div className="relative px-3 py-1">
        <Handle type="target" position={Position.Left} id={handleId} style={{ ...handleLeft(connected), top: '50%', transform: 'translateY(-50%)' }} />
        <div className="pl-2">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-xs text-blue-400 font-medium flex items-center gap-1 flex-shrink-0">
              {label}{schema.required && <span className="text-red-400">*</span>}
              {schema.description && <Tip text={schema.description} />}
            </span>
            <div className="flex-1" />
            {connected ? <LinkedBadge nodeId={nodeId} handleId={handleId} edges={edges} nodes={nodes} onDisconnect={onDisconnect} /> : (
              <span className="text-[11px] text-foreground font-medium min-w-[30px] text-right">{numVal}</span>
            )}
          </div>
          {showEditor && (
            <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
              <span className="text-[9px] text-muted-foreground">{schema.min}</span>
              <input type="range" min={schema.min} max={schema.max} step={schema.step ?? (schema.type === 'integer' ? 1 : 0.1)}
                value={numVal} onChange={e => onChange(Number(e.target.value))}
                className="nodrag flex-1 h-1 accent-blue-500 cursor-pointer" />
              <span className="text-[9px] text-muted-foreground">{schema.max}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Size: dropdown if enum, or W×H dual input ──
  if (ft === 'size') {
    return (
      <Row handleId={handleId} handleType="target" connected={connected}>
        <div className="flex items-center gap-2">
          <span className="text-xs text-blue-400 font-medium flex items-center gap-1 flex-shrink-0">
            {label}{schema.description && <Tip text={schema.description} />}
          </span>
          <div className="flex-1 min-w-0 flex justify-end" onClick={e => e.stopPropagation()}>
            {connected ? <LinkedBadge nodeId={nodeId} handleId={handleId} edges={edges} nodes={nodes} onDisconnect={onDisconnect} />
              : schema.enum && schema.enum.length > 0 ? (
                <select value={String(cur ?? schema.enum[0] ?? '')} onChange={e => onChange(e.target.value)} className={`nodrag ${selectCls} w-full max-w-[160px] text-right`}>
                  {schema.enum.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <SizeInput value={String(cur ?? '')} onChange={v => onChange(v)} min={schema.min} max={schema.max} />
              )}
          </div>
        </div>
      </Row>
    )
  }

  // ── All other types: single row ──
  return (
    <Row handleId={handleId} handleType="target" connected={connected}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-blue-400 font-medium whitespace-nowrap flex items-center gap-1 flex-shrink-0">
          {label}{schema.required && <span className="text-red-400">*</span>}
          {schema.description && <Tip text={schema.description} />}
        </span>
        <div className="flex-1 min-w-0 flex justify-end items-center gap-1" onClick={e => e.stopPropagation()}>
          {connected ? <LinkedBadge nodeId={nodeId} handleId={handleId} edges={edges} nodes={nodes} onDisconnect={onDisconnect} />
            : (ft === 'select' || (schema.type === 'enum' && schema.enum)) ? (
              <select value={String(cur ?? (schema.enum?.[0]) ?? '')} onChange={e => onChange(e.target.value)} className={`nodrag ${selectCls} w-full max-w-[180px] text-right`}>
                {(schema.enum ?? []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : schema.type === 'boolean' || ft === 'boolean' ? <ToggleSwitch checked={Boolean(cur)} onChange={onChange} />
            : schema.type === 'number' || schema.type === 'integer' || ft === 'number' ? (
              <>
                <NumberInput value={cur as number | undefined} min={schema.min} max={schema.max} step={schema.step ?? (schema.type === 'integer' ? 1 : 0.1)} onChange={onChange} />
                {isSeed && (
                  <button onClick={() => onChange(Math.floor(Math.random() * 2147483647))}
                    title="Randomize seed" className="px-1.5 py-1 rounded text-[16px] leading-none bg-blue-500/10 hover:bg-blue-500/20 transition-colors flex-shrink-0">
                    🎲
                  </button>
                )}
              </>
            ) : (
              <input type="text" value={String(cur ?? '')} onChange={e => onChange(e.target.value)}
                placeholder={schema.placeholder ?? schema.description ?? label} className={`${inputCls} max-w-[180px] text-right`} />
            )}
        </div>
      </div>
    </Row>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   MediaRow — single or multi media parameter with upload states
   ══════════════════════════════════════════════════════════════════════ */

function MediaRow({ nodeId, schema, value, connected, connectedSet, onChange, onPreview, edges, nodes }: {
  nodeId: string; schema: ModelParamSchema; value: unknown; connected: boolean; connectedSet: Set<string>
  onChange: (v: unknown) => void; onPreview: (src: string) => void
  edges?: Array<{ id: string; source: string; target: string; targetHandle?: string | null }>
  nodes?: Array<{ id: string; data: { label?: string } }>
}) {
  const disconnectHandle = (handleId: string) => {
    const edge = edges?.find(e => e.target === nodeId && e.targetHandle === handleId)
    if (edge) useWorkflowStore.getState().removeEdge(edge.id)
  }
  const label = schema.label ?? formatLabel(schema.name)
  const handleId = `param-${schema.name}`
  const nameLC = schema.name.toLowerCase()
  const acceptType = schema.mediaType === 'image' ? 'image/*' : schema.mediaType === 'video' ? 'video/*' : schema.mediaType === 'audio' ? 'audio/*' : '*/*'
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [uploadError, setUploadError] = useState('')

  const isArray = nameLC.endsWith('images') || nameLC.endsWith('videos') || nameLC.endsWith('audios')
    || nameLC.endsWith('image_urls') || nameLC.endsWith('video_urls') || nameLC.endsWith('audio_urls')
    || nameLC.endsWith('_urls')

  /** Upload file — directly set the final HTTP URL, no blob: prefix */
  const doUpload = async (file: File, cb: (url: string) => void) => {
    setUploadState('uploading'); setUploadError('')
    try {
      const { uploadIpc } = await import('../../ipc/ipc-client')
      const url = await uploadIpc.uploadFile(file)
      cb(url)
      setUploadState('success')
      setTimeout(() => setUploadState('idle'), 2000)
    } catch (err) {
      setUploadState('error')
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  const isValidUrl = (v: string) => {
    if (!v.trim()) return true
    try {
      const url = new URL(v)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch { return false }
  }

  /** Check if a URL is displayable (not blob:, not empty) */
  const isPreviewable = (v: string) => v && !v.startsWith('blob:') && isValidUrl(v)

  if (isArray) {
    const items: string[] = Array.isArray(value) ? value : (value ? [String(value)] : [''])

    // Only the last item can be deleted (prevents index-shifting bugs with connected edges)
    const canDeleteIndex = (i: number) => {
      if (i !== items.length - 1) return false // only last
      const hid = `${schema.name}[${i}]`
      return !connectedSet.has(hid) // can't delete if connected
    }

    /* Return a Fragment so each item's Handle container is at the SAME
       nesting depth as ParamRow / Row — direct child of body(px-1).
       This ensures all handles line up vertically on the node border. */
    return (
      <>
        {/* Label row — no Handle, just the field name */}
        <div className="px-3 py-1">
          <div className="pl-2 flex items-center gap-1 text-xs font-medium text-green-400">
            {label}{schema.required && <span className="text-red-400">*</span>}
            {schema.description && <Tip text={schema.description} />}
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-normal ml-1">({items.length})</span>
            <UploadStatusBadge state={uploadState} error={uploadError} />
          </div>
        </div>
        {/* Each item as its own Row (same depth as ParamRow) */}
        {items.map((v, i) => {
          const hid = `${schema.name}[${i}]`
          const conn = connectedSet.has(hid)
          const urlValid = isValidUrl(v)
          return (
            <div key={i} className="relative flex items-center min-h-[32px] px-3 py-0.5">
              <Handle type="target" position={Position.Left} id={hid} style={handleLeft(conn, true)} />
              <div className="pl-2 flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))] w-5 flex-shrink-0">[{i + 1}]</span>
                  {conn ? <LinkedBadge nodeId={nodeId} handleId={hid} edges={edges} nodes={nodes} onDisconnect={() => disconnectHandle(hid)} /> : (
                    <>
                      <input type="text" value={v || ''} placeholder="URL…"
                        onChange={e => { const a = [...items]; a[i] = e.target.value; onChange(a) }}
                        onClick={e => e.stopPropagation()}
                        className={`flex-1 rounded-md border bg-[hsl(var(--background))] px-2 py-1 text-[11px] text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 ${urlValid ? 'border-[hsl(var(--border))] focus:ring-green-500/50' : 'border-red-500 focus:ring-red-500/50'}`} />
                      <FileBtn accept={acceptType} uploading={uploadState === 'uploading'}
                        onFile={f => doUpload(f, url => { const a = [...items]; a[i] = url; onChange(a) })} />
                    </>
                  )}
                  {canDeleteIndex(i) ? (
                    <button onClick={e => { e.stopPropagation(); onChange(items.slice(0, -1)) }}
                      className="text-red-400/70 hover:text-red-400 text-sm px-0.5" title="Remove last">✕</button>
                  ) : (
                    <div className="w-4" />
                  )}
                </div>
                {!urlValid && v.trim() && (
                  <div className="pl-7 text-[9px] text-red-400 mt-0.5">Invalid URL</div>
                )}
                {isPreviewable(v) && schema.mediaType === 'image' && (
                  <div className="pl-6 mt-0.5">
                    <img src={v} alt="" onClick={e => { e.stopPropagation(); onPreview(v) }}
                      className="max-h-[50px] rounded border border-[hsl(var(--border))] object-contain cursor-pointer hover:ring-1 hover:ring-blue-500/40" />
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {/* Add button */}
        <div className="px-3 py-0.5">
          <button onClick={e => { e.stopPropagation(); onChange([...items, '']) }}
            className="w-full py-1.5 ml-2 rounded-md border border-dashed border-blue-500/30 text-[11px] font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 hover:border-blue-500/50 transition-colors">
            + Add
          </button>
        </div>
      </>
    )
  }

  /* ── Single media ── */
  const sval = typeof value === 'string' ? value : ''
  const urlValid = isValidUrl(sval)

  return (
    <div className="relative px-3 py-1">
      <Handle type="target" position={Position.Left} id={handleId} style={{ ...handleLeft(connected, true), top: 16 }} />
      <label className="pl-2 flex items-center gap-1 mb-1 text-xs font-medium text-green-400">
        {label}{schema.required && <span className="text-red-400">*</span>}
        {schema.description && <Tip text={schema.description} />}
        <UploadStatusBadge state={uploadState} error={uploadError} />
      </label>
      <div className="pl-2">
        {connected ? <LinkedBadge nodeId={nodeId} handleId={handleId} edges={edges} nodes={nodes} onDisconnect={() => disconnectHandle(handleId)} /> : (
          <>
            <div className="flex items-center gap-1">
              <input type="text" value={sval} placeholder={`Enter ${label.toLowerCase()}…`}
                onChange={e => onChange(e.target.value)} onClick={e => e.stopPropagation()}
                className={`flex-1 rounded-md border bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 ${urlValid ? 'border-[hsl(var(--border))] focus:ring-green-500/50' : 'border-red-500 focus:ring-red-500/50'}`} />
              <FileBtn accept={acceptType} uploading={uploadState === 'uploading'} onFile={f => doUpload(f, url => onChange(url))} />
            </div>
            {!urlValid && sval.trim() && <div className="text-[9px] text-red-400 mt-0.5">Invalid URL</div>}
            {/* Preview for any valid URL (including after upload) */}
            {isPreviewable(sval) && schema.mediaType === 'image' && (
              <img src={sval} alt="" onClick={e => { e.stopPropagation(); onPreview(sval) }}
                className="mt-1.5 max-h-[80px] rounded-md border border-[hsl(var(--border))] object-contain cursor-pointer hover:ring-2 hover:ring-blue-500/40 transition-shadow" />
            )}
            {isPreviewable(sval) && schema.mediaType === 'video' && (
              <video src={sval} controls className="mt-1.5 max-h-[80px] rounded-md border border-[hsl(var(--border))]" onClick={e => e.stopPropagation()} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════════════════ */

/** Shows "linked to NodeLabel" with a lock icon; click lock to disconnect */
function LinkedBadge({ nodeId, handleId, edges, nodes, onDisconnect }: {
  nodeId?: string; handleId?: string
  edges?: Array<{ id: string; source: string; target: string; targetHandle?: string | null }>
  nodes?: Array<{ id: string; data: { label?: string } }>
  onDisconnect?: () => void
}) {
  if (!nodeId || !handleId || !edges || !nodes) {
    return <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 italic"><LockIcon /> linked</span>
  }
  const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
  if (!edge) {
    return <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 italic"><LockIcon /> linked</span>
  }
  const sourceNode = nodes.find(n => n.id === edge.source)
  const sourceName = sourceNode?.data?.label || edge.source.slice(0, 8)
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 italic">
      {onDisconnect ? (
        <button onClick={e => { e.stopPropagation(); onDisconnect() }}
          title="Unlock: disconnect this link"
          className="hover:text-red-400 transition-colors">
          <LockIcon />
        </button>
      ) : <LockIcon />}
      linked to <span className="font-medium not-italic truncate max-w-[100px]">{sourceName}</span>
    </span>
  )
}

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  )
}

function UploadStatusBadge({ state, error }: { state: string; error: string }) {
  if (state === 'uploading') return <span className="ml-auto text-[10px] text-blue-400 animate-pulse">Uploading…</span>
  if (state === 'success') return <span className="ml-auto text-[10px] text-green-400">✓ Uploaded</span>
  if (state === 'error') return <span className="ml-auto text-[10px] text-red-400" title={error}>✕ Failed</span>
  return null
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: unknown) => void }) {
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onChange(!checked) }}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer focus:outline-none ${checked ? 'bg-blue-500' : 'bg-[hsl(var(--muted))]'}`}>
      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

function NumberInput({ value, min, max, step, onChange }: {
  value: number | undefined; min?: number; max?: number; step: number; onChange: (v: unknown) => void
}) {
  // Clamp value to min/max on blur
  const handleBlur = () => {
    if (value === undefined || value === null) return
    let clamped = Number(value)
    if (min !== undefined && clamped < min) clamped = min
    if (max !== undefined && clamped > max) clamped = max
    if (clamped !== Number(value)) onChange(clamped)
  }

  return (
    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
      <input type="number" value={value !== undefined && value !== null ? value : ''} min={min} max={max} step={step}
        onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        onBlur={handleBlur}
        className="w-full max-w-[120px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-right text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
      {min !== undefined && max !== undefined && <span className="text-[9px] text-[hsl(var(--muted-foreground))] whitespace-nowrap">{min}–{max}</span>}
    </div>
  )
}

function FileBtn({ accept, onFile, uploading }: { accept: string; onFile: (f: File) => void; uploading?: boolean }) {
  return (
    <label className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-md border border-[hsl(var(--border))] cursor-pointer transition-colors ${uploading ? 'bg-blue-500/25 animate-pulse' : 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'}`}
      onClick={e => e.stopPropagation()}>
      {uploading ? (
        <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" /></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      )}
      <input type="file" accept={accept} className="hidden" disabled={uploading}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} onClick={e => e.stopPropagation()} />
    </label>
  )
}

function Tip({ text }: { text: string }) {
  return (
    <span className="relative group cursor-help inline-flex items-center" onClick={e => e.stopPropagation()}>
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[hsl(var(--muted-foreground))] opacity-50 hover:opacity-100">
        <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span className="absolute bottom-full left-0 mb-2 w-max max-w-[320px] px-3 py-2.5 rounded-lg bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] text-[11px] leading-[1.6] shadow-xl border border-[hsl(var(--border))] opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
        {text}
      </span>
    </span>
  )
}

function DefParamControl({ param, value, onChange }: { param: ParamDefinition; value: unknown; onChange: (v: unknown) => void }) {
  const cls = 'rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50'
  const cur = value ?? param.default
  if (param.type === 'select' && param.options) {
    return <select value={String(cur ?? '')} onChange={e => onChange(e.target.value)} className={`nodrag ${cls} max-w-[160px]`} onClick={e => e.stopPropagation()}>{param.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
  }
  if (param.type === 'boolean') return <ToggleSwitch checked={Boolean(cur)} onChange={onChange} />
  if (param.type === 'number' || param.type === 'slider') return <NumberInput value={cur as number | undefined} min={param.validation?.min} max={param.validation?.max} step={param.validation?.step ?? 1} onChange={onChange} />
  if (param.type === 'textarea') return <textarea value={String(cur ?? '')} onChange={e => onChange(e.target.value)} className={`nodrag ${cls} w-full min-h-[40px] resize-y max-h-[300px]`} onClick={e => e.stopPropagation()} />
  return <input type="text" value={String(cur ?? '')} onChange={e => onChange(e.target.value)} className={`${cls} max-w-[160px]`} onClick={e => e.stopPropagation()} />
}

/* ══════════════════════════════════════════════════════════════════════
   MediaUploadBody — dedicated UI for Media Upload nodes
   Features: drag-and-drop zone, file picker, URL paste, preview, upload status
   ══════════════════════════════════════════════════════════════════════ */

function MediaUploadBody({ params, onBatchChange, onPreview }: {
  params: Record<string, unknown>
  onBatchChange: (updates: Record<string, unknown>) => void
  onPreview: (src: string) => void
}) {
  const uploadedUrl = String(params.uploadedUrl ?? '')
  const mediaType = String(params.mediaType ?? '')
  const fileName = String(params.fileName ?? '')
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [uploadError, setUploadError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [showUrlInput, setShowUrlInput] = useState(false)

  const detectMediaType = (name: string): string => {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image'
    if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) return 'video'
    if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) return 'audio'
    return 'file'
  }

  const handleFile = async (file: File) => {
    setUploadState('uploading'); setUploadError('')
    onBatchChange({ fileName: file.name, mediaType: detectMediaType(file.name) })
    try {
      const { uploadIpc } = await import('../../ipc/ipc-client')
      const url = await uploadIpc.uploadFile(file)
      onBatchChange({ uploadedUrl: url, fileName: file.name, mediaType: detectMediaType(file.name) })
      setUploadState('success')
      setTimeout(() => setUploadState('idle'), 2000)
    } catch (err) {
      setUploadState('error')
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleUrlSubmit = () => {
    const url = urlInput.trim()
    if (!url) return
    try { new URL(url) } catch { setUploadError('Invalid URL'); setUploadState('error'); return }
    const ext = url.split('/').pop()?.split('?')[0] ?? 'file'
    onBatchChange({ uploadedUrl: url, fileName: ext, mediaType: detectMediaType(ext) })
    setUrlInput('')
    setShowUrlInput(false)
    setUploadState('success')
    setUploadError('')
    setTimeout(() => setUploadState('idle'), 2000)
  }

  const handleClear = () => {
    onBatchChange({ uploadedUrl: '', fileName: '', mediaType: '' })
    setUploadState('idle')
    setUploadError('')
  }

  // Has content
  if (uploadedUrl) {
    return (
      <div className="px-3 py-2">
        {/* Preview */}
        <div className="mb-2 relative group">
          {(mediaType === 'image' || uploadedUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) ? (
            <img src={uploadedUrl} alt={fileName} onClick={e => { e.stopPropagation(); onPreview(uploadedUrl) }}
              className="w-full max-h-[120px] rounded-lg border border-[hsl(var(--border))] object-contain cursor-pointer hover:ring-2 hover:ring-blue-500/40 bg-black/20" />
          ) : (mediaType === 'video' || uploadedUrl.match(/\.(mp4|webm|mov)$/i)) ? (
            <video src={uploadedUrl} controls className="w-full max-h-[120px] rounded-lg border border-[hsl(var(--border))]" onClick={e => e.stopPropagation()} />
          ) : (mediaType === 'audio' || uploadedUrl.match(/\.(mp3|wav|ogg)$/i)) ? (
            <audio src={uploadedUrl} controls className="w-full" onClick={e => e.stopPropagation()} />
          ) : (
            <div className="p-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-xs text-center">
              {fileName || 'File uploaded'}
            </div>
          )}
        </div>

        {/* File info */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground truncate flex-1" title={fileName}>{fileName}</span>
          {uploadState === 'success' && <span className="text-[10px] text-green-400">Uploaded</span>}
          <button onClick={e => { e.stopPropagation(); handleClear() }}
            className="text-[10px] text-red-400 hover:text-red-300 transition-colors">
            Clear
          </button>
        </div>

        {/* URL display */}
        <div className="mt-1 text-[9px] text-muted-foreground/60 truncate" title={uploadedUrl}>
          {uploadedUrl.slice(0, 60)}...
        </div>
      </div>
    )
  }

  // Empty state — drop zone
  return (
    <div className="px-3 py-2" onClick={e => e.stopPropagation()}>
      <div
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }}
        onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragOver(false) }}
        onDrop={handleDrop}
        className={`relative rounded-lg border-2 border-dashed p-4 text-center transition-colors
          ${dragOver ? 'border-blue-500 bg-blue-500/10' : 'border-[hsl(var(--border))] hover:border-blue-500/50'}
          ${uploadState === 'uploading' ? 'opacity-60 pointer-events-none' : ''}`}
      >
        {uploadState === 'uploading' ? (
          <div className="py-2">
            <div className="text-xs text-blue-400 animate-pulse mb-1">Uploading...</div>
            <div className="text-[10px] text-muted-foreground">{fileName}</div>
          </div>
        ) : (
          <>
            <div className="text-2xl mb-1">📁</div>
            <div className="text-xs text-muted-foreground mb-2">
              Drop file here or click to browse
            </div>
            <div className="flex gap-1.5 justify-center">
              <label className="px-3 py-1 rounded-md text-[11px] font-medium bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 cursor-pointer transition-colors">
                Browse
                <input type="file" accept="image/*,video/*,audio/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              </label>
              <button onClick={() => setShowUrlInput(!showUrlInput)}
                className="px-3 py-1 rounded-md text-[11px] font-medium bg-[hsl(var(--muted))] text-muted-foreground hover:text-foreground transition-colors">
                Paste URL
              </button>
            </div>
          </>
        )}
      </div>

      {/* URL input */}
      {showUrlInput && (
        <div className="mt-2 flex gap-1">
          <input type="text" value={urlInput} onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUrlSubmit()}
            placeholder="https://..." autoFocus
            className="flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500/50" />
          <button onClick={handleUrlSubmit}
            className="px-2 py-1 rounded-md text-[10px] font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors">
            OK
          </button>
        </div>
      )}

      {/* Error */}
      {uploadState === 'error' && (
        <div className="mt-2 text-[10px] text-red-400 text-center">{uploadError}</div>
      )}

      {/* Supported formats hint */}
      <div className="mt-2 text-[9px] text-muted-foreground/50 text-center">
        Image, Video, Audio
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   TextInputBody — dedicated UI for Text Input nodes
   Features: rich textarea, Prompt Optimizer, Prompt Library (snippets)
   ══════════════════════════════════════════════════════════════════════ */

const SNIPPETS_KEY = 'wavespeed_prompt_snippets'
interface PromptSnippet { id: string; name: string; text: string }

function loadSnippets(): PromptSnippet[] {
  try { return JSON.parse(localStorage.getItem(SNIPPETS_KEY) || '[]') } catch { return [] }
}

function TextInputBody({ params, onParamChange }: {
  params: Record<string, unknown>
  onParamChange: (updates: Record<string, unknown>) => void
}) {
  const text = String(params.text ?? '')
  const [snippetOpen, setSnippetOpen] = useState(false)
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [snippets, setSnippets] = useState<PromptSnippet[]>(loadSnippets)
  const snippetRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!snippetOpen) return
    const handler = (e: MouseEvent) => {
      if (snippetRef.current && !snippetRef.current.contains(e.target as Node)) {
        setSnippetOpen(false)
        setShowSaveInput(false)
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 50)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler) }
  }, [snippetOpen])

  const doSave = () => {
    if (!saveName.trim() || !text.trim()) return
    const updated = [{ id: `snp-${Date.now()}`, name: saveName.trim(), text }, ...snippets]
    setSnippets(updated)
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify(updated))
    setSaveName('')
    setShowSaveInput(false)
  }

  const doLoad = (s: PromptSnippet) => {
    onParamChange({ text: s.text })
    setSnippetOpen(false)
  }

  const doDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const updated = snippets.filter(s => s.id !== id)
    setSnippets(updated)
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify(updated))
  }

  return (
    <div className="px-3 py-2" onClick={e => e.stopPropagation()}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 mb-1.5">
        {/* Snippet Library */}
        <div className="relative" ref={snippetRef}>
          <button onClick={() => { setSnippetOpen(!snippetOpen); setShowSaveInput(false) }}
            title="Prompt Library"
            className={`flex items-center justify-center w-6 h-6 rounded-md transition-colors
              ${snippetOpen ? 'bg-blue-500/20 text-blue-400' : 'hover:bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
          </button>

          {snippetOpen && (
            <div className="absolute top-7 left-0 z-[100] w-52 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-xl"
              onClick={e => e.stopPropagation()}>
              {/* Save Current */}
              {!showSaveInput ? (
                <button onClick={() => setShowSaveInput(true)} disabled={!text.trim()}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-[hsl(var(--accent))] transition-colors disabled:opacity-40 disabled:cursor-not-allowed rounded-t-lg">
                  <span>💾</span> <span>Save Current</span>
                </button>
              ) : (
                <div className="px-2 py-2 flex gap-1">
                  <input type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') doSave(); e.stopPropagation() }}
                    placeholder="Name..." autoFocus
                    className="flex-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500/50" />
                  <button onClick={doSave} disabled={!saveName.trim()}
                    className="px-2 py-1 rounded text-[10px] font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors">
                    Save
                  </button>
                </div>
              )}

              {snippets.length > 0 && <div className="mx-2 h-px bg-[hsl(var(--border))]" />}

              {/* Snippet List */}
              <div className="max-h-[180px] overflow-y-auto py-0.5">
                {snippets.map(s => (
                  <div key={s.id}
                    className="flex items-center gap-1 px-3 py-1.5 hover:bg-[hsl(var(--accent))] transition-colors cursor-pointer group"
                    onClick={() => doLoad(s)}>
                    <span className="flex-1 text-[11px] truncate" title={s.text}>{s.name}</span>
                    <button onClick={e => doDelete(e, s.id)}
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all text-[11px] px-0.5">
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {snippets.length === 0 && (
                <div className="px-3 py-3 text-[10px] text-[hsl(var(--muted-foreground))] text-center">
                  No saved snippets
                </div>
              )}
            </div>
          )}
        </div>

        {/* Prompt Optimizer */}
        <WorkflowPromptOptimizer
          currentPrompt={text}
          onOptimized={(optimized) => onParamChange({ text: optimized })}
          quickSettings={(params.__optimizerSettings as Record<string, unknown>) ?? {}}
          onQuickSettingsChange={(settings) => onParamChange({ __optimizerSettings: settings })}
        />

        <div className="flex-1" />

        {/* Character count */}
        <span className="text-[9px] text-[hsl(var(--muted-foreground))]">{text.length} chars</span>
      </div>

      {/* Textarea */}
      <textarea
        value={text}
        onChange={e => onParamChange({ text: e.target.value })}
        placeholder="Enter text or prompt..."
        rows={4}
        className="nodrag w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-2 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-[hsl(var(--muted-foreground))] resize-y min-h-[80px] max-h-[400px]"
      />
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   LoraRow — inline LoRA editor (path + scale, add/remove)
   ══════════════════════════════════════════════════════════════════════ */

interface LoraItem { path: string; scale: number }

function LoraRow({ schema, value, onChange }: {
  schema: ModelParamSchema; value: unknown; onChange: (v: unknown) => void
}) {
  const label = schema.label ?? formatLabel(schema.name)
  const maxItems = schema.maxItems ?? 3
  const items: LoraItem[] = Array.isArray(value) ? value : []
  const [inputPath, setInputPath] = useState('')

  const addLora = () => {
    const path = inputPath.trim()
    if (!path || items.length >= maxItems) return
    if (items.some(l => l.path === path)) return
    onChange([...items, { path, scale: 1 }])
    setInputPath('')
  }

  const removeLora = (index: number) => {
    onChange(items.filter((_, i) => i !== index))
  }

  const updateScale = (index: number, scale: number) => {
    onChange(items.map((l, i) => i === index ? { ...l, scale } : l))
  }

  return (
    <div className="relative px-3 py-1">
      <label className="pl-2 flex items-center gap-1 mb-1 text-xs font-medium text-purple-400">
        {label}{schema.required && <span className="text-red-400">*</span>}
        {schema.description && <Tip text={schema.description} />}
        <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-normal ml-1">({items.length}/{maxItems})</span>
      </label>
      <div className="pl-2 space-y-1.5">
        {items.map((lora, i) => (
          <div key={lora.path} className="flex items-center gap-1.5 p-1.5 rounded-md bg-[hsl(var(--muted))] border border-[hsl(var(--border))]" onClick={e => e.stopPropagation()}>
            <span className="text-[10px] text-[hsl(var(--foreground))] truncate flex-1 min-w-0" title={lora.path}>{lora.path}</span>
            <input type="range" min={0} max={4} step={0.1} value={lora.scale}
              onChange={e => updateScale(i, Number(e.target.value))}
              className="nodrag w-16 h-1 accent-purple-500 cursor-pointer flex-shrink-0" />
            <span className="text-[9px] text-[hsl(var(--muted-foreground))] w-6 text-right flex-shrink-0">{lora.scale.toFixed(1)}</span>
            <button onClick={() => removeLora(i)} className="text-red-400/70 hover:text-red-400 text-sm flex-shrink-0">✕</button>
          </div>
        ))}
        {items.length < maxItems && (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <input type="text" value={inputPath} placeholder="user/repo or .safetensors URL"
              onChange={e => setInputPath(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addLora()}
              className="flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-[11px] text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-purple-500/50 placeholder:text-[hsl(var(--muted-foreground))]" />
            <button onClick={addLora} disabled={!inputPath.trim()}
              className="px-2 py-1 rounded-md text-[10px] font-medium bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
              + Add
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   JsonRow — JSON textarea for complex types (array, object)
   ══════════════════════════════════════════════════════════════════════ */

function JsonRow({ nodeId, schema, value, connected, onChange, edges, nodes }: {
  nodeId: string; schema: ModelParamSchema; value: unknown; connected: boolean
  onChange: (v: unknown) => void
  edges?: Array<{ id: string; source: string; target: string; targetHandle?: string | null }>
  nodes?: Array<{ id: string; data: { label?: string } }>
}) {
  const label = schema.label ?? formatLabel(schema.name)
  const handleId = `param-${schema.name}`

  // Serialize value for display
  const displayValue = useMemo(() => {
    if (value === undefined || value === null) {
      if (schema.default !== undefined) {
        return typeof schema.default === 'string' ? schema.default : JSON.stringify(schema.default, null, 2)
      }
      return ''
    }
    if (typeof value === 'string') return value
    return JSON.stringify(value, null, 2)
  }, [value, schema.default])

  const handleChange = (raw: string) => {
    try {
      const parsed = JSON.parse(raw)
      onChange(parsed)
    } catch {
      onChange(raw)
    }
  }

  const onDisconnect = () => {
    const edge = edges?.find(e => e.target === nodeId && e.targetHandle === handleId)
    if (edge) useWorkflowStore.getState().removeEdge(edge.id)
  }

  return (
    <div className="relative px-3 py-1">
      <Handle type="target" position={Position.Left} id={handleId} style={{ ...handleLeft(connected), top: 16 }} />
      <label className="pl-2 flex items-center gap-1 mb-1 text-xs font-medium text-orange-400">
        {label}{schema.required && <span className="text-red-400">*</span>}
        {schema.description && <Tip text={schema.description} />}
        <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-normal ml-1">JSON</span>
      </label>
      <div className="pl-2">
        {connected ? <LinkedBadge nodeId={nodeId} handleId={handleId} edges={edges} nodes={nodes} onDisconnect={onDisconnect} /> : (
          <textarea value={displayValue} onChange={e => handleChange(e.target.value)}
            placeholder={schema.placeholder ?? `e.g. [1, 2, 3] or {"key": "value"}`}
            rows={3} onClick={e => e.stopPropagation()}
            className="nodrag w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-orange-500/50 focus:border-orange-500 placeholder:text-[hsl(var(--muted-foreground))] resize-y min-h-[48px] max-h-[300px] font-mono" />
        )}
      </div>
    </div>
  )
}

/** Size input — dual W×H number fields. Value format: "W*H" (e.g. "1024*1024") */
/* ══════════════════════════════════════════════════════════════════════
   ResultThumb — smart thumbnail for each result URL in grouped view
   ══════════════════════════════════════════════════════════════════════ */

function ResultThumb({ url, onPreview, onDownload }: { url: string; onPreview: (src: string) => void; onDownload: (url: string) => void }) {
  // Detect if the result is plain text (not a URL)
  const isUrl = /^https?:\/\//i.test(url) || /^blob:/i.test(url)
  const is3D = isUrl && url.match(/\.(glb|gltf)(\?.*)?$/i)
  const isImage = isUrl && url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)
  const isVideo = isUrl && url.match(/\.(mp4|webm|mov)(\?.*)?$/i)

  // Plain text result — show inline text preview
  if (!isUrl) {
    return (
      <div className="flex-1 min-w-[80px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-2 cursor-default"
        onClick={e => e.stopPropagation()}>
        <div className="text-[10px] text-[hsl(var(--foreground))] leading-snug line-clamp-4 break-words whitespace-pre-wrap">
          {url}
        </div>
        {url.length > 200 && (
          <button onClick={e => { e.stopPropagation(); onPreview(url) }}
            className="mt-1 text-[9px] text-blue-400 hover:text-blue-300 transition-colors">
            Show full text
          </button>
        )}
      </div>
    )
  }

  if (isImage) {
    return (
      <div className="relative group flex-1 min-w-[80px]">
        <img src={url} alt="" onClick={e => { e.stopPropagation(); onPreview(url) }}
          className="w-full max-h-[120px] rounded border border-[hsl(var(--border))] object-contain cursor-pointer hover:ring-2 hover:ring-blue-500/40 bg-black/10" />
        <button onClick={e => { e.stopPropagation(); onDownload(url) }}
          className="absolute top-1 right-1 w-7 h-7 rounded-md bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><line x1="4" y1="21" x2="20" y2="21"/>
          </svg>
        </button>
      </div>
    )
  }

  if (is3D) {
    return (
      <div className="relative group flex-1 min-w-[80px] cursor-pointer rounded border border-[hsl(var(--border))] bg-gradient-to-br from-[#1a1a2e] to-[#0f3460] p-3 flex flex-col items-center justify-center text-center hover:ring-2 hover:ring-blue-500/40 transition-all"
        style={{ minHeight: 120 }}
        onClick={e => { e.stopPropagation(); onPreview(url) }}>
        <div className="text-2xl mb-1">🧊</div>
        <div className="text-[10px] text-blue-300 font-medium">3D Model</div>
        <div className="text-[8px] text-white/30 truncate mt-0.5 max-w-full">{url.split('/').pop()?.split('?')[0]}</div>
      </div>
    )
  }

  if (isVideo) {
    return (
      <div className="relative group flex-1 min-w-[80px]">
        <video src={url} className="w-full max-h-[120px] rounded border border-[hsl(var(--border))] object-contain cursor-pointer"
          onClick={e => { e.stopPropagation(); onPreview(url) }} />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-6 h-6 rounded-full bg-black/50 flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
          </div>
        </div>
      </div>
    )
  }

  // Generic
  return (
    <div className="flex-1 min-w-[80px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-2 text-center cursor-pointer hover:bg-accent transition-colors"
      onClick={e => { e.stopPropagation(); onPreview(url) }}>
      <div className="text-[9px] text-muted-foreground truncate">{url.split('/').pop()?.split('?')[0] || 'File'}</div>
    </div>
  )
}

function SizeInput({ value, onChange, min, max }: { value: string; onChange: (v: string) => void; min?: number; max?: number }) {
  const parts = value.split('*')
  const w = parseInt(parts[0]) || 512
  const h = parseInt(parts[1] ?? parts[0]) || 512

  const clamp = (v: number) => {
    if (min !== undefined && v < min) return min
    if (max !== undefined && v > max) return max
    return v
  }

  const numCls = 'w-[52px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1 py-1 text-[11px] text-center text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'

  return (
    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <input type="number" value={w} min={min} max={max} step={64}
        onChange={e => onChange(`${clamp(Number(e.target.value))}*${h}`)}
        onBlur={e => onChange(`${clamp(Number(e.target.value))}*${h}`)}
        className={numCls} title="Width" />
      <span className="text-[10px] text-muted-foreground">×</span>
      <input type="number" value={h} min={min} max={max} step={64}
        onChange={e => onChange(`${w}*${clamp(Number(e.target.value))}`)}
        onBlur={e => onChange(`${w}*${clamp(Number(e.target.value))}`)}
        className={numCls} title="Height" />
      {min !== undefined && max !== undefined && (
        <span className="text-[8px] text-muted-foreground/60 whitespace-nowrap">{min}-{max}</span>
      )}
    </div>
  )
}

function formatLabel(name: string): string {
  return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export const CustomNode = memo(CustomNodeComponent)
