import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useFFmpegWorker } from '@/hooks/useFFmpegWorker'
import { useMultiPhaseProgress } from '@/hooks/useMultiPhaseProgress'
import { ProcessingProgress } from '@/components/shared/ProcessingProgress'
import { getMediaType, formatFileSize, formatDuration } from '@/lib/ffmpegFormats'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  ArrowLeft,
  Upload,
  Download,
  Loader2,
  Combine,
  RefreshCw,
  X,
  GripVertical,
  Music,
  Video,
  Trash2,
  ChevronUp,
  ChevronDown
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface MediaItem {
  id: string
  file: File
  type: 'video' | 'audio'
  duration: number | null
  preview: string | null
}

// Phase configuration for media merger
const PHASES = [
  { id: 'download', labelKey: 'freeTools.ffmpeg.loading', weight: 0.1 },
  { id: 'process', labelKey: 'freeTools.ffmpeg.merging', weight: 0.9 }
]

export function MediaMergerPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [mergedUrl, setMergedUrl] = useState<string | null>(null)
  const [mergedBlob, setMergedBlob] = useState<Blob | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Multi-phase progress tracking
  const {
    progress,
    startPhase,
    updatePhase,
    reset: resetProgress,
    resetAndStart,
    complete: completeAllPhases
  } = useMultiPhaseProgress({ phases: PHASES })

  const { merge, hasFailed, retryWorker } = useFFmpegWorker({
    onPhase: (phase) => {
      if (phase === 'download') {
        startPhase('download')
      } else if (phase === 'process') {
        startPhase('process')
      }
    },
    onProgress: (phase, progressValue, detail) => {
      const phaseId = phase === 'download' ? 'download' : 'process'
      updatePhase(phaseId, progressValue, detail)
    },
    onError: (err) => {
      console.error('Worker error:', err)
      setError(err)
      setIsProcessing(false)
    }
  })

  const handleRetry = useCallback(() => {
    setError(null)
    retryWorker()
  }, [retryWorker])

  const handleFilesSelect = useCallback(
    (files: FileList | File[]) => {
      const newItems: MediaItem[] = []
      const firstType = mediaItems.length > 0 ? mediaItems[0].type : null

      Array.from(files).forEach((file) => {
        const type = getMediaType(file)
        if (type !== 'video' && type !== 'audio') return

        // Only allow same media type
        if (firstType && type !== firstType) return
        if (newItems.length > 0 && type !== newItems[0].type) return

        const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        const preview = type === 'video' ? URL.createObjectURL(file) : null

        const item: MediaItem = { id, file, type, duration: null, preview }
        newItems.push(item)

        // Get duration
        const media = document.createElement(type === 'video' ? 'video' : 'audio')
        media.addEventListener('loadedmetadata', () => {
          setMediaItems((prev) =>
            prev.map((m) => (m.id === id ? { ...m, duration: media.duration } : m))
          )
        })
        media.src = URL.createObjectURL(file)
      })

      setMediaItems((prev) => [...prev, ...newItems])
      setMergedUrl(null)
      setMergedBlob(null)
      resetProgress()
    },
    [mediaItems, resetProgress]
  )

  const handleRemoveItem = useCallback((id: string) => {
    setMediaItems((prev) => {
      const item = prev.find((m) => m.id === id)
      if (item?.preview) URL.revokeObjectURL(item.preview)
      return prev.filter((m) => m.id !== id)
    })
  }, [])

  const handleMoveItem = useCallback((id: string, direction: 'up' | 'down') => {
    setMediaItems((prev) => {
      const index = prev.findIndex((m) => m.id === id)
      if (index === -1) return prev
      if (direction === 'up' && index === 0) return prev
      if (direction === 'down' && index === prev.length - 1) return prev

      const newItems = [...prev]
      const swapIndex = direction === 'up' ? index - 1 : index + 1
      ;[newItems[index], newItems[swapIndex]] = [newItems[swapIndex], newItems[index]]
      return newItems
    })
  }, [])

  const handleClearAll = useCallback(() => {
    mediaItems.forEach((item) => {
      if (item.preview) URL.revokeObjectURL(item.preview)
    })
    if (mergedUrl) URL.revokeObjectURL(mergedUrl)
    setMediaItems([])
    setMergedUrl(null)
    setMergedBlob(null)
    resetProgress()
  }, [mediaItems, mergedUrl, resetProgress])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragging(false)
      if (isProcessing) return
      if (e.dataTransfer.files.length > 0) {
        handleFilesSelect(e.dataTransfer.files)
      }
    },
    [handleFilesSelect, isProcessing]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setIsDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleMerge = async () => {
    if (mediaItems.length < 2) return

    setIsProcessing(true)
    setError(null)
    setMergedUrl(null)
    setMergedBlob(null)
    resetAndStart('download')

    const mediaType = mediaItems[0].type
    const ext = mediaType === 'video' ? 'mp4' : 'mp3'
    const mimeType = mediaType === 'video' ? 'video/mp4' : 'audio/mpeg'

    try {
      // Read all files as ArrayBuffers
      const files: ArrayBuffer[] = []
      const fileNames: string[] = []

      for (const item of mediaItems) {
        const arrayBuffer = await item.file.arrayBuffer()
        files.push(arrayBuffer)
        fileNames.push(item.file.name)
      }

      // Merge using FFmpeg worker
      const result = await merge(files, fileNames, ext, ext)

      // Create blob and URL
      const blob = new Blob([result.data], { type: mimeType })
      const url = URL.createObjectURL(blob)

      setMergedBlob(blob)
      setMergedUrl(url)
      completeAllPhases()
    } catch (err) {
      console.error('Merging failed:', err)
      setError(err instanceof Error ? err.message : 'Merging failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDownload = () => {
    if (!mergedUrl || !mergedBlob) return

    const mediaType = mediaItems[0]?.type || 'video'
    const ext = mediaType === 'video' ? 'mp4' : 'mp3'
    const filename = `merged_${Date.now()}.${ext}`

    const link = document.createElement('a')
    link.href = mergedUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const totalDuration = mediaItems.reduce((sum, item) => sum + (item.duration || 0), 0)
  const mediaType = mediaItems.length > 0 ? mediaItems[0].type : null

  return (
    <div
      className="p-8 relative"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary rounded-lg m-4">
          <div className="text-center">
            <Upload className="h-12 w-12 text-primary mx-auto mb-2" />
            <p className="text-lg font-medium">{t('freeTools.mediaMerger.dropToAdd')}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" onClick={() => navigate('/free-tools')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{t('freeTools.mediaMerger.title')}</h1>
          <p className="text-muted-foreground text-sm">
            {t('freeTools.mediaMerger.description')}
          </p>
        </div>
      </div>

      {/* Upload area */}
      {mediaItems.length === 0 && (
        <Card
          className={cn(
            'border-2 border-dashed cursor-pointer transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50'
          )}
          onClick={() => fileInputRef.current?.click()}
        >
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium">{t('freeTools.mediaMerger.selectFiles')}</p>
            <p className="text-sm text-muted-foreground">
              {t('freeTools.mediaMerger.orDragDrop')}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t('freeTools.mediaMerger.supportedFormats')}
            </p>
          </CardContent>
        </Card>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*,.mp4,.webm,.mov,.avi,.mkv,.mp3,.m4a,.ogg,.wav,.flac"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFilesSelect(e.target.files)
          e.target.value = ''
        }}
      />

      {/* File list and controls */}
      {mediaItems.length > 0 && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('freeTools.mediaMerger.addMore')}
            </Button>

            <Button
              onClick={handleMerge}
              disabled={isProcessing || mediaItems.length < 2}
              className="gradient-bg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('freeTools.mediaMerger.merging')}
                </>
              ) : (
                <>
                  <Combine className="h-4 w-4 mr-2" />
                  {t('freeTools.mediaMerger.merge')} ({mediaItems.length})
                </>
              )}
            </Button>

            {mergedUrl && (
              <Button variant="outline" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                {t('common.download')}
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={handleClearAll}
              disabled={isProcessing}
              className="ml-auto"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Progress display */}
          <ProcessingProgress
            progress={progress}
            showPhases={true}
            showOverall={true}
            showEta={true}
          />

          {/* Error with retry button */}
          {error && hasFailed() && !isProcessing && (
            <div className="flex items-center justify-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <span className="text-sm text-destructive">{error}</span>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.retry')}
              </Button>
            </div>
          )}

          {/* File list */}
          <Card>
            <CardContent className="p-4">
              <div className="space-y-2">
                {mediaItems.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg group"
                  >
                    {/* Drag handle placeholder */}
                    <GripVertical className="h-4 w-4 text-muted-foreground/50" />

                    {/* Index */}
                    <span className="w-6 text-center text-sm font-medium text-muted-foreground">
                      {index + 1}
                    </span>

                    {/* Preview/Icon */}
                    {item.type === 'video' && item.preview ? (
                      <div className="w-16 h-12 rounded overflow-hidden bg-black shrink-0">
                        <video
                          src={item.preview}
                          className="w-full h-full object-cover"
                          muted
                        />
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0">
                        {item.type === 'video' ? (
                          <Video className="h-5 w-5 text-primary/60" />
                        ) : (
                          <Music className="h-5 w-5 text-primary/60" />
                        )}
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.file.name}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{formatFileSize(item.file.size)}</span>
                        {item.duration && <span>{formatDuration(item.duration)}</span>}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleMoveItem(item.id, 'up')}
                        disabled={index === 0 || isProcessing}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleMoveItem(item.id, 'down')}
                        disabled={index === mediaItems.length - 1 || isProcessing}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleRemoveItem(item.id)}
                        disabled={isProcessing}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Summary */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <div className="text-sm text-muted-foreground">
                  {mediaItems.length} {mediaType === 'video' ? 'videos' : 'audio files'}
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">{t('freeTools.mediaMerger.totalDuration')}: </span>
                  <span className="font-medium">{formatDuration(totalDuration)}</span>
                </div>
              </div>

              {/* Merged result with player */}
              {mergedUrl && mergedBlob && (
                <div className="mt-4 pt-4 border-t space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-green-600 dark:text-green-400">
                      {t('freeTools.mediaMerger.merged')}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {formatFileSize(mergedBlob.size)}
                    </span>
                  </div>

                  {/* Merged media player */}
                  {mediaType === 'video' ? (
                    <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                      <video
                        src={mergedUrl}
                        className="w-full h-full object-contain"
                        controls
                        playsInline
                      />
                    </div>
                  ) : (
                    <audio
                      src={mergedUrl}
                      className="w-full"
                      controls
                    />
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Note about same format */}
          <p className="text-xs text-muted-foreground text-center">
            {t('freeTools.mediaMerger.sameFormatNote')}
          </p>
        </div>
      )}
    </div>
  )
}
