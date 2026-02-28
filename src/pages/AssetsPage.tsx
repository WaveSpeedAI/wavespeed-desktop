import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAssetsStore } from '@/stores/assetsStore'
import { formatBytes } from '@/types/progress'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from '@/hooks/useToast'
import { useInView } from '@/hooks/useInView'
import { cn } from '@/lib/utils'
import {
  Search,
  Loader2,
  Image,
  Video,
  Music,
  FileText,
  Star,
  MoreVertical,
  Trash2,
  FolderOpen,
  Download,
  Eye,
  EyeOff,
  Tag,
  X,
  SlidersHorizontal,
  CheckSquare,
  Square,
  Plus,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  FolderHeart,
  GitBranch,
  Wrench,
  Cpu,
} from 'lucide-react'
import type { AssetMetadata, AssetType, AssetSortBy, AssetsFilter } from '@/types/asset'

// Video preview component - shows first frame, plays on hover
function VideoPreview({ src, enabled }: { src: string; enabled: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)

  const handleMouseEnter = () => {
    if (videoRef.current && isLoaded && enabled) {
      videoRef.current.play().catch(() => {
        // Ignore autoplay errors
      })
    }
  }

  const handleMouseLeave = () => {
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }

  // Show placeholder if disabled or error
  if (!enabled || hasError) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Video className="h-12 w-12 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div
      className="w-full h-full relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted z-10">
          <Video className="h-12 w-12 text-muted-foreground" />
        </div>
      )}
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-cover"
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedData={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
      />
    </div>
  )
}

// Asset type icon component
function AssetTypeIcon({ type, className }: { type: AssetType; className?: string }) {
  switch (type) {
    case 'image':
      return <Image className={className} />
    case 'video':
      return <Video className={className} />
    case 'audio':
      return <Music className={className} />
    case 'text':
    case 'json':
      return <FileText className={className} />
  }
}

// Format date
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Check if running in desktop mode
const isDesktopMode = !!window.electronAPI?.saveAsset

// Get asset URL for preview (local-asset:// in desktop for proper video/audio support)
function getAssetUrl(asset: AssetMetadata): string {
  if (asset.filePath) {
    // Use custom protocol for local files to ensure proper media loading in Electron
    return `local-asset://${encodeURIComponent(asset.filePath)}`
  }
  return asset.originalUrl || ''
}

export function AssetsPage() {
  const { t } = useTranslation()
  const {
    assets,
    isLoaded,
    isLoading,
    loadAssets,
    deleteAsset,
    deleteAssets,
    updateAsset,
    getFilteredAssets,
    getAllTags,
    getAllModels,
    openAssetLocation,
  } = useAssetsStore()

  // Filter state
  const [filter, setFilter] = useState<AssetsFilter>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isSelectionMode, setIsSelectionMode] = useState(false)

  // Dialog state
  const [previewAsset, setPreviewAsset] = useState<AssetMetadata | null>(null)
  const [deleteConfirmAsset, setDeleteConfirmAsset] = useState<AssetMetadata | null>(null)
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  const [tagDialogAsset, setTagDialogAsset] = useState<AssetMetadata | null>(null)
  const [newTag, setNewTag] = useState('')

  // Loading state
  const [isDeleting, setIsDeleting] = useState(false)

  // Pagination state
  const [page, setPage] = useState(1)
  const pageSize = 50

  // Preview toggle
  const [loadPreviews, setLoadPreviews] = useState(true)
  const [loadedPreviewKeys, setLoadedPreviewKeys] = useState<Set<string>>(() => new Set())

  const markPreviewLoaded = useCallback((key: string) => {
    setLoadedPreviewKeys((prev) => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [])

  // Load assets on mount
  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter(f => ({ ...f, search: searchQuery }))
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Reset page when filter changes
  useEffect(() => {
    setPage(1)
  }, [filter])

  // Get filtered assets
  const filteredAssets = useMemo(() => {
    return getFilteredAssets(filter)
  }, [getFilteredAssets, filter, assets])

  // Pagination
  const totalPages = Math.ceil(filteredAssets.length / pageSize)
  const paginatedAssets = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredAssets.slice(start, start + pageSize)
  }, [filteredAssets, page, pageSize])

  // Get all tags and models for filters
  const allTags = useMemo(() => getAllTags(), [getAllTags, assets])
  const allModels = useMemo(() => getAllModels(), [getAllModels, assets])

  // Handlers
  const handleTypeFilterChange = useCallback((type: AssetType, checked: boolean) => {
    setFilter(f => {
      const currentTypes = f.types || []
      if (checked) {
        return { ...f, types: [...currentTypes, type] }
      }
      return { ...f, types: currentTypes.filter(t => t !== type) }
    })
  }, [])

  const handleModelFilterChange = useCallback((modelId: string) => {
    setFilter(f => ({
      ...f,
      models: modelId === 'all' ? undefined : [modelId]
    }))
  }, [])

  const handleFavoritesFilterChange = useCallback((checked: boolean) => {
    setFilter(f => ({ ...f, favoritesOnly: checked }))
  }, [])

  const handleClearFilters = useCallback(() => {
    setFilter({})
    setSearchQuery('')
  }, [])

  const handleToggleFavorite = useCallback(async (asset: AssetMetadata) => {
    await updateAsset(asset.id, { favorite: !asset.favorite })
  }, [updateAsset])

  const handleDelete = useCallback(async (asset: AssetMetadata) => {
    setIsDeleting(true)
    try {
      await deleteAsset(asset.id)
      toast({
        title: t('assets.deleted'),
        description: t('assets.deletedDesc', { name: asset.fileName }),
      })
    } catch {
      toast({
        title: t('common.error'),
        description: t('assets.deleteFailed'),
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
      setDeleteConfirmAsset(null)
    }
  }, [deleteAsset, t])

  const handleBulkDelete = useCallback(async () => {
    setIsDeleting(true)
    try {
      const count = await deleteAssets(Array.from(selectedIds))
      toast({
        title: t('assets.deletedBulk'),
        description: t('assets.deletedBulkDesc', { count }),
      })
      setSelectedIds(new Set())
      setIsSelectionMode(false)
    } catch {
      toast({
        title: t('common.error'),
        description: t('assets.deleteFailed'),
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
      setShowBulkDeleteConfirm(false)
    }
  }, [deleteAssets, selectedIds, t])

  const handleBulkFavorite = useCallback(async (favorite: boolean) => {
    const ids = Array.from(selectedIds)
    for (const id of ids) {
      await updateAsset(id, { favorite })
    }
    toast({
      title: favorite ? t('assets.addedToFavorites') : t('assets.removedFromFavorites'),
      description: t('assets.bulkFavoriteDesc', { count: ids.length }),
    })
  }, [selectedIds, updateAsset, t])

  const handleOpenLocation = useCallback(async (asset: AssetMetadata) => {
    await openAssetLocation(asset.id)
  }, [openAssetLocation])

  const handleDownload = useCallback((asset: AssetMetadata) => {
    // For local files, open in file explorer instead of downloading
    if (asset.filePath) {
      openAssetLocation(asset.id)
      return
    }
    
    const url = asset.originalUrl
    if (!url) return

    // Create a temporary link and trigger download for remote URLs
    const link = document.createElement('a')
    link.href = url
    link.download = asset.fileName
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }, [openAssetLocation])

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredAssets.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredAssets.map(a => a.id)))
    }
  }, [filteredAssets, selectedIds.size])

  const handleToggleSelect = useCallback((assetId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(assetId)) {
        next.delete(assetId)
      } else {
        next.add(assetId)
      }
      return next
    })
  }, [])

  const handleAddTag = useCallback(async () => {
    if (!tagDialogAsset || !newTag.trim()) return
    const currentTags = tagDialogAsset.tags || []
    if (!currentTags.includes(newTag.trim())) {
      await updateAsset(tagDialogAsset.id, { tags: [...currentTags, newTag.trim()] })
    }
    setNewTag('')
  }, [tagDialogAsset, newTag, updateAsset])

  const handleRemoveTag = useCallback(async (asset: AssetMetadata, tag: string) => {
    await updateAsset(asset.id, { tags: asset.tags.filter(t => t !== tag) })
  }, [updateAsset])


  const handleOpenAssetsFolder = useCallback(async () => {
    if (window.electronAPI?.openAssetsFolder) {
      await window.electronAPI.openAssetsFolder()
    }
  }, [])

  // Navigate to previous/next asset in preview (with loop support)
  const navigateAsset = useCallback((direction: 'prev' | 'next') => {
    if (!previewAsset || paginatedAssets.length <= 1) return
    const currentIdx = paginatedAssets.findIndex(a => a.id === previewAsset.id)
    if (currentIdx === -1) return
    let newIdx: number
    if (direction === 'prev') {
      newIdx = currentIdx === 0 ? paginatedAssets.length - 1 : currentIdx - 1
    } else {
      newIdx = currentIdx === paginatedAssets.length - 1 ? 0 : currentIdx + 1
    }
    setPreviewAsset(paginatedAssets[newIdx])
  }, [previewAsset, paginatedAssets])

  // Keyboard navigation for preview dialog
  useEffect(() => {
    if (!previewAsset) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        navigateAsset('prev')
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        navigateAsset('next')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [previewAsset, navigateAsset])

  const AssetCard = ({ asset, assetKey }: { asset: AssetMetadata; assetKey: string }) => {
    const { ref, isInView } = useInView<HTMLDivElement>()
    const assetUrl = getAssetUrl(asset)
    const shouldLoad = loadPreviews && (isInView || loadedPreviewKeys.has(assetKey))

    useEffect(() => {
      if (!loadPreviews || !isInView || !assetUrl) return
      markPreviewLoaded(assetKey)
    }, [assetKey, assetUrl, isInView, loadPreviews, markPreviewLoaded])

    return (
      <div
        className={cn(
          "group relative overflow-hidden rounded-xl border border-border/70 bg-card/85 shadow-sm transition-all hover:shadow-md",
          selectedIds.has(asset.id) && "ring-2 ring-primary"
        )}
      >
        {/* Thumbnail */}
        <div
          ref={ref}
          className="aspect-square bg-muted flex items-center justify-center cursor-pointer"
          onClick={() => isSelectionMode ? handleToggleSelect(asset.id) : setPreviewAsset(asset)}
        >
          {asset.type === 'image' && shouldLoad && assetUrl ? (
            <img
              src={assetUrl}
              alt={asset.fileName}
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : asset.type === 'video' && shouldLoad && assetUrl ? (
            <VideoPreview src={assetUrl} enabled={shouldLoad} />
          ) : (
            <AssetTypeIcon type={asset.type} className="h-12 w-12 text-muted-foreground" />
          )}

          {/* Selection checkbox overlay */}
          {isSelectionMode && (
            <div className="absolute top-2 left-2" onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={selectedIds.has(asset.id)}
                onCheckedChange={() => handleToggleSelect(asset.id)}
                className="bg-background"
              />
            </div>
          )}

          {/* Favorite star */}
          {asset.favorite && (
            <div className="absolute top-2 right-2">
              <Star className="h-5 w-5 fill-yellow-400 text-yellow-400 drop-shadow-sm" />
            </div>
          )}

          {/* Type badge */}
          <Badge
            variant="secondary"
            className={cn(
              "absolute text-xs",
              isSelectionMode ? "top-9 left-2" : "top-2 left-2"
            )}
          >
            <AssetTypeIcon type={asset.type} className="h-3 w-3 mr-1" />
            {t(`assets.types.${asset.type}`)}
          </Badge>


        </div>

        {/* Info */}
        <div className="p-2">
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate" title={asset.fileName}>
                {asset.fileName}
              </p>
              {asset.source === 'workflow' && asset.workflowName ? (
                <p className="text-xs text-blue-400 truncate flex items-center gap-1" title={`Workflow: ${asset.workflowName}`}>
                  <GitBranch className="h-3 w-3 shrink-0" />
                  {asset.workflowName}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground truncate" title={asset.modelId}>
                  {asset.modelId}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {formatDate(asset.createdAt)} · {formatBytes(asset.fileSize)}
              </p>
            </div>

            {/* Actions */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setPreviewAsset(asset)}>
                  <Eye className="mr-2 h-4 w-4" />
                  {t('assets.preview')}
                </DropdownMenuItem>
                {isDesktopMode ? (
                  <DropdownMenuItem onClick={() => handleOpenLocation(asset)}>
                    <FolderOpen className="mr-2 h-4 w-4" />
                    {t('assets.openLocation')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => handleDownload(asset)}>
                    <Download className="mr-2 h-4 w-4" />
                    {t('common.download')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => handleToggleFavorite(asset)}>
                  <Star className={cn("mr-2 h-4 w-4", asset.favorite && "fill-yellow-400")} />
                  {asset.favorite ? t('assets.unfavorite') : t('assets.favorite')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTagDialogAsset(asset)}>
                  <Tag className="mr-2 h-4 w-4" />
                  {t('assets.manageTags')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setDeleteConfirmAsset(asset)}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('common.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Tags */}
          {asset.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {asset.tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="outline" className="rounded-md border-border/70 bg-background text-xs">
                  {tag}
                </Badge>
              ))}
              {asset.tags.length > 3 && (
                <Badge variant="outline" className="rounded-md border-border/70 bg-background text-xs">
                  +{asset.tags.length - 3}
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (isLoading || !isLoaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col pt-12 md:pt-0">
      {/* Header */}
      <div className="page-header px-4 md:px-6 py-4 border-b border-border/70">
        <div className="flex flex-col gap-1.5 md:flex-row md:items-baseline md:gap-3 mb-4">
          <h1 className="flex items-center gap-2 text-xl md:text-2xl font-bold tracking-tight">
            <FolderHeart className="h-5 w-5 text-primary" />
            {t('assets.title')}
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            {t('assets.subtitle', { count: assets.length })}
          </p>
        </div>

        {/* Search, Filters & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('assets.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 rounded-lg border-border/80 bg-background pl-9"
            />
          </div>
          <Select
            value={filter.sortBy || 'date-desc'}
            onValueChange={(value) => setFilter(f => ({ ...f, sortBy: value as AssetSortBy }))}
          >
            <SelectTrigger className="h-9 w-full rounded-lg border-border/80 bg-background sm:w-[170px]">
              <ArrowUpDown className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date-desc">{t('assets.sort.dateNewest')}</SelectItem>
              <SelectItem value="date-asc">{t('assets.sort.dateOldest')}</SelectItem>
              <SelectItem value="name-asc">{t('assets.sort.nameAZ')}</SelectItem>
              <SelectItem value="name-desc">{t('assets.sort.nameZA')}</SelectItem>
              <SelectItem value="size-desc">{t('assets.sort.sizeLargest')}</SelectItem>
              <SelectItem value="size-asc">{t('assets.sort.sizeSmallest')}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={loadPreviews ? 'default' : 'outline'}
            size="icon"
            onClick={() => setLoadPreviews(!loadPreviews)}
            title={loadPreviews ? t('assets.disablePreviews') : t('assets.loadPreviews')}
            className="h-9 w-9 rounded-lg"
          >
            {loadPreviews ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant={showFilters ? 'default' : 'outline'}
            size="icon"
            onClick={() => setShowFilters(!showFilters)}
            className="h-9 w-9 rounded-lg"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
          <div className="flex-1" />
          {isSelectionMode ? (
            <>
              <Button variant="outline" size="sm" onClick={handleSelectAll}>
                {selectedIds.size === filteredAssets.length ? (
                  <>
                    <Square className="mr-2 h-4 w-4" />
                    {t('assets.deselectAll')}
                  </>
                ) : (
                  <>
                    <CheckSquare className="mr-2 h-4 w-4" />
                    {t('assets.selectAll')}
                  </>
                )}
              </Button>
              {selectedIds.size > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkFavorite(true)}
                  >
                    <Star className="mr-2 h-4 w-4" />
                    {t('assets.addToFavorites')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkFavorite(false)}
                  >
                    <Star className="mr-2 h-4 w-4" />
                    {t('assets.removeFromFavorites')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowBulkDeleteConfirm(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('assets.deleteSelected', { count: selectedIds.size })}
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsSelectionMode(false)
                  setSelectedIds(new Set())
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsSelectionMode(true)}
              >
                <CheckSquare className="mr-2 h-4 w-4" />
                {t('assets.select')}
              </Button>
              {isDesktopMode && (
                <Button variant="outline" size="sm" onClick={handleOpenAssetsFolder}>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  {t('assets.openFolder')}
                </Button>
              )}
            </>
          )}
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="mt-3 space-y-2.5">
            {/* Row 1: Type & Source pills */}
            <div className="flex flex-wrap items-start gap-6 rounded-lg border border-border/50 bg-card/40 px-4 py-3">
              {/* Type */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">{t('assets.filterByType')}</span>
                <div className="flex flex-wrap gap-1.5">
                  {(['image', 'video', 'audio', 'text'] as AssetType[]).map((type) => {
                    const isActive = (filter.types || []).includes(type)
                    return (
                      <button
                        key={type}
                        onClick={() => handleTypeFilterChange(type, !isActive)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors',
                          'cursor-pointer select-none border',
                          isActive
                            ? 'border-primary/40 bg-primary/10 text-primary'
                            : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                        )}
                      >
                        <AssetTypeIcon type={type} className="h-3.5 w-3.5" />
                        {t(`assets.typesPlural.${type}`)}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Source */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">{t('assets.filterBySource', 'Source')}</span>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    { value: 'playground' as const, label: 'Playground', icon: Sparkles },
                    { value: 'workflow' as const, label: 'Workflow', icon: GitBranch },
                    { value: 'free-tool' as const, label: 'Free Tool', icon: Wrench },
                    { value: 'z-image' as const, label: 'Z-Image', icon: Cpu },
                  ]).map(({ value, label, icon: Icon }) => {
                    const isActive = (filter.sources || []).includes(value)
                    return (
                      <button
                        key={value}
                        onClick={() => {
                          setFilter(f => {
                            const current = f.sources || []
                            return { ...f, sources: isActive ? current.filter(s => s !== value) : [...current, value] }
                          })
                        }}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors',
                          'cursor-pointer select-none border',
                          isActive
                            ? 'border-primary/40 bg-primary/10 text-primary'
                            : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Row 2: Model, Favorites, Clear */}
            <div className="flex flex-wrap items-center gap-4 px-1">
              {/* Model dropdown */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">{t('assets.filterByModel')}</span>
                <Select
                  value={(filter.models && filter.models[0]) || 'all'}
                  onValueChange={handleModelFilterChange}
                >
                  <SelectTrigger className="h-7 w-[160px] text-xs border-border/40 bg-card/40 rounded-md">
                    <SelectValue placeholder={t('assets.allModels')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('assets.allModels')}</SelectItem>
                    {allModels.map((modelId) => (
                      <SelectItem key={modelId} value={modelId}>
                        {modelId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="h-4 w-px bg-border/30" />

              {/* Favorites toggle */}
              <button
                onClick={() => handleFavoritesFilterChange(!filter.favoritesOnly)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
                  'cursor-pointer select-none',
                  filter.favoritesOnly
                    ? 'text-yellow-400'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Star className={cn('h-3.5 w-3.5', filter.favoritesOnly && 'fill-current')} />
                {t('assets.showFavoritesOnly')}
              </button>

              {/* Clear filters */}
              <button
                onClick={handleClearFilters}
                className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer select-none"
              >
                <X className="h-3 w-3" />
                {t('assets.clearFilters')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <FolderOpen className="h-16 w-16 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-2">{t('assets.noAssets')}</h2>
            <p className="text-muted-foreground mb-4 max-w-md">
              {assets.length === 0
                ? t('assets.noAssetsDesc')
                : t('assets.noMatchingAssets')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {paginatedAssets.map((asset) => {
              const assetKey = asset.filePath || asset.originalUrl || asset.id
              return <AssetCard key={assetKey} asset={asset} assetKey={assetKey} />
            })}
          </div>
        )}
      </ScrollArea>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border/70 bg-background/70 p-4 backdrop-blur">
          <p className="text-sm text-muted-foreground">
            {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, filteredAssets.length)} / {filteredAssets.length}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p - 1)}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              {t('common.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages}
            >
              {t('common.next')}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Preview Dialog */}
      <Dialog open={!!previewAsset} onOpenChange={() => setPreviewAsset(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewAsset?.fileName}
              {paginatedAssets.length > 1 && previewAsset && (
                <span className="text-sm font-normal text-muted-foreground">
                  ({paginatedAssets.findIndex(a => a.id === previewAsset.id) + 1}/{paginatedAssets.length})
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {previewAsset?.modelId} · {previewAsset && formatDate(previewAsset.createdAt)}
              {previewAsset?.source === 'workflow' && previewAsset?.workflowName && (
                <> · <GitBranch className="inline h-3 w-3" /> {previewAsset.workflowName}</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto relative">
            {/* Navigation buttons */}
            {paginatedAssets.length > 1 && (
              <>
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => navigateAsset('prev')}
                  className="absolute left-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full opacity-80 hover:opacity-100"
                >
                  <span className="text-xl">◀</span>
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => navigateAsset('next')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full opacity-80 hover:opacity-100"
                >
                  <span className="text-xl">▶</span>
                </Button>
              </>
            )}
            {previewAsset?.type === 'image' && (
              <img
                src={getAssetUrl(previewAsset)}
                alt={previewAsset.fileName}
                className="max-w-full max-h-[60vh] mx-auto object-contain"
              />
            )}
            {previewAsset?.type === 'video' && (
              <video
                src={getAssetUrl(previewAsset)}
                controls
                className="max-w-full max-h-[60vh] mx-auto"
              />
            )}
            {previewAsset?.type === 'audio' && (
              <div className="flex items-center justify-center p-8">
                <audio
                  src={getAssetUrl(previewAsset)}
                  controls
                  className="w-full max-w-md"
                />
              </div>
            )}
            {(previewAsset?.type === 'text' || previewAsset?.type === 'json') && (
              <div className="p-4 bg-muted rounded-lg text-sm">
                <p className="text-muted-foreground">{t('assets.textPreviewUnavailable')}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            {isDesktopMode ? (
              <Button variant="outline" onClick={() => previewAsset && handleOpenLocation(previewAsset)}>
                <FolderOpen className="mr-2 h-4 w-4" />
                {t('assets.openLocation')}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => previewAsset && handleDownload(previewAsset)}>
                <Download className="mr-2 h-4 w-4" />
                {t('common.download')}
              </Button>
            )}
            <Button variant="outline" onClick={() => previewAsset && handleToggleFavorite(previewAsset)}>
              <Star className={cn("mr-2 h-4 w-4", previewAsset?.favorite && "fill-yellow-400")} />
              {previewAsset?.favorite ? t('assets.unfavorite') : t('assets.favorite')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmAsset} onOpenChange={() => setDeleteConfirmAsset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assets.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('assets.deleteConfirmDesc', { name: deleteConfirmAsset?.fileName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmAsset && handleDelete(deleteConfirmAsset)}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assets.bulkDeleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('assets.bulkDeleteConfirmDesc', { count: selectedIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              {t('assets.deleteSelected', { count: selectedIds.size })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Tag Management Dialog */}
      <Dialog open={!!tagDialogAsset} onOpenChange={() => setTagDialogAsset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assets.manageTags')}</DialogTitle>
            <DialogDescription>
              {t('assets.manageTagsDesc', { name: tagDialogAsset?.fileName })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Current tags */}
            <div className="space-y-2">
              <Label>{t('assets.currentTags')}</Label>
              <div className="flex flex-wrap gap-2">
                {tagDialogAsset?.tags.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('assets.noTags')}</p>
                )}
                {tagDialogAsset?.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                    {tag}
                    <button
                      onClick={() => tagDialogAsset && handleRemoveTag(tagDialogAsset, tag)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>

            {/* Add new tag */}
            <div className="space-y-2">
              <Label>{t('assets.addTag')}</Label>
              <div className="flex gap-2">
                <Input
                  placeholder={t('assets.tagPlaceholder')}
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                  list="tag-suggestions"
                />
                <datalist id="tag-suggestions">
                  {allTags.filter(t => !tagDialogAsset?.tags.includes(t)).map((tag) => (
                    <option key={tag} value={tag} />
                  ))}
                </datalist>
                <Button onClick={handleAddTag} disabled={!newTag.trim()}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagDialogAsset(null)}>
              {t('common.done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
