import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { X, RotateCcw, Check, Loader2, Play, Pause, Video } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoRecorderProps {
  onRecord: (blob: Blob) => void
  onClose: () => void
  disabled?: boolean
}

export function VideoRecorder({ onRecord, onClose, disabled }: VideoRecorderProps) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationRef = useRef<number | null>(null)

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment')
  const [audioLevel, setAudioLevel] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)

  const drawWaveform = useCallback(() => {
    if (!canvasRef.current || !analyserRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const analyser = analyserRef.current
    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw)
      analyser.getByteFrequencyData(dataArray)

      // Calculate average audio level
      const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength
      setAudioLevel(average / 255)

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Draw bars
      const barCount = 32
      const barWidth = canvas.width / barCount
      const barGap = 2

      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor(i * bufferLength / barCount)
        const barHeight = (dataArray[dataIndex] / 255) * canvas.height

        ctx.fillStyle = `rgba(59, 130, 246, ${0.5 + (dataArray[dataIndex] / 255) * 0.4})`
        ctx.fillRect(
          i * barWidth + barGap / 2,
          canvas.height - barHeight,
          barWidth - barGap,
          barHeight
        )
      }
    }

    draw()
  }, [])

  useEffect(() => {
    let mounted = true
    let localStream: MediaStream | null = null
    let localAudioContext: AudioContext | null = null

    const startCamera = async () => {
      setIsLoading(true)
      setError(null)

      // Stop any existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: true
        })

        if (!mounted) {
          // Component unmounted while waiting for permission
          stream.getTracks().forEach(track => track.stop())
          return
        }

        localStream = stream
        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          try {
            await videoRef.current.play()
          } catch (playErr) {
            if (playErr instanceof Error && playErr.name === 'AbortError') {
              return
            }
            throw playErr
          }
        }

        // Set up audio analyzer for waveform
        const audioContext = new AudioContext()
        localAudioContext = audioContext
        audioContextRef.current = audioContext
        // Ensure AudioContext is running (browsers may start it suspended)
        if (audioContext.state === 'suspended') {
          await audioContext.resume()
        }
        const source = audioContext.createMediaStreamSource(stream)
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyserRef.current = analyser
      } catch (err) {
        if (!mounted) return

        console.error('Camera/mic error:', err)
        if (err instanceof Error) {
          if (err.name === 'NotAllowedError') {
            setError(t('playground.capture.cameraPermissionDenied'))
          } else if (err.name === 'NotFoundError') {
            setError(t('playground.capture.noCameraFound'))
          } else {
            setError(t('playground.capture.cameraError'))
          }
        } else {
          setError(t('playground.capture.cameraError'))
        }
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    startCamera()

    return () => {
      mounted = false
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop())
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      if (localAudioContext) {
        localAudioContext.close()
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
    }
  }, [facingMode, t])

  // Start waveform when recording starts
  useEffect(() => {
    if (isRecording) {
      // Small delay to ensure canvas is rendered
      const timeout = setTimeout(() => {
        drawWaveform()
      }, 50)
      return () => clearTimeout(timeout)
    }
  }, [isRecording, drawWaveform])

  // Cleanup recorded URL on unmount
  useEffect(() => {
    return () => {
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl)
      }
    }
  }, [recordedUrl])

  const switchCamera = async () => {
    if (isRecording) return
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user')
  }

  const startRecording = () => {
    if (!streamRef.current) return

    chunksRef.current = []
    setDuration(0)

    // Determine supported MIME type
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ]

    let mimeType = ''
    for (const type of mimeTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        mimeType = type
        break
      }
    }

    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType: mimeType || undefined
    })

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data)
      }
    }

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' })
      const url = URL.createObjectURL(blob)
      setRecordedBlob(blob)
      setRecordedUrl(url)

      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }

    mediaRecorderRef.current = mediaRecorder
    mediaRecorder.start(1000) // Collect data every second
    setIsRecording(true)

    // Start timer
    timerRef.current = setInterval(() => {
      setDuration(prev => prev + 1)
    }, 1000)
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }

  const retake = () => {
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl)
    }
    setRecordedBlob(null)
    setRecordedUrl(null)
    setDuration(0)
    setIsPlaying(false)
    setCurrentTime(0)
    setVideoDuration(0)
  }

  const togglePlayback = () => {
    if (!previewRef.current) return

    if (isPlaying) {
      previewRef.current.pause()
    } else {
      previewRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }

  const handleTimeUpdate = () => {
    if (previewRef.current) {
      setCurrentTime(previewRef.current.currentTime)
    }
  }

  const handleLoadedMetadata = () => {
    if (previewRef.current) {
      const dur = previewRef.current.duration
      // WebM files often have Infinity duration, use recorded duration as fallback
      if (isFinite(dur) && dur > 0) {
        setVideoDuration(dur)
      } else {
        setVideoDuration(duration)
      }
    }
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!previewRef.current || !videoDuration) return

    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percentage = clickX / rect.width
    const newTime = percentage * videoDuration

    previewRef.current.currentTime = newTime
    setCurrentTime(newTime)
  }

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) {
      return '0:00'
    }
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const confirmRecording = () => {
    if (recordedBlob) {
      onRecord(recordedBlob)
    }
  }

  const handleClose = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
    }
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl)
    }
    onClose()
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="space-y-3">
      <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted p-4">
            <p className="text-sm text-destructive text-center">{error}</p>
          </div>
        )}

        {/* Live camera preview */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={cn(
            "w-full h-full object-cover",
            facingMode === 'user' && "scale-x-[-1]",
            recordedUrl && "hidden"
          )}
        />

        {/* Recorded video preview */}
        {recordedUrl && (
          <>
            <video
              ref={previewRef}
              src={recordedUrl}
              className="w-full h-full object-cover"
              onClick={togglePlayback}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={() => setIsPlaying(false)}
            />
            {/* Play/Pause overlay button */}
            <button
              onClick={togglePlayback}
              className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors"
            >
              <div className="h-16 w-16 rounded-full bg-black/50 flex items-center justify-center">
                {isPlaying ? (
                  <Pause className="h-8 w-8 text-white" />
                ) : (
                  <Play className="h-8 w-8 text-white ml-1" />
                )}
              </div>
            </button>
            {/* Progress bar and time */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
              <div
                className="h-1 bg-white/30 rounded-full overflow-hidden cursor-pointer mb-1"
                onClick={handleSeek}
              >
                <div
                  className="h-full bg-white transition-all duration-100"
                  style={{ width: videoDuration ? `${(currentTime / videoDuration) * 100}%` : '0%' }}
                />
              </div>
              <div className="flex justify-between text-white text-xs font-mono">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(videoDuration)}</span>
              </div>
            </div>
          </>
        )}

        {/* Recording indicator and audio waveform */}
        {isRecording && (
          <>
            <div className="absolute top-2 left-2 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-white text-sm font-mono">{formatDuration(duration)}</span>
            </div>
            {/* Audio waveform overlay */}
            <canvas
              ref={canvasRef}
              width={320}
              height={40}
              className="absolute bottom-2 left-2 right-2 h-8 rounded bg-black/30"
              style={{ width: 'calc(100% - 16px)' }}
            />
          </>
        )}

        {/* Close button */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-8 w-8 bg-black/50 hover:bg-black/70 text-white"
          onClick={handleClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2">
        {!recordedUrl ? (
          <>
            <Button
              variant="outline"
              size="icon"
              onClick={switchCamera}
              disabled={isLoading || !!error || disabled || isRecording}
              title={t('playground.capture.switchCamera')}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isLoading || !!error || disabled}
              className={cn(
                "h-12 w-12 rounded-full transition-colors text-white",
                isRecording
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-primary hover:bg-primary/90"
              )}
              title={isRecording ? t('playground.capture.stopRecording') : t('playground.capture.startRecording')}
            >
              {!isRecording && <Video className="h-5 w-5" />}
            </Button>
            <div className="w-9" /> {/* Spacer for centering */}
          </>
        ) : (
          <>
            <Button
              variant="outline"
              onClick={retake}
              disabled={disabled}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {t('playground.capture.retake')}
            </Button>
            <Button
              onClick={confirmRecording}
              disabled={disabled}
            >
              <Check className="h-4 w-4 mr-2" />
              {t('playground.capture.useVideo')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
