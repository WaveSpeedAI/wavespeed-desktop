import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useFFmpegWorker } from '@/hooks/useFFmpegWorker'
import { useMultiPhaseProgress } from '@/hooks/useMultiPhaseProgress'
import { ProcessingProgress } from '@/components/shared/ProcessingProgress'
import {
  VIDEO_FORMATS,
  QUALITY_PRESETS,
  RESOLUTION_PRESETS,
  getVideoFormat,
  formatFileSize
} from '@/lib/ffmpegFormats'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
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
  FileVideo,
  RefreshCw
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Phase configuration for video converter
const PHASES = [
  { id: 'download', labelKey: 'freeTools.ffmpeg.loading', weight: 0.1 },
  { id: 'process', labelKey: 'freeTools.ffmpeg.converting', weight: 0.9 }
]

export function VideoConverterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const dragCounterRef = useRef(0)

  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoInfo, setVideoInfo] = useState<{
    duration: number
    width: number
    height: number
  } | null>(null)
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null)
  const [convertedBlob, setConvertedBlob] = useState<Blob | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [outputFormat, setOutputFormat] = useState('mp4-h264')
  const [quality, setQuality] = useState('medium')
  const [resolution, setResolution] = useState('original')
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

  const { convert, hasFailed, retryWorker } = useFFmpegWorker({
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

  const handleBack = useCallback(() => {
    if (isProcessing) {
      setShowBackWarning(true)
    } else {
      navigate('/free-tools')
    }
  }, [isProcessing, navigate])

  const handleConfirmBack = useCallback(() => {
    setShowBackWarning(false)
    navigate('/free-tools')
  }, [navigate])

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith('video/') && !file.name.match(/\.(mp4|webm|mov|avi|mkv|m4v|wmv|flv)$/i)) {
        return
      }

      // Clean up previous URLs
      if (videoUrl) URL.revokeObjectURL(videoUrl)
      if (convertedUrl) URL.revokeObjectURL(convertedUrl)

      const url = URL.createObjectURL(file)
      setVideoFile(file)
      setVideoUrl(url)
      setConvertedUrl(null)
      setConvertedBlob(null)
      resetProgress()

      // Get video info
      const video = document.createElement('video')
      video.addEventListener('loadedmetadata', () => {
        setVideoInfo({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight
        })
      })
      video.src = url
    },
    [videoUrl, convertedUrl, resetProgress]
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

  const handleConvert = async () => {
    if (!videoFile) return

    setIsProcessing(true)
    setError(null)
    setConvertedUrl(null)
    setConvertedBlob(null)
    resetAndStart('download')

    const format = getVideoFormat(outputFormat)
    if (!format) return

    const qualityPreset = QUALITY_PRESETS.find((q) => q.id === quality)
    const resolutionPreset = RESOLUTION_PRESETS.find((r) => r.id === resolution)

    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await videoFile.arrayBuffer()

      // Convert using FFmpeg worker
      const result = await convert(arrayBuffer, videoFile.name, outputFormat, format.ext, {
        videoCodec: format.codec,
        videoBitrate: qualityPreset?.videoBitrate,
        audioBitrate: qualityPreset?.audioBitrate,
        resolution: resolutionPreset?.value
      })

      // Create blob and URL
      const blob = new Blob([result.data], { type: format.mimeType })
      const url = URL.createObjectURL(blob)

      setConvertedBlob(blob)
      setConvertedUrl(url)
      completeAllPhases()
    } catch (err) {
      console.error('Conversion failed:', err)
      setError(err instanceof Error ? err.message : 'Conversion failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDownload = () => {
    if (!convertedUrl || !convertedBlob || !videoFile) return

    const format = getVideoFormat(outputFormat)
    const filename = videoFile.name.replace(/\.[^.]+$/, `.${format?.ext || 'mp4'}`)

    const link = document.createElement('a')
    link.href = convertedUrl
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
      {isDragging && videoFile && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary rounded-lg m-4">
          <div className="text-center">
            <Upload className="h-12 w-12 text-primary mx-auto mb-2" />
            <p className="text-lg font-medium">{t('freeTools.videoConverter.dropToReplace')}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{t('freeTools.videoConverter.title')}</h1>
          <p className="text-muted-foreground text-sm">
            {t('freeTools.videoConverter.description')}
          </p>
        </div>
      </div>

      {/* Upload area */}
      {!videoFile && (
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
            <p className="text-lg font-medium">{t('freeTools.videoConverter.selectVideo')}</p>
            <p className="text-sm text-muted-foreground">
              {t('freeTools.videoConverter.orDragDrop')}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t('freeTools.videoConverter.supportedFormats')}
            </p>
          </CardContent>
        </Card>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mp4,.webm,.mov,.avi,.mkv,.m4v,.wmv,.flv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFileSelect(file)
          e.target.value = ''
        }}
      />

      {/* Video preview and controls */}
      {videoFile && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('freeTools.videoConverter.selectVideo')}
            </Button>

            <Select value={outputFormat} onValueChange={setOutputFormat} disabled={isProcessing}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIDEO_FORMATS.map((format) => (
                  <SelectItem key={format.id} value={format.id}>
                    {format.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={quality} onValueChange={setQuality} disabled={isProcessing}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUALITY_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={resolution} onValueChange={setResolution} disabled={isProcessing}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTION_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button onClick={handleConvert} disabled={isProcessing} className="gradient-bg">
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('freeTools.videoConverter.converting')}
                </>
              ) : (
                <>
                  <FileVideo className="h-4 w-4 mr-2" />
                  {t('freeTools.videoConverter.convert')}
                </>
              )}
            </Button>

            {convertedUrl && (
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

          {/* Side by side video preview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Original video */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">
                    {t('freeTools.videoConverter.original')}
                  </span>
                  {videoInfo && (
                    <span className="text-xs text-muted-foreground">
                      {videoInfo.width}x{videoInfo.height} • {formatFileSize(videoFile.size)}
                    </span>
                  )}
                </div>
                <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                  <video
                    ref={videoRef}
                    src={videoUrl || undefined}
                    className="w-full h-full object-contain"
                    controls
                    playsInline
                  />
                </div>
              </CardContent>
            </Card>

            {/* Converted video */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">
                    {t('freeTools.videoConverter.converted')}
                  </span>
                  {convertedBlob && (
                    <span className="text-xs text-green-600 dark:text-green-400">
                      {formatFileSize(convertedBlob.size)}
                    </span>
                  )}
                </div>
                <div className="relative aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center">
                  {convertedUrl ? (
                    <video
                      src={convertedUrl}
                      className="w-full h-full object-contain"
                      controls
                      playsInline
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <FileVideo className="h-10 w-10 mb-2 opacity-30" />
                      <span className="text-sm">{t('freeTools.videoConverter.outputSettings')}</span>
                      <div className="text-xs mt-2 space-y-1 text-center">
                        <div>{VIDEO_FORMATS.find((f) => f.id === outputFormat)?.label}</div>
                        <div>{QUALITY_PRESETS.find((q) => q.id === quality)?.label} • {RESOLUTION_PRESETS.find((r) => r.id === resolution)?.label}</div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
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
