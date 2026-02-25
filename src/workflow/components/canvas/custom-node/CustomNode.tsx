/**
 * Main CustomNode component — the top-level node renderer for the workflow canvas.
 *
 * Imports sub-components from sibling modules and orchestrates:
 * - Model selection (AI Task nodes)
 * - Parameter editing (schema-based + Playground FormField)
 * - Media upload / text input (dedicated body components)
 * - Inline preview, results panel, resize handles
 */
import React, { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Handle, Position, useReactFlow, type NodeProps } from 'reactflow'
import { useExecutionStore } from '../../../stores/execution.store'
import { useWorkflowStore } from '../../../stores/workflow.store'
import { useUIStore } from '../../../stores/ui.store'
import { apiClient } from '@/api/client'
import { useModelsStore } from '@/stores/modelsStore'
import { getFormFieldsFromModel } from '@/lib/schemaToForm'
import { formFieldsToModelParamSchema } from '../../../lib/model-converter'
import type { NodeStatus } from '@/workflow/types/execution'
import type { WaveSpeedModel } from '@/workflow/types/node-defs'
import type { FormFieldConfig } from '@/lib/schemaToForm'

import {
  type CustomNodeData,
  MIN_NODE_WIDTH, MIN_NODE_HEIGHT, DEFAULT_NODE_WIDTH,
} from './CustomNodeTypes'
import { handleRight } from './CustomNodeHandleAnchor'
import { CustomNodeBody } from './CustomNodeBody'

/* ── main component ──────────────────────────────────────────────────── */

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
  const { runNode, cancelNode, retryNode } = useExecutionStore()
  const openPreview = useUIStore(s => s.openPreview)
  const allNodes = useWorkflowStore(s => s.nodes)
  const allLastResults = useExecutionStore(s => s.lastResults)
  const [hovered, setHovered] = useState(false)
  const [segmentPointPickerOpen, setSegmentPointPickerOpen] = useState(false)
  const [resultsExpanded, setResultsExpanded] = useState(false)
  const storeModels = useModelsStore(s => s.models)
  const getModelById = useModelsStore(s => s.getModelById)
  const fetchModels = useModelsStore(s => s.fetchModels)

  // ── Resizable dimensions (use ref + direct DOM for zero-lag) ──
  const savedWidth = (data.params.__nodeWidth as number) ?? DEFAULT_NODE_WIDTH
  const savedHeight = (data.params.__nodeHeight as number | undefined) ?? undefined
  const nodeRef = useRef<HTMLDivElement>(null)
  const [resizing, setResizing] = useState(false)
  const { getViewport, setNodes } = useReactFlow()
  const shortId = id.slice(0, 8)
  const nodeLabel = data.nodeType === 'ai-task/run'
    ? t('workflow.aiTaskNodeLabel', 'WaveSpeed API')
    : t(`workflow.nodeDefs.${data.nodeType}.label`, data.nodeType?.split('/').pop() ?? 'Node')
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
      if (xDir === -1 || yDir === -1) {
        const tx = xDir === -1 ? dx : 0
        const ty = yDir === -1 ? dy : 0
        el.style.transform = `translate(${tx}px, ${ty}px)`
      }
    }

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      el.style.transform = ''
      el.style.width = ''
      el.style.minHeight = ''
      setResizing(false)

      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      const newWidth = xDir !== 0 ? Math.max(MIN_NODE_WIDTH, startW + dx * xDir) : undefined
      const newHeight = yDir !== 0 ? Math.max(MIN_NODE_HEIGHT, startH + dy * yDir) : undefined

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
  const isAITask = data.nodeType === 'ai-task/run'
  const currentModelId = String(data.params?.modelId ?? '').trim()
  const currentModel = useModelsStore(s => s.getModelById(currentModelId))

  const schema = useMemo(() => {
    if (isAITask && currentModel) {
      return formFieldsToModelParamSchema(getFormFieldsFromModel(currentModel))
    }
    return data.modelInputSchema ?? []
  }, [isAITask, currentModel, data.modelInputSchema])

  const isPreviewNode = data.nodeType === 'output/preview'
  const removeEdgesByIds = useWorkflowStore(s => s.removeEdgesByIds)

  const handleInlineSelectModel = useCallback((model: WaveSpeedModel) => {
    const desktopModel = useModelsStore.getState().models.find(m => m.model_id === model.modelId)
    const inputSchemaForNode = desktopModel
      ? formFieldsToModelParamSchema(getFormFieldsFromModel(desktopModel))
      : model.inputSchema

    if (currentModelId) {
      const newParamNames = new Set(inputSchemaForNode.map(p => p.name))
      const edgesToRemove = edges.filter(e => {
        if (e.source === id) return false
        if (e.target === id) {
          const th = e.targetHandle ?? ''
          if (th.startsWith('input-')) return false
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
    for (const p of inputSchemaForNode) {
      if (p.default !== undefined) nextParams[p.name] = p.default
    }

    updateNodeParams(id, nextParams)

    const baseName = model.displayName
    const otherLabels = allNodes
      .filter(n => n.id !== id && n.data?.nodeType === 'ai-task/run')
      .map(n => String(n.data?.label ?? '').replace(/^🤖\s*/, '').trim())
    let finalLabel = baseName
    if (otherLabels.includes(finalLabel)) {
      let idx = 2
      while (otherLabels.includes(`${baseName} (${idx})`)) idx++
      finalLabel = `${baseName} (${idx})`
    }

    updateNodeData(id, {
      modelInputSchema: inputSchemaForNode,
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
  }, [currentModelId, data.params, edges, id, updateNodeData, updateNodeParams, removeEdgesByIds, allNodes])

  useEffect(() => {
    if (isAITask && storeModels.length === 0) fetchModels()
  }, [isAITask, storeModels.length, fetchModels])

  const orderedVisibleParams = useMemo(() =>
    schema.filter(p => p.name !== 'modelId' && (p.required || !p.hidden)),
    [schema]
  )
  const optionalParams = useMemo(() =>
    schema.filter(p => p.name !== 'modelId' && !p.required && p.hidden),
    [schema]
  )
  const defParams = paramDefs.filter(p => p.key !== 'modelId')
  const [showOptional, setShowOptional] = useState(false)

  const formFields = useMemo<FormFieldConfig[]>(() => {
    if (!isAITask || !currentModel) return []
    return getFormFieldsFromModel(currentModel).filter(f => f.name !== 'modelId')
  }, [isAITask, currentModel])
  const formValues = useMemo(() => {
    const p = data.params ?? {}
    return Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('__')))
  }, [data.params])
  const [enabledHiddenFields, setEnabledHiddenFields] = useState<Set<string>>(new Set())
  const visibleFormFields = useMemo(() => formFields.filter(f => !f.hidden), [formFields])
  const hiddenFormFields = useMemo(() => formFields.filter(f => f.hidden), [formFields])
  const usePlaygroundForm = isAITask && formFields.length > 0

  useEffect(() => {
    if (usePlaygroundForm) setEnabledHiddenFields(new Set())
  }, [currentModelId, usePlaygroundForm])

  const resultGroups = useExecutionStore(s => s.lastResults[id]) ?? []

  const saveWorkflow = useWorkflowStore(s => s.saveWorkflow)
  const removeNode = useWorkflowStore(s => s.removeNode)
  const { continueFrom } = useExecutionStore()

  const ensureWorkflowId = async () => {
    let wfId = workflowId
    if (!wfId || isDirty) {
      await saveWorkflow({ forRun: true })
      wfId = useWorkflowStore.getState().workflowId
    }
    return wfId
  }

  const handleWorkflowUploadFile = useCallback(async (file: File): Promise<string> => {
    const wfId = await ensureWorkflowId()
    if (!wfId) throw new Error('Workflow not saved yet.')
    const { storageIpc } = await import('../../../ipc/ipc-client')
    const data = await file.arrayBuffer()
    const localPath = await storageIpc.saveUploadedFile(wfId, id, file.name, data)
    return `local-asset://${encodeURIComponent(localPath)}`
  }, [ensureWorkflowId, id])

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
    const wfId = workflowId ?? ''
    running ? cancelNode(wfId, id) : runNode(wfId, id)
  }

  const onRunFromHere = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await optimizeOnRunIfEnabled()
    continueFrom(workflowId ?? '', id)
  }

  const onDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    removeNode(id)
  }

  const onWheel = (e: React.WheelEvent) => {
    const el = e.target as Node | null
    if (!el) return
    const tag = el instanceof HTMLElement ? el.tagName.toLowerCase() : ''
    if (tag === 'textarea' || tag === 'input') {
      e.stopPropagation()
      return
    }
    if (el instanceof HTMLElement && el.isContentEditable) {
      e.stopPropagation()
    }
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onWheel={onWheel}
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
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-medium shadow-lg backdrop-blur-sm bg-blue-500 text-white hover:bg-blue-600 transition-all whitespace-nowrap"
                title={t('workflow.runNode', 'Run Node')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg> {t('workflow.run', 'Run')}
              </button>
              <button onClick={onRunFromHere}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-medium shadow-lg backdrop-blur-sm bg-green-600 text-white hover:bg-green-700 transition-all whitespace-nowrap"
                title={t('workflow.continueFrom', 'Continue From')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="4,4 14,12 4,20"/><polygon points="12,4 22,12 12,20"/></svg> {t('workflow.runFromHere', 'Run from here')}
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

      {/* ── Title bar ──────────── */}
      <div className={`flex items-center gap-1.5 px-3 py-2 select-none
        ${running ? 'bg-blue-500/10' : status === 'confirmed' ? 'bg-green-500/8' : status === 'error' ? 'bg-red-500/8' : ''}`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0
          ${running ? 'bg-blue-500 animate-pulse' :
            status === 'confirmed' ? 'bg-green-500' :
            status === 'error' ? 'bg-red-500' :
            status === 'unconfirmed' ? 'bg-orange-500' :
            'bg-[hsl(var(--muted-foreground))] opacity-30'}`} />
        <span className="font-semibold text-[13px] truncate">{nodeLabel}</span>
        <span className="text-[10px] text-[hsl(var(--muted-foreground))] opacity-50 font-mono flex-shrink-0">{shortId}</span>
      </div>

      {/* ── Running status bar ── */}
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

      {/* ── Error details + Retry ── */}
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
      <CustomNodeBody
        id={id}
        data={data}
        status={status}
        edges={edges}
        connectedSet={connectedSet}
        inputDefs={inputDefs}
        paramDefs={defParams}
        isAITask={isAITask}
        isPreviewNode={isPreviewNode}
        currentModelId={currentModelId}
        currentModel={currentModel}
        storeModels={storeModels}
        getModelById={getModelById}
        usePlaygroundForm={usePlaygroundForm}
        visibleFormFields={visibleFormFields}
        hiddenFormFields={hiddenFormFields}
        enabledHiddenFields={enabledHiddenFields}
        setEnabledHiddenFields={setEnabledHiddenFields}
        orderedVisibleParams={orderedVisibleParams}
        optionalParams={optionalParams}
        showOptional={showOptional}
        setShowOptional={setShowOptional}
        formValues={formValues}
        resultGroups={resultGroups}
        setParam={setParam}
        updateNodeParams={updateNodeParams}
        openPreview={openPreview}
        handleInlineSelectModel={handleInlineSelectModel}
        handleWorkflowUploadFile={handleWorkflowUploadFile}
        localizeInputLabel={localizeInputLabel}
        localizeParamLabel={localizeParamLabel}
        localizeParamDescription={localizeParamDescription}
        segmentPointPickerOpen={segmentPointPickerOpen}
        setSegmentPointPickerOpen={setSegmentPointPickerOpen}
        ensureWorkflowId={ensureWorkflowId}
        inlineInputPreviewUrl={inlineInputPreviewUrl}
        inlinePreviewIsImage={inlinePreviewIsImage}
        inlinePreviewIsVideo={inlinePreviewIsVideo}
        inlinePreviewIsAudio={inlinePreviewIsAudio}
        inlinePreviewIs3D={inlinePreviewIs3D}
        resultsExpanded={resultsExpanded}
        setResultsExpanded={setResultsExpanded}
      />


      {/* ── Resize handles — 4 edges + 4 corners ────────────────── */}
      {selected && <>
      <div onMouseDown={e => onEdgeResizeStart(e,  1,  0)} className="nodrag absolute top-2 right-0 bottom-2 w-[5px] cursor-ew-resize z-20 hover:bg-blue-500/20" />
      <div onMouseDown={e => onEdgeResizeStart(e, -1,  0)} className="nodrag absolute top-2 left-0  bottom-2 w-[5px] cursor-ew-resize z-20 hover:bg-blue-500/20" />
      <div onMouseDown={e => onEdgeResizeStart(e,  0,  1)} className="nodrag absolute bottom-0 left-2 right-2  h-[5px] cursor-ns-resize z-20 hover:bg-blue-500/20" />
      <div onMouseDown={e => onEdgeResizeStart(e,  0, -1)} className="nodrag absolute top-0    left-2 right-2  h-[5px] cursor-ns-resize z-20 hover:bg-blue-500/20" />
      <div onMouseDown={e => onEdgeResizeStart(e,  1,  1)} className="nodrag absolute bottom-0 right-0 w-3 h-3 cursor-se-resize z-30" />
      <div onMouseDown={e => onEdgeResizeStart(e, -1,  1)} className="nodrag absolute bottom-0 left-0  w-3 h-3 cursor-sw-resize z-30" />
      <div onMouseDown={e => onEdgeResizeStart(e,  1, -1)} className="nodrag absolute top-0    right-0 w-3 h-3 cursor-ne-resize z-30" />
      <div onMouseDown={e => onEdgeResizeStart(e, -1, -1)} className="nodrag absolute top-0    left-0  w-3 h-3 cursor-nw-resize z-30" />
      </>}
      </div>

      {/* ── Output handle — placed on outer div so React Flow positions it correctly ───── */}
      <Handle type="source" position={Position.Right} id="output"
        style={{ ...handleRight(), top: 22 }}
        title={t('workflow.output', 'Output')} />
      <div className="absolute top-[15px] right-5 text-[10px] font-medium text-primary/60 select-none">{t('workflow.outputLowercase', 'output')}</div>
    </div>
  )
}

export const CustomNode = memo(CustomNodeComponent)
export type { CustomNodeData }
