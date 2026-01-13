import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNativeMediaTrimmer } from '@mobile/hooks/useNativeMediaTrimmer'
import { useMobileDownload } from '@mobile/hooks/useMobileDownload'
import { formatDuration, formatFileSize, getMediaType } from '@mobile/lib/ffmpegFormats'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'

// Helper to format time as mm:ss.d for input
function formatTimeForInput(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`
}

// Parse time from mm:ss.d or just seconds format
function parseTimeInput(input: string, maxDuration: number): number | null {
  const trimmed = input.trim()

  // Try mm:ss.d format
  const colonMatch = trimmed.match(/^(\d+):(\d+\.?\d*)$/)
  if (colonMatch) {
    const mins = parseInt(colonMatch[1], 10)
    const secs = parseFloat(colonMatch[2])
    const total = mins * 60 + secs
    if (!isNaN(total) && total >= 0 && total <= maxDuration) {
      return total
    }
    return null
  }

  // Try plain seconds format
  const seconds = parseFloat(trimmed)
  if (!isNaN(seconds) && seconds >= 0 && seconds <= maxDuration) {
    return seconds
  }

  return null
}
import {
  ArrowLeft,
  Upload,
  Download,
  Loader2,
  Scissors,
  X,
  AlertCircle,
  FileVideo,
  FileAudio
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function MediaTrimmerPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { downloadBlob } = useMobileDownload()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null)
  const resultVideoRef = useRef<HTMLVideoElement>(null)

  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<'video' | 'audio' | null>(null)
  const [duration, setDuration] = useState(0)
  const [startTime, setStartTime] = useState(0)
  const [endTime, setEndTime] = useState(0)
  const [trimmedUrl, setTrimmedUrl] = useState<string | null>(null)
  const [trimmedBlob, setTrimmedBlob] = useState<Blob | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Text input state for editable time inputs
  const [startTimeInput, setStartTimeInput] = useState('')
  const [endTimeInput, setEndTimeInput] = useState('')
  const [isStartFocused, setIsStartFocused] = useState(false)
  const [isEndFocused, setIsEndFocused] = useState(false)

  // Use native browser APIs for trimming (no FFmpeg needed)
  const { trim } = useNativeMediaTrimmer()

  const handleFileSelect = useCallback((file: File) => {
    const type = getMediaType(file)
    if (type !== 'video' && type !== 'audio') {
      setError(t('freeTools.mediaTrimmer.invalidFile', 'Please select a valid video or audio file'))
      return
    }

    // Clean up previous URLs
    if (mediaUrl) URL.revokeObjectURL(mediaUrl)
    if (trimmedUrl) URL.revokeObjectURL(trimmedUrl)

    const url = URL.createObjectURL(file)
    setMediaFile(file)
    setMediaUrl(url)
    setMediaType(type)
    setTrimmedUrl(null)
    setTrimmedBlob(null)
    setError(null)
    setProgress(0)
    setStartTime(0)
    setEndTime(0)
  }, [mediaUrl, trimmedUrl, t])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (isProcessing) return
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect, isProcessing])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileSelect(file)
    e.target.value = ''
  }, [handleFileSelect])

  const clearInput = useCallback(() => {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl)
    if (trimmedUrl) URL.revokeObjectURL(trimmedUrl)
    setMediaFile(null)
    setMediaUrl(null)
    setMediaType(null)
    setDuration(0)
    setStartTime(0)
    setEndTime(0)
    setStartTimeInput('0:00.0')
    setEndTimeInput('0:00.0')
    setTrimmedUrl(null)
    setTrimmedBlob(null)
    setError(null)
    setProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [mediaUrl, trimmedUrl])

  // Update duration when media loads
  useEffect(() => {
    if (mediaRef.current && mediaUrl) {
      const media = mediaRef.current
      const handleLoaded = () => {
        setDuration(media.duration)
        setStartTime(0)
        setEndTime(media.duration)
        // Initialize text inputs
        setStartTimeInput(formatTimeForInput(0))
        setEndTimeInput(formatTimeForInput(media.duration))
      }
      media.addEventListener('loadedmetadata', handleLoaded)
      return () => media.removeEventListener('loadedmetadata', handleLoaded)
    }
  }, [mediaUrl])

  const handleTrim = async () => {
    if (!mediaFile || !mediaType || startTime >= endTime) return

    setIsProcessing(true)
    setError(null)
    setTrimmedUrl(null)
    setTrimmedBlob(null)
    setProgress(0)

    try {
      // Use native browser APIs for trimming (no FFmpeg download needed)
      const result = await trim(
        mediaFile,
        startTime,
        endTime,
        mediaType,
        {
          onProgress: (p) => setProgress(Math.round(p))
        }
      )

      const url = URL.createObjectURL(result.blob)

      setTrimmedBlob(result.blob)
      setTrimmedUrl(url)
      setProgress(100)
    } catch (err) {
      console.error('Trim failed:', err)
      setError(err instanceof Error ? err.message : 'Trim failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDownload = async () => {
    if (!trimmedBlob || !mediaFile) return

    // Determine extension from blob type
    const blobType = trimmedBlob.type
    let ext = 'mp4'
    if (blobType.includes('webm')) ext = 'webm'
    else if (blobType.includes('mp3') || blobType.includes('mpeg')) ext = 'mp3'
    else if (blobType.includes('wav')) ext = 'wav'

    const baseName = mediaFile.name.replace(/\.[^.]+$/, '')
    const filename = `${baseName}_trimmed.${ext}`

    await downloadBlob(trimmedBlob, filename)
  }

  const handleSliderChange = (values: number[]) => {
    setStartTime(values[0])
    setEndTime(values[1])
    // Update text inputs when slider changes (if not focused)
    if (!isStartFocused) {
      setStartTimeInput(formatTimeForInput(values[0]))
    }
    if (!isEndFocused) {
      setEndTimeInput(formatTimeForInput(values[1]))
    }
  }

  // Sync text inputs when times change externally (e.g., from slider)
  useEffect(() => {
    if (!isStartFocused) {
      setStartTimeInput(formatTimeForInput(startTime))
    }
  }, [startTime, isStartFocused])

  useEffect(() => {
    if (!isEndFocused) {
      setEndTimeInput(formatTimeForInput(endTime))
    }
  }, [endTime, isEndFocused])

  // Handle start time input blur - validate and apply
  const handleStartTimeBlur = () => {
    setIsStartFocused(false)
    const parsed = parseTimeInput(startTimeInput, duration)
    if (parsed !== null && parsed < endTime) {
      setStartTime(parsed)
    } else {
      // Revert to current value if invalid
      setStartTimeInput(formatTimeForInput(startTime))
    }
  }

  // Handle end time input blur - validate and apply
  const handleEndTimeBlur = () => {
    setIsEndFocused(false)
    const parsed = parseTimeInput(endTimeInput, duration)
    if (parsed !== null && parsed > startTime) {
      setEndTime(parsed)
    } else {
      // Revert to current value if invalid
      setEndTimeInput(formatTimeForInput(endTime))
    }
  }

  const trimDuration = endTime - startTime
  const MediaIcon = mediaType === 'video' ? FileVideo : FileAudio

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/free-tools')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{t('freeTools.mediaTrimmer.title')}</h1>
          <p className="text-muted-foreground text-xs">
            {t('freeTools.mediaTrimmer.description')}
          </p>
        </div>
      </div>

      {/* Input Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            {t('freeTools.mediaTrimmer.inputMedia', 'Input Media')}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('freeTools.mediaTrimmer.supportedFormats', 'MP4, WebM, MOV, AVI, MP3, WAV, OGG')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!mediaFile ? (
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                "hover:border-primary hover:bg-primary/5"
              )}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <Scissors className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-1">
                {t('freeTools.mediaTrimmer.selectMedia', 'Click or drag video/audio here')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {mediaType === 'video' ? (
                <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                  <video
                    ref={mediaRef as React.RefObject<HTMLVideoElement>}
                    src={mediaUrl!}
                    className="w-full h-full object-contain"
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedData={() => {
                      const video = mediaRef.current as HTMLVideoElement
                      if (video && video.currentTime === 0) {
                        video.currentTime = 0.001
                      }
                    }}
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-7 w-7"
                    onClick={clearInput}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <MediaIcon className="h-8 w-8 text-primary flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{mediaFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(mediaFile.size)} • {formatDuration(duration)}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={clearInput} className="flex-shrink-0">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <audio
                    ref={mediaRef as React.RefObject<HTMLAudioElement>}
                    src={mediaUrl!}
                    controls
                    className="w-full h-10"
                  />
                </div>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={handleInputChange}
          />
        </CardContent>
      </Card>

      {/* Settings */}
      {mediaFile && duration > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('freeTools.mediaTrimmer.trimSettings', 'Trim Settings')}</CardTitle>
            <CardDescription className="text-xs">
              {t('freeTools.mediaTrimmer.selectRange', 'Select start and end time')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Time Range Slider */}
            <div className="space-y-2">
              <Slider
                value={[startTime, endTime]}
                onValueChange={handleSliderChange}
                min={0}
                max={duration}
                step={0.1}
                disabled={isProcessing}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{formatDuration(0)}</span>
                <span>{formatDuration(duration)}</span>
              </div>
            </div>

            {/* Time inputs */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('freeTools.mediaTrimmer.startTime', 'Start Time')}</Label>
                <Input
                  type="text"
                  value={startTimeInput}
                  onChange={(e) => setStartTimeInput(e.target.value)}
                  onFocus={() => setIsStartFocused(true)}
                  onBlur={handleStartTimeBlur}
                  placeholder="0:00.0"
                  disabled={isProcessing}
                  className="h-9 text-sm font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  {t('freeTools.mediaTrimmer.timeFormat', 'Format: m:ss.d or seconds')}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('freeTools.mediaTrimmer.endTime', 'End Time')}</Label>
                <Input
                  type="text"
                  value={endTimeInput}
                  onChange={(e) => setEndTimeInput(e.target.value)}
                  onFocus={() => setIsEndFocused(true)}
                  onBlur={handleEndTimeBlur}
                  placeholder="0:00.0"
                  disabled={isProcessing}
                  className="h-9 text-sm font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  {t('freeTools.mediaTrimmer.timeFormat', 'Format: m:ss.d or seconds')}
                </p>
              </div>
            </div>

            <div className="text-sm text-center text-muted-foreground">
              {t('freeTools.mediaTrimmer.outputDuration', 'Output duration')}: <span className="font-medium">{formatDuration(trimDuration)}</span>
            </div>

            <Button
              className="w-full"
              onClick={handleTrim}
              disabled={isProcessing || startTime >= endTime}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('freeTools.mediaTrimmer.trimming', 'Trimming...')}
                </>
              ) : (
                <>
                  <Scissors className="mr-2 h-4 w-4" />
                  {t('freeTools.mediaTrimmer.trim', 'Trim Media')}
                </>
              )}
            </Button>

            {isProcessing && (
              <div className="space-y-2">
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-center text-muted-foreground">{progress}%</p>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {trimmedUrl && trimmedBlob && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4" />
              {t('freeTools.mediaTrimmer.result', 'Trimmed Result')}
            </CardTitle>
            <CardDescription className="text-xs">
              {formatDuration(trimDuration)} • {formatFileSize(trimmedBlob.size)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {mediaType === 'video' ? (
              <div className="aspect-video bg-black rounded-lg overflow-hidden">
                <video
                  ref={resultVideoRef}
                  src={trimmedUrl}
                  className="w-full h-full object-contain"
                  controls
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={() => {
                    if (resultVideoRef.current && resultVideoRef.current.currentTime === 0) {
                      resultVideoRef.current.currentTime = 0.001
                    }
                  }}
                />
              </div>
            ) : (
              <audio src={trimmedUrl} controls className="w-full h-10" />
            )}
            <Button className="w-full" onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              {t('common.download', 'Download')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
