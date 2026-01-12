import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNativeMediaMerger } from '@mobile/hooks/useNativeMediaMerger'
import { useMobileDownload } from '@mobile/hooks/useMobileDownload'
import { formatFileSize, getMediaType } from '@mobile/lib/ffmpegFormats'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  ArrowLeft,
  Upload,
  Download,
  Loader2,
  Combine,
  X,
  AlertCircle,
  FileVideo,
  FileAudio,
  Plus,
  GripVertical,
  ArrowUp,
  ArrowDown
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface MediaItem {
  id: string
  file: File
  url: string
  type: 'video' | 'audio'
}

export function MediaMergerPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { downloadBlob } = useMobileDownload()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resultVideoRef = useRef<HTMLVideoElement>(null)

  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [mergedUrl, setMergedUrl] = useState<string | null>(null)
  const [mergedBlob, setMergedBlob] = useState<Blob | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Use native browser APIs for merging (no FFmpeg needed)
  const { merge } = useNativeMediaMerger()

  const addFiles = useCallback((files: FileList | File[]) => {
    const newItems: MediaItem[] = []
    const firstType = mediaItems.length > 0 ? mediaItems[0].type : null

    for (const file of Array.from(files)) {
      const type = getMediaType(file)
      if (type !== 'video' && type !== 'audio') continue

      // All files must be same type
      if (firstType && type !== firstType) {
        setError(t('freeTools.mediaMerger.sameTypeRequired', 'All files must be the same type (video or audio)'))
        continue
      }

      newItems.push({
        id: `${Date.now()}-${Math.random()}`,
        file,
        url: URL.createObjectURL(file),
        type
      })
    }

    if (newItems.length > 0) {
      setMediaItems(prev => [...prev, ...newItems])
      setMergedUrl(null)
      setMergedBlob(null)
      setError(null)
      setProgress(0)
    }
  }, [mediaItems, t])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (isProcessing) return
    addFiles(e.dataTransfer.files)
  }, [addFiles, isProcessing])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files)
    e.target.value = ''
  }, [addFiles])

  const removeItem = useCallback((id: string) => {
    setMediaItems(prev => {
      const item = prev.find(i => i.id === id)
      if (item) URL.revokeObjectURL(item.url)
      return prev.filter(i => i.id !== id)
    })
  }, [])

  const moveItem = useCallback((index: number, direction: 'up' | 'down') => {
    setMediaItems(prev => {
      const newItems = [...prev]
      const newIndex = direction === 'up' ? index - 1 : index + 1
      if (newIndex < 0 || newIndex >= newItems.length) return prev
      [newItems[index], newItems[newIndex]] = [newItems[newIndex], newItems[index]]
      return newItems
    })
  }, [])

  const clearAll = useCallback(() => {
    mediaItems.forEach(item => URL.revokeObjectURL(item.url))
    if (mergedUrl) URL.revokeObjectURL(mergedUrl)
    setMediaItems([])
    setMergedUrl(null)
    setMergedBlob(null)
    setError(null)
    setProgress(0)
  }, [mediaItems, mergedUrl])

  const handleMerge = async () => {
    if (mediaItems.length < 2) return

    setIsProcessing(true)
    setError(null)
    setMergedUrl(null)
    setMergedBlob(null)
    setProgress(0)

    try {
      const files = mediaItems.map(item => item.file)
      const outputType = mediaItems[0].type

      // Use native browser APIs for merging (no FFmpeg download needed)
      const result = await merge(files, outputType, {
        onProgress: (p) => setProgress(Math.round(p))
      })

      const url = URL.createObjectURL(result.blob)

      setMergedBlob(result.blob)
      setMergedUrl(url)
      setProgress(100)
    } catch (err) {
      console.error('Merge failed:', err)
      setError(err instanceof Error ? err.message : 'Merge failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDownload = async () => {
    if (!mergedBlob) return

    // Determine extension from blob type
    const blobType = mergedBlob.type
    let ext = 'mp4'
    if (blobType.includes('webm')) ext = 'webm'
    else if (blobType.includes('mp3') || blobType.includes('mpeg')) ext = 'mp3'
    else if (blobType.includes('wav')) ext = 'wav'

    const filename = `merged_${Date.now()}.${ext}`

    await downloadBlob(mergedBlob, filename)
  }

  const outputType = mediaItems.length > 0 ? mediaItems[0].type : null
  const totalSize = mediaItems.reduce((sum, item) => sum + item.file.size, 0)

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/free-tools')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{t('freeTools.mediaMerger.title')}</h1>
          <p className="text-muted-foreground text-xs">
            {t('freeTools.mediaMerger.description')}
          </p>
        </div>
      </div>

      {/* Input Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            {t('freeTools.mediaMerger.inputMedia', 'Input Files')}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('freeTools.mediaMerger.supportedFormats', 'Add multiple video or audio files to merge')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Drop zone */}
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
              "hover:border-primary hover:bg-primary/5"
            )}
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <Plus className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {mediaItems.length === 0
                ? t('freeTools.mediaMerger.selectFiles', 'Click or drag files here')
                : t('freeTools.mediaMerger.addMore', 'Add more files')
              }
            </p>
          </div>

          {/* File list */}
          {mediaItems.length > 0 && (
            <div className="space-y-2">
              {mediaItems.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  {item.type === 'video' ? (
                    <FileVideo className="h-5 w-5 text-primary flex-shrink-0" />
                  ) : (
                    <FileAudio className="h-5 w-5 text-primary flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(item.file.size)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => moveItem(index, 'up')}
                      disabled={index === 0 || isProcessing}
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => moveItem(index, 'down')}
                      disabled={index === mediaItems.length - 1 || isProcessing}
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => removeItem(item.id)}
                      disabled={isProcessing}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
                <span>{mediaItems.length} {t('freeTools.mediaMerger.files', 'files')} • {formatFileSize(totalSize)}</span>
                <Button variant="ghost" size="sm" onClick={clearAll} disabled={isProcessing}>
                  {t('common.clearAll', 'Clear All')}
                </Button>
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*"
            multiple
            className="hidden"
            onChange={handleInputChange}
          />
        </CardContent>
      </Card>

      {/* Merge Button */}
      {mediaItems.length >= 2 && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <Button
              className="w-full"
              onClick={handleMerge}
              disabled={isProcessing || mediaItems.length < 2}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('freeTools.mediaMerger.merging', 'Merging...')}
                </>
              ) : (
                <>
                  <Combine className="mr-2 h-4 w-4" />
                  {t('freeTools.mediaMerger.merge', 'Merge Files')}
                </>
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
      {mergedUrl && mergedBlob && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4" />
              {t('freeTools.mediaMerger.result', 'Merged Result')}
            </CardTitle>
            <CardDescription className="text-xs">
              {formatFileSize(mergedBlob.size)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {outputType === 'video' ? (
              <div className="aspect-video bg-black rounded-lg overflow-hidden">
                <video
                  ref={resultVideoRef}
                  src={mergedUrl}
                  className="w-full h-full object-contain"
                  controls
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={() => {
                    if (resultVideoRef.current && resultVideoRef.current.currentTime === 0) {
                      resultVideoRef.current.currentTime = 0.001
                    }
                  }}
                />
              </div>
            ) : (
              <audio src={mergedUrl} controls className="w-full h-10" />
            )}
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
