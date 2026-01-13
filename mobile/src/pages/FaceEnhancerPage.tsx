import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useFaceEnhancerWorker } from '@mobile/hooks/useFaceEnhancerWorker'
import { useMobileDownload } from '@mobile/hooks/useMobileDownload'
import { formatFileSize } from '@mobile/lib/ffmpegFormats'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  ArrowLeft,
  Upload,
  Download,
  Loader2,
  Sparkles,
  X,
  AlertCircle,
  Image as ImageIcon,
  UserCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function FaceEnhancerPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { downloadFromDataUrl } = useMobileDownload()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [enhancedUrl, setEnhancedUrl] = useState<string | null>(null)
  const [faceCount, setFaceCount] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isInitializing, setIsInitializing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const { initModel, enhance, hasFailed, retryWorker } = useFaceEnhancerWorker({
    onPhase: (p) => {
      setPhase(p)
      if (p === 'download') setProgress(5)
      else if (p === 'loading') setProgress(95)
      else if (p === 'detect') setProgress(10)
      else if (p === 'enhance') setProgress(30)
    },
    onProgress: (p, progressValue) => {
      if (p === 'download') {
        setProgress(Math.round(progressValue * 0.9))
      } else if (p === 'detect' || p === 'enhance') {
        setProgress(Math.round(progressValue))
      }
    },
    onError: (err) => {
      console.error('Worker error:', err)
      setError(err)
      setIsProcessing(false)
      setIsInitializing(false)
    }
  })

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError(t('freeTools.faceEnhancer.invalidFile', 'Please select a valid image file'))
      return
    }

    // Clean up previous URLs
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    if (enhancedUrl) URL.revokeObjectURL(enhancedUrl)

    const url = URL.createObjectURL(file)
    setImageFile(file)
    setImageUrl(url)
    setEnhancedUrl(null)
    setFaceCount(0)
    setError(null)
    setProgress(0)
    setPhase('')
  }, [imageUrl, enhancedUrl, t])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (isProcessing || isInitializing) return
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect, isProcessing, isInitializing])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileSelect(file)
    e.target.value = ''
  }, [handleFileSelect])

  const clearInput = useCallback(() => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    if (enhancedUrl) URL.revokeObjectURL(enhancedUrl)
    setImageFile(null)
    setImageUrl(null)
    setEnhancedUrl(null)
    setFaceCount(0)
    setError(null)
    setProgress(0)
    setPhase('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [imageUrl, enhancedUrl])

  const handleEnhance = async () => {
    if (!imageFile || !imageUrl || !canvasRef.current) return

    setIsProcessing(true)
    setIsInitializing(true)
    setError(null)
    setEnhancedUrl(null)
    setFaceCount(0)
    setProgress(0)

    try {
      // Initialize model (downloads if needed)
      await initModel()
      setIsInitializing(false)

      // Load image to canvas
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = imageUrl
      })

      const canvas = canvasRef.current
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)

      const imageData = ctx.getImageData(0, 0, img.width, img.height)

      // Enhance faces
      const result = await enhance(imageData)
      setEnhancedUrl(result.dataUrl)
      setFaceCount(result.faces)
      setProgress(100)
    } catch (err) {
      console.error('Enhancement failed:', err)
      setError(err instanceof Error ? err.message : 'Enhancement failed')
    } finally {
      setIsProcessing(false)
      setIsInitializing(false)
    }
  }

  const handleDownload = async () => {
    if (!enhancedUrl || !imageFile) return

    const filename = imageFile.name.replace(/\.[^.]+$/, '_enhanced.png')

    await downloadFromDataUrl(enhancedUrl, filename)
  }

  const handleRetry = useCallback(() => {
    setError(null)
    retryWorker()
  }, [retryWorker])

  const getPhaseLabel = () => {
    switch (phase) {
      case 'download':
        return t('freeTools.faceEnhancer.downloading', 'Downloading models...')
      case 'loading':
        return t('freeTools.faceEnhancer.loading', 'Loading models...')
      case 'detect':
        return t('freeTools.faceEnhancer.detecting', 'Detecting faces...')
      case 'enhance':
        return t('freeTools.faceEnhancer.enhancing', 'Enhancing faces...')
      default:
        return t('freeTools.faceEnhancer.processing', 'Processing...')
    }
  }

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/free-tools')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{t('freeTools.faceEnhancer.title')}</h1>
          <p className="text-muted-foreground text-xs">
            {t('freeTools.faceEnhancer.description')}
          </p>
        </div>
      </div>

      {/* Input Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            {t('freeTools.faceEnhancer.inputImage', 'Input Image')}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('freeTools.faceEnhancer.selectImageWithFaces', 'Select an image with faces to enhance')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!imageFile ? (
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                "hover:border-primary hover:bg-primary/5"
              )}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <UserCircle className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-1">
                {t('freeTools.faceEnhancer.selectImage', 'Click or drag image here')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('freeTools.faceEnhancer.modelsInfo', 'Uses YOLO + GFPGAN AI models')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative aspect-video bg-black/5 dark:bg-white/5 rounded-lg overflow-hidden">
                <img
                  src={imageUrl!}
                  alt="Input"
                  className="w-full h-full object-contain"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 h-7 w-7"
                  onClick={clearInput}
                  disabled={isProcessing}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ImageIcon className="h-4 w-4" />
                <span className="truncate">{imageFile.name}</span>
                <span>({formatFileSize(imageFile.size)})</span>
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleInputChange}
          />
        </CardContent>
      </Card>

      {/* Enhance Button */}
      {imageFile && !enhancedUrl && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <Button
              className="w-full"
              onClick={handleEnhance}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {getPhaseLabel()}
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t('freeTools.faceEnhancer.enhance', 'Enhance Faces')}
                </>
              )}
            </Button>

            {isProcessing && (
              <div className="space-y-2">
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-center text-muted-foreground">{progress}%</p>
              </div>
            )}

            {isInitializing && (
              <p className="text-xs text-center text-muted-foreground">
                {t('freeTools.faceEnhancer.firstTimeDownload', 'First time? Models will be downloaded (~350MB)')}
              </p>
            )}

            {error && hasFailed() && !isProcessing && (
              <div className="flex items-center justify-center gap-3 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span className="text-sm text-destructive flex-1">{error}</span>
                <Button variant="outline" size="sm" onClick={handleRetry}>
                  {t('common.retry', 'Retry')}
                </Button>
              </div>
            )}

            {error && !hasFailed() && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {enhancedUrl && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4" />
              {t('freeTools.faceEnhancer.result', 'Enhanced Result')}
            </CardTitle>
            <CardDescription className="text-xs">
              {faceCount > 0
                ? t('freeTools.faceEnhancer.facesEnhanced', '{{count}} face(s) enhanced', { count: faceCount })
                : t('freeTools.faceEnhancer.noFacesFound', 'No faces found')
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="aspect-video bg-black/5 dark:bg-white/5 rounded-lg overflow-hidden">
              <img
                src={enhancedUrl}
                alt="Enhanced"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                {t('common.download', 'Download')}
              </Button>
              <Button variant="outline" onClick={clearInput}>
                {t('freeTools.faceEnhancer.newImage', 'New Image')}
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
