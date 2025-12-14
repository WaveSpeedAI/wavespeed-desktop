import { useState, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useDropzone } from 'react-dropzone'
import { apiClient } from '@/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Upload, X, Loader2, FileVideo, FileAudio, Image, FileArchive, File as FileIcon, Camera, Video, Mic, Brush } from 'lucide-react'
import { CameraCapture } from './CameraCapture'
import { VideoRecorder } from './VideoRecorder'
import { AudioRecorder } from './AudioRecorder'
import { MaskEditor } from './MaskEditor'

type CaptureMode = 'upload' | 'camera' | 'video' | 'audio' | 'mask'

interface FileUploadProps {
  accept: string
  multiple?: boolean
  maxFiles?: number
  value: string | string[]
  onChange: (urls: string | string[]) => void
  disabled?: boolean
  placeholder?: string
  isMaskField?: boolean
  formValues?: Record<string, unknown>
  onUploadingChange?: (isUploading: boolean) => void
}

export function FileUpload({
  accept,
  multiple = false,
  maxFiles = 1,
  value,
  onChange,
  disabled = false,
  isMaskField = false,
  formValues,
  onUploadingChange
}: FileUploadProps) {
  const { t } = useTranslation()
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [captureMode, setCaptureMode] = useState<CaptureMode>('upload')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewType, setPreviewType] = useState<'image' | 'video' | 'audio' | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Convert value to array for consistent handling
  const urls = Array.isArray(value) ? value : value ? [value] : []

  // Determine what capture options are available based on accept type
  const supportsCamera = accept.includes('image') && !isMaskField
  const supportsVideo = accept.includes('video')
  const supportsAudio = accept.includes('audio')
  const supportsMask = isMaskField && accept.includes('image')
  const hasCaptureOptions = supportsCamera || supportsVideo || supportsAudio || supportsMask

  // Get reference image/video URL from formValues for mask editor
  const referenceImageUrl = useMemo(() => {
    if (!formValues || !supportsMask) return undefined

    // Check for 'image' field first (most common)
    if (formValues['image'] && typeof formValues['image'] === 'string') {
      return formValues['image']
    }

    // Check for any field ending with '_image' or 'image_url'
    for (const [key, val] of Object.entries(formValues)) {
      if (typeof val === 'string' && val && (key.endsWith('_image') || key.endsWith('image_url'))) {
        return val
      }
    }

    return undefined
  }, [formValues, supportsMask])

  const referenceVideoUrl = useMemo(() => {
    if (!formValues || !supportsMask) return undefined

    // Check for 'video' field
    if (formValues['video'] && typeof formValues['video'] === 'string') {
      return formValues['video']
    }

    // Check for any field ending with '_video' or 'video_url'
    for (const [key, val] of Object.entries(formValues)) {
      if (typeof val === 'string' && val && (key.endsWith('_video') || key.endsWith('video_url'))) {
        return val
      }
    }

    return undefined
  }, [formValues, supportsMask])

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
    onUploadingChange?.(true)
    setCaptureMode('upload')

    // Create abort controller for this upload
    abortControllerRef.current = new AbortController()

    try {
      // Create a file from the blob with appropriate extension
      const extension = blob.type.includes('video') ? 'webm' :
                       blob.type.includes('audio') ? 'webm' :
                       blob.type.includes('png') ? 'png' : 'jpg'
      const filename = `capture_${Date.now()}.${extension}`
      const file = new File([blob], filename, { type: blob.type })

      const url = await apiClient.uploadFile(file, abortControllerRef.current.signal)

      if (multiple) {
        onChange([...urls, url])
      } else {
        onChange(url)
      }
    } catch (err) {
      // Don't show error for cancelled uploads
      if (err instanceof Error && err.message === 'Upload cancelled') {
        // Silently ignore
      } else {
        setError(err instanceof Error ? err.message : 'Upload failed')
      }
    } finally {
      abortControllerRef.current = null
      setIsUploading(false)
      onUploadingChange?.(false)
    }
  }, [multiple, urls, onChange, onUploadingChange])

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (disabled) return

    setError(null)
    setIsUploading(true)
    onUploadingChange?.(true)

    // Create abort controller for this upload batch
    abortControllerRef.current = new AbortController()

    try {
      const uploadPromises = acceptedFiles.slice(0, maxFiles - urls.length).map(async (file) => {
        try {
          const url = await apiClient.uploadFile(file, abortControllerRef.current?.signal)
          return { url, name: file.name, type: file.type }
        } catch (err) {
          // Re-throw cancellation errors to stop all uploads
          if (err instanceof Error && err.message === 'Upload cancelled') {
            throw err
          }
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
      // Don't show error for cancelled uploads
      if (err instanceof Error && err.message === 'Upload cancelled') {
        // Silently ignore
      } else {
        setError(err instanceof Error ? err.message : 'Upload failed')
      }
    } finally {
      abortControllerRef.current = null
      setIsUploading(false)
      onUploadingChange?.(false)
    }
  }, [disabled, maxFiles, urls, multiple, onChange, onUploadingChange])

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

  const handleCancelUpload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

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

          {/* Mask editor */}
          {captureMode === 'mask' && (
            <MaskEditor
              referenceImageUrl={referenceImageUrl}
              referenceVideoUrl={referenceVideoUrl}
              onComplete={handleCapture}
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCancelUpload()
                      }}
                      className="h-5 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3 mr-0.5" />
                      {t('common.cancel')}
                    </Button>
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
                  {supportsMask && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setCaptureMode('mask')}
                      disabled={disabled || isUploading}
                      className="h-[38px] w-[38px]"
                      title={t('playground.capture.drawMask')}
                    >
                      <Brush className="h-4 w-4" />
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
