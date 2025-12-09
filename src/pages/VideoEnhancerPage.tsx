import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUpscalerWorker } from '@/hooks/useUpscalerWorker'
import { useMultiPhaseProgress } from '@/hooks/useMultiPhaseProgress'
import { ProcessingProgress } from '@/components/shared/ProcessingProgress'
import { Muxer, ArrayBufferTarget } from 'webm-muxer'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ArrowLeft, Upload, Download, Loader2, Play, Square, X, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

type ModelType = 'slim' | 'medium' | 'thick'
type ScaleType = '2x' | '3x' | '4x'

// Phase configuration for video enhancer (model loading is cached by browser)
const PHASES = [
  { id: 'process', labelKey: 'freeTools.progress.processingFrames', weight: 0.9 },
  { id: 'encode', labelKey: 'freeTools.progress.encoding', weight: 0.08 },
  { id: 'finalize', labelKey: 'freeTools.progress.finalizing', weight: 0.02 }
]

export function VideoEnhancerPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const outputVideoRef = useRef<HTMLVideoElement>(null)
  const abortRef = useRef(false)
  const dragCounterRef = useRef(0)

  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [model, setModel] = useState<ModelType>('slim')
  const [scale, setScale] = useState<ScaleType>('2x')
  const [downloadFormat, setDownloadFormat] = useState<'webm' | 'mp4'>('mp4')
  const [supportedFormats, setSupportedFormats] = useState<{
    webm: boolean
    mp4: boolean
  }>({ webm: true, mp4: false })
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Multi-phase progress tracking
  const {
    progress,
    startPhase,
    updatePhase,
    completePhase,
    reset: resetProgress,
    resetAndStart,
    complete: completeAllPhases
  } = useMultiPhaseProgress({ phases: PHASES })

  const [error, setError] = useState<string | null>(null)

  const { loadModel, upscale, dispose, hasFailed, retryWorker } = useUpscalerWorker({
    onPhase: () => {
      // Model loading phases ignored - handled by browser caching
    },
    onProgress: () => {
      // Model loading progress ignored - handled by browser caching
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

  // Check supported video formats
  useEffect(() => {
    const webmSupported = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    const mp4Supported =
      MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') ||
      MediaRecorder.isTypeSupported('video/mp4')
    setSupportedFormats({ webm: webmSupported, mp4: mp4Supported })
    // Fallback to webm if mp4 is not supported (default is mp4)
    if (!mp4Supported) {
      setDownloadFormat('webm')
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl)
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
      abortRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith('video/')) return

      // Cleanup previous
      if (videoUrl) URL.revokeObjectURL(videoUrl)
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
      abortRef.current = true

      const url = URL.createObjectURL(file)
      setVideoFile(file)
      setVideoUrl(url)
      setDownloadUrl(null)
      resetProgress()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [videoUrl, downloadUrl, resetProgress]
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

  const startProcessing = async () => {
    if (!videoRef.current || !canvasRef.current) return

    abortRef.current = false
    setIsProcessing(true)
    resetAndStart('process')
    setDownloadUrl(null)

    try {
      // Load the selected model in worker (cached by browser after first download)
      await loadModel(model, scale)

      const video = videoRef.current
      const outputCanvas = canvasRef.current

      // Wait for video metadata
      await new Promise<void>((resolve) => {
        if (video.readyState >= 1) {
          resolve()
        } else {
          video.onloadedmetadata = () => resolve()
        }
      })

      // Get scale multiplier
      const scaleMultiplier = parseInt(scale.replace('x', ''))

      // Setup output canvas size
      outputCanvas.width = video.videoWidth * scaleMultiplier
      outputCanvas.height = video.videoHeight * scaleMultiplier
      const outputCtx = outputCanvas.getContext('2d')!

      // Create source canvas for extracting frames
      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = video.videoWidth
      sourceCanvas.height = video.videoHeight
      const sourceCtx = sourceCanvas.getContext('2d')!

      const duration = video.duration
      const targetFps = 30
      const frameInterval = 1 / targetFps
      const totalFrames = Math.ceil(duration * targetFps)

      video.pause()
      video.muted = true

      // Setup muxer
      const muxerTarget = new ArrayBufferTarget()
      const muxer = new Muxer({
        target: muxerTarget,
        video: {
          codec: 'V_VP9',
          width: outputCanvas.width,
          height: outputCanvas.height,
          frameRate: targetFps
        },
        firstTimestampBehavior: 'offset'
      })

      // Setup encoder
      let encodedFrames = 0
      const encoder = new VideoEncoder({
        output: (chunk, meta) => {
          encodedFrames++
          muxer.addVideoChunk(chunk, meta)
        },
        error: (e) => console.error('Encoder error:', e)
      })

      encoder.configure({
        codec: 'vp09.00.10.08',
        width: outputCanvas.width,
        height: outputCanvas.height,
        bitrate: 8_000_000,
        framerate: targetFps
      })

      console.log('Processing', totalFrames, 'frames at', targetFps, 'fps')

      // Process each frame
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        if (abortRef.current) {
          throw new Error('Aborted')
        }

        const currentTime = frameIndex * frameInterval

        // Seek to frame position
        video.currentTime = currentTime
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve()
        })

        // Draw video frame to source canvas
        sourceCtx.drawImage(video, 0, 0)

        // Get ImageData for worker
        const imageData = sourceCtx.getImageData(
          0,
          0,
          video.videoWidth,
          video.videoHeight
        )

        // Upscale with worker
        const upscaledDataUrl = await upscale(imageData)

        // Draw upscaled result to output canvas
        const upscaledImg = new Image()
        await new Promise<void>((resolve) => {
          upscaledImg.onload = () => {
            outputCtx.drawImage(upscaledImg, 0, 0)
            resolve()
          }
          upscaledImg.src = upscaledDataUrl
        })

        // Create video frame with correct timestamp
        const timestamp = Math.round(currentTime * 1_000_000) // microseconds
        const frame = new VideoFrame(outputCanvas, { timestamp })
        encoder.encode(frame, { keyFrame: frameIndex % 30 === 0 })
        frame.close()

        // Update progress with frame detail
        const frameProgress = ((frameIndex + 1) / totalFrames) * 100
        updatePhase('process', frameProgress, {
          current: frameIndex + 1,
          total: totalFrames,
          unit: 'frames'
        })

        if (frameIndex % 30 === 0) {
          console.log(`Frame ${frameIndex + 1}/${totalFrames}`)
        }
      }

      console.log('All frames processed:', encodedFrames)

      video.currentTime = 0
      completePhase('process')

      // Encoding phase
      startPhase('encode')
      await encoder.flush()
      encoder.close()
      completePhase('encode')

      // Finalize phase
      startPhase('finalize')
      muxer.finalize()
      const buffer = muxerTarget.buffer

      if (!buffer || buffer.byteLength === 0) {
        throw new Error('Encoder produced no output')
      }

      const finalBlob = new Blob([buffer], { type: 'video/webm' })
      console.log(
        'Final video size:',
        finalBlob.size,
        'bytes, frames:',
        encodedFrames
      )

      const url = URL.createObjectURL(finalBlob)
      console.log('Created blob URL:', url)
      setDownloadUrl(url)
      completeAllPhases()
      setIsProcessing(false)

      // Show output video
      if (outputVideoRef.current) {
        outputVideoRef.current.src = url
        outputVideoRef.current.load()
      }
    } catch (error) {
      if ((error as Error).message !== 'Aborted') {
        console.error('Failed to process video:', error)
      }
      setIsProcessing(false)
      // Reset video state on error
      if (videoRef.current) {
        videoRef.current.playbackRate = 1
        videoRef.current.pause()
      }
    } finally {
      dispose()
    }
  }

  const stopProcessing = () => {
    abortRef.current = true
    setIsProcessing(false)
    resetProgress()
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.playbackRate = 1
      videoRef.current.currentTime = 0
    }
  }

  const handleDownload = () => {
    if (!downloadUrl) return

    const extension =
      downloadFormat === 'mp4' && supportedFormats.mp4 ? 'mp4' : 'webm'
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = `enhanced-${videoFile?.name?.replace(/\.[^.]+$/, '') || 'video'}.${extension}`
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
      {/* Drag overlay for inner page */}
      {isDragging && videoUrl && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary rounded-lg m-4">
          <div className="text-center">
            <Upload className="h-12 w-12 text-primary mx-auto mb-2" />
            <p className="text-lg font-medium">
              {t('freeTools.videoEnhancer.orDragDrop')}
            </p>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/free-tools')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {t('freeTools.videoEnhancer.title')}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t('freeTools.videoEnhancer.description')}
          </p>
        </div>
      </div>

      {/* Upload area */}
      {!videoUrl && (
        <Card
          className={cn(
            'border-2 border-dashed cursor-pointer transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50'
          )}
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
        >
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium">
              {t('freeTools.videoEnhancer.selectVideo')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('freeTools.videoEnhancer.orDragDrop')}
            </p>
          </CardContent>
        </Card>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFileSelect(file)
        }}
      />

      {/* Video preview area */}
      {videoUrl && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('freeTools.videoEnhancer.selectVideo')}
            </Button>

            <Select
              value={model}
              onValueChange={(v) => setModel(v as ModelType)}
              disabled={isProcessing}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="slim">
                  {t('freeTools.videoEnhancer.modelFast')}
                </SelectItem>
                <SelectItem value="medium">
                  {t('freeTools.videoEnhancer.modelBalanced')}
                </SelectItem>
                <SelectItem value="thick">
                  {t('freeTools.videoEnhancer.modelQuality')}
                </SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={scale}
              onValueChange={(v) => setScale(v as ScaleType)}
              disabled={isProcessing}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2x">2x</SelectItem>
                <SelectItem value="3x">3x</SelectItem>
                <SelectItem value="4x">4x</SelectItem>
              </SelectContent>
            </Select>

            {!isProcessing ? (
              <Button onClick={startProcessing} className="gradient-bg">
                <Play className="h-4 w-4 mr-2" />
                {t('freeTools.videoEnhancer.start')}
              </Button>
            ) : (
              <Button variant="destructive" onClick={stopProcessing}>
                <Square className="h-4 w-4 mr-2" />
                {t('freeTools.videoEnhancer.stop')}
              </Button>
            )}

            {downloadUrl && (
              <>
                <Select
                  value={downloadFormat}
                  onValueChange={(v) => setDownloadFormat(v as 'webm' | 'mp4')}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {supportedFormats.mp4 && (
                      <SelectItem value="mp4">MP4</SelectItem>
                    )}
                    <SelectItem value="webm">WebM</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  {t('freeTools.videoEnhancer.download')}
                </Button>
              </>
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
              <span className="text-sm text-destructive">{t('common.downloadFailed')}</span>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.retry')}
              </Button>
            </div>
          )}

          {/* Side by side preview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Original */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">
                    {t('freeTools.videoEnhancer.original')}
                  </span>
                </div>
                <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className="w-full h-full object-contain"
                    controls={!isProcessing}
                    muted
                    playsInline
                  />
                </div>
              </CardContent>
            </Card>

            {/* Upscaled */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">
                    {t('freeTools.videoEnhancer.enhanced')}
                  </span>
                </div>
                <div
                  className={cn(
                    'relative aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center',
                    downloadUrl && 'cursor-pointer'
                  )}
                  onClick={() => downloadUrl && setShowPreview(true)}
                >
                  {downloadUrl ? (
                    <video
                      ref={outputVideoRef}
                      src={downloadUrl}
                      className="w-full h-full object-contain pointer-events-none"
                      playsInline
                      muted
                      autoPlay
                      loop
                    />
                  ) : (
                    !isProcessing && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                        <span className="text-sm">—</span>
                      </div>
                    )
                  )}
                  {/* Canvas for processing - visible during processing, hidden otherwise */}
                  <canvas
                    ref={canvasRef}
                    className={cn(
                      isProcessing
                        ? 'w-full h-full object-contain'
                        : 'absolute -left-[9999px] -top-[9999px]'
                    )}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Fullscreen Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent
          className="w-screen h-screen max-w-none max-h-none p-0 border-0 bg-black flex items-center justify-center"
          hideCloseButton
        >
          <DialogTitle className="sr-only">Fullscreen Preview</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-50 text-white hover:bg-white/20 h-10 w-10 [filter:drop-shadow(0_0_2px_rgba(0,0,0,0.8))_drop-shadow(0_0_4px_rgba(0,0,0,0.5))]"
            onClick={() => setShowPreview(false)}
          >
            <X className="h-6 w-6" />
          </Button>
          {downloadUrl && (
            <video
              src={downloadUrl}
              controls
              autoPlay
              className="max-w-full max-h-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
