import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Mic, Square, X, RotateCcw, Check, Loader2, Play, Pause } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AudioRecorderProps {
  onRecord: (blob: Blob) => void
  onClose: () => void
  disabled?: boolean
}

export function AudioRecorder({ onRecord, onClose, disabled }: AudioRecorderProps) {
  const { t } = useTranslation()
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationRef = useRef<number | null>(null)

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isMicReady, setIsMicReady] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)

  // Refs for cleanup
  const mountedRef = useRef(true)

  // Draw waveform visualization
  const drawWaveform = (analyser: AnalyserNode) => {
    if (!canvasRef.current || !mountedRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Get computed colors from CSS variables
    const computedStyle = getComputedStyle(document.documentElement)
    const mutedColor = computedStyle.getPropertyValue('--muted').trim()
    const primaryColor = computedStyle.getPropertyValue('--primary').trim()

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const draw = () => {
      if (!mountedRef.current) return
      const animId = requestAnimationFrame(draw)
      animationRef.current = animId

      analyser.getByteTimeDomainData(dataArray)

      // Use computed colors or fallback
      ctx.fillStyle = mutedColor ? `hsl(${mutedColor})` : '#1f1f23'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.lineWidth = 2
      ctx.strokeStyle = primaryColor ? `hsl(${primaryColor})` : '#3b82f6'
      ctx.beginPath()

      const sliceWidth = canvas.width / bufferLength
      let x = 0

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0
        const y = (v * canvas.height) / 2

        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }

        x += sliceWidth
      }

      ctx.lineTo(canvas.width, canvas.height / 2)
      ctx.stroke()
    }

    draw()
  }

  // Request microphone access (called when user clicks record)
  const requestMicrophoneAccess = async () => {
    if (isMicReady || isLoading) return true // Already ready or loading

    setIsLoading(true)
    setError(null)

    try {
      // Check if mediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('Microphone error: mediaDevices API not available')
        setError(t('playground.capture.micError'))
        setIsLoading(false)
        return false
      }

      console.log('[AudioRecorder] Requesting microphone access...')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      })
      console.log('[AudioRecorder] Microphone access granted')

      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop())
        return false
      }

      streamRef.current = stream

      // Set up audio analyzer for waveform
      const audioContext = new AudioContext()
      audioContextRef.current = audioContext

      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }

      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      analyserRef.current = analyser

      setIsLoading(false)
      setIsMicReady(true)

      // Start waveform after a short delay to ensure canvas is rendered
      setTimeout(() => {
        if (mountedRef.current && analyserRef.current) {
          drawWaveform(analyserRef.current)
        }
      }, 100)

      return true
    } catch (err) {
      if (!mountedRef.current) return false

      console.error('Microphone error:', err)
      console.error('Error name:', err instanceof Error ? err.name : 'unknown')
      console.error('Error message:', err instanceof Error ? err.message : String(err))

      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setError(t('playground.capture.micPermissionDenied'))
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setError(t('playground.capture.noMicFound'))
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          // Device is already in use or hardware error
          setError(t('playground.capture.micInUse'))
        } else if (err.name === 'OverconstrainedError') {
          // Constraints cannot be satisfied
          setError(t('playground.capture.noMicFound'))
        } else if (err.name === 'SecurityError') {
          // Insecure context (non-HTTPS)
          setError(t('playground.capture.micPermissionDenied'))
        } else {
          setError(t('playground.capture.micError'))
        }
      } else {
        setError(t('playground.capture.micError'))
      }
      setIsLoading(false)
      return false
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [])

  // Cleanup recorded URL on unmount
  useEffect(() => {
    return () => {
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl)
      }
    }
  }, [recordedUrl])

  const startRecording = async () => {
    // Request microphone access if not ready
    if (!isMicReady) {
      const success = await requestMicrophoneAccess()
      if (!success) return
    }

    if (!streamRef.current) return

    chunksRef.current = []
    setDuration(0)

    // Determine supported MIME type
    const mimeTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4'
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
      const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
      const url = URL.createObjectURL(blob)
      setRecordedBlob(blob)
      setRecordedUrl(url)

      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }

    mediaRecorderRef.current = mediaRecorder
    mediaRecorder.start(100) // Collect data every 100ms for better granularity
    setIsRecording(true)

    timerRef.current = setInterval(() => {
      setDuration(prev => prev + 1)
    }, 1000)
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const restartWaveform = () => {
    if (!analyserRef.current || !canvasRef.current) return

    const analyser = analyserRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Get computed colors from CSS variables
    const computedStyle = getComputedStyle(document.documentElement)
    const mutedColor = computedStyle.getPropertyValue('--muted').trim()
    const primaryColor = computedStyle.getPropertyValue('--primary').trim()

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw)
      analyser.getByteTimeDomainData(dataArray)

      ctx.fillStyle = mutedColor ? `hsl(${mutedColor})` : '#1f1f23'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.lineWidth = 2
      ctx.strokeStyle = primaryColor ? `hsl(${primaryColor})` : '#3b82f6'
      ctx.beginPath()

      const sliceWidth = canvas.width / bufferLength
      let x = 0

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0
        const y = (v * canvas.height) / 2

        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }

        x += sliceWidth
      }

      ctx.lineTo(canvas.width, canvas.height / 2)
      ctx.stroke()
    }

    draw()
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
    setAudioDuration(0)
    // Restart waveform after state update
    setTimeout(() => {
      restartWaveform()
    }, 50)
  }

  const togglePlayback = () => {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
    }
  }

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const dur = audioRef.current.duration
      // WebM files often have Infinity duration, use recorded duration as fallback
      if (isFinite(dur) && dur > 0) {
        setAudioDuration(dur)
      } else {
        setAudioDuration(duration)
      }
    }
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !audioDuration) return

    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percentage = clickX / rect.width
    const newTime = percentage * audioDuration

    audioRef.current.currentTime = newTime
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
      <div className="relative rounded-lg overflow-hidden bg-muted p-4">
        {isLoading && (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-24">
            <p className="text-sm text-destructive text-center">{error}</p>
          </div>
        )}

        {!isLoading && !error && (
          <div className="space-y-3">
            {/* Waveform visualization or audio player */}
            {!recordedUrl ? (
              isMicReady ? (
                <canvas
                  ref={canvasRef}
                  width={400}
                  height={80}
                  className="w-full h-20 rounded bg-muted"
                />
              ) : (
                <div className="flex items-center justify-center h-20 rounded bg-muted">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mic className="h-5 w-5" />
                    <span className="text-sm">{t('playground.capture.tapToRecord')}</span>
                  </div>
                </div>
              )
            ) : (
              <div className="bg-background rounded-lg p-4 space-y-3">
                <audio
                  ref={audioRef}
                  src={recordedUrl}
                  onEnded={() => setIsPlaying(false)}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  className="hidden"
                />

                {/* Waveform-style progress bar */}
                <div
                  className="relative h-12 bg-muted/50 rounded-lg cursor-pointer overflow-hidden"
                  onClick={handleSeek}
                >
                  {/* Background bars */}
                  <div className="absolute inset-0 flex items-center gap-[2px] px-2">
                    {Array.from({ length: 50 }).map((_, i) => {
                      // Deterministic "random" heights based on index
                      const h = 25 + Math.sin(i * 0.8) * 20 + Math.cos(i * 1.3) * 15 + (i % 3) * 10
                      return (
                        <div
                          key={i}
                          className="flex-1 bg-muted-foreground/20 rounded-sm"
                          style={{ height: `${Math.min(90, Math.max(15, h))}%` }}
                        />
                      )
                    })}
                  </div>

                  {/* Progress overlay */}
                  <div
                    className="absolute inset-y-0 left-0 overflow-hidden"
                    style={{ width: audioDuration ? `${(currentTime / audioDuration) * 100}%` : '0%' }}
                  >
                    <div className="absolute inset-0 flex items-center gap-[2px] px-2">
                      {Array.from({ length: 50 }).map((_, i) => {
                        const h = 25 + Math.sin(i * 0.8) * 20 + Math.cos(i * 1.3) * 15 + (i % 3) * 10
                        return (
                          <div
                            key={i}
                            className="flex-1 bg-primary rounded-sm"
                            style={{ height: `${Math.min(90, Math.max(15, h))}%` }}
                          />
                        )
                      })}
                    </div>
                  </div>

                  {/* Playhead */}
                  <div
                    className="absolute top-1 bottom-1 w-1 bg-primary rounded-full shadow-lg"
                    style={{ left: `calc(${audioDuration ? (currentTime / audioDuration) * 100 : 0}% - 2px)` }}
                  />
                </div>

                {/* Controls row */}
                <div className="flex items-center gap-4">
                  {/* Play/Pause button */}
                  <button
                    onClick={togglePlayback}
                    className="h-12 w-12 rounded-full bg-primary hover:bg-primary/90 flex items-center justify-center transition-colors shadow-lg"
                  >
                    {isPlaying ? (
                      <Pause className="h-5 w-5 text-primary-foreground" />
                    ) : (
                      <Play className="h-5 w-5 text-primary-foreground ml-0.5" />
                    )}
                  </button>

                  {/* Time display */}
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-sm font-mono text-foreground">
                      {formatTime(currentTime)}
                    </span>
                    <span className="text-sm font-mono text-muted-foreground">
                      {formatTime(audioDuration || duration)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Recording indicator */}
            {isRecording && (
              <div className="flex items-center justify-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-mono">{formatDuration(duration)}</span>
              </div>
            )}
          </div>
        )}

        {/* Close button */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-8 w-8"
          onClick={handleClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2">
        {!recordedUrl ? (
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
            {isRecording ? (
              <Square className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </Button>
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
              {t('playground.capture.useAudio')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
