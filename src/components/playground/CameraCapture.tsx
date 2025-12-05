import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { X, RotateCcw, Check, Loader2, Camera } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CameraCaptureProps {
  onCapture: (blob: Blob) => void
  onClose: () => void
  disabled?: boolean
}

export function CameraCapture({ onCapture, onClose, disabled }: CameraCaptureProps) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment')

  useEffect(() => {
    let mounted = true

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
          audio: false
        })

        if (!mounted) {
          // Component unmounted while waiting for permission
          stream.getTracks().forEach(track => track.stop())
          return
        }

        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          try {
            await videoRef.current.play()
          } catch (playErr) {
            // AbortError is expected when component re-renders during play
            if (playErr instanceof Error && playErr.name === 'AbortError') {
              return
            }
            throw playErr
          }
        }
      } catch (err) {
        if (!mounted) return

        console.error('Camera error:', err)
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
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
    }
  }, [facingMode, t])

  const switchCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user')
  }

  const takePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Flip horizontally if using front camera
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }

    ctx.drawImage(video, 0, 0)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    setCapturedImage(dataUrl)
  }

  const retake = () => {
    setCapturedImage(null)
  }

  const confirmCapture = () => {
    if (!canvasRef.current) return

    canvasRef.current.toBlob((blob) => {
      if (blob) {
        onCapture(blob)
      }
    }, 'image/jpeg', 0.9)
  }

  const handleClose = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
    }
    onClose()
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
            capturedImage && "hidden"
          )}
        />

        {/* Captured image preview */}
        {capturedImage && (
          <img
            src={capturedImage}
            alt="Captured"
            className="w-full h-full object-cover"
          />
        )}

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />

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
        {!capturedImage ? (
          <>
            <Button
              variant="outline"
              size="icon"
              onClick={switchCamera}
              disabled={isLoading || !!error || disabled}
              title={t('playground.capture.switchCamera')}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              onClick={takePhoto}
              disabled={isLoading || !!error || disabled}
              className="h-12 w-12 rounded-full bg-primary hover:bg-primary/90 text-white"
              title={t('playground.capture.takePhoto')}
            >
              <Camera className="h-5 w-5" />
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
              onClick={confirmCapture}
              disabled={disabled}
            >
              <Check className="h-4 w-4 mr-2" />
              {t('playground.capture.usePhoto')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
