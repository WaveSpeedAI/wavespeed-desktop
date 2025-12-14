import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  ArrowLeft,
  Upload,
  Download,
  Loader2,
  Image as ImageIcon,
  X,
  AlertCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Lightweight image formats (Canvas API)
const IMAGE_FORMATS = [
  { id: 'jpg', label: 'JPEG', ext: 'jpg', mimeType: 'image/jpeg', supportsQuality: true },
  { id: 'png', label: 'PNG', ext: 'png', mimeType: 'image/png', supportsQuality: false },
  { id: 'webp', label: 'WebP', ext: 'webp', mimeType: 'image/webp', supportsQuality: true }
]

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/**
 * Convert image using Canvas API (instant, no WASM needed)
 */
async function convertImage(
  file: File,
  outputFormat: string,
  quality: number,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  onProgress?.(10)

  // Load image
  const img = new Image()
  const imageUrl = URL.createObjectURL(file)

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = imageUrl
  })

  URL.revokeObjectURL(imageUrl)
  onProgress?.(30)

  // Create canvas and draw image
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get canvas context')
  }

  // Fill with white background for JPEG (no transparency support)
  const format = IMAGE_FORMATS.find(f => f.id === outputFormat)
  if (format?.mimeType === 'image/jpeg') {
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  ctx.drawImage(img, 0, 0)
  onProgress?.(60)

  // Convert to blob
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to convert image'))
        }
      },
      format?.mimeType || 'image/jpeg',
      format?.supportsQuality ? quality / 100 : undefined
    )
  })

  onProgress?.(100)
  return blob
}

export function ImageConverterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null)
  const [convertedBlob, setConvertedBlob] = useState<Blob | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [outputFormat, setOutputFormat] = useState('jpg')
  const [quality, setQuality] = useState(85)
  const [error, setError] = useState<string | null>(null)

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError(t('freeTools.imageConverter.invalidFile', 'Please select a valid image file'))
      return
    }

    // Clean up previous URLs
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    if (convertedUrl) URL.revokeObjectURL(convertedUrl)

    const url = URL.createObjectURL(file)
    setImageFile(file)
    setImageUrl(url)
    setConvertedUrl(null)
    setConvertedBlob(null)
    setError(null)
    setProgress(0)
  }, [imageUrl, convertedUrl, t])

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
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    if (convertedUrl) URL.revokeObjectURL(convertedUrl)
    setImageFile(null)
    setImageUrl(null)
    setConvertedUrl(null)
    setConvertedBlob(null)
    setError(null)
    setProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [imageUrl, convertedUrl])

  const handleConvert = async () => {
    if (!imageFile) return

    setIsProcessing(true)
    setError(null)
    setConvertedUrl(null)
    setConvertedBlob(null)
    setProgress(0)

    try {
      const blob = await convertImage(imageFile, outputFormat, quality, setProgress)
      const url = URL.createObjectURL(blob)

      setConvertedBlob(blob)
      setConvertedUrl(url)
      setProgress(100)
    } catch (err) {
      console.error('Conversion failed:', err)
      setError(err instanceof Error ? err.message : 'Conversion failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDownload = () => {
    if (!convertedUrl || !convertedBlob || !imageFile) return

    const format = IMAGE_FORMATS.find(f => f.id === outputFormat)
    const filename = imageFile.name.replace(/\.[^.]+$/, `.${format?.ext || outputFormat}`)

    const link = document.createElement('a')
    link.href = convertedUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const selectedFormat = IMAGE_FORMATS.find(f => f.id === outputFormat)

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/free-tools')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{t('freeTools.imageConverter.title')}</h1>
          <p className="text-muted-foreground text-xs">
            {t('freeTools.imageConverter.description')}
          </p>
        </div>
      </div>

      {/* Input Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            {t('freeTools.imageConverter.inputImage', 'Input Image')}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('freeTools.imageConverter.supportedFormats', 'JPG, PNG, WebP, GIF, BMP → JPG/PNG/WebP')}
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
              <ImageIcon className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-1">
                {t('freeTools.imageConverter.selectImage', 'Click or drag image here')}
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

      {/* Settings */}
      {imageFile && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('common.settings', 'Settings')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('freeTools.imageConverter.outputFormat', 'Output Format')}</Label>
              <Select value={outputFormat} onValueChange={setOutputFormat} disabled={isProcessing}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_FORMATS.map((format) => (
                    <SelectItem key={format.id} value={format.id}>
                      {format.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedFormat?.supportsQuality && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t('freeTools.imageConverter.quality', 'Quality')}</Label>
                  <span className="text-xs text-muted-foreground">{quality}%</span>
                </div>
                <Slider
                  value={[quality]}
                  onValueChange={([v]) => setQuality(v)}
                  min={1}
                  max={100}
                  step={1}
                  disabled={isProcessing}
                />
              </div>
            )}

            <Button
              className="w-full"
              onClick={handleConvert}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('freeTools.imageConverter.converting', 'Converting...')}
                </>
              ) : (
                t('freeTools.imageConverter.convert', 'Convert Image')
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
      {convertedUrl && convertedBlob && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4" />
              {t('freeTools.imageConverter.result', 'Result')}
            </CardTitle>
            <CardDescription className="text-xs">
              {selectedFormat?.label} • {formatFileSize(convertedBlob.size)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="aspect-video bg-black/5 dark:bg-white/5 rounded-lg overflow-hidden">
              <img
                src={convertedUrl}
                alt="Converted"
                className="w-full h-full object-contain"
              />
            </div>
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
