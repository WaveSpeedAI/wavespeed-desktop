/**
 * Node-specific body components for CustomNode.
 *
 * MediaUploadBody — dedicated UI for Media Upload nodes
 * TextInputBody — dedicated UI for Text Input nodes
 */
import React, { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient } from '@/api/client'
import { WorkflowPromptOptimizer } from '../WorkflowPromptOptimizer'
import { CompInput } from '../composition-input'
import { FormField } from '@/components/playground/FormField'

/* ══════════════════════════════════════════════════════════════════════
   MediaUploadBody
   ══════════════════════════════════════════════════════════════════════ */

export function MediaUploadBody({ params, onBatchChange, onPreview }: {
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  const detectMediaType = (name: string): string => {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image'
    if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) return 'video'
    if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) return 'audio'
    return 'file'
  }

  const handleFile = async (file: File) => {
    setUploadState('uploading'); setUploadError('')
    const localMediaType = detectMediaType(file.name)
    // Immediately show local preview via blob URL while uploading in background
    const blobUrl = URL.createObjectURL(file)
    onBatchChange({ uploadedUrl: blobUrl, fileName: file.name, mediaType: localMediaType })
    try {
      const url = await apiClient.uploadFile(file)
      // Revoke blob URL and replace with CDN URL
      URL.revokeObjectURL(blobUrl)
      onBatchChange({ uploadedUrl: url, fileName: file.name, mediaType: localMediaType })
      setUploadState('success')
      setTimeout(() => setUploadState('idle'), 2000)
    } catch (err) {
      // Upload failed — keep the local blob preview so user can still see the file
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

  if (uploadedUrl) {
    const isImage = mediaType === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(uploadedUrl)
    const isVideo = mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(uploadedUrl)
    const isAudio = mediaType === 'audio' || /\.(mp3|wav|ogg)$/i.test(uploadedUrl)

    const clearBtn = (
      <button
        onClick={e => { e.stopPropagation(); handleClear() }}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500/90 hover:bg-red-500 text-white flex items-center justify-center shadow-md transition-colors z-10"
        title={t('workflow.mediaUpload.clear', 'Clear')}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
        </svg>
      </button>
    )

    return (
      <div className="px-3 py-2">
        {/* Media preview — button is on the media element itself */}
        <div className="flex justify-center">
          {isImage ? (
            <div className="relative inline-block">
              <img src={uploadedUrl} alt={fileName} onClick={e => { e.stopPropagation(); onPreview(uploadedUrl) }}
                className="max-w-full max-h-[120px] rounded-lg border border-[hsl(var(--border))] object-contain cursor-pointer hover:ring-2 hover:ring-blue-500/40 bg-black/20" />
              {clearBtn}
            </div>
          ) : isVideo ? (
            <div className="relative inline-block">
              <video src={uploadedUrl} controls className="max-w-full max-h-[120px] rounded-lg border border-[hsl(var(--border))]" onClick={e => e.stopPropagation()} />
              {clearBtn}
            </div>
          ) : isAudio ? (
            <div className="relative w-full">
              <audio src={uploadedUrl} controls className="w-full" onClick={e => e.stopPropagation()} />
              {clearBtn}
            </div>
          ) : (
            <div className="relative w-full">
              <div className="p-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-xs text-center">
                {fileName || t('workflow.mediaUpload.fileUploaded', 'File uploaded')}
              </div>
              {clearBtn}
            </div>
          )}
        </div>
        {/* File info — selectable & copyable */}
        <div className="mt-1.5 flex items-center gap-1.5 nodrag nowheel">
          <span className="text-[11px] text-foreground/80 font-medium truncate select-text cursor-text" title={fileName}>{fileName}</span>
          {uploadState === 'success' && <span className="text-[10px] text-green-400 flex-shrink-0">✓</span>}
        </div>
        {uploadedUrl && !uploadedUrl.startsWith('blob:') && (
          <div className="text-[9px] text-muted-foreground/50 truncate mt-0.5 select-text cursor-text nodrag nowheel" title={uploadedUrl}>
            {uploadedUrl}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-3 py-2" onClick={e => e.stopPropagation()}>
      <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); if (fileInputRef.current) fileInputRef.current.value = '' }} />
      <div
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }}
        onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragOver(false) }}
        onDrop={handleDrop}
        onClick={() => { if (uploadState !== 'uploading') fileInputRef.current?.click() }}
        className={`relative rounded-lg border-2 border-dashed p-4 text-center transition-colors cursor-pointer
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
              <label className="px-3 py-1 rounded-md text-[11px] font-medium bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 cursor-pointer transition-colors"
                onClick={e => e.stopPropagation()}>
                {t('workflow.mediaUpload.browse', 'Browse')}
                <input type="file" accept="image/*,video/*,audio/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              </label>
              <button onClick={e => { e.stopPropagation(); setShowUrlInput(!showUrlInput) }}
                className="px-3 py-1 rounded-md text-[11px] font-medium bg-[hsl(var(--muted))] text-muted-foreground hover:text-foreground transition-colors">
                {t('workflow.mediaUpload.pasteUrl', 'Paste URL')}
              </button>
            </div>
          </>
        )}
      </div>
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
      {uploadState === 'error' && (
        <div className="mt-2 text-[10px] text-red-400 text-center">{uploadError}</div>
      )}
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

export function TextInputBody({ params, onParamChange }: {
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

  useEffect(() => {
    if (!snippetOpen) return
    const pointerHandler = (e: PointerEvent) => {
      if (snippetRef.current && !snippetRef.current.contains(e.target as Node)) {
        setSnippetOpen(false); setShowSaveInput(false)
      }
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSnippetOpen(false); setShowSaveInput(false) }
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
    setSnippets(updated); localStorage.setItem(SNIPPETS_KEY, JSON.stringify(updated))
    setSaveName(''); setShowSaveInput(false)
  }

  const doLoad = (s: PromptSnippet) => {
    const { lastManualOptimizedText: _manual, ...rest } = optimizerSettings
    onParamChange({ text: s.text, __optimizerSettings: rest })
    setSnippetOpen(false)
  }

  const doDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const updated = snippets.filter(s => s.id !== id)
    setSnippets(updated); localStorage.setItem(SNIPPETS_KEY, JSON.stringify(updated))
  }

  const handleManualOptimize = async () => {
    if (!text.trim() || isOptimizing) return
    setIsOptimizing(true); setOptimizeError('')
    try {
      const { optimizeOnRun: _opt, autoOptimize: _legacy, lastManualOptimizedText: _manual, ...settingsForApi } = optimizerSettings
      const optimized = await apiClient.optimizePrompt({ ...settingsForApi, text })
      const { autoOptimize: _legacy2, ...rest } = optimizerSettings
      onParamChange({ text: optimized, __optimizerSettings: { ...rest, optimizeOnRun, lastManualOptimizedText: optimized } })
    } catch (err) {
      setOptimizeError(err instanceof Error ? err.message : t('workflow.textInput.optimizeFailed', 'Optimize failed'))
    } finally { setIsOptimizing(false) }
  }

  return (
    <div className="px-3 py-2" onClick={e => e.stopPropagation()}>
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-2 mb-2">
      <div className="flex items-center gap-0.5 mb-1.5">
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
              {!showSaveInput ? (
                <button onClick={() => setShowSaveInput(true)} disabled={!text.trim()}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-[hsl(var(--accent))] transition-colors disabled:opacity-40 disabled:cursor-not-allowed rounded-t-lg">
                  <span>💾</span> <span>{t('workflow.textInput.saveCurrent', 'Save Current')}</span>
                </button>
              ) : (
                <div className="px-2 py-2 flex gap-1">
                  <CompInput type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
                    onKeyDown={e => { const composing = e.nativeEvent.isComposing || e.key === 'Process'; if (!composing && e.key === 'Enter') doSave(); e.stopPropagation() }}
                    placeholder={t('workflow.textInput.namePlaceholder', 'Name...')} autoFocus
                    className="flex-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500/50" />
                  <button onClick={doSave} disabled={!saveName.trim()}
                    className="px-2 py-1 rounded text-[10px] font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors">
                    {t('workflow.save', 'Save')}
                  </button>
                </div>
              )}
              {snippets.length > 0 && <div className="mx-2 h-px bg-[hsl(var(--border))]" />}
              <div className="max-h-[180px] overflow-y-auto py-0.5">
                {snippets.map(s => (
                  <div key={s.id} className="flex items-center gap-1 px-3 py-1.5 hover:bg-[hsl(var(--accent))] transition-colors cursor-pointer group" onClick={() => doLoad(s)}>
                    <span className="flex-1 text-[11px] truncate" title={s.text}>{s.name}</span>
                    <button onClick={e => doDelete(e, s.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all text-[11px] px-0.5">✕</button>
                  </div>
                ))}
              </div>
              {snippets.length === 0 && (
                <div className="px-3 py-3 text-[10px] text-[hsl(var(--muted-foreground))] text-center">{t('workflow.textInput.noSavedSnippets', 'No saved snippets')}</div>
              )}
            </div>
          )}
        </div>
        <div className="ml-1 flex items-center gap-1.5">
          <button type="button" onClick={handleManualOptimize} disabled={isOptimizing || !text.trim()}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-blue-500/45 bg-blue-500/15 px-2.5 text-[10px] font-semibold text-blue-600 dark:text-blue-200 shadow-sm transition-all hover:bg-blue-500/25 hover:shadow-blue-500/20 disabled:cursor-not-allowed disabled:opacity-30 disabled:border-[hsl(var(--border))] disabled:bg-[hsl(var(--muted))] disabled:text-[hsl(var(--muted-foreground))] disabled:shadow-none"
            title={t('workflow.textInput.optimizeNowTitle', 'Optimize text now')}>
            {isOptimizing ? (
              <><svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" /></svg>{t('workflow.textInput.optimizing', 'Optimizing...')}</>
            ) : (
              <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z"/></svg>{t('workflow.textInput.optimizeNow', 'Optimize Now')}</>
            )}
          </button>
          <button type="button" onClick={toggleOptimizeOnRun}
            className={`inline-flex h-6 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-semibold transition-all ${optimizeOnRun ? 'border-emerald-500/55 bg-emerald-500/15 text-emerald-600 dark:text-emerald-200 shadow-sm' : 'border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}
            title={t('workflow.textInput.autoOnRunTitle', 'Only optimize when Run is clicked')}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${optimizeOnRun ? 'bg-emerald-500 dark:bg-emerald-300' : 'bg-[hsl(var(--muted-foreground))]/70'}`} />
            {t('workflow.textInput.autoOnRun', 'Optimize On Run')}
          </button>
        </div>
        <div className="flex-1" />
        <span className="text-[9px] text-[hsl(var(--muted-foreground))]">{text.length} {t('workflow.textInput.chars', 'chars')}</span>
      </div>
      <div className="mb-1 flex items-center justify-between rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-1">
        {optimizeOnRun
          ? <span className="text-[10px] font-medium text-emerald-300">{t('workflow.textInput.optimizeOnRunEnabled', 'Enabled: Optimize On Run')}</span>
          : <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">{t('workflow.textInput.optimizeOffHint', 'Default: no optimization (run with original text)')}</span>}
      </div>
      {manualOptimizedLocked && (
        <div className="mb-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
          {t('workflow.textInput.manualOptimizedHint', 'Manually optimized. Auto-on-run will be skipped until text changes.')}
        </div>
      )}
      {optimizeError && (
        <div className="mb-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-300">{optimizeError}</div>
      )}
      </div>

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

      <FormField
        field={{ name: 'text', type: 'textarea', label: t('workflow.textInput.text', 'Text'), required: false, placeholder: t('workflow.textInput.enterTextOrPrompt', 'Enter text or prompt...') }}
        value={text}
        onChange={v => {
          const { lastManualOptimizedText: _manual, ...rest } = optimizerSettings
          onParamChange({ text: v, __optimizerSettings: rest })
        }}
        formValues={params}
        hideLabel
      />
    </div>
  )
}
