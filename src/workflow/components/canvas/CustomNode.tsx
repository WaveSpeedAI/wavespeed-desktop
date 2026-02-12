/**
 * Custom node component — ComfyUI-inspired inline parameter editing.
 *
 * Each parameter is a row with a left Handle, label, and inline control.
 * Media fields support file upload with progress/error states and click-to-preview.
 */
import React, { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Handle, Position, useReactFlow, type NodeProps } from 'reactflow'
import { useExecutionStore } from '../../stores/execution.store'
import { useWorkflowStore } from '../../stores/workflow.store'
import { useUIStore } from '../../stores/ui.store'
import { WorkflowPromptOptimizer } from './WorkflowPromptOptimizer'
import { apiClient } from '@/api/client'
import { MaskEditor } from '@/components/playground/MaskEditor'
import { SegmentPointPicker, type SegmentPoint } from '../SegmentPointPicker'
import { Paintbrush, MousePointer2 } from 'lucide-react'
import { modelsIpc } from '../../ipc/ipc-client'
import { fuzzySearch } from '@/lib/fuzzySearch'
// Status constants (kept for edge component compatibility)
// import { NODE_STATUS_COLORS, NODE_STATUS_BORDER } from '@/workflow/constants'
import type { NodeStatus } from '@/workflow/types/execution'
import type { ParamDefinition, PortDefinition, ModelParamSchema, WaveSpeedModel } from '@/workflow/types/node-defs'

import { CompInput, CompTextarea } from './composition-input'

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

const HANDLE_SIZE = 12
const ACCENT = 'hsl(var(--primary))'
const ACCENT_MEDIA = 'hsl(142 71% 45%)'

const TEXTAREA_NAMES = new Set([
  'prompt', 'negative_prompt', 'text', 'description', 'content', 'system_prompt',
])

/**
 * Centralized file-picker accept rules by workflow node type.
 * Keep node-specific constraints here to avoid scattered if/else logic.
 */
const NODE_INPUT_ACCEPT_RULES: Record<string, string | Record<string, string>> = {
  'free-tool/image-enhancer': { input: 'image/*' },
  'free-tool/background-remover': { input: 'image/*' },
  'free-tool/face-enhancer': { input: 'image/*' },
  'free-tool/video-enhancer': { input: 'video/*' },
  'free-tool/face-swapper': { source: 'image/*', target: 'image/*' },
  'free-tool/image-eraser': { input: 'image/*', mask: 'image/*' },
  'free-tool/segment-anything': { input: 'image/*' },
  'free-tool/image-converter': { input: 'image/*' },
  'free-tool/video-converter': { input: 'video/*' },
  'free-tool/audio-converter': { input: 'audio/*' },
  'free-tool/media-trimmer': { input: 'video/*,audio/*' },
  'free-tool/media-merger': {
    first: 'video/*,audio/*',
    second: 'video/*,audio/*'
  },
  'input/media-upload': { output: 'image/*,video/*,audio/*' }
}

/* ── handle styles ───────────────────────────────────────────────────── */

/** Left-side input handle — absolute positioned to sit on the node border.
 *  zIndex 40 keeps handles above the resize edge zones (z-20/z-30) so that
 *  dragging from a handle always starts a connection, never a resize. */
const handleLeft = (_connected: boolean, media = false): React.CSSProperties => ({
  width: HANDLE_SIZE, height: HANDLE_SIZE, borderRadius: '50%',
  border: '2px solid hsl(var(--card))',
  background: media ? ACCENT_MEDIA : ACCENT,
  left: -HANDLE_SIZE / 2 - 1,
  top: '50%', transform: 'translateY(-50%)',
  position: 'absolute',
  zIndex: 40,
})

/** Right-side output handle */
const handleRight = (): React.CSSProperties => ({
  width: HANDLE_SIZE, height: HANDLE_SIZE, borderRadius: '50%',
  border: '2px solid hsl(var(--card))',
  background: ACCENT,
  right: -HANDLE_SIZE / 2 - 1,
  top: '50%', transform: 'translateY(-50%)',
  position: 'absolute',
  zIndex: 40,
})

/* ── main component ──────────────────────────────────────────────────── */

const MIN_NODE_WIDTH = 300
const MIN_NODE_HEIGHT = 80
const DEFAULT_NODE_WIDTH = 380

function CustomNodeComponent({ id, data, selected }: NodeProps<CustomNodeData>) {
  const { t } = useTranslation()
  const status = useExecutionStore(s => s.nodeStatuses[id] ?? 'idle') as NodeStatus
  const progress = useExecutionStore(s => s.progressMap[id])
  const errorMessage = useExecutionStore(s => s.errorMessages[id])
  const edges = useWorkflowStore(s => s.edges)
  const updateNodeParams = useWorkflowStore(s => s.updateNodeParams)
  const updateNodeData = useWorkflowStore(s => s.updateNodeData)
  const workflowId = useWorkflowStore(s => s.workflowId)
  const isDirty = useWorkflowStore(s => s.isDirty)
  const { runNode, cancelNode, retryNode, clearNodeResults } = useExecutionStore()
  const openPreview = useUIStore(s => s.openPreview)
  const allNodes = useWorkflowStore(s => s.nodes)
  const allLastResults = useExecutionStore(s => s.lastResults)
  const [hovered, setHovered] = useState(false)
  const [segmentPointPickerOpen, setSegmentPointPickerOpen] = useState(false)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [availableModels, setAvailableModels] = useState<WaveSpeedModel[]>([])
  const [modelSwitchBlocked, setModelSwitchBlocked] = useState(false)

  // ── Resizable dimensions (use ref + direct DOM for zero-lag) ──
  const savedWidth = (data.params.__nodeWidth as number) ?? DEFAULT_NODE_WIDTH
  const savedHeight = (data.params.__nodeHeight as number | undefined) ?? undefined
  const nodeRef = useRef<HTMLDivElement>(null)
  const [resizing, setResizing] = useState(false)
  const { getViewport, setNodes } = useReactFlow()
  const nodeLabel = data.nodeType === 'ai-task/run' && data.label && String(data.label).startsWith('🤖')
    ? String(data.label)
    : t(`workflow.nodeDefs.${data.nodeType}.label`, data.label)
  const localizeInputLabel = useCallback((key: string, fallback: string) =>
    t(`workflow.nodeDefs.${data.nodeType}.inputs.${key}.label`, fallback), [data.nodeType, t])
  const localizeParamLabel = useCallback((key: string, fallback: string) =>
    t(`workflow.nodeDefs.${data.nodeType}.params.${key}.label`, fallback), [data.nodeType, t])
  const localizeParamDescription = useCallback((key: string, fallback?: string) =>
    fallback ? t(`workflow.nodeDefs.${data.nodeType}.params.${key}.description`, fallback) : undefined, [data.nodeType, t])

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
  const currentModelId = String(data.params.modelId ?? '').trim()
  const currentModelDisplayName = useMemo(() => {
    const rawLabel = String(data.label ?? '').trim()
    if (rawLabel.startsWith('🤖')) return rawLabel.replace(/^🤖\s*/, '')
    if (!currentModelId) return ''
    const parts = currentModelId.split('/')
    return parts[parts.length - 1] || currentModelId
  }, [data.label, currentModelId])
  const isPreviewNode = data.nodeType === 'output/preview'
  const modelSearchResults = useMemo(() => {
    const q = modelSearchQuery.trim()
    if (!q) return []
    return fuzzySearch(availableModels, q, (m) => [
      m.displayName,
      m.modelId,
      m.category,
      m.provider
    ]).map(r => r.item).slice(0, 8)
  }, [availableModels, modelSearchQuery])

  const removeEdgesByIds = useWorkflowStore(s => s.removeEdgesByIds)

  const handleInlineSelectModel = useCallback((model: WaveSpeedModel) => {
    // Smart edge pruning: keep edges whose param name exists in the new model, remove the rest
    if (currentModelId) {
      const newParamNames = new Set(model.inputSchema.map(p => p.name))
      const edgesToRemove = edges.filter(e => {
        // Output edges (this node is source): always keep
        if (e.source === id) return false
        // Input edges (this node is target)
        if (e.target === id) {
          const th = e.targetHandle ?? ''
          // Static input handles (input-xxx): always keep
          if (th.startsWith('input-')) return false
          // Model param handles (param-xxx): keep if new model has the same param name
          if (th.startsWith('param-')) {
            const paramName = th.slice('param-'.length)
            return !newParamNames.has(paramName)
          }
        }
        return false
      })
      if (edgesToRemove.length > 0) {
        removeEdgesByIds(edgesToRemove.map(e => e.id))
      }
    }

    const internalParams: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data.params ?? {})) {
      if (k.startsWith('__')) internalParams[k] = v
    }
    delete internalParams.__hiddenRuns

    const nextParams: Record<string, unknown> = { ...internalParams, modelId: model.modelId }
    for (const p of model.inputSchema) {
      if (p.default !== undefined) nextParams[p.name] = p.default
    }

    updateNodeParams(id, nextParams)

    // Auto-deduplicate label when multiple nodes use the same model
    const baseName = model.displayName
    const otherLabels = allNodes
      .filter(n => n.id !== id && n.data?.nodeType === 'ai-task/run')
      .map(n => String(n.data?.label ?? ''))
    let finalLabel = `🤖 ${baseName}`
    if (otherLabels.includes(finalLabel)) {
      let idx = 2
      while (otherLabels.includes(`🤖 ${baseName} (${idx})`)) idx++
      finalLabel = `🤖 ${baseName} (${idx})`
    }

    updateNodeData(id, {
      modelInputSchema: model.inputSchema,
      label: finalLabel
    })

    const execStore = useExecutionStore.getState()
    execStore.updateNodeStatus(id, 'idle')
    useExecutionStore.setState(s => {
      const newResults = { ...s.lastResults }
      delete newResults[id]
      const newFetched = new Set(s._fetchedNodes)
      newFetched.delete(id)
      return { lastResults: newResults, _fetchedNodes: newFetched }
    })

    setModelSearchQuery('')
    setModelSwitchBlocked(false)
  }, [currentModelId, data.params, edges, id, updateNodeData, updateNodeParams, removeEdgesByIds, allNodes])

  useEffect(() => {
    if (!isAITask) return
    let cancelled = false
    modelsIpc.list().then((m) => {
      if (!cancelled) setAvailableModels(m ?? [])
    }).catch(() => {
      if (!cancelled) setAvailableModels([])
    })
    return () => { cancelled = true }
  }, [isAITask])

  const mediaParams = useMemo(() => schema.filter(p => p.mediaType && p.fieldType !== 'loras'), [schema])
  const loraParams = useMemo(() => schema.filter(p => p.fieldType === 'loras'), [schema])
  const jsonParams = useMemo(() => schema.filter(p => p.fieldType === 'json'), [schema])
  const requiredParams = useMemo(() => schema.filter(p => !p.mediaType && p.fieldType !== 'loras' && p.fieldType !== 'json' && p.name !== 'modelId' && (p.required || !p.hidden)), [schema])
  const optionalParams = useMemo(() => schema.filter(p => !p.mediaType && p.fieldType !== 'loras' && p.fieldType !== 'json' && p.name !== 'modelId' && !p.required && p.hidden), [schema])
  const defParams = paramDefs.filter(p => p.key !== 'modelId')
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
    // Executor reads from persisted workflow DB, so save first when dirty.
    if (!wfId || isDirty) {
      await saveWorkflow()
      wfId = useWorkflowStore.getState().workflowId
    }
    return wfId
  }

  const inlineInputPreviewUrl = useMemo(() => {
    if (!isPreviewNode) return ''
    const isMediaLike = (u: string) =>
      /^https?:\/\//i.test(u) || /^blob:/i.test(u) || /^local-asset:\/\//i.test(u) || /^data:/i.test(u) || /^file:\/\//i.test(u)

    const pickFromSourceNode = (sourceNodeId: string): string => {
      const latest = allLastResults[sourceNodeId]?.[0]?.urls?.[0] ?? ''
      if (latest && isMediaLike(latest)) return latest

      const sourceNode = allNodes.find(n => n.id === sourceNodeId)
      const sourceParams = sourceNode?.data?.params as Record<string, unknown> | undefined
      const candidates = [
        String(sourceParams?.uploadedUrl ?? ''),
        String(sourceParams?.output ?? ''),
        String(sourceParams?.input ?? ''),
        String(sourceParams?.url ?? '')
      ]
      for (const c of candidates) {
        if (c && isMediaLike(c)) return c
      }
      return ''
    }

    for (const inp of inputDefs) {
      const hid = `input-${inp.key}`
      const edge = edges.find(e => e.target === id && e.targetHandle === hid)
      if (edge) {
        const upstream = pickFromSourceNode(edge.source)
        if (upstream) return upstream
      } else {
        const localVal = String(data.params[inp.key] ?? '')
        if (localVal && isMediaLike(localVal)) return localVal
      }
    }

    return ''
  }, [allLastResults, allNodes, data.params, edges, id, inputDefs, isPreviewNode])

  const inlinePreviewDetectSource = useMemo(() => {
    if (!inlineInputPreviewUrl) return ''
    const lowered = /^local-asset:\/\//i.test(inlineInputPreviewUrl)
      ? (() => {
          try {
            return decodeURIComponent(inlineInputPreviewUrl.replace(/^local-asset:\/\//i, '')).toLowerCase()
          } catch {
            return inlineInputPreviewUrl.toLowerCase()
          }
        })()
      : inlineInputPreviewUrl.toLowerCase()
    return lowered.split('?')[0]
  }, [inlineInputPreviewUrl])
  const inlinePreviewIsImage = /^data:image\//i.test(inlineInputPreviewUrl) || /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)$/.test(inlinePreviewDetectSource)
  const inlinePreviewIsVideo = /^data:video\//i.test(inlineInputPreviewUrl) || /\.(mp4|webm|mov|avi|mkv)$/.test(inlinePreviewDetectSource)
  const inlinePreviewIsAudio = /^data:audio\//i.test(inlineInputPreviewUrl) || /\.(mp3|wav|ogg|flac|aac|m4a)$/.test(inlinePreviewDetectSource)
  const inlinePreviewIs3D = /\.(glb|gltf)$/.test(inlinePreviewDetectSource)

  // If enabled, optimize prompt/text once right before running.
  const optimizeOnRunIfEnabled = useCallback(async () => {
    const settings = (data.params.__optimizerSettings as Record<string, unknown> | undefined) ?? {}
    const enabled = Boolean(settings.optimizeOnRun ?? settings.autoOptimize)
    if (!enabled) return

    const fieldToOptimize: 'text' | 'prompt' | null = (() => {
      if (data.nodeType === 'input/text-input') return 'text'
      if (typeof data.params.prompt === 'string') return 'prompt'
      if (typeof data.params.text === 'string') return 'text'
      return null
    })()
    if (!fieldToOptimize) return

    const sourceText = String(data.params[fieldToOptimize] ?? '')
    if (!sourceText.trim()) return

    // If current text was manually optimized, skip auto optimize on run.
    const lastManualOptimizedText = typeof settings.lastManualOptimizedText === 'string'
      ? settings.lastManualOptimizedText
      : ''
    if (lastManualOptimizedText && lastManualOptimizedText === sourceText) return

    const { optimizeOnRun: _opt, autoOptimize: _legacy, lastManualOptimizedText: _manual, ...settingsForApi } = settings

    try {
      const optimized = await apiClient.optimizePrompt({ ...settingsForApi, text: sourceText })
      if (optimized && optimized !== sourceText) {
        updateNodeParams(id, { ...data.params, [fieldToOptimize]: optimized })
      }
    } catch (err) {
      console.warn('Optimize on run failed:', err)
    }
  }, [data.nodeType, data.params, id, updateNodeParams])

  const onRun = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!running) {
      await optimizeOnRunIfEnabled()
    }
    const wfId = await ensureWorkflowId()
    if (!wfId) return
    running ? cancelNode(wfId, id) : runNode(wfId, id)
  }

  const onRunFromHere = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await optimizeOnRunIfEnabled()
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
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg> {t('workflow.stop', 'Stop')}
            </button>
          ) : (
            <>
              <button onClick={onRun}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-medium shadow-lg backdrop-blur-sm bg-blue-500 text-white hover:bg-blue-600 transition-all"
                title={t('workflow.runNode', 'Run Node')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg> {t('workflow.run', 'Run')}
              </button>
              <button onClick={onRunFromHere}
                className="flex items-center justify-center w-8 h-8 rounded-full shadow-lg backdrop-blur-sm bg-green-600 text-white hover:bg-green-700 transition-all"
                title={t('workflow.continueFrom', 'Continue From')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="4,4 14,12 4,20"/><polygon points="12,4 22,12 12,20"/></svg>
              </button>
              <button onClick={onDelete}
                className="flex items-center justify-center w-8 h-8 rounded-full shadow-lg backdrop-blur-sm bg-[hsl(var(--muted))] text-muted-foreground hover:bg-red-500/20 hover:text-red-400 transition-all"
                title={t('workflow.delete', 'Delete')}>
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
        <span className="font-semibold text-[13px] flex-1 truncate">{nodeLabel}</span>
      </div>

      {/* ── Running status bar — prominent, always visible when running ── */}
      {running && (
        <div className="px-3 py-1.5 bg-blue-500/5">
          <div className="flex items-center gap-2 mb-1">
            <svg className="animate-spin flex-shrink-0 text-blue-400" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
            </svg>
            <span className="text-[11px] text-blue-400 font-medium flex-1">
              {progress?.message || t('workflow.running', 'Running...')}
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
              title={t('workflow.retry', 'Retry')}
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

        {isAITask && (
          <div className="px-3 mb-1">
            <div className="relative pl-2">
              <svg className="absolute left-[18px] top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
              </svg>
              <input
                type="text"
                value={modelSearchQuery}
                onChange={e => {
                  setModelSearchQuery(e.target.value)
                  if (modelSwitchBlocked) setModelSwitchBlocked(false)
                }}
                placeholder={t('workflow.modelSelector.searchAllPlaceholder', 'Search all models...')}
                className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-6 pr-2 py-1.5 text-[11px] text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                onClick={e => e.stopPropagation()}
              />
            </div>
            {modelSearchQuery.trim() && (
              <div className="mt-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] max-h-[170px] overflow-y-auto">
                {modelSearchResults.map(model => (
                  <button
                    key={model.modelId}
                    onClick={e => { e.stopPropagation(); handleInlineSelectModel(model) }}
                    className="w-full text-left px-2 py-1.5 hover:bg-[hsl(var(--accent))] transition-colors border-b border-[hsl(var(--border))]/40 last:border-b-0"
                  >
                    <div className="text-[11px] font-medium truncate">{model.displayName}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{model.category} · {model.provider}</div>
                  </button>
                ))}
                {modelSearchResults.length === 0 && (
                  <div className="px-2 py-2 text-[10px] text-muted-foreground text-center">
                    {t('workflow.modelSelector.noModelsFound', 'No models found')}
                  </div>
                )}
              </div>
            )}
            {modelSwitchBlocked && (
              <div className="mt-1 text-[10px] text-amber-300">
                {t('workflow.modelSelector.disconnectBeforeSwitch', 'Please disconnect this node before switching model.')}
              </div>
            )}
          </div>
        )}

        {isAITask && !hasSchema && (
          <div className="mx-2 text-center py-4 text-[hsl(var(--muted-foreground))] text-xs italic border border-dashed border-[hsl(var(--border))] rounded-lg my-1">
            {t('workflow.nodeDefs.ai-task/run.emptyHint', 'Click this node, then select a model →')}
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
                {showOptional ? t('workflow.hide', 'Hide') : t('workflow.show', 'Show')} {optionalParams.length} {t('workflow.optional', 'optional')}
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
          if (!isPreviewNode) {
            return (
              <Row key={inp.key} handleId={hid} handleType="target" connected={conn} media>
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className={`text-xs whitespace-nowrap flex-shrink-0 ${conn ? 'text-green-400 font-semibold' : 'text-[hsl(var(--muted-foreground))]'}`}>
                    {localizeInputLabel(inp.key, inp.label)}{inp.required && <span className="text-red-400"> *</span>}
                  </span>
                  {conn
                    ? <ConnectedInputControl nodeId={id} handleId={hid} edges={edges} nodes={useWorkflowStore.getState().nodes} onPreview={openPreview} />
                    : <div className="flex-1 min-w-0"><InputPortControl
                      nodeId={id}
                      port={inp}
                      value={data.params[inp.key]}
                      onChange={v => setParam(inp.key, v)}
                      onPreview={openPreview}
                      referenceImageUrl={data.nodeType === 'free-tool/image-eraser' && inp.key === 'mask' ? String(data.params.input ?? '') : undefined}
                      showDrawMaskButton={data.nodeType === 'free-tool/image-eraser' && inp.key === 'mask'}
                    /></div>}
                </div>
              </Row>
            )
          }

          return (
            <Row key={inp.key} handleId={hid} handleType="target" connected={conn} media>
              <div className="w-full min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs ${conn ? 'text-green-400 font-semibold' : 'text-[hsl(var(--muted-foreground))]'}`}>
                    {localizeInputLabel(inp.key, inp.label)}{inp.required && <span className="text-red-400"> *</span>}
                  </span>
                </div>
                {conn
                  ? <ConnectedInputControl nodeId={id} handleId={hid} edges={edges} nodes={useWorkflowStore.getState().nodes} onPreview={openPreview} showPreview={false} />
                  : <InputPortControl
                    nodeId={id}
                    port={inp}
                    value={data.params[inp.key]}
                    onChange={v => setParam(inp.key, v)}
                    onPreview={openPreview}
                    referenceImageUrl={data.nodeType === 'free-tool/image-eraser' && inp.key === 'mask' ? String(data.params.input ?? '') : undefined}
                    showDrawMaskButton={data.nodeType === 'free-tool/image-eraser' && inp.key === 'mask'}
                    showPreview={false}
                  />}
              </div>
            </Row>
          )
        })}

        {/* Segment Anything: Pick points by clicking */}
        {data.nodeType === 'free-tool/segment-anything' && (
          <div className="px-3 py-1">
            <div className="pl-2 flex items-center justify-between gap-2 w-full">
              <span className="text-xs text-[hsl(var(--muted-foreground))] flex-shrink-0">
                {t('workflow.pointsLabel')}
              </span>
              <button
                type="button"
                title={String(data.params.input ?? '').trim() ? t('workflow.pickPoints') : t('workflow.pickPointsNeedInput')}
                disabled={!String(data.params.input ?? '').trim()}
                onClick={e => {
                  e.stopPropagation()
                  if (String(data.params.input ?? '').trim()) setSegmentPointPickerOpen(true)
                }}
                className={`nodrag flex-shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md border border-[hsl(var(--border))] text-xs transition-colors ${
                  String(data.params.input ?? '').trim()
                    ? 'cursor-pointer bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'
                    : 'cursor-not-allowed opacity-50'
                }`}
              >
                <MousePointer2 className="h-4 w-4" />
                {t('workflow.pickPoints')}
                {(() => {
                  try {
                    const pts = data.params.__segmentPoints as string | undefined
                    if (!pts) return null
                    const arr = JSON.parse(pts) as SegmentPoint[]
                    return Array.isArray(arr) && arr.length > 0 ? (
                      <span className="text-[10px] opacity-75">({arr.length})</span>
                    ) : null
                  } catch {
                    return null
                  }
                })()}
              </button>
            </div>
            {segmentPointPickerOpen && String(data.params.input ?? '').trim() && (
              <SegmentPointPicker
                referenceImageUrl={String(data.params.input)}
                onComplete={(points: SegmentPoint[]) => {
                  updateNodeParams(id, { ...data.params, __segmentPoints: JSON.stringify(points) })
                  setSegmentPointPickerOpen(false)
                }}
                onClose={() => setSegmentPointPickerOpen(false)}
              />
            )}
          </div>
        )}

        {/* Hide defParams for nodes with custom body UI */}
        {data.nodeType !== 'input/media-upload' && data.nodeType !== 'input/text-input' && defParams.map(p => {
          const hid = `param-${p.key}`
          const canConnect = p.connectable !== false && p.dataType !== undefined
          const conn = canConnect ? connectedSet.has(hid) : false

          if (!canConnect) {
            return (
              <div key={p.key} className="px-3 py-1">
                <div className="pl-2 flex items-center justify-between gap-2 w-full">
                  <span className="text-xs text-[hsl(var(--muted-foreground))] flex-shrink-0">
                    {localizeParamLabel(p.key, p.label)}
                    {localizeParamDescription(p.key, p.description) && <Tip text={String(localizeParamDescription(p.key, p.description))} />}
                  </span>
                  <DefParamControl nodeId={id} param={p} value={data.params[p.key]} onChange={v => setParam(p.key, v)} />
                </div>
              </div>
            )
          }

          return (
            <Row key={p.key} handleId={hid} handleType="target" connected={conn}>
              <div className="flex items-center justify-between gap-2 w-full">
                <span className="text-xs text-[hsl(var(--muted-foreground))] flex-shrink-0">
                  {localizeParamLabel(p.key, p.label)}
                  {localizeParamDescription(p.key, p.description) && <Tip text={String(localizeParamDescription(p.key, p.description))} />}
                </span>
                {conn
                  ? <LinkedBadge nodeId={id} handleId={hid} edges={edges} nodes={useWorkflowStore.getState().nodes} />
                  : <DefParamControl nodeId={id} param={p} value={data.params[p.key]} onChange={v => setParam(p.key, v)} />}
              </div>
            </Row>
          )
        })}

        {/* Unified input preview area — always rendered near the bottom */}
        {isPreviewNode && inlineInputPreviewUrl && (
          <div className="px-3 pb-2">
            <div className="mt-1" onClick={e => e.stopPropagation()}>
              {inlinePreviewIsImage && (
                <img
                  src={inlineInputPreviewUrl}
                  alt=""
                  onClick={e => { e.stopPropagation(); openPreview(inlineInputPreviewUrl) }}
                  className="w-full max-h-[4096px] rounded-lg border border-[hsl(var(--border))] object-contain cursor-pointer hover:ring-2 hover:ring-blue-500/40 transition-shadow bg-black/5"
                />
              )}
              {inlinePreviewIsVideo && (
                <video
                  src={inlineInputPreviewUrl}
                  controls
                  className="w-full max-h-[4096px] rounded-lg border border-[hsl(var(--border))] object-contain"
                />
              )}
              {inlinePreviewIsAudio && (
                <audio src={inlineInputPreviewUrl} controls className="w-full max-h-10 rounded-lg border border-[hsl(var(--border))]" />
              )}
              {inlinePreviewIs3D && (
                <Inline3DViewer
                  src={inlineInputPreviewUrl}
                  onClick={() => openPreview(inlineInputPreviewUrl)}
                />
              )}
            </div>
          </div>
        )}
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

        const isImageUrl = (url: string): boolean => {
          const normalized = (() => {
            if (/^local-asset:\/\//i.test(url)) {
              try {
                return decodeURIComponent(url.replace(/^local-asset:\/\//i, '')).toLowerCase().split('?')[0]
              } catch {
                return url.toLowerCase().split('?')[0]
              }
            }
            return url.toLowerCase().split('?')[0]
          })()
          return Boolean(normalized.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)$/i))
        }

        const allDisplayImageUrls = displayGroups.flatMap(g => g.urls).filter(isImageUrl)

        return (
          <div className="px-3 pb-2 pt-1 border-t border-[hsl(var(--border))]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px] text-green-400 font-medium">
                {t('workflow.results', 'Results')} ({displayGroups.length}/{resultGroups.length})
              </span>
              <div className="flex-1" />
              {/* Clear all results + delete files */}
              <button onClick={async e => {
                  e.stopPropagation()
                  try {
                    const { historyIpc } = await import('../../ipc/ipc-client')
                    await historyIpc.deleteAll(id)
                  } catch { /* best-effort */ }
                  clearNodeResults(id)
                  // Also clear hidden runs metadata from params
                  const { __hiddenRuns: _, __showLatestOnly: _2, ...rest } = data.params as Record<string, unknown>
                  updateNodeParams(id, rest)
                }}
                className="text-[9px] text-red-400/70 hover:text-red-400 transition-colors"
                title={t('workflow.clearAllResults', 'Clear all results')}>
                {t('workflow.clearAll', 'Clear all')}
              </button>
              {/* Show all — always clickable, clears hidden + turns off latest */}
              <button onClick={e => { e.stopPropagation(); showAllRuns() }}
                className="text-[9px] text-blue-400 hover:text-blue-300 transition-colors">
                {t('workflow.showAll', 'Show all')}
              </button>
              {/* Latest-only toggle */}
              <button onClick={toggleLatest}
                className={`flex items-center gap-1 text-[9px] transition-colors ${latestOnly ? 'text-blue-400' : 'text-muted-foreground hover:text-foreground'}`}
                title={latestOnly ? t('workflow.showAllRuns', 'Show all runs') : t('workflow.showLatestOnly', 'Show latest only')}>
                <span className={`w-6 h-3 rounded-full relative transition-colors ${latestOnly ? 'bg-blue-500' : 'bg-muted-foreground/30'}`}>
                  <span className={`absolute top-0.5 w-2 h-2 rounded-full bg-white transition-transform ${latestOnly ? 'left-3.5' : 'left-0.5'}`} />
                </span>
                <span>{t('workflow.latest', 'Latest')}</span>
              </button>
            </div>
            <div className="space-y-2">
              {displayGroups.map((group) => {
                const isNewest = group === newestGroup
                return (
                  <div key={group.time} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] overflow-hidden">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[hsl(var(--muted))]">
                      {isNewest && <span className="text-[10px] text-green-400 font-semibold">{t('workflow.latest', 'Latest')}</span>}
                      <span className="text-[10px] text-foreground/80 font-medium">
                        {new Date(group.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      {group.durationMs != null && <span className="text-[10px] text-blue-400/80 font-medium">⏱ {(group.durationMs / 1000).toFixed(1)}s</span>}
                      {group.cost != null && group.cost > 0 && <span className="text-[10px] text-amber-400/80 font-medium">💰 ${group.cost.toFixed(4)}</span>}
                      <div className="flex-1" />
                      <button onClick={e => { e.stopPropagation(); hideRun(group.time) }}
                        className="text-[10px] text-muted-foreground hover:text-red-400 transition-colors" title={t('workflow.hideRun', 'Hide this run')}>
                        ✕
                      </button>
                    </div>
                    <div className="p-1.5 flex gap-1.5 flex-wrap">
                      {group.urls.map((url, ui) => (
                        <ResultThumb
                          key={`${url}-${ui}`}
                          url={url}
                          onPreview={(src) => {
                            openPreview(src, isImageUrl(src) ? allDisplayImageUrls : undefined)
                          }}
                          onDownload={handleDownload}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
              {/* Empty state */}
              {displayGroups.length === 0 && (
                <div className="text-center py-3 text-[10px] text-muted-foreground">
                  {latestOnly && newestHidden ? t('workflow.latestHidden', 'Latest result hidden.') : t('workflow.noVisibleResults', 'No visible results.')}
                  <button onClick={e => { e.stopPropagation(); showAllRuns() }}
                    className="text-blue-400 hover:text-blue-300 ml-1">{t('workflow.showAll', 'Show all')}</button>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── Output handle — top-right, aligned with title bar ───── */}
      <Handle type="source" position={Position.Right} id="output"
        style={{ ...handleRight(), top: 22 }}
        title={t('workflow.output', 'Output')} />
      <div className="absolute top-[14px] right-5 text-[11px] font-medium text-blue-400/80">{t('workflow.outputLowercase', 'output')}</div>

      {/* ── Resize handles — 4 edges + 4 corners ────────────────── */}
      {/* Only shown when selected to avoid interfering with handle connections */}
      {selected && <>
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
      </>}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   Inline3DViewer — lightweight inline 3D model preview using @google/model-viewer
   ══════════════════════════════════════════════════════════════════════ */

function Inline3DViewer({ src, onClick }: { src: string; onClick?: () => void }) {
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
              optimizeOnRun={Boolean(optimizerSettings?.optimizeOnRun ?? optimizerSettings?.autoOptimize)}
              onOptimizeOnRunChange={(enabled) => {
                const { autoOptimize: _legacy, ...rest } = optimizerSettings ?? {}
                onOptimizerSettingsChange?.({ ...rest, optimizeOnRun: enabled })
              }}
            />
          )}
        </label>
        <div className="pl-2">
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

function MediaRow({ nodeId, schema, value, connected, connectedSet, onChange, onPreview, edges, nodes }: {
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
                      <CompInput type="text" value={v || ''} placeholder={t('workflow.mediaUpload.urlShortPlaceholder', 'URL...')}
                        onChange={e => { const a = [...items]; a[i] = e.target.value; onChange(a) }}
                        onClick={e => e.stopPropagation()}
                        className={`flex-1 rounded-md border bg-[hsl(var(--background))] px-2 py-1 text-[11px] text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 ${urlValid ? 'border-[hsl(var(--border))] focus:ring-green-500/50' : 'border-red-500 focus:ring-red-500/50'}`} />
                      <FileBtn accept={acceptType} uploading={uploadState === 'uploading'}
                        onFile={f => doUpload(f, url => { const a = [...items]; a[i] = url; onChange(a) })} />
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
        {/* Add button */}
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
              <CompInput
                type="text"
                value={sval}
                placeholder={t('workflow.enterField', { field: label.toLowerCase(), defaultValue: `Enter ${label.toLowerCase()}...` })}
                onChange={e => onChange(e.target.value)} onClick={e => e.stopPropagation()}
                className={`flex-1 rounded-md border bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 ${urlValid ? 'border-[hsl(var(--border))] focus:ring-green-500/50' : 'border-red-500 focus:ring-red-500/50'}`} />
              <FileBtn accept={acceptType} uploading={uploadState === 'uploading'} onFile={f => doUpload(f, url => onChange(url))} />
            </div>
            {!urlValid && sval.trim() && <div className="text-[9px] text-red-400 mt-0.5">{t('workflow.invalidUrl', 'Invalid URL')}</div>}
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
function LinkedBadge({ nodeId, handleId, edges, nodes, onDisconnect, onPreview }: {
  nodeId?: string; handleId?: string
  edges?: Array<{ id: string; source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }>
  nodes?: Array<{ id: string; data: { label?: string; nodeType?: string; params?: Record<string, unknown> } }>
  onDisconnect?: () => void
  onPreview?: (src: string) => void
}) {
  const { t } = useTranslation()
  const lastResults = useExecutionStore(s => s.lastResults)
  if (!nodeId || !handleId || !edges || !nodes) {
    return <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 italic"><LockIcon /> {t('workflow.linked', 'linked')}</span>
  }
  const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
  if (!edge) {
    return <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 italic"><LockIcon /> {t('workflow.linked', 'linked')}</span>
  }
  const sourceNode = nodes.find(n => n.id === edge.source)
  const sourceName = sourceNode?.data?.label || edge.source.slice(0, 8)
  const latestResultUrl = lastResults[edge.source]?.[0]?.urls?.[0]
  const previewUrl = (() => {
    if (latestResultUrl && (/^https?:\/\//i.test(latestResultUrl) || /^blob:/i.test(latestResultUrl) || /^local-asset:\/\//i.test(latestResultUrl) || /^data:/i.test(latestResultUrl))) {
      return latestResultUrl
    }
    const params = sourceNode?.data?.params
    const nodeType = sourceNode?.data?.nodeType
    if (nodeType === 'input/media-upload') {
      const uploadedUrl = String(params?.uploadedUrl ?? '')
      if (uploadedUrl && (/^https?:\/\//i.test(uploadedUrl) || /^blob:/i.test(uploadedUrl) || /^local-asset:\/\//i.test(uploadedUrl) || /^data:/i.test(uploadedUrl))) {
        return uploadedUrl
      }
    }
    return ''
  })()

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
      {onPreview && previewUrl && (
        <button
          onClick={e => { e.stopPropagation(); onPreview(previewUrl) }}
          title={t('workflow.previewUpstreamOutput', 'Preview upstream output')}
          className="not-italic text-blue-300 hover:text-blue-100 transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      )}
    </span>
  )
}

function ConnectedInputControl({
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

    if (latestResultUrl && isMediaLike(latestResultUrl)) return latestResultUrl

    // Media upload node and common source-node params fallback
    const candidates = [
      String(sourceParams.uploadedUrl ?? ''),
      String(sourceParams.output ?? ''),
      String(sourceParams.input ?? ''),
      String(sourceParams.url ?? '')
    ]
    for (const c of candidates) {
      if (c && isMediaLike(c)) return c
    }
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
      <LinkedBadge nodeId={nodeId} handleId={handleId} edges={edges} nodes={nodes} onPreview={onPreview} />
      {showPreview && previewUrl && onPreview && (
        <div className="mt-1" onClick={e => e.stopPropagation()}>
          {isImage && (
            <img
              src={previewUrl}
              alt=""
              onClick={e => { e.stopPropagation(); onPreview(previewUrl) }}
              className="w-full max-h-[420px] rounded-lg border border-[hsl(var(--border))] object-contain cursor-pointer hover:ring-2 hover:ring-blue-500/40 transition-shadow bg-black/5"
            />
          )}
          {isVideo && (
            <video
              src={previewUrl}
              controls
              className="w-full max-h-[420px] rounded-lg border border-[hsl(var(--border))] object-contain"
            />
          )}
          {isAudio && (
            <audio src={previewUrl} controls className="w-full max-h-10 rounded-lg border border-[hsl(var(--border))]" />
          )}
        </div>
      )}
    </div>
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
  const { t } = useTranslation()
  if (state === 'uploading') return <span className="ml-auto text-[10px] text-blue-400 animate-pulse">{t('workflow.mediaUpload.uploadingShort', 'Uploading...')}</span>
  if (state === 'success') return <span className="ml-auto text-[10px] text-green-400">✓ {t('workflow.mediaUpload.uploaded', 'Uploaded')}</span>
  if (state === 'error') return <span className="ml-auto text-[10px] text-red-400" title={error}>✕ {t('workflow.mediaUpload.failed', 'Failed')}</span>
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

function DefParamControl({ nodeId, param, value, onChange }: { nodeId: string; param: ParamDefinition; value: unknown; onChange: (v: unknown) => void }) {
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
        const { storageIpc } = await import('../../ipc/ipc-client')
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
            placeholder={t('workflow.nodeDefs.output/file.params.outputDir.placeholder', '留空使用工作流默认输出目录')}
            className={`${cls} flex-1`}
            onClick={e => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={e => { e.stopPropagation(); handlePickDirectory() }}
            title={t('workflow.selectDirectory', '选择目录')}
            className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-md border border-[hsl(var(--border))] transition-colors ${
              selectingDir ? 'bg-blue-500/25 animate-pulse text-blue-300' : 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'
            }`}
          >
            📂
          </button>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); handleOpenDirectory() }}
            title={textVal.trim() ? t('workflow.openFolder', '打开文件夹') : t('workflow.openWorkflowFolder', '打开工作流目录')}
            className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-md border border-[hsl(var(--border))] transition-colors ${
              openingDir ? 'bg-blue-500/25 animate-pulse text-blue-300' : 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'
            }`}
          >
            ↗
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground truncate" title={textVal || t('workflow.outputDirFallbackHint', '未设置：将导出到工作流默认目录')}>
          {textVal || t('workflow.outputDirFallbackHint', '未设置：将导出到工作流默认目录')}
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
        const { storageIpc } = await import('../../ipc/ipc-client')
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

function InputPortControl({
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

  // Detect media type for preview (local-asset, http, blob)
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
      const { storageIpc } = await import('../../ipc/ipc-client')
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
      const { storageIpc } = await import('../../ipc/ipc-client')
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
      {/* Preview for uploaded / URL media */}
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

/* ══════════════════════════════════════════════════════════════════════
   MediaUploadBody — dedicated UI for Media Upload nodes
   Features: drag-and-drop zone, file picker, URL paste, preview, upload status
   ══════════════════════════════════════════════════════════════════════ */

function MediaUploadBody({ params, onBatchChange, onPreview }: {
  params: Record<string, unknown>
  onBatchChange: (updates: Record<string, unknown>) => void
  onPreview: (src: string) => void
}) {
  const { t } = useTranslation()
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
      setUploadError(err instanceof Error ? err.message : t('workflow.mediaUpload.uploadFailed', 'Upload failed'))
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
    try { new URL(url) } catch { setUploadError(t('workflow.mediaUpload.invalidUrl', 'Invalid URL')); setUploadState('error'); return }
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
              {fileName || t('workflow.mediaUpload.fileUploaded', 'File uploaded')}
            </div>
          )}
        </div>

        {/* File info */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground truncate flex-1" title={fileName}>{fileName}</span>
          {uploadState === 'success' && <span className="text-[10px] text-green-400">{t('workflow.mediaUpload.uploaded', 'Uploaded')}</span>}
          <button onClick={e => { e.stopPropagation(); handleClear() }}
            className="text-[10px] text-red-400 hover:text-red-300 transition-colors">
            {t('workflow.mediaUpload.clear', 'Clear')}
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
            <div className="text-xs text-blue-400 animate-pulse mb-1">{t('workflow.mediaUpload.uploading', 'Uploading...')}</div>
            <div className="text-[10px] text-muted-foreground">{fileName}</div>
          </div>
        ) : (
          <>
            <div className="text-2xl mb-1">📁</div>
            <div className="text-xs text-muted-foreground mb-2">
              {t('workflow.mediaUpload.dropOrBrowse', 'Drop file here or click to browse')}
            </div>
            <div className="flex gap-1.5 justify-center">
              <label className="px-3 py-1 rounded-md text-[11px] font-medium bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 cursor-pointer transition-colors">
                {t('workflow.mediaUpload.browse', 'Browse')}
                <input type="file" accept="image/*,video/*,audio/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              </label>
              <button onClick={() => setShowUrlInput(!showUrlInput)}
                className="px-3 py-1 rounded-md text-[11px] font-medium bg-[hsl(var(--muted))] text-muted-foreground hover:text-foreground transition-colors">
                {t('workflow.mediaUpload.pasteUrl', 'Paste URL')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* URL input */}
      {showUrlInput && (
        <div className="mt-2 flex gap-1">
          <CompInput type="text" value={urlInput} onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => {
              const composing = e.nativeEvent.isComposing || e.key === 'Process'
              if (!composing && e.key === 'Enter') handleUrlSubmit()
            }}
            placeholder={t('workflow.mediaUpload.urlPlaceholder', 'https://...')} autoFocus
            className="flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500/50" />
          <button onClick={handleUrlSubmit}
            className="px-2 py-1 rounded-md text-[10px] font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors">
            {t('common.ok', 'OK')}
          </button>
        </div>
      )}

      {/* Error */}
      {uploadState === 'error' && (
        <div className="mt-2 text-[10px] text-red-400 text-center">{uploadError}</div>
      )}

      {/* Supported formats hint */}
      <div className="mt-2 text-[9px] text-muted-foreground/50 text-center">
        {t('workflow.mediaUpload.supportedTypes', 'Image, Video, Audio')}
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
  const { t } = useTranslation()
  const text = String(params.text ?? '')
  const [snippetOpen, setSnippetOpen] = useState(false)
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [snippets, setSnippets] = useState<PromptSnippet[]>(loadSnippets)
  const snippetRef = useRef<HTMLDivElement>(null)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [optimizeError, setOptimizeError] = useState('')

  const optimizerSettings = ((params.__optimizerSettings as Record<string, unknown> | undefined) ?? {})
  const optimizeOnRun = Boolean(optimizerSettings.optimizeOnRun ?? optimizerSettings.autoOptimize ?? false)
  const manualOptimizedLocked = typeof optimizerSettings.lastManualOptimizedText === 'string'
    && optimizerSettings.lastManualOptimizedText === text

  const updateOptimizerSettings = (next: Record<string, unknown>) => {
    onParamChange({ __optimizerSettings: next })
  }

  const toggleOptimizeOnRun = () => {
    const { autoOptimize: _legacy, ...rest } = optimizerSettings
    updateOptimizerSettings({ ...rest, optimizeOnRun: !optimizeOnRun })
  }

  // Close dropdown on outside click
  useEffect(() => {
    if (!snippetOpen) return
    const pointerHandler = (e: PointerEvent) => {
      if (snippetRef.current && !snippetRef.current.contains(e.target as Node)) {
        setSnippetOpen(false)
        setShowSaveInput(false)
      }
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSnippetOpen(false)
        setShowSaveInput(false)
      }
    }
    window.addEventListener('pointerdown', pointerHandler, true)
    window.addEventListener('keydown', keyHandler)
    return () => {
      window.removeEventListener('pointerdown', pointerHandler, true)
      window.removeEventListener('keydown', keyHandler)
    }
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
    const { lastManualOptimizedText: _manual, ...rest } = optimizerSettings
    onParamChange({
      text: s.text,
      __optimizerSettings: rest
    })
    setSnippetOpen(false)
  }

  const doDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const updated = snippets.filter(s => s.id !== id)
    setSnippets(updated)
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify(updated))
  }

  const handleManualOptimize = async () => {
    if (!text.trim() || isOptimizing) return

    setIsOptimizing(true)
    setOptimizeError('')
    try {
      const {
        optimizeOnRun: _opt,
        autoOptimize: _legacy,
        lastManualOptimizedText: _manual,
        ...settingsForApi
      } = optimizerSettings

      const optimized = await apiClient.optimizePrompt({
        ...settingsForApi,
        text
      })

      const { autoOptimize: _legacy2, ...rest } = optimizerSettings
      onParamChange({
        text: optimized,
        __optimizerSettings: {
          ...rest,
          optimizeOnRun,
          lastManualOptimizedText: optimized
        }
      })
    } catch (err) {
      setOptimizeError(err instanceof Error ? err.message : t('workflow.textInput.optimizeFailed', 'Optimize failed'))
    } finally {
      setIsOptimizing(false)
    }
  }

  return (
    <div className="px-3 py-2" onClick={e => e.stopPropagation()}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 mb-1.5">
        {/* Snippet Library */}
        <div className="relative" ref={snippetRef}>
          <button onClick={() => { setSnippetOpen(!snippetOpen); setShowSaveInput(false) }}
            title={t('workflow.textInput.promptLibrary', 'Prompt Library')}
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
                  <span>💾</span> <span>{t('workflow.textInput.saveCurrent', 'Save Current')}</span>
                </button>
              ) : (
                <div className="px-2 py-2 flex gap-1">
                  <CompInput type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
                    onKeyDown={e => {
                      const composing = e.nativeEvent.isComposing || e.key === 'Process'
                      if (!composing && e.key === 'Enter') doSave()
                      e.stopPropagation()
                    }}
                    placeholder={t('workflow.textInput.namePlaceholder', 'Name...')} autoFocus
                    className="flex-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500/50" />
                  <button onClick={doSave} disabled={!saveName.trim()}
                    className="px-2 py-1 rounded text-[10px] font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors">
                    {t('workflow.save', 'Save')}
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
                  {t('workflow.textInput.noSavedSnippets', 'No saved snippets')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Manual optimize + auto-on-run controls */}
        <div className="ml-1 flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleManualOptimize}
            disabled={isOptimizing || !text.trim()}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-blue-500/45 bg-blue-500/15 px-2.5 text-[10px] font-semibold text-blue-600 dark:text-blue-200 shadow-sm transition-all hover:bg-blue-500/25 hover:shadow-blue-500/20 disabled:cursor-not-allowed disabled:opacity-30 disabled:border-[hsl(var(--border))] disabled:bg-[hsl(var(--muted))] disabled:text-[hsl(var(--muted-foreground))] disabled:shadow-none"
            title={t('workflow.textInput.optimizeNowTitle', 'Optimize text now')}
          >
            {isOptimizing ? (
              <>
                <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
                </svg>
                {t('workflow.textInput.optimizing', 'Optimizing...')}
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z"/>
                </svg>
                {t('workflow.textInput.optimizeNow', 'Optimize now')}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={toggleOptimizeOnRun}
            className={`inline-flex h-6 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-semibold transition-all ${
              optimizeOnRun
                ? 'border-emerald-500/55 bg-emerald-500/15 text-emerald-600 dark:text-emerald-200 shadow-sm'
                : 'border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
            }`}
            title={t('workflow.textInput.autoOnRunTitle', 'Only optimize when Run is clicked')}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${optimizeOnRun ? 'bg-emerald-500 dark:bg-emerald-300' : 'bg-[hsl(var(--muted-foreground))]/70'}`} />
            {t('workflow.textInput.autoOnRun', 'Auto on Run')}
          </button>
        </div>

        <div className="flex-1" />

        {/* Character count */}
        <span className="text-[9px] text-[hsl(var(--muted-foreground))]">{text.length} {t('workflow.textInput.chars', 'chars')}</span>
      </div>

      <div className="mb-1 flex items-center justify-between rounded-md border border-[hsl(var(--border))]/70 bg-[hsl(var(--muted))]/20 px-2 py-1">
        {optimizeOnRun ? (
          <span className="text-[10px] font-medium text-emerald-300">{t('workflow.textInput.optimizeOnRunEnabled', 'Enabled: optimize on Run')}</span>
        ) : (
          <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">{t('workflow.textInput.optimizeOffHint', 'Default: no optimization (run with original text)')}</span>
        )}
      </div>

      {manualOptimizedLocked && (
        <div className="mb-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
          {t('workflow.textInput.manualOptimizedHint', 'Manually optimized. Auto-on-run will be skipped until text changes.')}
        </div>
      )}
      {optimizeError && (
        <div className="mb-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
          {optimizeError}
        </div>
      )}

      <WorkflowPromptOptimizer
        currentPrompt={text}
        onOptimized={(optimized) => onParamChange({ text: optimized })}
        quickSettings={optimizerSettings}
        onQuickSettingsChange={(settings) => onParamChange({ __optimizerSettings: settings })}
        optimizeOnRun={optimizeOnRun}
        onOptimizeOnRunChange={(enabled) => {
          const { autoOptimize: _legacy, ...rest } = optimizerSettings
          onParamChange({ __optimizerSettings: { ...rest, optimizeOnRun: enabled } })
        }}
        showRunToggle={false}
        showQuickOptimize={false}
        inlinePanel
        hideTextField
        inactive={!optimizeOnRun}
      />

      {/* Textarea */}
      <CompTextarea
        value={text}
        onChange={e => {
          const { lastManualOptimizedText: _manual, ...rest } = optimizerSettings
          onParamChange({
            text: e.target.value,
            __optimizerSettings: rest
          })
        }}
        placeholder={t('workflow.textInput.enterTextOrPrompt', 'Enter text or prompt...')}
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
          <CompTextarea value={displayValue} onChange={e => handleChange(e.target.value)}
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
  const detectSource = (() => {
    if (/^local-asset:\/\//i.test(url)) {
      try {
        return decodeURIComponent(url.replace(/^local-asset:\/\//i, '')).toLowerCase()
      } catch {
        return url.toLowerCase()
      }
    }
    return url.toLowerCase()
  })().split('?')[0]

  // Detect if the result is plain text (not a URL)
  const isUrl = /^https?:\/\//i.test(url) || /^blob:/i.test(url) || /^local-asset:\/\//i.test(url)
  const is3D = isUrl && /\.(glb|gltf)$/.test(detectSource)
  const isImage = isUrl && /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)$/.test(detectSource)
  const isVideo = isUrl && /\.(mp4|webm|mov|avi|mkv)$/.test(detectSource)
  const isAudio = isUrl && /\.(mp3|wav|ogg|flac|aac|m4a)$/.test(detectSource)

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

  if (isAudio) {
    return (
      <div className="flex-1 min-w-[80px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-2">
        <audio src={url} controls className="w-full" onClick={e => e.stopPropagation()} />
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
