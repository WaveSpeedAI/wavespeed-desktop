import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Video, ImageUp, Eraser, Wand2, ArrowRight, MousePointer2, FileVideo } from 'lucide-react'

// Import tool demo images
import videoEnhancerImg from '../../../build/images/VideoEnhancer.jpeg'
import imageEnhancerImg from '../../../build/images/ImageEnhancer.jpeg'
import backgroundRemoverImg from '../../../build/images/BackgroundRemover.jpeg'
import imageEraserImg from '../../../build/images/ImageEraser.jpeg'
import SegmentAnythingImg from '../../../build/images/SegmentAnything.png'

export function MobileFreeToolsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const tools = [
    {
      id: 'video',
      icon: Video,
      titleKey: 'freeTools.videoEnhancer.title',
      descriptionKey: 'freeTools.videoEnhancer.description',
      route: '/free-tools/video',
      gradient: 'from-violet-500/20 via-purple-500/10 to-transparent',
      image: videoEnhancerImg
    },
    {
      id: 'image',
      icon: ImageUp,
      titleKey: 'freeTools.imageEnhancer.title',
      descriptionKey: 'freeTools.imageEnhancer.description',
      route: '/free-tools/image',
      gradient: 'from-cyan-500/20 via-blue-500/10 to-transparent',
      image: imageEnhancerImg
    },
    {
      id: 'background-remover',
      icon: Eraser,
      titleKey: 'freeTools.backgroundRemover.title',
      descriptionKey: 'freeTools.backgroundRemover.description',
      route: '/free-tools/background-remover',
      gradient: 'from-emerald-500/20 via-green-500/10 to-transparent',
      image: backgroundRemoverImg
    },
    {
      id: 'image-eraser',
      icon: Wand2,
      titleKey: 'freeTools.imageEraser.title',
      descriptionKey: 'freeTools.imageEraser.description',
      route: '/free-tools/image-eraser',
      gradient: 'from-orange-500/20 via-red-500/10 to-transparent',
      image: imageEraserImg
    },
    {
      id: 'segment-anything',
      icon: MousePointer2,
      titleKey: 'freeTools.segmentAnything.title',
      descriptionKey: 'freeTools.segmentAnything.description',
      route: '/free-tools/segment-anything',
      gradient: 'from-pink-500/20 via-rose-500/10 to-transparent',
      image: SegmentAnythingImg
    },
    {
      id: 'video-converter',
      icon: FileVideo,
      titleKey: 'freeTools.videoConverter.title',
      descriptionKey: 'freeTools.videoConverter.description',
      route: '/free-tools/video-converter',
      gradient: 'from-blue-500/20 via-indigo-500/10 to-transparent',
      image: videoEnhancerImg // Reuse video enhancer image for now
    }
  ]

  return (
    <div className="p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('freeTools.title')}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t('freeTools.description')}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {tools.map((tool) => (
          <Card
            key={tool.id}
            className="group cursor-pointer hover:shadow-lg transition-all duration-200 hover:border-primary/50 flex flex-col relative overflow-hidden"
            onClick={() => navigate(tool.route)}
          >
            {/* Decorative gradient background */}
            <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl ${tool.gradient} rounded-full blur-2xl opacity-60 group-hover:opacity-100 group-hover:scale-125 transition-all duration-500`} />

            {/* Demo image */}
            <div className="px-3 pt-3 relative z-10">
              <div className="h-24 rounded-lg overflow-hidden bg-muted">
                <img
                  src={tool.image}
                  alt={tool.title || t(tool.titleKey)}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
            </div>

            <CardHeader className="relative z-10 pt-3 pb-2 px-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <tool.icon className="h-3.5 w-3.5 text-primary" />
                </div>
                <CardTitle className="text-sm">{tool.title || t(tool.titleKey)}</CardTitle>
              </div>
              <CardDescription className="mt-1.5 text-xs line-clamp-2">
                {tool.description || t(tool.descriptionKey)}
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto relative z-10 pt-0 px-3 pb-3">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between group-hover:bg-primary/5 h-8"
              >
                <span className="text-xs">{t('common.open')}</span>
                <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
