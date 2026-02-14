/**
 * TemplateBrowser — reusable template browsing UI with left sidebar filters + gallery grid.
 * Used by both TemplatesPage (full page) and WorkflowTemplateDialog (modal).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TemplateGallery } from './TemplateGallery'
import { Folder, Globe, User, Star, Grid3x3, Image, Video, Music, Sparkle } from 'lucide-react'
import type { Template } from '@/types/template'

interface TemplateBrowserProps {
  templateType: 'playground' | 'workflow'
  onUseTemplate: (template: Template) => void
  onEditTemplate?: (template: Template) => void
  onDeleteTemplate?: (template: Template) => void
  onExportTemplate?: (template: Template) => void
}

export function TemplateBrowser({
  templateType,
  onUseTemplate,
  onEditTemplate,
  onDeleteTemplate,
  onExportTemplate,
}: TemplateBrowserProps) {
  const { t } = useTranslation()
  const [sourceFilter, setSourceFilter] = useState<'public' | 'custom' | 'favorites' | undefined>(undefined)
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined)

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left Sidebar Navigation */}
      <aside className="w-48 flex-shrink-0 border-r border-border/50 py-4 px-3 overflow-y-auto">
        <div className="space-y-5">
          {/* Source Filter */}
          <div className="space-y-0.5">
            <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t('templates.source')}
            </h3>
            {([
              { key: undefined, icon: <Folder className="h-4 w-4" />, label: t('templates.allSources') },
              { key: 'public' as const, icon: <Globe className="h-4 w-4" />, label: t('templates.public') },
              { key: 'custom' as const, icon: <User className="h-4 w-4" />, label: t('templates.myTemplates') },
              { key: 'favorites' as const, icon: <Star className="h-4 w-4" />, label: t('templates.favorites') },
            ] as const).map(opt => (
              <button
                key={opt.key ?? 'all'}
                onClick={() => setSourceFilter(opt.key)}
                className={`w-full flex items-center gap-3 ml-1 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  sourceFilter === opt.key
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>

          {/* Category Filter (only for workflow) */}
          {templateType === 'workflow' && (
            <div className="space-y-0.5">
              <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {t('templates.category')}
              </h3>
              {([
                { key: undefined, icon: <Grid3x3 className="h-4 w-4" />, label: t('templates.allCategories') },
                { key: 'image-processing', icon: <Image className="h-4 w-4" />, label: t('templates.imageProcessing') },
                { key: 'video-editing', icon: <Video className="h-4 w-4" />, label: t('templates.videoEditing') },
                { key: 'audio-conversion', icon: <Music className="h-4 w-4" />, label: t('templates.audioConversion') },
                { key: 'ai-generation', icon: <Sparkle className="h-4 w-4" />, label: t('templates.aiGeneration') },
              ] as const).map(opt => (
                <button
                  key={opt.key ?? 'all'}
                  onClick={() => setCategoryFilter(opt.key)}
                  className={`w-full flex items-center gap-3 ml-1 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    categoryFilter === opt.key
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content — Gallery */}
      <div className="flex-1 flex flex-col overflow-hidden px-5 py-4">
        <div className="flex-1 overflow-hidden">
          <TemplateGallery
            initialFilter={{
              templateType,
              type: sourceFilter === 'favorites' ? undefined : sourceFilter,
              category: categoryFilter,
              isFavorite: sourceFilter === 'favorites' ? true : undefined,
            }}
            onUseTemplate={onUseTemplate}
            onEditTemplate={onEditTemplate}
            onDeleteTemplate={onDeleteTemplate}
            onExportTemplate={onExportTemplate}
            showFilters={false}
          />
        </div>
      </div>
    </div>
  )
}
