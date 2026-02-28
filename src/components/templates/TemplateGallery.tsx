import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTemplateStore } from '@/stores/templateStore'
import { TemplateCard } from './TemplateCard'
import { TemplateFilters } from './TemplateFilters'
import { TemplateSearch } from './TemplateSearch'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, FolderOpen, ArrowUpDown } from 'lucide-react'
import type { Template, TemplateFilter } from '@/types/template'

interface TemplateGalleryProps {
  onUseTemplate: (template: Template) => void
  onEditTemplate?: (template: Template) => void
  onDeleteTemplate?: (template: Template) => void
  onExportTemplate?: (template: Template) => void
  initialFilter?: TemplateFilter
  showFilters?: boolean
  externalSearch?: string
}

export function TemplateGallery({
  onUseTemplate,
  onEditTemplate,
  onDeleteTemplate,
  onExportTemplate,
  initialFilter = {},
  showFilters = true,
  externalSearch,
}: TemplateGalleryProps) {
  const { t } = useTranslation()
  const { templates, isLoading, error, loadTemplates, toggleFavorite, setFilter, currentFilter } = useTemplateStore()
  const [searchQuery, setSearchQuery] = useState('')
  const prevSearchRef = useRef(searchQuery)

  // Use external search when provided, otherwise use internal
  const effectiveSearch = externalSearch !== undefined ? externalSearch : searchQuery

  // Sync filter whenever initialFilter props change
  useEffect(() => {
    const filter = { ...initialFilter, search: effectiveSearch }
    setFilter(filter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFilter?.templateType, initialFilter?.type, initialFilter?.category, initialFilter?.isFavorite])

  // Update filter when search query changes (skip initial mount)
  useEffect(() => {
    if (prevSearchRef.current === effectiveSearch) return
    prevSearchRef.current = effectiveSearch
    // Use store's current filter to avoid stale closure
    const storeFilter = useTemplateStore.getState().currentFilter
    setFilter({ ...storeFilter, search: effectiveSearch })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSearch])

  const handleFilterChange = (newFilter: TemplateFilter) => {
    setFilter({ ...newFilter, search: effectiveSearch })
  }

  const handleClearFilters = () => {
    setFilter({ search: effectiveSearch })
  }

  const handleToggleFavorite = async (template: Template) => {
    await toggleFavorite(template.id)
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-destructive mb-2">{t('common.error')}</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            onClick={() => loadTemplates(currentFilter)}
            className="mt-4"
          >
            {t('common.retry')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-6 h-full">
      {/* Sidebar Filters */}
      {showFilters && (
        <aside className="w-64 flex-shrink-0">
          <div className="sticky top-4">
            <TemplateFilters
              filter={currentFilter}
              onChange={handleFilterChange}
              onClear={handleClearFilters}
            />
          </div>
        </aside>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Search and Filters Bar */}
        <div className="mb-6">
          <div className="flex items-center gap-3">
            {/* Search Bar — hidden when external search is provided */}
            {externalSearch === undefined && (
              <div className="w-64">
                <TemplateSearch
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
              </div>
            )}

            {/* Sort By Dropdown */}
            <div className="relative">
              <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <select
                value={currentFilter.sortBy || 'updatedAt'}
                onChange={(e) => handleFilterChange({ ...currentFilter, sortBy: e.target.value as 'updatedAt' | 'useCount' })}
                className="pl-9 pr-3 py-2 text-sm border rounded-lg bg-card hover:bg-accent/50 transition-colors cursor-pointer min-w-[130px] appearance-none"
              >
                <option value="updatedAt">{t('templates.newest')}</option>
                <option value="useCount">{t('templates.mostUsed')}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty State */}
        {!isLoading && templates.length === 0 && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <FolderOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">{t('templates.noTemplates')}</h3>
              <p className="text-sm text-muted-foreground">
                {effectiveSearch || currentFilter.templateType || currentFilter.type || currentFilter.isFavorite
                  ? t('templates.noResultsDesc')
                  : t('templates.noTemplatesDesc')}
              </p>
            </div>
          </div>
        )}

        {/* Templates Grid */}
        {!isLoading && templates.length > 0 && (
          <ScrollArea className="flex-1">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 pb-4">
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onUse={onUseTemplate}
                  onEdit={onEditTemplate}
                  onDelete={onDeleteTemplate}
                  onExport={onExportTemplate}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
