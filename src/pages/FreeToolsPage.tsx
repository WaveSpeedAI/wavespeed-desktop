import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Video, ImageUp, Eraser, Wand2, ArrowRight, MousePointer2 } from 'lucide-react'

// Import tool demo images
import videoEnhancerImg from '../../build/images/VideoEnhancer.jpeg'
import imageEnhancerImg from '../../build/images/ImageEnhancer.jpeg'
import backgroundRemoverImg from '../../build/images/BackgroundRemover.jpeg'
import imageEraserImg from '../../build/images/ImageEraser.jpeg'
import freeToolImg from '../../build/images/FreeTool.jpeg'

export function FreeToolsPage() {
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
      image: freeToolImg
    }
  ]

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{t('freeTools.title')}</h1>
        <p className="text-muted-foreground mt-1">
          {t('freeTools.description')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-6 max-w-6xl">
        {tools.map((tool) => (
          <Card
            key={tool.id}
            className="group cursor-pointer hover:shadow-lg transition-all duration-200 hover:border-primary/50 flex flex-col relative overflow-hidden"
            onClick={() => navigate(tool.route)}
          >
            {/* Decorative gradient background */}
            <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl ${tool.gradient} rounded-full blur-2xl opacity-60 group-hover:opacity-100 group-hover:scale-125 transition-all duration-500`} />
            <div className={`absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr ${tool.gradient} rounded-full blur-xl opacity-40 group-hover:opacity-70 transition-all duration-500`} />
            
            {/* Demo image */}
            <div className="px-4 pt-4 relative z-10">
              <div className="h-32 rounded-lg overflow-hidden bg-muted">
                <img 
                  src={tool.image} 
                  alt={t(tool.titleKey)}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
            </div>
            
            <CardHeader className="relative z-10 pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <tool.icon className="h-4 w-4 text-primary" />
                </div>
                <CardTitle className="text-base">{t(tool.titleKey)}</CardTitle>
              </div>
              <CardDescription className="mt-2 text-sm">
                {t(tool.descriptionKey)}
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto relative z-10 pt-0">
              <Button
                variant="ghost"
                className="w-full justify-between group-hover:bg-primary/5"
              >
                <span>{t('common.open')}</span>
                <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
