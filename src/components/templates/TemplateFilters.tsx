import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { X, Folder, Globe, User, Grid3x3, Image, Video, Music, Sparkle, Star } from 'lucide-react'
import type { TemplateFilter } from '@/types/template'

interface TemplateFiltersProps {
  filter: TemplateFilter
  onChange: (filter: TemplateFilter) => void
  onClear: () => void
}

export function TemplateFilters({ filter, onChange, onClear }: TemplateFiltersProps) {
  const { t } = useTranslation()

  const hasActiveFilters = 
    filter.type || 
    filter.isFavorite !== undefined || 
    filter.category

  return (
    <div className="space-y-4">
      {/* Header with Clear */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">{t('templates.filters')}</h3>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-8 px-2 text-xs"
          >
            <X className="h-3 w-3 mr-1" />
            {t('common.clear')}
          </Button>
        )}
      </div>

      {/* Source Filter */}
      <div>
        <select
          value={filter.type || 'all'}
          onChange={(e) => onChange({ ...filter, type: e.target.value === 'all' ? undefined : e.target.value as 'public' | 'custom' })}
          className="w-full px-3 py-2 text-sm border rounded-lg bg-card hover:bg-accent/50 transition-colors cursor-pointer"
        >
          <option value="all">
            {t('templates.source')}
          </option>
          <option value="public">
            {t('templates.public')}
          </option>
          <option value="custom">
            {t('templates.myTemplates')}
          </option>
        </select>
      </div>

      {/* Category Filter (for workflow templates) */}
      {filter.templateType === 'workflow' && (
        <div>
          <select
            value={filter.category || 'all'}
            onChange={(e) => onChange({ ...filter, category: e.target.value === 'all' ? undefined : e.target.value })}
            className="w-full px-3 py-2 text-sm border rounded-lg bg-card hover:bg-accent/50 transition-colors cursor-pointer"
          >
            <option value="all">
              {t('templates.category')}
            </option>
            <option value="image-processing">
              {t('templates.imageProcessing')}
            </option>
            <option value="video-editing">
              {t('templates.videoEditing')}
            </option>
            <option value="audio-conversion">
              {t('templates.audioConversion')}
            </option>
            <option value="ai-generation">
              {t('templates.aiGeneration')}
            </option>
          </select>
        </div>
      )}

      {/* Favorites Toggle */}
      <div className="flex items-center space-x-2 pt-2">
        <Checkbox
          id="favorites"
          checked={filter.isFavorite === true}
          onCheckedChange={(checked) => 
            onChange({ 
              ...filter, 
              isFavorite: checked ? true : undefined
            })
          }
        />
        <Label htmlFor="favorites" className="font-normal cursor-pointer text-sm flex items-center gap-2">
          <Star className="h-3.5 w-3.5" />
          {t('templates.favoritesOnly')}
        </Label>
      </div>
    </div>
  )
}
