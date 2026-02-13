import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Video, ImageUp, Eraser, Wand2, ArrowRight, MousePointer2, FileVideo, FileAudio, FileImage, Scissors, Combine, Sparkles, ArrowLeftRight } from 'lucide-react'

// Import tool demo images
import videoEnhancerImg from '../../build/images/VideoEnhancer.jpeg'
import imageEnhancerImg from '../../build/images/ImageEnhancer.jpeg'
import faceEnhancerImg from '../../build/images/FaceEnhancer.jpeg'
import faceSwapperImg from '../../build/images/FaceSwapper.jpeg'
import backgroundRemoverImg from '../../build/images/BackgroundRemover.jpeg'
import imageEraserImg from '../../build/images/ImageEraser.jpeg'
import SegmentAnythingImg from '../../build/images/SegmentAnything.png'
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
      route: '/free-tools/video-enhancer',
      gradient: 'from-violet-500/20 via-purple-500/10 to-transparent',
      image: videoEnhancerImg
    },
    {
      id: 'image',
      icon: ImageUp,
      titleKey: 'freeTools.imageEnhancer.title',
      descriptionKey: 'freeTools.imageEnhancer.description',
      route: '/free-tools/image-enhancer',
      gradient: 'from-cyan-500/20 via-blue-500/10 to-transparent',
      image: imageEnhancerImg
    },
    {
      id: 'face-enhancer',
      icon: Sparkles,
      titleKey: 'freeTools.faceEnhancer.title',
      descriptionKey: 'freeTools.faceEnhancer.description',
      route: '/free-tools/face-enhancer',
      gradient: 'from-rose-500/20 via-pink-500/10 to-transparent',
      image: faceEnhancerImg
    },
    {
      id: 'face-swapper',
      icon: ArrowLeftRight,
      titleKey: 'freeTools.faceSwapper.title',
      descriptionKey: 'freeTools.faceSwapper.description',
      route: '/free-tools/face-swapper',
      gradient: 'from-amber-500/20 via-orange-500/10 to-transparent',
      image: faceSwapperImg
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
      gradient: 'from-indigo-500/20 via-blue-500/10 to-transparent',
      image: freeToolImg
    },
    {
      id: 'audio-converter',
      icon: FileAudio,
      titleKey: 'freeTools.audioConverter.title',
      descriptionKey: 'freeTools.audioConverter.description',
      route: '/free-tools/audio-converter',
      gradient: 'from-teal-500/20 via-cyan-500/10 to-transparent',
      image: freeToolImg
    },
    {
      id: 'image-converter',
      icon: FileImage,
      titleKey: 'freeTools.imageConverter.title',
      descriptionKey: 'freeTools.imageConverter.description',
      route: '/free-tools/image-converter',
      gradient: 'from-amber-500/20 via-yellow-500/10 to-transparent',
      image: freeToolImg
    },
    {
      id: 'media-trimmer',
      icon: Scissors,
      titleKey: 'freeTools.mediaTrimmer.title',
      descriptionKey: 'freeTools.mediaTrimmer.description',
      route: '/free-tools/media-trimmer',
      gradient: 'from-red-500/20 via-orange-500/10 to-transparent',
      image: freeToolImg
    },
    {
      id: 'media-merger',
      icon: Combine,
      titleKey: 'freeTools.mediaMerger.title',
      descriptionKey: 'freeTools.mediaMerger.description',
      route: '/free-tools/media-merger',
      gradient: 'from-purple-500/20 via-fuchsia-500/10 to-transparent',
      image: freeToolImg
    }
  ]

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-background via-background to-muted/20 pt-12 md:pt-0">
      <div className="page-header border-b border-border/70 bg-background/70 px-4 py-4 backdrop-blur md:px-6">
        <div className="flex flex-col gap-1.5 md:flex-row md:items-baseline md:gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold md:text-3xl">
            <Sparkles className="h-6 w-6 text-primary" />
            {t('freeTools.title')}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground md:text-base">{t('freeTools.description')}</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-6">
          {tools.map((tool) => (
            <Card
              key={tool.id}
              className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-border/70 bg-card/80 shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-lg"
              onClick={() => navigate(tool.route)}
            >
              {/* Decorative gradient background */}
              <div className={`absolute right-0 top-0 h-32 w-32 rounded-full bg-gradient-to-bl ${tool.gradient} opacity-60 blur-2xl transition-all duration-500 group-hover:scale-125 group-hover:opacity-100`} />
              <div className={`absolute bottom-0 left-0 h-24 w-24 rounded-full bg-gradient-to-tr ${tool.gradient} opacity-40 blur-xl transition-all duration-500 group-hover:opacity-70`} />

              {/* Demo image */}
              <div className="relative z-10 px-4 pt-4">
                <div className="h-32 overflow-hidden rounded-lg border border-border/60 bg-muted flex items-center justify-center">
                  {tool.image ? (
                    <img
                      src={tool.image}
                      alt={t(tool.titleKey)}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <tool.icon className="h-12 w-12 text-muted-foreground/30 transition-colors group-hover:text-primary/50" />
                  )}
                </div>
              </div>

              <CardHeader className="relative z-10 pt-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2 transition-colors group-hover:bg-primary/20">
                    <tool.icon className="h-4 w-4 text-primary" />
                  </div>
                  <CardTitle className="text-base">{t(tool.titleKey)}</CardTitle>
                </div>
                <CardDescription className="mt-2 text-sm">
                  <span className="line-clamp-2 leading-relaxed">{t(tool.descriptionKey)}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="relative z-10 mt-auto pt-0">
                <Button
                  variant="ghost"
                  className="w-full justify-between rounded-lg group-hover:bg-primary/5"
                >
                  <span>{t('common.open')}</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
