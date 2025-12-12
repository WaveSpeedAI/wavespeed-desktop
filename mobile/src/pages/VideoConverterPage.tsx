import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { ArrowLeft, Upload, Video, Download, Loader2, X, FileVideo, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type OutputFormat = 'webm' | 'mp4'
type VideoCodec = 'vp8' | 'vp9' | 'h264' | 'av1'

interface ConversionResult {
  blob: Blob
  url: string
  filename: string
  codec: VideoCodec
}

export function VideoConverterPage() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [inputVideo, setInputVideo] = useState<{ file: File; url: string } | null>(null)
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('webm')
  const [isConverting, setIsConverting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ConversionResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('video/')) {
      setError('Please select a valid video file')
      return
    }

    // Clean up previous
    if (inputVideo?.url) {
      URL.revokeObjectURL(inputVideo.url)
    }
    if (result?.url) {
      URL.revokeObjectURL(result.url)
    }

    setInputVideo({
      file,
      url: URL.createObjectURL(file)
    })
    setResult(null)
    setError(null)
    setProgress(0)
  }, [inputVideo, result])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) {
      handleFileSelect(file)
    }
  }, [handleFileSelect])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }, [handleFileSelect])

  const clearInput = useCallback(() => {
    if (inputVideo?.url) {
      URL.revokeObjectURL(inputVideo.url)
    }
    if (result?.url) {
      URL.revokeObjectURL(result.url)
    }
    setInputVideo(null)
    setResult(null)
    setError(null)
    setProgress(0)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [inputVideo, result])

  const convertVideo = useCallback(async () => {
    if (!inputVideo || !videoRef.current || !canvasRef.current) return

    setIsConverting(true)
    setError(null)
    setProgress(0)

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')!

    try {
      // Wait for video to be ready
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve()
        video.onerror = () => reject(new Error('Failed to load video'))
        video.src = inputVideo.url
      })

      // Set canvas size
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight

      // Get video duration and fps
      const duration = video.duration
      const fps = 30
      const totalFrames = Math.ceil(duration * fps)

      // Try different codecs based on format
      const codecsToTry: { codec: VideoCodec; mimeType: string }[] = outputFormat === 'webm'
        ? [
            { codec: 'vp9', mimeType: 'video/webm;codecs=vp9' },
            { codec: 'vp8', mimeType: 'video/webm;codecs=vp8' },
            { codec: 'av1', mimeType: 'video/webm;codecs=av01' }
          ]
        : [
            { codec: 'h264', mimeType: 'video/mp4;codecs=avc1' },
            { codec: 'vp9', mimeType: 'video/webm;codecs=vp9' }
          ]

      let selectedCodec: VideoCodec | null = null
      let mimeType: string | null = null

      for (const { codec, mimeType: mime } of codecsToTry) {
        if (MediaRecorder.isTypeSupported(mime)) {
          selectedCodec = codec
          mimeType = mime
          break
        }
      }

      if (!mimeType || !selectedCodec) {
        throw new Error('No supported video codec found')
      }

      // Create MediaRecorder from canvas stream
      const stream = canvas.captureStream(fps)
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5000000
      })

      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data)
        }
      }

      // Start recording
      recorder.start()

      // Play video and draw frames
      video.currentTime = 0
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve()
      })

      for (let frame = 0; frame < totalFrames; frame++) {
        const time = frame / fps
        video.currentTime = time

        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve()
        })

        ctx.drawImage(video, 0, 0)
        setProgress(Math.round((frame / totalFrames) * 100))

        // Small delay to allow frame to be recorded
        await new Promise((r) => setTimeout(r, 1000 / fps))
      }

      // Stop recording
      recorder.stop()

      // Wait for final data
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
      })

      // Create result blob
      const resultBlob = new Blob(chunks, { type: mimeType })
      const resultUrl = URL.createObjectURL(resultBlob)

      // Generate filename
      const baseName = inputVideo.file.name.replace(/\.[^/.]+$/, '')
      const ext = outputFormat === 'mp4' && selectedCodec !== 'h264' ? 'webm' : outputFormat
      const filename = `${baseName}_converted.${ext}`

      setResult({
        blob: resultBlob,
        url: resultUrl,
        filename,
        codec: selectedCodec
      })
      setProgress(100)

    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsConverting(false)
    }
  }, [inputVideo, outputFormat])

  const downloadResult = useCallback(() => {
    if (!result) return

    const a = document.createElement('a')
    a.href = result.url
    a.download = result.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [result])

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/free-tools')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Video Converter</h1>
          <p className="text-muted-foreground text-xs">
            Convert videos between formats using your browser
          </p>
        </div>
      </div>

      {/* Input Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Input Video
          </CardTitle>
          <CardDescription>
            Select or drag a video file to convert
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!inputVideo ? (
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                "hover:border-primary hover:bg-primary/5"
              )}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <Video className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-2">
                Click or drag video here
              </p>
              <p className="text-xs text-muted-foreground">
                Supports MP4, WebM, MOV, AVI
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                <video
                  ref={videoRef}
                  src={inputVideo.url}
                  className="w-full h-full object-contain"
                  controls
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2"
                  onClick={clearInput}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileVideo className="h-4 w-4" />
                <span>{inputVideo.file.name}</span>
                <span className="text-xs">({(inputVideo.file.size / 1024 / 1024).toFixed(2)} MB)</span>
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleInputChange}
          />
        </CardContent>
      </Card>

      {/* Settings */}
      {inputVideo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Output Format</Label>
              <Select value={outputFormat} onValueChange={(v) => setOutputFormat(v as OutputFormat)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="webm">WebM (VP8/VP9)</SelectItem>
                  <SelectItem value="mp4">MP4 (H.264)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full"
              onClick={convertVideo}
              disabled={isConverting}
            >
              {isConverting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Converting...
                </>
              ) : (
                'Convert Video'
              )}
            </Button>

            {isConverting && (
              <div className="space-y-2">
                <Progress value={progress} />
                <p className="text-sm text-center text-muted-foreground">{progress}%</p>
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
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Download className="h-5 w-5" />
              Result
            </CardTitle>
            <CardDescription>
              Codec used: {result.codec.toUpperCase()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="aspect-video bg-black rounded-lg overflow-hidden">
              <video
                src={result.url}
                className="w-full h-full object-contain"
                controls
              />
            </div>
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground text-center">
                {result.filename} ({(result.blob.size / 1024 / 1024).toFixed(2)} MB)
              </div>
              <Button className="w-full" onClick={downloadResult}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hidden canvas for processing */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
