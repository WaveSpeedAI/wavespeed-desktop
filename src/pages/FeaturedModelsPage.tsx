import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useModelsStore } from '@/stores/modelsStore'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowLeft, PlayCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

// Featured model families with all variants
const FEATURED_MODEL_FAMILIES = [
  {
    name: 'Seedream 4.5',
    provider: 'bytedance',
    poster: 'https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1764761216479761378_Yy864da9.png',
    variants: [
      { id: 'bytedance/seedream-v4.5', type: 'text-to-image' },
      { id: 'bytedance/seedream-v4.5/edit', type: 'image-to-image' },
      { id: 'bytedance/seedream-v4.5/edit-sequential', type: 'image-to-image' },
      { id: 'bytedance/seedream-v4.5/sequential', type: 'text-to-image' },
    ],
    primaryVariant: 'bytedance/seedream-v4.5',
    category: 'image' as const,
  },
  {
    name: 'Seedance 1.5 Pro',
    provider: 'bytedance',
    poster: 'https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1766494048998434655_qEMLsAI0.png',
    variants: [
      { id: 'bytedance/seedance-v1.5-pro/image-to-video', type: 'image-to-video' },
      { id: 'bytedance/seedance-v1.5-pro/text-to-video', type: 'text-to-video' },
      { id: 'bytedance/seedance-v1.5-pro/image-to-video-fast', type: 'image-to-video' },
      { id: 'bytedance/seedance-v1.5-pro/text-to-video-fast', type: 'text-to-video' },
      { id: 'bytedance/seedance-v1.5-pro/video-extend', type: 'video-extend' },
      { id: 'bytedance/seedance-v1.5-pro/video-extend-fast', type: 'video-extend' },
    ],
    primaryVariant: 'bytedance/seedance-v1.5-pro/image-to-video',
    category: 'video' as const,
  },
  {
    name: 'Wan Spicy',
    provider: 'wavespeed-ai',
    poster: 'https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1766298334453523753_f975da96.png',
    variants: [
      { id: 'wavespeed-ai/wan-2.2-spicy/image-to-video', type: 'image-to-video' },
      { id: 'wavespeed-ai/wan-2.2-spicy/image-to-video-lora', type: 'lora-support' },
      { id: 'wavespeed-ai/wan-2.2-spicy/video-extend', type: 'video-extend' },
      { id: 'wavespeed-ai/wan-2.2-spicy/video-extend-lora', type: 'lora-support' },
    ],
    primaryVariant: 'wavespeed-ai/wan-2.2-spicy/image-to-video',
    category: 'video' as const,
  },
  {
    name: 'Wan Animate',
    provider: 'wavespeed-ai',
    poster: 'https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1758433474532574441_SkTQLIEA.jpeg',
    variants: [
      { id: 'wavespeed-ai/wan-2.2/animate', type: 'motion-control' },
    ],
    primaryVariant: 'wavespeed-ai/wan-2.2/animate',
    category: 'other' as const,
  },
  {
    name: 'InfiniteTalk',
    provider: 'wavespeed-ai',
    poster: 'https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1766575571686877852_Sckigeck.png',
    variants: [
      { id: 'wavespeed-ai/infinitetalk', type: 'digital-human' },
      { id: 'wavespeed-ai/infinitetalk/multi', type: 'digital-human' },
      { id: 'wavespeed-ai/infinitetalk/video-to-video', type: 'digital-human' },
      { id: 'wavespeed-ai/infinitetalk-fast', type: 'digital-human' },
      { id: 'wavespeed-ai/infinitetalk-fast/multi', type: 'digital-human' },
      { id: 'wavespeed-ai/infinitetalk-fast/video-to-video', type: 'digital-human' },
    ],
    primaryVariant: 'wavespeed-ai/infinitetalk',
    category: 'other' as const,
  },
  {
    name: 'Kling 2.6 Motion Control',
    provider: 'kwaivgi',
    poster: 'https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1766519115490596160_Smusqomu.png',
    variants: [
      { id: 'kwaivgi/kling-v2.6-pro/motion-control', type: 'motion-control' },
      { id: 'kwaivgi/kling-v2.6-std/motion-control', type: 'motion-control' },
    ],
    primaryVariant: 'kwaivgi/kling-v2.6-pro/motion-control',
    category: 'other' as const,
  },
  {
    name: 'Nano Banana Pro',
    provider: 'google',
    poster: 'https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1763649945119973876_WvMIEAxu.jpg',
    variants: [
      { id: 'google/nano-banana-pro/text-to-image', type: 'text-to-image' },
      { id: 'google/nano-banana-pro/text-to-image-ultra', type: 'text-to-image' },
      { id: 'google/nano-banana-pro/text-to-image-multi', type: 'text-to-image' },
      { id: 'google/nano-banana-pro/edit', type: 'image-to-image' },
      { id: 'google/nano-banana-pro/edit-ultra', type: 'image-to-image' },
      { id: 'google/nano-banana-pro/edit-multi', type: 'image-to-image' },
    ],
    primaryVariant: 'google/nano-banana-pro/text-to-image',
    category: 'image' as const,
  },
]

function getCategoryAccent(category: 'image' | 'video' | 'other') {
  switch (category) {
    case 'video':
      return {
        bar: 'from-purple-500 to-violet-500',
        badge: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
        border: 'hover:border-purple-500/40',
      }
    case 'image':
      return {
        bar: 'from-sky-400 to-blue-500',
        badge: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
        border: 'hover:border-blue-500/40',
      }
    default:
      return {
        bar: 'from-emerald-400 to-teal-500',
        badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
        border: 'hover:border-emerald-500/40',
      }
  }
}

export function FeaturedModelsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { models, fetchModels } = useModelsStore()
  const { isValidated } = useApiKeyStore()

  useEffect(() => {
    if (isValidated) {
      fetchModels()
    }
  }, [isValidated, fetchModels])

  const getPrice = (modelId: string) => {
    const model = models.find(m => m.model_id === modelId)
    return model?.base_price
  }

  return (
    <div className="flex h-full flex-col relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-orange-500/5" />

      {/* Header */}
      <div className="page-header px-6 py-4 relative z-10">
        <div className="flex items-center gap-3 mb-1">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('welcome.featuredModels.title')}</h1>
            <p className="text-muted-foreground text-sm">{t('welcome.featuredModels.description')}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
          {FEATURED_MODEL_FAMILIES.map((family) => {
            const accent = getCategoryAccent(family.category)
            const price = getPrice(family.primaryVariant)
            const uniqueTypes = [...new Set(family.variants.map(v => v.type))]

            return (
              <div
                key={family.name}
                className={cn(
                  "group cursor-pointer rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm transition-all duration-300 hover:shadow-lg hover:scale-[1.02] overflow-hidden",
                  accent.border
                )}
                onClick={() => navigate(`/playground/${family.primaryVariant}`)}
              >
                {/* Cover image */}
                <div className="relative aspect-[3/4] overflow-hidden bg-muted">
                  <img
                    src={family.poster}
                    alt={family.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white leading-tight drop-shadow-md">
                        {family.name}
                      </h3>
                      <p className="text-[10px] text-white/70">{family.provider}</p>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0 font-medium bg-black/40 text-white border-0">
                      {family.variants.length === 1 ? '1 variant' : `${family.variants.length} variants`}
                    </Badge>
                  </div>
                </div>

                <div className="p-4">

                  {/* Type tags */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {uniqueTypes.map((type) => (
                      <span
                        key={type}
                        className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", accent.badge)}
                      >
                        {type}
                      </span>
                    ))}
                  </div>

                  {/* Variants list */}
                  <div className="space-y-1 mb-3">
                    {family.variants.map((variant) => (
                      <button
                        key={variant.id}
                        className="w-full text-left text-xs text-muted-foreground hover:text-primary transition-colors truncate flex items-center gap-1.5 py-0.5"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/playground/${variant.id}`)
                        }}
                      >
                        <PlayCircle className="h-3 w-3 shrink-0 opacity-50" />
                        <span className="truncate font-mono">{variant.id}</span>
                      </button>
                    ))}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-2 border-t border-border/30">
                    {price !== undefined ? (
                      <span className="text-sm font-bold text-primary">${price.toFixed(4)}</span>
                    ) : (
                      <span />
                    )}
                    <div className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                      <PlayCircle className="h-3.5 w-3.5" />
                      <span>Try it</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
