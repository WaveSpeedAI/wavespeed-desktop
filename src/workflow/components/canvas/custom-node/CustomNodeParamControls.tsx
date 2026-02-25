/**
 * Parameter row components for CustomNode.
 *
 * ParamRow, MediaRow, LoraRow, JsonRow, DefParamControl, InputPortControl
 */
import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowStore } from '../../../stores/workflow.store'
import { Paintbrush, Dices } from 'lucide-react'
import { MaskEditor } from '@/components/playground/MaskEditor'
import { WorkflowPromptOptimizer } from '../WorkflowPromptOptimizer'
import { CompInput, CompTextarea } from '../composition-input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ParamDefinition, PortDefinition, ModelParamSchema } from '@/workflow/types/node-defs'

import { TEXTAREA_NAMES, RANDOM_SEED_MAX, NODE_INPUT_ACCEPT_RULES, formatLabel } from './CustomNodeTypes'
import { HandleAnchor } from './CustomNodeHandleAnchor'
import { Row, LinkedBadge, Tip, UploadStatusBadge, ToggleSwitch, NumberInput, FileBtn, SizeInput } from './CustomNodePrimitives'

/* ══════════════════════════════════════════════════════════════════════
   ParamRow — one row per regular (non-media) schema parameter
   ══════════════════════════════════════════════════════════════════════ */

export function ParamRow({ nodeId, schema, value, connected, onChange, onDisconnect, edges, nodes, optimizerSettings, onOptimizerSettingsChange }: {
  nodeId: string; schema: ModelParamSchema; value: unknown; connected: boolean
  onChange: (v: unknown) => void
  onDisconnect?: () => void
  edges?: Array<{ id: string; source: string; target: string; targetHandle?: string | null }>
  nodes?: Array<{ id: string; data: { label?: string } }>
  optimizerSettings?: Record<string, unknown>
  onOptimizerSettingsChange?: (settings: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  const label = schema.label ?? formatLabel(schema.name)
  const ft = schema.fieldType ?? (TEXTAREA_NAMES.has(schema.name.toLowerCase()) ? 'textarea' : undefined)
  const isSeed = schema.name.toLowerCase() === 'seed'
  const handleId = `param-${schema.name}`
  const cur = value ?? schema.default
  const showEditor = !connected

  const inputCls = 'w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-[hsl(var(--muted-foreground))]'
  const selectCls = 'rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50'

  // ── Textarea: full-width below label ──
  if (ft === 'textarea') {
    const isPromptField = schema.name.toLowerCase() === 'prompt'
    return (
      <div className="px-3 py-1">
        <label className="flex items-center gap-1 mb-1 text-xs font-medium text-blue-400">
          <HandleAnchor id={handleId} type="target" connected={connected} />
          {label}{schema.required && <span className="text-red-400">*</span>}
          {schema.description && <Tip text={schema.description} />}
          {isPromptField && !connected && (
            <WorkflowPromptOptimizer
              currentPrompt={String(cur ?? '')}
              onOptimized={v => onChange(v)}
              quickSettings={optimizerSettings}
              onQuickSettingsChange={onOptimizerSettingsChange}
              optimizeOnRun={Boolean(optimizerSettings?.optimizeOnRun ?? optimizerSettings?.autoOptimize)}
              onOptimizeOnRunChange={(enabled) => {
                const { autoOptimize: _legacy, ...rest } = optimizerSettings ?? {}
                onOptimizerSettingsChange?.({ ...rest, optimizeOnRun: enabled })
              }}
            />
          )}
        </label>
        <div>
          {connected ? <LinkedBadge nodeId={nodeId} handleId={handleId} edges={edges} nodes={nodes} onDisconnect={onDisconnect} /> : (
            <CompTextarea value={String(cur ?? '')} onChange={e => onChange(e.target.value)}
              placeholder={schema.placeholder ?? schema.description ?? label} rows={3}
              className={`nodrag ${inputCls} resize-y min-h-[60px] max-h-[300px]`}
              onClick={e => e.stopPropagation()} />
          )}
        </div>
      </div>
    )
  }

  // ── Slider ──
  if (ft === 'slider' && schema.min !== undefined && schema.max !== undefined) {
    const numVal = cur !== undefined && cur !== null ? Number(cur) : schema.min
    return (
      <div className="px-3 py-1">
        <div>
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-xs text-blue-400 font-medium flex items-center gap-1 flex-shrink-0">
              <HandleAnchor id={handleId} type="target" connected={connected} />
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

  // ── Size ──
  if (ft === 'size') {
    return (
      <Row>
        <div className="flex items-center gap-2">
          <span className="text-xs text-blue-400 font-medium flex items-center gap-1 flex-shrink-0">
            <HandleAnchor id={handleId} type="target" connected={connected} />
            {label}{schema.description && <Tip text={schema.description} />}
          </span>
          <div className="flex-1 min-w-0 flex justify-end" onClick={e => e.stopPropagation()}>
            {connected ? <LinkedBadge nodeId={nodeId} handleId={handleId} edges={edges} nodes={nodes} onDisconnect={onDisconnect} />
              : schema.enum && schema.enum.length > 0 ? (
                <select value={String(cur ?? schema.enum[0] ?? '')} onChange={e => onChange(e.target.value)} className={`nodrag ${selectCls} w-full max-w-[160px] text-right`}>
                  {schema.enum.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <SizeInput value={String(cur ?? '')} onChange={(v: string) => onChange(v)} min={schema.min} max={schema.max} />
              )}
          </div>
        </div>
      </Row>
    )
  }

  // ── All other types ──
  return (
    <Row>
      <div className="flex items-center gap-2">
        <span className="text-xs text-blue-400 font-medium whitespace-nowrap flex items-center gap-1 flex-shrink-0">
          <HandleAnchor id={handleId} type="target" connected={connected} />
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
                <NumberInput
                  value={cur as number | undefined}
                  min={schema.min}
                  max={schema.max}
                  step={schema.step ?? (schema.type === 'integer' ? 1 : 0.1)}
                  onChange={onChange}
                  placeholder={isSeed && !schema.required ? t('workflow.seedRandomPlaceholder', 'Random') : undefined}
                />
                {isSeed && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onChange(Math.floor(Math.random() * RANDOM_SEED_MAX))}
                        className="p-1.5 rounded bg-blue-500/10 hover:bg-blue-500/20 transition-colors flex-shrink-0"
                      >
                        <Dices className="h-4 w-4 text-blue-400" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>{t('playground.randomSeed')}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </>
            ) : (
              <CompInput type="text" value={String(cur ?? '')} onChange={e => onChange(e.target.value)}
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

export function MediaRow({ nodeId, schema, value, connected, connectedSet, onChange, onPreview, edges, nodes }: {
  nodeId: string; schema: ModelParamSchema; value: unknown; connected: boolean; connectedSet: Set<string>
  onChange: (v: unknown) => void; onPreview: (src: string) => void
  edges?: Array<{ id: string; source: string; target: string; targetHandle?: string | null }>
  nodes?: Array<{ id: string; data: { label?: string } }>
}) {
  const { t } = useTranslation()
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

  const doUpload = async (file: File, cb: (url: string) => void) => {
    setUploadState('uploading'); setUploadError('')
    try {
      const { uploadIpc } = await import('../../../ipc/ipc-client')
      const url = await uploadIpc.uploadFile(file)
      cb(url)
      setUploadState('success')
      setTimeout(() => setUploadState('idle'), 2000)
    } catch (err) {
      setUploadState('error')
      setUploadError(err instanceof Error ? err.message : t('workflow.mediaUpload.uploadFailed', 'Upload failed'))
    }
  }

  const isValidUrl = (v: string) => {
    if (!v.trim()) return true
    try {
      const url = new URL(v)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch { return false }
  }

  const isPreviewable = (v: string) => v && !v.startsWith('blob:') && isValidUrl(v)

  if (isArray) {
    const items: string[] = Array.isArray(value) ? value : (value ? [String(value)] : [''])
    const canDeleteIndex = (i: number) => {
      if (i !== items.length - 1) return false
      const hid = `${schema.name}[${i}]`
      return !connectedSet.has(hid)
    }

    return (
      <>
        <div className="px-3 py-1">
          <div className="flex items-center gap-1 text-xs font-medium text-green-400">
            {label}{schema.required && <span className="text-red-400">*</span>}
            {schema.description && <Tip text={schema.description} />}
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-normal ml-1">({items.length})</span>
            <UploadStatusBadge state={uploadState} error={uploadError} />
          </div>
        </div>
        {items.map((v, i) => {
          const hid = `${schema.name}[${i}]`
          const conn = connectedSet.has(hid)
          const urlValid = isValidUrl(v)
          return (
            <div key={i} className="min-h-[32px] px-3 py-0.5">
              <div>
                <div className="flex items-center gap-1">
                  <HandleAnchor id={hid} type="target" connected={conn} media />
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))] w-5 flex-shrink-0">[{i + 1}]</span>
                  {conn ? <LinkedBadge nodeId={nodeId} handleId={hid} edges={edges} nodes={nodes} onDisconnect={() => disconnectHandle(hid)} /> : (
                    <>
                      <CompInput type="text" value={v || ''} placeholder={t('workflow.mediaUpload.urlShortPlaceholder', 'URL...')}
                        onChange={e => { const a = [...items]; a[i] = e.target.value; onChange(a) }}
                        onClick={e => e.stopPropagation()}
                        className={`flex-1 rounded-md border bg-[hsl(var(--background))] px-2 py-1 text-[11px] text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 ${urlValid ? 'border-[hsl(var(--border))] focus:ring-green-500/50' : 'border-red-500 focus:ring-red-500/50'}`} />
                      <FileBtn accept={acceptType} uploading={uploadState === 'uploading'}
                        onFile={(f: File) => doUpload(f, url => { const a = [...items]; a[i] = url; onChange(a) })} />
                    </>
                  )}
                  {canDeleteIndex(i) ? (
                    <button onClick={e => { e.stopPropagation(); onChange(items.slice(0, -1)) }}
                      className="text-red-400/70 hover:text-red-400 text-sm px-0.5" title={t('workflow.removeLast', 'Remove last')}>✕</button>
                  ) : (
                    <div className="w-4" />
                  )}
                </div>
                {!urlValid && v.trim() && (
                  <div className="pl-7 text-[9px] text-red-400 mt-0.5">{t('workflow.invalidUrl', 'Invalid URL')}</div>
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
        <div className="px-3 py-0.5">
          <button onClick={e => { e.stopPropagation(); onChange([...items, '']) }}
            className="w-full py-1.5 ml-2 rounded-md border border-dashed border-blue-500/30 text-[11px] font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 hover:border-blue-500/50 transition-colors">
            + {t('workflow.add', 'Add')}
          </button>
        </div>
      </>
    )
  }

  /* ── Single media ── */
  const sval = typeof value === 'string' ? value : ''
  const urlValid = isValidUrl(sval)

  return (
    <div className="px-3 py-1">
      <label className="flex items-center gap-1 mb-1 text-xs font-medium text-green-400">
        <HandleAnchor id={handleId} type="target" connected={connected} media />
        {label}{schema.required && <span className="text-red-400">*</span>}
        {schema.description && <Tip text={schema.description} />}
        <UploadStatusBadge state={uploadState} error={uploadError} />
      </label>
      <div>
        {connected ? <LinkedBadge nodeId={nodeId} handleId={handleId} edges={edges} nodes={nodes} onDisconnect={() => disconnectHandle(handleId)} /> : (
          <>
            <div className="flex items-center gap-1">
              <CompInput
                type="text"
                value={sval}
                placeholder={t('workflow.enterField', { field: label.toLowerCase(), defaultValue: `Enter ${label.toLowerCase()}...` })}
                onChange={e => onChange(e.target.value)} onClick={e => e.stopPropagation()}
                className={`flex-1 rounded-md border bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 ${urlValid ? 'border-[hsl(var(--border))] focus:ring-green-500/50' : 'border-red-500 focus:ring-red-500/50'}`} />
              <FileBtn accept={acceptType} uploading={uploadState === 'uploading'} onFile={(f: File) => doUpload(f, url => onChange(url))} />
            </div>
            {!urlValid && sval.trim() && <div className="text-[9px] text-red-400 mt-0.5">{t('workflow.invalidUrl', 'Invalid URL')}</div>}
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
   LoraRow — inline LoRA editor (path + scale, add/remove)
   ══════════════════════════════════════════════════════════════════════ */

interface LoraItem { path: string; scale: number }

export function LoraRow({ schema, value, onChange }: {
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
      <label className="flex items-center gap-1 mb-1 text-xs font-medium text-purple-400">
        {label}{schema.required && <span className="text-red-400">*</span>}
        {schema.description && <Tip text={schema.description} />}
        <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-normal ml-1">({items.length}/{maxItems})</span>
      </label>
      <div className="space-y-1.5">
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
            <CompInput type="text" value={inputPath} placeholder="user/repo or .safetensors URL"
              onChange={e => setInputPath(e.target.value)}
              onKeyDown={e => {
                const composing = e.nativeEvent.isComposing || e.key === 'Process'
                if (!composing && e.key === 'Enter') addLora()
              }}
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

export function JsonRow({ nodeId, schema, value, connected, onChange, edges, nodes }: {
  nodeId: string; schema: ModelParamSchema; value: unknown; connected: boolean
  onChange: (v: unknown) => void
  edges?: Array<{ id: string; source: string; target: string; targetHandle?: string | null }>
  nodes?: Array<{ id: string; data: { label?: string } }>
}) {
  const label = schema.label ?? formatLabel(schema.name)
  const handleId = `param-${schema.name}`

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
    <div className="px-3 py-1">
      <label className="flex items-center gap-1 mb-1 text-xs font-medium text-orange-400">
        <HandleAnchor id={handleId} type="target" connected={connected} />
        {label}{schema.required && <span className="text-red-400">*</span>}
        {schema.description && <Tip text={schema.description} />}
        <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-normal ml-1">JSON</span>
      </label>
      <div>
        {connected ? <LinkedBadge nodeId={nodeId} handleId={handleId} edges={edges} nodes={nodes} onDisconnect={onDisconnect} /> : (
          <CompTextarea value={displayValue} onChange={e => handleChange(e.target.value)}
            placeholder={schema.placeholder ?? `e.g. [1, 2, 3] or {"key": "value"}`}
            rows={3} onClick={e => e.stopPropagation()}
            className="nodrag w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-orange-500/50 focus:border-orange-500 placeholder:text-[hsl(var(--muted-foreground))] resize-y min-h-[48px] max-h-[300px] font-mono" />
        )}
      </div>
    </div>
  )
}


/* ══════════════════════════════════════════════════════════════════════
   DefParamControl — control for ParamDefinition-based params
   ══════════════════════════════════════════════════════════════════════ */

export function DefParamControl({ nodeId, param, value, onChange }: { nodeId: string; param: ParamDefinition; value: unknown; onChange: (v: unknown) => void }) {
  const { t } = useTranslation()
  const cls = 'rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50'
  const cur = value ?? param.default
  const workflowId = useWorkflowStore(s => s.workflowId)
  const saveWorkflow = useWorkflowStore(s => s.saveWorkflow)
  const nodeType = useWorkflowStore(s => s.nodes.find(n => n.id === nodeId)?.data?.nodeType as string | undefined)
  const [uploading, setUploading] = useState(false)
  const [selectingDir, setSelectingDir] = useState(false)
  const [openingDir, setOpeningDir] = useState(false)

  const ensureWorkflowId = useCallback(async () => {
    let wfId = workflowId
    if (!wfId) {
      await saveWorkflow()
      wfId = useWorkflowStore.getState().workflowId
    }
    return wfId
  }, [workflowId, saveWorkflow])

  if (nodeType === 'output/file' && param.key === 'outputDir') {
    const textVal = String(cur ?? '')
    const handlePickDirectory = async () => {
      try {
        setSelectingDir(true)
        const result = await window.electronAPI?.selectDirectory?.()
        if (result?.success && result.path) onChange(result.path)
      } catch (error) {
        console.error('Select directory failed:', error)
      } finally {
        setSelectingDir(false)
      }
    }

    const handleOpenDirectory = async () => {
      try {
        setOpeningDir(true)
        const dir = textVal.trim()
        if (dir) {
          await window.electronAPI?.openFileLocation?.(dir)
          return
        }
        const wfId = await ensureWorkflowId()
        if (!wfId) return
        const { storageIpc } = await import('../../../ipc/ipc-client')
        await storageIpc.openWorkflowFolder(wfId)
      } catch (error) {
        console.error('Open output folder failed:', error)
      } finally {
        setOpeningDir(false)
      }
    }

    return (
      <div className="w-full max-w-[260px] space-y-1.5">
        <div className="flex items-center gap-1.5">
          <CompInput
            type="text"
            value={textVal}
            onChange={e => onChange(e.target.value)}
            placeholder={t('workflow.nodeDefs.output/file.params.outputDir.placeholder', 'Leave empty to use workflow default output directory')}
            className={`${cls} flex-1`}
            onClick={e => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={e => { e.stopPropagation(); handlePickDirectory() }}
            title={t('workflow.selectDirectory', 'Select directory')}
            className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-md border border-[hsl(var(--border))] transition-colors ${
              selectingDir ? 'bg-blue-500/25 animate-pulse text-blue-300' : 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'
            }`}
          >
            📂
          </button>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); handleOpenDirectory() }}
            title={textVal.trim() ? t('workflow.openFolder', 'Open folder') : t('workflow.openWorkflowFolder', 'Open workflow folder')}
            className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-md border border-[hsl(var(--border))] transition-colors ${
              openingDir ? 'bg-blue-500/25 animate-pulse text-blue-300' : 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'
            }`}
          >
            ↗
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground truncate" title={textVal || t('workflow.outputDirFallbackHint', 'Not set: will export to workflow default directory')}>
          {textVal || t('workflow.outputDirFallbackHint', 'Not set: will export to workflow default directory')}
        </div>
      </div>
    )
  }

  if (param.type === 'select' && param.options) {
    return (
      <select value={String(cur ?? '')} onChange={e => onChange(e.target.value)} className={`nodrag ${cls} max-w-[160px]`} onClick={e => e.stopPropagation()}>
        {param.options.map(o => (
          <option key={o.value} value={o.value}>
            {t(`workflow.nodeDefs.${nodeType}.params.${param.key}.options.${o.value}`, o.label)}
          </option>
        ))}
      </select>
    )
  }
  if (param.type === 'file') {
    const textVal = String(cur ?? '')
    const handleFile = async (file: File) => {
      try {
        setUploading(true)
        const wfId = await ensureWorkflowId()
        if (!wfId) throw new Error('Workflow not saved yet.')
        const { storageIpc } = await import('../../../ipc/ipc-client')
        const data = await file.arrayBuffer()
        const localPath = await storageIpc.saveUploadedFile(wfId, nodeId, file.name, data)
        onChange(`local-asset://${encodeURIComponent(localPath)}`)
      } catch (error) {
        console.error('Local upload failed:', error)
      } finally {
        setUploading(false)
      }
    }
    return (
      <div className="flex items-center gap-1.5 w-full max-w-[220px]">
        <CompInput
          type="text"
          value={textVal}
          onChange={e => onChange(e.target.value)}
          placeholder={t('workflow.localFileOrUrl', 'Local file or URL')}
          className={`${cls} flex-1`}
          onClick={e => e.stopPropagation()}
        />
        <label className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-md border border-[hsl(var(--border))] cursor-pointer transition-colors ${uploading ? 'bg-blue-500/25 animate-pulse' : 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'}`}
          onClick={e => e.stopPropagation()}>
          {uploading ? (
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" /></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          )}
          <input type="file" className="hidden" disabled={uploading}
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
            onClick={e => e.stopPropagation()} />
        </label>
      </div>
    )
  }
  if (param.type === 'boolean') return <ToggleSwitch checked={Boolean(cur)} onChange={onChange} />
  if (param.type === 'number' || param.type === 'slider') return <NumberInput value={cur as number | undefined} min={param.validation?.min} max={param.validation?.max} step={param.validation?.step ?? 1} onChange={onChange} />
  if (param.type === 'textarea') return <CompTextarea value={String(cur ?? '')} onChange={e => onChange(e.target.value)} className={`nodrag ${cls} w-full min-h-[40px] resize-y max-h-[300px]`} onClick={e => e.stopPropagation()} />
  return <CompInput type="text" value={String(cur ?? '')} onChange={e => onChange(e.target.value)} className={`${cls} max-w-[160px]`} onClick={e => e.stopPropagation()} />
}


/* ══════════════════════════════════════════════════════════════════════
   InputPortControl — file/media input for PortDefinition-based inputs
   ══════════════════════════════════════════════════════════════════════ */

export function InputPortControl({
  nodeId,
  port,
  value,
  onChange,
  onPreview,
  referenceImageUrl,
  showDrawMaskButton,
  showPreview = true
}: {
  nodeId: string
  port: PortDefinition
  value: unknown
  onChange: (v: unknown) => void
  onPreview?: (src: string) => void
  referenceImageUrl?: string
  showDrawMaskButton?: boolean
  showPreview?: boolean
}) {
  const { t } = useTranslation()
  const nodeType = useWorkflowStore(s => s.nodes.find(n => n.id === nodeId)?.data?.nodeType as string | undefined)
  const workflowId = useWorkflowStore(s => s.workflowId)
  const saveWorkflow = useWorkflowStore(s => s.saveWorkflow)
  const [uploading, setUploading] = useState(false)
  const [maskEditorOpen, setMaskEditorOpen] = useState(false)
  const [drawingMask, setDrawingMask] = useState(false)
  const textVal = String(value ?? '')
  const cls = 'rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50'

  const detectSource = textVal
    ? (/^local-asset:\/\//i.test(textVal)
        ? (() => {
            try {
              return decodeURIComponent(textVal.replace(/^local-asset:\/\//i, '')).toLowerCase()
            } catch {
              return textVal.toLowerCase()
            }
          })()
        : textVal.toLowerCase()
    ).split('?')[0]
    : ''
  const isPreviewableUrl = /^https?:\/\//i.test(textVal) || /^blob:/i.test(textVal) || /^local-asset:\/\//i.test(textVal) || /^data:/i.test(textVal)
  const isImageByExt = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)$/.test(detectSource)
  const isVideoByExt = /\.(mp4|webm|mov|avi|mkv)$/.test(detectSource)
  const isAudioByExt = /\.(mp3|wav|ogg|flac|aac|m4a)$/.test(detectSource)
  const isDataImage = /^data:image\//i.test(textVal)
  const isDataVideo = /^data:video\//i.test(textVal)
  const isDataAudio = /^data:audio\//i.test(textVal)
  const typeHint = String(port.dataType ?? '')
  const isImage = isDataImage || (isPreviewableUrl && (isImageByExt || (typeHint === 'image' && !isVideoByExt && !isAudioByExt)))
  const isVideo = isDataVideo || (isPreviewableUrl && (isVideoByExt || (typeHint === 'video' && !isImageByExt && !isAudioByExt)))
  const isAudio = isDataAudio || (isPreviewableUrl && (isAudioByExt || (typeHint === 'audio' && !isImageByExt && !isVideoByExt)))

  const ensureWorkflowId = useCallback(async () => {
    let wfId = workflowId
    if (!wfId) {
      await saveWorkflow()
      wfId = useWorkflowStore.getState().workflowId
    }
    return wfId
  }, [workflowId, saveWorkflow])

  const nodeRule = nodeType ? NODE_INPUT_ACCEPT_RULES[nodeType] : undefined
  const acceptFromRule = typeof nodeRule === 'string'
    ? nodeRule
    : nodeRule?.[port.key]

  const accept = acceptFromRule
    ?? (port.dataType === 'image'
      ? 'image/*'
      : port.dataType === 'video'
        ? 'video/*'
        : port.dataType === 'audio'
          ? 'audio/*'
          : '*/*')

  const canUpload = port.dataType === 'image'
    || port.dataType === 'video'
    || port.dataType === 'audio'
    || port.dataType === 'url'
    || port.dataType === 'any'

  const handleFile = async (file: File) => {
    try {
      setUploading(true)
      const wfId = await ensureWorkflowId()
      if (!wfId) throw new Error('Workflow not saved yet.')
      const { storageIpc } = await import('../../../ipc/ipc-client')
      const data = await file.arrayBuffer()
      const localPath = await storageIpc.saveUploadedFile(wfId, nodeId, file.name, data)
      onChange(`local-asset://${encodeURIComponent(localPath)}`)
    } catch (error) {
      console.error('Input upload failed:', error)
    } finally {
      setUploading(false)
    }
  }

  const handleDrawMaskOpen = useCallback(() => {
    if (!referenceImageUrl?.trim()) return
    setMaskEditorOpen(true)
  }, [referenceImageUrl])

  const handleMaskComplete = useCallback(async (blob: Blob) => {
    try {
      setDrawingMask(true)
      const wfId = await ensureWorkflowId()
      if (!wfId) throw new Error('Workflow not saved yet.')
      const { storageIpc } = await import('../../../ipc/ipc-client')
      const data = await blob.arrayBuffer()
      const localPath = await storageIpc.saveUploadedFile(wfId, nodeId, 'mask-drawn.png', data)
      onChange(`local-asset://${encodeURIComponent(localPath)}`)
      setMaskEditorOpen(false)
    } catch (error) {
      console.error('Mask save failed:', error)
    } finally {
      setDrawingMask(false)
    }
  }, [ensureWorkflowId, nodeId, onChange])

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center gap-1.5">
        <CompInput
          type="text"
          value={textVal}
          onChange={e => onChange(e.target.value)}
          placeholder={t('workflow.localFileOrUrl', 'Local file or URL')}
          className={`${cls} flex-1`}
          onClick={e => e.stopPropagation()}
        />
        {showDrawMaskButton && (
          <button
            type="button"
            title={referenceImageUrl?.trim() ? t('workflow.drawMask') : t('workflow.drawMaskNeedInput')}
            disabled={!referenceImageUrl?.trim() || drawingMask}
            onClick={e => { e.stopPropagation(); handleDrawMaskOpen() }}
            className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-md border border-[hsl(var(--border))] transition-colors nodrag ${
              referenceImageUrl?.trim()
                ? 'cursor-pointer bg-purple-500/15 text-purple-400 hover:bg-purple-500/25'
                : 'cursor-not-allowed opacity-50'
            } ${drawingMask ? 'animate-pulse' : ''}`}
          >
            {drawingMask ? (
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" /></svg>
            ) : (
              <Paintbrush className="h-4 w-4" />
            )}
          </button>
        )}
        {canUpload && (
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
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
              onClick={e => e.stopPropagation()} />
          </label>
        )}
      </div>
      {showPreview && textVal.trim() && (isImage || isVideo || isAudio) && (
        <div className="mt-1" onClick={e => e.stopPropagation()}>
          {isImage && (
            <img
              src={textVal}
              alt=""
              onClick={e => { e.stopPropagation(); onPreview?.(textVal) }}
              className="w-full max-h-[420px] rounded-lg border border-[hsl(var(--border))] object-contain cursor-pointer hover:ring-2 hover:ring-blue-500/40 transition-shadow bg-black/5"
            />
          )}
          {isVideo && (
            <video
              src={textVal}
              controls
              className="w-full max-h-[420px] rounded-lg border border-[hsl(var(--border))] object-contain"
            />
          )}
          {isAudio && (
            <audio src={textVal} controls className="w-full max-h-10 rounded-lg border border-[hsl(var(--border))]" />
          )}
        </div>
      )}
      {maskEditorOpen && referenceImageUrl?.trim() && (
        <MaskEditor
          referenceImageUrl={referenceImageUrl}
          onComplete={handleMaskComplete}
          onClose={() => setMaskEditorOpen(false)}
          disabled={drawingMask}
        />
      )}
    </div>
  )
}
