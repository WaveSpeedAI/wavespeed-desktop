import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAssetsStore } from '@/stores/assetsStore'
import type { AssetMetadata, AssetType, AssetsFilter } from '@/types/asset'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Search, Image, Video, Music, File, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const TYPE_FILTERS = ['all', 'image', 'video', 'audio'] as const

export function AssetsPanel() {
  const { t } = useTranslation()
  const { assets, isLoaded, loadAssets, getFilteredAssets } = useAssetsStore()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  useEffect(() => {
    if (!isLoaded) loadAssets()
  }, [isLoaded, loadAssets])

  const filteredAssets = useMemo(() => {
    const filter: AssetsFilter = {}
    if (search) filter.search = search
    if (typeFilter !== 'all') filter.types = [typeFilter as AssetType]
    return getFilteredAssets(filter)
  }, [getFilteredAssets, search, typeFilter, assets])

  const getAssetUrl = useCallback((asset: AssetMetadata) => {
    if (asset.filePath) return `local-file://${asset.filePath}`
    return asset.originalUrl || ''
  }, [])

  const getTypeIcon = (type: AssetType) => {
    switch (type) {
      case 'image': return <Image className="h-4 w-4" />
      case 'video': return <Video className="h-4 w-4" />
      case 'audio': return <Music className="h-4 w-4" />
      default: return <File className="h-4 w-4" />
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-4 pt-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('assets.searchPlaceholder', 'Search assets...')}
            className="w-full h-10 pl-9 pr-8 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Type filter */}
      <div className="px-4 pb-3 flex gap-2">
        {TYPE_FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setTypeFilter(f)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize',
              typeFilter === f
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            )}
          >
            {f === 'all' ? t('playground.explore.all', 'All') : f}
          </button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 pb-4">
          {filteredAssets.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t('assets.noAssets', 'No assets yet')}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {filteredAssets.slice(0, 50).map((asset) => {
                const url = getAssetUrl(asset)
                return (
                  <div
                    key={asset.id}
                    className="group relative aspect-square rounded-lg overflow-hidden bg-muted border border-border/50 hover:border-primary/30 transition-all cursor-pointer"
                  >
                    {asset.type === 'image' ? (
                      <img src={url} alt={asset.fileName} className="w-full h-full object-cover" loading="lazy" />
                    ) : asset.type === 'video' ? (
                      <div className="w-full h-full flex items-center justify-center bg-muted">
                        <Video className="h-8 w-8 text-muted-foreground" />
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted">
                        {getTypeIcon(asset.type)}
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-[10px] text-white truncate">{asset.fileName}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
