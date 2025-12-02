import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { apiClient } from '@/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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

interface UploadedFile {
  url: string
  name: string
  type: string
}

export function FileUpload({
  accept,
  multiple = false,
  maxFiles = 1,
  value,
  onChange,
  disabled = false,
  placeholder
}: FileUploadProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)

  // Convert value to array for consistent handling
  const urls = Array.isArray(value) ? value : value ? [value] : []

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (disabled) return

    setError(null)
    setIsUploading(true)

    try {
      const uploadPromises = acceptedFiles.slice(0, maxFiles - urls.length).map(async (file) => {
        setUploadProgress(prev => ({ ...prev, [file.name]: 0 }))

        try {
          const url = await apiClient.uploadFile(file)
          setUploadProgress(prev => ({ ...prev, [file.name]: 100 }))
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
      setUploadProgress({})
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

  const getFileIcon = (url: string) => {
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
            const FileIcon = getFileIcon(url)
            const isImage = accept.includes('image') && url.match(/\.(jpg|jpeg|png|gif|webp)$/i)

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
        <div
          {...getRootProps()}
          className={cn(
            'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
            isDragActive && 'border-primary bg-primary/5',
            disabled && 'opacity-50 cursor-not-allowed',
            !disabled && !isDragActive && 'hover:border-primary/50'
          )}
        >
          <input {...getInputProps()} />
          {isUploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Uploading...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <div className="text-sm">
                <span className="font-medium text-primary">Click to upload</span>
                <span className="text-muted-foreground"> or drag and drop</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {placeholder || `${accept.replace(/\*/g, '').replace('application/', '')} files`}
                {multiple && ` (up to ${maxFiles})`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}
