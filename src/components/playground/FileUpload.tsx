import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { apiClient } from '@/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Upload, X, Loader2, FileVideo, FileAudio, Image, FileArchive, File } from 'lucide-react'

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
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')

  // Convert value to array for consistent handling
  const urls = Array.isArray(value) ? value : value ? [value] : []

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
    return File
  }

  const canAddMore = multiple ? urls.length < maxFiles : urls.length === 0

  return (
    <div className="space-y-3">
      {/* Uploaded files */}
      {urls.length > 0 && (
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
          {urls.map((url, index) => {
            const FileIcon = getFileIcon()
            const isImage = accept.includes('image') && url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)
            const isVideo = accept.includes('video') && url.match(/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i)

            return (
              <div
                key={index}
                className="relative group rounded-lg border bg-muted/50 overflow-hidden aspect-video"
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
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FileIcon className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => removeFile(index)}
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
        <div className="space-y-2">
          <div
            {...getRootProps()}
            className={cn(
              'border-2 border-dashed rounded-lg px-4 py-3 cursor-pointer transition-colors',
              isDragActive && 'border-primary bg-primary/5',
              disabled && 'opacity-50 cursor-not-allowed',
              !disabled && !isDragActive && 'hover:border-primary/50'
            )}
          >
            <input {...getInputProps()} />
            {isUploading ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Uploading...</p>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <Upload className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm">
                  <span className="font-medium text-primary">Click to upload</span>
                  <span className="text-muted-foreground"> or drag and drop</span>
                </div>
              </div>
            )}
          </div>

          {/* URL input */}
          <div className="flex gap-2 overflow-hidden">
            <Input
              type="url"
              placeholder="Or enter URL..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
              disabled={disabled}
              className="flex-1 h-9"
            />
            {urlInput.trim() && (
              <Button
                type="button"
                size="sm"
                onClick={handleAddUrl}
                disabled={disabled}
                className="h-9"
              >
                Add
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}
