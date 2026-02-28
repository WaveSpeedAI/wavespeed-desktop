import { useState, useRef, useCallback, useEffect, useContext } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { PageResetContext } from '@/components/layout/PageResetContext'
import { useTranslation } from 'react-i18next'
import { useFFmpegWorker } from '@/hooks/useFFmpegWorker'
import { useMultiPhaseProgress } from '@/hooks/useMultiPhaseProgress'
import { ProcessingProgress } from '@/components/shared/ProcessingProgress'
import { TimeRangeSlider } from '@/components/ffmpeg/TimeRangeSlider'
import { getMediaType, formatDuration } from '@/lib/ffmpegFormats'
import { formatBytes } from '@/types/progress'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  ArrowLeft,
  Upload,
  Download,
  Loader2,
  Scissors,
  RefreshCw,
  Music
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Phase configuration for media trimmer
const PHASES = [
  { id: 'download', labelKey: 'freeTools.ffmpeg.loading', weight: 0.1 },
  { id: 'process', labelKey: 'freeTools.ffmpeg.trimming', weight: 0.9 }
]

export function MediaTrimmerPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { resetPage } = useContext(PageResetContext)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null)
  const dragCounterRef = useRef(0)

  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<'video' | 'audio' | null>(null)
  const [duration, setDuration] = useState<number>(0)
  const [startTime, setStartTime] = useState<number>(0)
  const [endTime, setEndTime] = useState<number>(0)
  const [_currentTime, setCurrentTime] = useState<number>(0)
  const [_isPlaying, setIsPlaying] = useState(false)
  const [trimmedUrl, setTrimmedUrl] = useState<string | null>(null)
  const [trimmedBlob, setTrimmedBlob] = useState<Blob | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showBackWarning, setShowBackWarning] = useState(false)

  // Multi-phase progress tracking
  const {
    progress,
    startPhase,
    updatePhase,
    reset: resetProgress,
    resetAndStart,
    complete: completeAllPhases
  } = useMultiPhaseProgress({ phases: PHASES })

  const { trim, hasFailed, retryWorker } = useFFmpegWorker({
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
      resetProgress()
    }
  })

  const handleRetry = useCallback(() => {
    setError(null)
    retryWorker()
  }, [retryWorker])

  const handleBack = useCallback(() => {
    if (isProcessing) {
      setShowBackWarning(true)
    } else {
      resetPage(location.pathname)
      navigate('/free-tools')
    }
  }, [isProcessing, resetPage, location.pathname, navigate])

  const handleConfirmBack = useCallback(() => {
    setShowBackWarning(false)
    resetPage(location.pathname)
    navigate('/free-tools')
  }, [resetPage, location.pathname, navigate])

  const handleFileSelect = useCallback(
    (file: File) => {
      const type = getMediaType(file)
      if (type !== 'video' && type !== 'audio') return

      setError(null)
      // Clean up previous URLs
      if (mediaUrl) URL.revokeObjectURL(mediaUrl)
      if (trimmedUrl) URL.revokeObjectURL(trimmedUrl)

      const url = URL.createObjectURL(file)
      setMediaFile(file)
      setMediaUrl(url)
      setMediaType(type)
      setTrimmedUrl(null)
      setTrimmedBlob(null)
      setIsPlaying(false)
      setStartTime(0)
      setCurrentTime(0)
      resetProgress()
    },
    [mediaUrl, trimmedUrl, resetProgress]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragging(false)
      if (isProcessing) return
      const file = e.dataTransfer.files[0]
      if (file) handleFileSelect(file)
    },
    [handleFileSelect, isProcessing]
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

  // Handle media loaded
  const handleLoadedMetadata = useCallback(() => {
    if (mediaRef.current) {
      const dur = mediaRef.current.duration
      setDuration(dur)
      setEndTime(dur)
    }
  }, [])

  // Sync playback position
  useEffect(() => {
    const media = mediaRef.current
    if (!media) return

    const handleTimeUpdate = () => {
      setCurrentTime(media.currentTime)
    }

    media.addEventListener('timeupdate', handleTimeUpdate)
    return () => media.removeEventListener('timeupdate', handleTimeUpdate)
  }, [])

  const handleTrim = async () => {
    if (!mediaFile || !duration) return

    setIsProcessing(true)
    setError(null)
    setTrimmedUrl(null)
    setTrimmedBlob(null)
    resetAndStart('download')

    // Determine output format from input
    const ext = mediaFile.name.split('.').pop()?.toLowerCase() || (mediaType === 'video' ? 'mp4' : 'mp3')
    const mimeType = mediaType === 'video' ? 'video/mp4' : 'audio/mpeg'

    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await mediaFile.arrayBuffer()

      // Trim using FFmpeg worker
      const result = await trim(
        arrayBuffer,
        mediaFile.name,
        startTime,
        endTime,
        ext,
        ext
      )

      // Create blob and URL
      const blob = new Blob([result.data], { type: mimeType })
      const url = URL.createObjectURL(blob)

      setTrimmedBlob(blob)
      setTrimmedUrl(url)
      completeAllPhases()
    } catch (err) {
      console.error('Trimming failed:', err)
      setError(err instanceof Error ? err.message : 'Trimming failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDownload = () => {
    if (!trimmedUrl || !trimmedBlob || !mediaFile) return

    const ext = mediaFile.name.split('.').pop()?.toLowerCase() || 'mp4'
    const baseName = mediaFile.name.replace(/\.[^.]+$/, '')
    const filename = `${baseName}_trimmed.${ext}`

    const link = document.createElement('a')
    link.href = trimmedUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div
      className="p-8 relative"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* Drag overlay */}
      {isDragging && mediaFile && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary rounded-lg m-4">
          <div className="text-center">
            <Upload className="h-12 w-12 text-primary mx-auto mb-2" />
            <p className="text-lg font-medium">{t('freeTools.mediaTrimmer.dropToReplace')}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{t('freeTools.mediaTrimmer.title')}</h1>
          <p className="text-muted-foreground text-sm">
            {t('freeTools.mediaTrimmer.description')}
          </p>
        </div>
      </div>

      {/* Upload area */}
      {!mediaFile && (
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
            <p className="text-lg font-medium">{t('freeTools.mediaTrimmer.selectMedia')}</p>
            <p className="text-sm text-muted-foreground">
              {t('freeTools.mediaTrimmer.orDragDrop')}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t('freeTools.mediaTrimmer.supportedFormats')}
            </p>
          </CardContent>
        </Card>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*,.mp4,.webm,.mov,.avi,.mkv,.mp3,.m4a,.ogg,.wav,.flac"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFileSelect(file)
          e.target.value = ''
        }}
      />

      {/* Media preview and controls */}
      {mediaFile && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('freeTools.mediaTrimmer.selectMedia')}
            </Button>

            <Button onClick={handleTrim} disabled={isProcessing} className="gradient-bg">
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('freeTools.mediaTrimmer.trimming')}
                </>
              ) : (
                <>
                  <Scissors className="h-4 w-4 mr-2" />
                  {t('freeTools.mediaTrimmer.trim')}
                </>
              )}
            </Button>

            {trimmedUrl && (
              <Button variant="outline" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                {t('common.download')}
              </Button>
            )}
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

          {/* Media preview */}
          <Card>
            <CardContent className="p-6 space-y-6">
              {/* Media element */}
              {mediaType === 'video' ? (
                <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                  <video
                    ref={mediaRef as React.RefObject<HTMLVideoElement>}
                    src={trimmedUrl || mediaUrl || undefined}
                    className="w-full h-full object-contain"
                    onLoadedMetadata={handleLoadedMetadata}
                    controls
                    playsInline
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                    <Music className="h-8 w-8 text-primary/60" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{mediaFile.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatBytes(mediaFile.size)}
                      </div>
                    </div>
                  </div>
                  <audio
                    ref={mediaRef as React.RefObject<HTMLAudioElement>}
                    src={trimmedUrl || mediaUrl || undefined}
                    onLoadedMetadata={handleLoadedMetadata}
                    className="w-full"
                    controls
                  />
                </div>
              )}

              {/* Time range slider */}
              {duration > 0 && (
                <TimeRangeSlider
                  duration={duration}
                  startTime={startTime}
                  endTime={endTime}
                  onStartChange={setStartTime}
                  onEndChange={setEndTime}
                />
              )}

              {/* Info */}
              <div className="flex flex-wrap gap-6 text-sm">
                <div>
                  <span className="text-muted-foreground">{t('freeTools.mediaTrimmer.originalDuration')}: </span>
                  <span className="font-medium">{formatDuration(duration)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('freeTools.mediaTrimmer.selectedDuration')}: </span>
                  <span className="font-medium text-primary">{formatDuration(endTime - startTime)}</span>
                </div>
                {trimmedBlob && (
                  <div>
                    <span className="text-muted-foreground">{t('freeTools.mediaTrimmer.trimmedSize')}: </span>
                    <span className="font-medium text-green-600 dark:text-green-400">
                      {formatBytes(trimmedBlob.size)}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Back Warning Dialog */}
      <AlertDialog open={showBackWarning} onOpenChange={setShowBackWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('freeTools.backWarning.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('freeTools.backWarning.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('freeTools.backWarning.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmBack}>
              {t('freeTools.backWarning.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
