import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Video, ImageUp, Eraser, Wand2, ArrowRight, MousePointer2, FileVideo, FileAudio, FileImage, Scissors, Combine, Sparkles } from 'lucide-react'

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
      iconGradient: 'from-violet-500 to-purple-600',
      image: videoEnhancerImg
    },
    {
      id: 'image',
      icon: ImageUp,
      titleKey: 'freeTools.imageEnhancer.title',
      descriptionKey: 'freeTools.imageEnhancer.description',
      route: '/free-tools/image',
      gradient: 'from-cyan-500/20 via-blue-500/10 to-transparent',
      iconGradient: 'from-cyan-500 to-blue-600',
      image: imageEnhancerImg
    },
    {
      id: 'background-remover',
      icon: Eraser,
      titleKey: 'freeTools.backgroundRemover.title',
      descriptionKey: 'freeTools.backgroundRemover.description',
      route: '/free-tools/background-remover',
      gradient: 'from-emerald-500/20 via-green-500/10 to-transparent',
      iconGradient: 'from-emerald-500 to-green-600',
      image: backgroundRemoverImg
    },
    {
      id: 'image-eraser',
      icon: Wand2,
      titleKey: 'freeTools.imageEraser.title',
      descriptionKey: 'freeTools.imageEraser.description',
      route: '/free-tools/image-eraser',
      gradient: 'from-orange-500/20 via-red-500/10 to-transparent',
      iconGradient: 'from-orange-500 to-red-600',
      image: imageEraserImg
    },
    {
      id: 'segment-anything',
      icon: MousePointer2,
      titleKey: 'freeTools.segmentAnything.title',
      descriptionKey: 'freeTools.segmentAnything.description',
      route: '/free-tools/segment-anything',
      gradient: 'from-pink-500/20 via-rose-500/10 to-transparent',
      iconGradient: 'from-pink-500 to-rose-600',
      image: SegmentAnythingImg
    },
    {
      id: 'face-enhancer',
      icon: Sparkles,
      titleKey: 'freeTools.faceEnhancer.title',
      descriptionKey: 'freeTools.faceEnhancer.description',
      route: '/free-tools/face-enhancer',
      gradient: 'from-rose-500/20 via-pink-500/10 to-transparent',
      iconGradient: 'from-rose-500 to-pink-600'
      // No image - will show icon placeholder
    },
    {
      id: 'video-converter',
      icon: FileVideo,
      titleKey: 'freeTools.videoConverter.title',
      descriptionKey: 'freeTools.videoConverter.description',
      route: '/free-tools/video-converter',
      gradient: 'from-indigo-500/20 via-blue-500/10 to-transparent',
      iconGradient: 'from-indigo-500 to-blue-600'
      // No image - will show icon placeholder
    },
    {
      id: 'audio-converter',
      icon: FileAudio,
      titleKey: 'freeTools.audioConverter.title',
      descriptionKey: 'freeTools.audioConverter.description',
      route: '/free-tools/audio-converter',
      gradient: 'from-teal-500/20 via-cyan-500/10 to-transparent',
      iconGradient: 'from-teal-500 to-cyan-600'
      // No image - will show icon placeholder
    },
    {
      id: 'image-converter',
      icon: FileImage,
      titleKey: 'freeTools.imageConverter.title',
      descriptionKey: 'freeTools.imageConverter.description',
      route: '/free-tools/image-converter',
      gradient: 'from-amber-500/20 via-yellow-500/10 to-transparent',
      iconGradient: 'from-amber-500 to-yellow-600'
      // No image - will show icon placeholder
    },
    {
      id: 'media-trimmer',
      icon: Scissors,
      titleKey: 'freeTools.mediaTrimmer.title',
      descriptionKey: 'freeTools.mediaTrimmer.description',
      route: '/free-tools/media-trimmer',
      gradient: 'from-red-500/20 via-orange-500/10 to-transparent',
      iconGradient: 'from-red-500 to-orange-600'
      // No image - will show icon placeholder
    },
    {
      id: 'media-merger',
      icon: Combine,
      titleKey: 'freeTools.mediaMerger.title',
      descriptionKey: 'freeTools.mediaMerger.description',
      route: '/free-tools/media-merger',
      gradient: 'from-purple-500/20 via-fuchsia-500/10 to-transparent',
      iconGradient: 'from-purple-500 to-fuchsia-600'
      // No image - will show icon placeholder
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

            {/* Demo image or icon placeholder */}
            <div className="px-3 pt-3 relative z-10">
              <div className="h-24 rounded-lg overflow-hidden bg-muted">
                {tool.image ? (
                  <img
                    src={tool.image}
                    alt={t(tool.titleKey)}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className={`w-full h-full bg-gradient-to-br ${tool.iconGradient} flex items-center justify-center group-hover:scale-105 transition-transform duration-300`}>
                    <tool.icon className="h-10 w-10 text-white/90" />
                  </div>
                )}
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
