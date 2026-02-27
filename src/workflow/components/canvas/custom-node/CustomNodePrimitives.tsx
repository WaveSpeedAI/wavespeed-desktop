/**
 * Small reusable UI primitives used across CustomNode sub-components.
 *
 * Row, LinkedBadge, ConnectedInputControl, LockIcon, UploadStatusBadge,
 * ToggleSwitch, NumberInput, FileBtn, Tip, SizeInput, Inline3DViewer
 */
import React, { useRef, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useExecutionStore } from '../../../stores/execution.store'
import { useWorkflowStore } from '../../../stores/workflow.store'

/* ══════════════════════════════════════════════════════════════════════
   Row — simple padding wrapper for parameter rows
   ══════════════════════════════════════════════════════════════════════ */

export function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[32px] px-3 py-1">
      {children}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   LockIcon
   ══════════════════════════════════════════════════════════════════════ */

export function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   LinkedBadge — "linked to NodeLabel" with lock icon; click to disconnect
   ══════════════════════════════════════════════════════════════════════ */

export function LinkedBadge({ nodeId, handleId, edges, nodes, onDisconnect }: {
  nodeId?: string; handleId?: string
  edges?: Array<{ id: string; source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }>
  nodes?: Array<{ id: string; data: { label?: string; nodeType?: string } }>
  onDisconnect?: () => void
}) {
  const { t } = useTranslation()
  if (!nodeId || !handleId || !edges || !nodes) {
    return <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 italic"><LockIcon /> {t('workflow.linked', 'linked')}</span>
  }
  const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
  if (!edge) {
    return <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 italic"><LockIcon /> {t('workflow.linked', 'linked')}</span>
  }
  const sourceNode = nodes.find(n => n.id === edge.source)
  const sourceShortId = edge.source.slice(0, 8)
  const sourceLabel = sourceNode?.data?.label
  const sourceName = sourceLabel ? `${sourceLabel} #${sourceShortId}` : sourceShortId

  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 italic">
      {onDisconnect ? (
        <button onClick={e => { e.stopPropagation(); onDisconnect() }}
          title={t('workflow.disconnectLink', 'Unlock: disconnect this link')}
          className="hover:text-red-400 transition-colors">
          <LockIcon />
        </button>
      ) : <LockIcon />}
      {t('workflow.linkedTo', 'linked to')} <span className="font-medium not-italic truncate max-w-[100px]">{sourceName}</span>
    </span>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   ConnectedInputControl — shows linked badge + optional media preview
   ══════════════════════════════════════════════════════════════════════ */

export function ConnectedInputControl({
  nodeId,
  handleId,
  edges,
  nodes,
  onPreview,
  showPreview = true
}: {
  nodeId?: string
  handleId?: string
  edges?: Array<{ id: string; source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }>
  nodes?: Array<{ id: string; data: { label?: string; nodeType?: string; params?: Record<string, unknown> } }>
  onPreview?: (src: string) => void
  showPreview?: boolean
}) {
  const lastResults = useExecutionStore(s => s.lastResults)

  if (!nodeId || !handleId || !edges || !nodes) {
    return <LinkedBadge />
  }

  const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
  if (!edge) return <LinkedBadge />

  const sourceNode = nodes.find(n => n.id === edge.source)
  const sourceParams = sourceNode?.data?.params ?? {}
  const latestResultUrl = lastResults[edge.source]?.[0]?.urls?.[0] ?? ''

  const pickPreviewUrl = (): string => {
    const isMediaLike = (u: string) =>
      /^https?:\/\//i.test(u) || /^blob:/i.test(u) || /^local-asset:\/\//i.test(u) || /^data:/i.test(u)

    // Prefer actual execution results — this is the real output of the source node
    if (latestResultUrl && isMediaLike(latestResultUrl)) return latestResultUrl

    // Only fall back to source params for input-type nodes (media-upload)
    // that store their value directly in params. Do NOT use generic params
    // like 'input'/'output' which are the source node's own inputs, not outputs.
    const uploadedUrl = String(sourceParams.uploadedUrl ?? '')
    if (uploadedUrl && isMediaLike(uploadedUrl)) return uploadedUrl

    return ''
  }

  const previewUrl = pickPreviewUrl()
  const detectSource = previewUrl
    ? (/^local-asset:\/\//i.test(previewUrl)
        ? (() => {
            try {
              return decodeURIComponent(previewUrl.replace(/^local-asset:\/\//i, '')).toLowerCase()
            } catch {
              return previewUrl.toLowerCase()
            }
          })()
        : previewUrl.toLowerCase()
      ).split('?')[0]
    : ''
  const isImage = /^data:image\//i.test(previewUrl) || /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)$/.test(detectSource)
  const isVideo = /^data:video\//i.test(previewUrl) || /\.(mp4|webm|mov|avi|mkv)$/.test(detectSource)
  const isAudio = /^data:audio\//i.test(previewUrl) || /\.(mp3|wav|ogg|flac|aac|m4a)$/.test(detectSource)

  return (
    <div className="w-full space-y-2">
      <LinkedBadge nodeId={nodeId} handleId={handleId} edges={edges} nodes={nodes} />
      {showPreview && previewUrl && onPreview && (
        <div className="mt-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {isImage && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onPreview(previewUrl) }}
              className="relative rounded-md border border-[hsl(var(--border))] bg-muted/50 overflow-hidden h-16 w-16 flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-blue-500/40 transition-shadow"
            >
              <img src={previewUrl} alt="" className="w-full h-full object-cover" />
            </button>
          )}
          {isVideo && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onPreview(previewUrl) }}
              className="relative rounded-md border border-[hsl(var(--border))] bg-muted/50 overflow-hidden h-16 w-16 flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-blue-500/40 transition-shadow"
            >
              <video
                src={previewUrl}
                className="w-full h-full object-cover"
                muted
                playsInline
                onMouseEnter={(e) => e.currentTarget.play()}
                onMouseLeave={(e) => {
                  e.currentTarget.pause()
                  e.currentTarget.currentTime = 0
                }}
              />
            </button>
          )}
          {isAudio && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onPreview(previewUrl) }}
              className="relative rounded-md border border-[hsl(var(--border))] bg-muted/50 overflow-hidden h-16 w-16 flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-blue-500/40 transition-shadow flex items-center justify-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-[hsl(var(--muted-foreground))]">
                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   UploadStatusBadge
   ══════════════════════════════════════════════════════════════════════ */

export function UploadStatusBadge({ state, error }: { state: string; error: string }) {
  const { t } = useTranslation()
  if (state === 'uploading') return <span className="ml-auto text-[10px] text-blue-400 animate-pulse">{t('workflow.mediaUpload.uploadingShort', 'Uploading...')}</span>
  if (state === 'success') return <span className="ml-auto text-[10px] text-green-400">✓ {t('workflow.mediaUpload.uploaded', 'Uploaded')}</span>
  if (state === 'error') return <span className="ml-auto text-[10px] text-red-400" title={error}>✕ {t('workflow.mediaUpload.failed', 'Failed')}</span>
  return null
}

/* ══════════════════════════════════════════════════════════════════════
   ToggleSwitch
   ══════════════════════════════════════════════════════════════════════ */

export function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: unknown) => void }) {
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onChange(!checked) }}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer focus:outline-none ${checked ? 'bg-blue-500' : 'bg-[hsl(var(--muted))]'}`}>
      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   NumberInput
   ══════════════════════════════════════════════════════════════════════ */

export function NumberInput({ value, min, max, step, onChange, placeholder }: {
  value: number | undefined; min?: number; max?: number; step: number; onChange: (v: unknown) => void; placeholder?: string
}) {
  const shouldRound = step >= 1 && Number.isInteger(step)

  // Clamp (and round for integer steps) on blur
  const handleBlur = () => {
    if (value === undefined || value === null) return
    let clamped = Number(value)
    if (shouldRound) clamped = Math.round(clamped)
    if (min !== undefined && clamped < min) clamped = min
    if (max !== undefined && clamped > max) clamped = max
    if (clamped !== Number(value)) onChange(clamped)
  }

  return (
    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
      <input type="number" value={value !== undefined && value !== null ? value : ''} min={min} max={max} step={step}
        onChange={e => {
          if (e.target.value === '') { onChange(undefined); return }
          const n = Number(e.target.value)
          onChange(shouldRound ? Math.round(n) : n)
        }}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="w-full max-w-[120px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-right text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50 placeholder:text-[hsl(var(--muted-foreground))] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
      {min !== undefined && max !== undefined && <span className="text-[9px] text-[hsl(var(--muted-foreground))] whitespace-nowrap">{min}–{max}</span>}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   FileBtn — small upload button
   ══════════════════════════════════════════════════════════════════════ */

export function FileBtn({ accept, onFile, uploading }: { accept: string; onFile: (f: File) => void; uploading?: boolean }) {
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

/* ══════════════════════════════════════════════════════════════════════
   Tip — hover tooltip for descriptions
   ══════════════════════════════════════════════════════════════════════ */

export function Tip({ text }: { text: string }) {
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


/* ══════════════════════════════════════════════════════════════════════
   SizeInput — dual W×H number fields. Value format: "W*H" (e.g. "1024*1024")
   ══════════════════════════════════════════════════════════════════════ */

export function SizeInput({ value, onChange, min, max }: { value: string; onChange: (v: string) => void; min?: number; max?: number }) {
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

/* ══════════════════════════════════════════════════════════════════════
   Inline3DViewer — lightweight inline 3D model preview using @google/model-viewer
   ══════════════════════════════════════════════════════════════════════ */

export function Inline3DViewer({ src, onClick }: { src: string; onClick?: () => void }) {
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
    el.style.borderRadius = '8px'
    el.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)'
    containerRef.current.innerHTML = ''
    containerRef.current.appendChild(el)
    return () => { if (containerRef.current) containerRef.current.innerHTML = '' }
  }, [src])

  return (
    <div
      ref={containerRef}
      onClick={e => { e.stopPropagation(); onClick?.() }}
      className="w-full aspect-square rounded-lg border border-[hsl(var(--border))] overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500/40 transition-shadow"
    />
  )
}
