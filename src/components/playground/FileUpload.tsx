import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useDropzone } from 'react-dropzone'
import { apiClient } from '@/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Upload, X, Loader2, FileVideo, FileAudio, Image, FileArchive, File as FileIcon, Camera, Video, Mic } from 'lucide-react'
import { CameraCapture } from './CameraCapture'
import { VideoRecorder } from './VideoRecorder'
import { AudioRecorder } from './AudioRecorder'

type CaptureMode = 'upload' | 'camera' | 'video' | 'audio'

interface FileUploadProps {
  accept: string
  multiple?: boolean
  maxFiles?: number
  value: string | string[]
  onChange: (urls: string | string[]) => void
  disabled?: boolean
  placeholder?: string
}

export function FileUpload({
  accept,
  multiple = false,
  maxFiles = 1,
  value,
  onChange,
  disabled = false
}: FileUploadProps) {
  const { t } = useTranslation()
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [captureMode, setCaptureMode] = useState<CaptureMode>('upload')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewType, setPreviewType] = useState<'image' | 'video' | 'audio' | null>(null)

  // Convert value to array for consistent handling
  const urls = Array.isArray(value) ? value : value ? [value] : []

  // Determine what capture options are available based on accept type
  const supportsCamera = accept.includes('image')
  const supportsVideo = accept.includes('video')
  const supportsAudio = accept.includes('audio')
  const hasCaptureOptions = supportsCamera || supportsVideo || supportsAudio

  const handleAddUrl = () => {
    if (!urlInput.trim()) return

    const newUrl = urlInput.trim()
    if (multiple) {
      onChange([...urls, newUrl])
    } else {
      onChange(newUrl)
    }
    setUrlInput('')
  }

  const handleCapture = useCallback(async (blob: Blob) => {
    setError(null)
    setIsUploading(true)
    setCaptureMode('upload')

    try {
      // Create a file from the blob with appropriate extension
      const extension = blob.type.includes('video') ? 'webm' :
                       blob.type.includes('audio') ? 'webm' : 'jpg'
      const filename = `capture_${Date.now()}.${extension}`
      const file = new File([blob], filename, { type: blob.type })

      const url = await apiClient.uploadFile(file)

      if (multiple) {
        onChange([...urls, url])
      } else {
        onChange(url)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }, [multiple, urls, onChange])

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (disabled) return

    setError(null)
    setIsUploading(true)

    try {
      const uploadPromises = acceptedFiles.slice(0, maxFiles - urls.length).map(async (file) => {
        try {
          const url = await apiClient.uploadFile(file)
          return { url, name: file.name, type: file.type }
        } catch {
          throw new Error(`Failed to upload ${file.name}`)
        }
      })

      const results = await Promise.all(uploadPromises)
      const newUrls = results.map(r => r.url)

      if (multiple) {
        onChange([...urls, ...newUrls])
      } else {
        onChange(newUrls[0] || '')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }, [disabled, maxFiles, urls, multiple, onChange])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: accept.split(',').reduce((acc, type) => {
      const trimmed = type.trim()
      if (trimmed.startsWith('.')) {
        return acc
      }
      acc[trimmed] = []
      return acc
    }, {} as Record<string, string[]>),
    multiple: multiple && urls.length < maxFiles,
    disabled: disabled || isUploading || (!multiple && urls.length >= 1),
    maxFiles: maxFiles - urls.length
  })

  const removeFile = (index: number) => {
    const newUrls = urls.filter((_, i) => i !== index)
    if (multiple) {
      onChange(newUrls)
    } else {
      onChange('')
    }
  }

  const getFileIcon = () => {
    if (accept.includes('video')) return FileVideo
    if (accept.includes('audio')) return FileAudio
    if (accept.includes('zip') || accept.includes('application')) return FileArchive
    if (accept.includes('image')) return Image
    return FileIcon
  }

  const canAddMore = multiple ? urls.length < maxFiles : urls.length === 0

  return (
    <div className="space-y-2">
      {/* Uploaded files */}
      {urls.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {urls.map((url, index) => {
            const FileIconComponent = getFileIcon()
            const isImage = accept.includes('image') && url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)
            const isVideo = accept.includes('video') && url.match(/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i)
            const isAudio = accept.includes('audio') && url.match(/\.(mp3|wav|ogg|webm|m4a)(\?.*)?$/i)

            const handlePreview = () => {
              setPreviewUrl(url)
              if (isImage) setPreviewType('image')
              else if (isVideo) setPreviewType('video')
              else if (isAudio) setPreviewType('audio')
            }

            return (
              <div
                key={index}
                className="relative group rounded-md border bg-muted/50 overflow-hidden h-16 w-16 flex-shrink-0 cursor-pointer"
                onClick={handlePreview}
              >
                {isImage ? (
                  <img
                    src={url}
                    alt={`Uploaded ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                ) : isVideo ? (
                  <video
                    src={url}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    onMouseEnter={(e) => e.currentTarget.play()}
                    onMouseLeave={(e) => {
                      e.currentTarget.pause()
                      e.currentTarget.currentTime = 0
                    }}
                  />
                ) : isAudio ? (
                  <div className="w-full h-full flex items-center justify-center bg-primary/10">
                    <FileAudio className="h-6 w-6 text-primary" />
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FileIconComponent className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-0.5 right-0.5 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeFile(index)
                  }}
                  disabled={disabled}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )
          })}
        </div>
      )}

      {/* Upload zone */}
      {canAddMore && (
        <div className="space-y-1.5">
          {/* Camera capture */}
          {captureMode === 'camera' && (
            <CameraCapture
              onCapture={handleCapture}
              onClose={() => setCaptureMode('upload')}
              disabled={disabled || isUploading}
            />
          )}

          {/* Video recorder */}
          {captureMode === 'video' && (
            <VideoRecorder
              onRecord={handleCapture}
              onClose={() => setCaptureMode('upload')}
              disabled={disabled || isUploading}
            />
          )}

          {/* Audio recorder */}
          {captureMode === 'audio' && (
            <AudioRecorder
              onRecord={handleCapture}
              onClose={() => setCaptureMode('upload')}
              disabled={disabled || isUploading}
            />
          )}

          {/* File upload dropzone with integrated controls */}
          {captureMode === 'upload' && (
            <div className="flex gap-1.5 items-stretch">
              {/* Dropzone */}
              <div
                {...getRootProps()}
                className={cn(
                  'flex-1 border-2 border-dashed rounded-md px-3 py-2 cursor-pointer transition-colors min-h-[38px] flex items-center',
                  isDragActive && 'border-primary bg-primary/5',
                  disabled && 'opacity-50 cursor-not-allowed',
                  !disabled && !isDragActive && 'hover:border-primary/50'
                )}
              >
                <input {...getInputProps()} />
                {isUploading ? (
                  <div className="flex items-center gap-2 w-full justify-center">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{t('playground.capture.uploading')}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 w-full justify-center">
                    <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{t('playground.capture.clickToUpload')}</span>
                  </div>
                )}
              </div>

              {/* Capture mode buttons */}
              {hasCaptureOptions && (
                <div className="flex gap-0.5">
                  {supportsCamera && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setCaptureMode('camera')}
                      disabled={disabled || isUploading}
                      className="h-[38px] w-[38px]"
                      title={t('playground.capture.camera')}
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                  )}
                  {supportsVideo && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setCaptureMode('video')}
                      disabled={disabled || isUploading}
                      className="h-[38px] w-[38px]"
                      title={t('playground.capture.record')}
                    >
                      <Video className="h-4 w-4" />
                    </Button>
                  )}
                  {supportsAudio && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setCaptureMode('audio')}
                      disabled={disabled || isUploading}
                      className="h-[38px] w-[38px]"
                      title={t('playground.capture.audio')}
                    >
                      <Mic className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* URL input - only show in upload mode */}
          {captureMode === 'upload' && (
            <div className="flex gap-1.5">
              <Input
                type="url"
                placeholder={t('playground.capture.enterUrl')}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
                disabled={disabled}
                className="flex-1 h-8 text-xs"
              />
              {urlInput.trim() && (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleAddUrl}
                  disabled={disabled}
                  className="h-8 px-3"
                >
                  {t('playground.capture.add')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {/* Preview Dialog */}
      <Dialog open={!!previewUrl} onOpenChange={(open) => !open && setPreviewUrl(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden">
          {previewType === 'image' && previewUrl && (
            <img
              src={previewUrl}
              alt="Preview"
              className="w-full h-auto max-h-[80vh] object-contain"
            />
          )}
          {previewType === 'video' && previewUrl && (
            <video
              src={previewUrl}
              controls
              autoPlay
              className="w-full h-auto max-h-[80vh]"
            />
          )}
          {previewType === 'audio' && previewUrl && (
            <div className="p-8">
              <audio
                src={previewUrl}
                controls
                autoPlay
                className="w-full"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
