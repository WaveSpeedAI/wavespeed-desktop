import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNavigation } from './BottomNavigation'
import { MobileHeader } from './MobileHeader'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { Loader2 } from 'lucide-react'
import { VideoEnhancerPage } from '@/pages/VideoEnhancerPage'
import { ImageEnhancerPage } from '@/pages/ImageEnhancerPage'
import { BackgroundRemoverPage } from '@/pages/BackgroundRemoverPage'
import { MobileImageEraserPage } from '@mobile/pages/MobileImageEraserPage'
import { MobileSegmentAnythingPage } from '@mobile/pages/MobileSegmentAnythingPage'
import { VideoConverterPage } from '@mobile/pages/VideoConverterPage'
import { AudioConverterPage } from '@mobile/pages/AudioConverterPage'
import { ImageConverterPage } from '@mobile/pages/ImageConverterPage'
import { MediaTrimmerPage } from '@mobile/pages/MediaTrimmerPage'
import { MediaMergerPage } from '@mobile/pages/MediaMergerPage'
import { FaceEnhancerPage } from '@mobile/pages/FaceEnhancerPage'
import { ErrorBoundary } from '@mobile/components/shared/ErrorBoundary'
import { WelcomePage } from '@/pages/WelcomePage'

export function MobileLayout() {
  const location = useLocation()

  // Track which persistent pages have been visited (to delay initial mount)
  const [visitedPages, setVisitedPages] = useState<Set<string>>(new Set())

  const { isLoading: isLoadingApiKey, isValidated } = useApiKeyStore()

  // Track visits to persistent pages
  useEffect(() => {
    const persistentPaths = [
      '/free-tools/video',
      '/free-tools/image',
      '/free-tools/face-enhancer',
      '/free-tools/background-remover',
      '/free-tools/image-eraser',
      '/free-tools/segment-anything',
      '/free-tools/video-converter',
      '/free-tools/audio-converter',
      '/free-tools/image-converter',
      '/free-tools/media-trimmer',
      '/free-tools/media-merger'
    ]
    if (persistentPaths.includes(location.pathname)) {
      if (!visitedPages.has(location.pathname)) {
        setVisitedPages(prev => new Set(prev).add(location.pathname))
      }
    }
  }, [location.pathname, visitedPages])

  // Pages that don't require API key
  const publicPaths = ['/', '/settings', '/templates', '/assets', '/free-tools']
  const isPublicPage = publicPaths.some(path =>
    location.pathname === path || location.pathname.startsWith(path + '/')
  )

  // Show loading state while API key is being loaded
  if (isLoadingApiKey) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Check if current page requires login
  const requiresLogin = !isValidated && !isPublicPage

  // Free tools paths for conditional rendering
  const freeToolsPaths = [
    '/free-tools/video',
    '/free-tools/image',
    '/free-tools/face-enhancer',
    '/free-tools/background-remover',
    '/free-tools/image-eraser',
    '/free-tools/segment-anything',
    '/free-tools/video-converter',
    '/free-tools/audio-converter',
    '/free-tools/image-converter',
    '/free-tools/media-trimmer',
    '/free-tools/media-merger'
  ]
  const isFreeToolsPage = freeToolsPaths.includes(location.pathname)

  // Welcome page content for users without API key
  const welcomeContent = <WelcomePage />

  return (
    <TooltipProvider>
      <div className="flex flex-col h-[100dvh] bg-background">
        {/* Header */}
        <MobileHeader />

        {/* Main content area */}
        <main className="flex-1 overflow-hidden pb-14">
          {requiresLogin ? welcomeContent : (
            <>
              {/* Regular routes via Outlet */}
              <div className={isFreeToolsPage ? 'hidden' : 'h-full overflow-auto'}>
                <Outlet />
              </div>

              {/* Persistent Free Tools pages */}
              {visitedPages.has('/free-tools/video') && (
                <div className={location.pathname === '/free-tools/video' ? 'h-full overflow-auto' : 'hidden'}>
                  <ErrorBoundary><VideoEnhancerPage /></ErrorBoundary>
                </div>
              )}
              {visitedPages.has('/free-tools/image') && (
                <div className={location.pathname === '/free-tools/image' ? 'h-full overflow-auto' : 'hidden'}>
                  <ErrorBoundary><ImageEnhancerPage /></ErrorBoundary>
                </div>
              )}
              {visitedPages.has('/free-tools/background-remover') && (
                <div className={location.pathname === '/free-tools/background-remover' ? 'h-full overflow-auto' : 'hidden'}>
                  <ErrorBoundary><BackgroundRemoverPage /></ErrorBoundary>
                </div>
              )}
              {visitedPages.has('/free-tools/image-eraser') && (
                <div className={location.pathname === '/free-tools/image-eraser' ? 'h-full overflow-auto' : 'hidden'}>
                  <ErrorBoundary><MobileImageEraserPage /></ErrorBoundary>
                </div>
              )}
              {visitedPages.has('/free-tools/segment-anything') && (
                <div className={location.pathname === '/free-tools/segment-anything' ? 'h-full overflow-auto' : 'hidden'}>
                  <ErrorBoundary><MobileSegmentAnythingPage /></ErrorBoundary>
                </div>
              )}
              {visitedPages.has('/free-tools/video-converter') && (
                <div className={location.pathname === '/free-tools/video-converter' ? 'h-full overflow-auto' : 'hidden'}>
                  <ErrorBoundary><VideoConverterPage /></ErrorBoundary>
                </div>
              )}
              {visitedPages.has('/free-tools/face-enhancer') && (
                <div className={location.pathname === '/free-tools/face-enhancer' ? 'h-full overflow-auto' : 'hidden'}>
                  <ErrorBoundary><FaceEnhancerPage /></ErrorBoundary>
                </div>
              )}
              {visitedPages.has('/free-tools/audio-converter') && (
                <div className={location.pathname === '/free-tools/audio-converter' ? 'h-full overflow-auto' : 'hidden'}>
                  <ErrorBoundary><AudioConverterPage /></ErrorBoundary>
                </div>
              )}
              {visitedPages.has('/free-tools/image-converter') && (
                <div className={location.pathname === '/free-tools/image-converter' ? 'h-full overflow-auto' : 'hidden'}>
                  <ErrorBoundary><ImageConverterPage /></ErrorBoundary>
                </div>
              )}
              {visitedPages.has('/free-tools/media-trimmer') && (
                <div className={location.pathname === '/free-tools/media-trimmer' ? 'h-full overflow-auto' : 'hidden'}>
                  <ErrorBoundary><MediaTrimmerPage /></ErrorBoundary>
                </div>
              )}
              {visitedPages.has('/free-tools/media-merger') && (
                <div className={location.pathname === '/free-tools/media-merger' ? 'h-full overflow-auto' : 'hidden'}>
                  <ErrorBoundary><MediaMergerPage /></ErrorBoundary>
                </div>
              )}
            </>
          )}
        </main>

        {/* Bottom navigation */}
        <BottomNavigation />

        <Toaster />
      </div>
    </TooltipProvider>
  )
}
