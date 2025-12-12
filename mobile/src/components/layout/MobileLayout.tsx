import { useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BottomNavigation } from './BottomNavigation'
import { MobileHeader } from './MobileHeader'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { toast } from '@/hooks/useToast'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KeyRound, Eye, EyeOff, Loader2, Zap, ExternalLink } from 'lucide-react'
import { getPlatformService } from '@mobile/platform'
import { VideoEnhancerPage } from '@/pages/VideoEnhancerPage'
import { ImageEnhancerPage } from '@/pages/ImageEnhancerPage'
import { BackgroundRemoverPage } from '@/pages/BackgroundRemoverPage'
import { ImageEraserPage } from '@/pages/ImageEraserPage'
import { MobileSegmentAnythingPage } from '@mobile/pages/MobileSegmentAnythingPage'
import { VideoConverterPage } from '@mobile/pages/VideoConverterPage'

export function MobileLayout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  // Track which persistent pages have been visited (to delay initial mount)
  const [visitedPages, setVisitedPages] = useState<Set<string>>(new Set())

  const { isLoading: isLoadingApiKey, isValidated, isValidating, setApiKey } = useApiKeyStore()
  const [inputKey, setInputKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState('')

  // Track visits to persistent pages
  useEffect(() => {
    const persistentPaths = [
      '/free-tools/video',
      '/free-tools/image',
      '/free-tools/background-remover',
      '/free-tools/image-eraser',
      '/free-tools/segment-anything',
      '/free-tools/video-converter'
    ]
    if (persistentPaths.includes(location.pathname)) {
      if (!visitedPages.has(location.pathname)) {
        setVisitedPages(prev => new Set(prev).add(location.pathname))
      }
    }
  }, [location.pathname, visitedPages])

  // Pages that don't require API key
  const publicPaths = ['/settings', '/templates', '/assets', '/free-tools']
  const isPublicPage = publicPaths.some(path =>
    location.pathname === path || location.pathname.startsWith(path + '/')
  )

  const handleSaveApiKey = async () => {
    if (!inputKey.trim()) return

    setError('')
    try {
      // Use the store's setApiKey which handles validation and saving
      await setApiKey(inputKey.trim())

      // Check if validation succeeded
      const store = useApiKeyStore.getState()
      if (store.isValidated) {
        toast({
          title: t('settings.apiKey.saved'),
          description: t('settings.apiKey.savedDesc'),
        })
        setInputKey('')
      } else {
        setError(t('settings.apiKey.invalidDesc'))
      }
    } catch {
      setError(t('settings.apiKey.invalidDesc'))
    }
  }

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
    '/free-tools/background-remover',
    '/free-tools/image-eraser',
    '/free-tools/segment-anything',
    '/free-tools/video-converter'
  ]
  const isFreeToolsPage = freeToolsPaths.includes(location.pathname)

  // Login form content
  const loginContent = (
    <div className="flex h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo and title */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center mb-3">
            <div className="gradient-bg rounded-xl p-2.5">
              <Zap className="h-6 w-6 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold gradient-text mb-1">WaveSpeed</h1>
          <p className="text-sm text-muted-foreground">
            {t('apiKeyRequired.defaultDesc')}
          </p>
        </div>

        {/* API Key form */}
        <div className="bg-card border rounded-lg p-4 shadow-lg space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">{t('settings.apiKey.title')}</h2>
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiKey" className="text-sm">{t('settings.apiKey.label')}</Label>
            <div className="relative">
              <Input
                id="apiKey"
                type={showKey ? 'text' : 'password'}
                value={inputKey}
                onChange={(e) => {
                  setInputKey(e.target.value)
                  setError('')
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
                placeholder={t('settings.apiKey.placeholder')}
                className="pr-10 mobile-input"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>

          <Button
            className="w-full mobile-button gradient-bg hover:opacity-90"
            onClick={handleSaveApiKey}
            disabled={isValidating || !inputKey.trim()}
          >
            {isValidating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('settings.apiKey.validating')}
              </>
            ) : (
              t('settings.apiKey.save')
            )}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            {t('settings.apiKey.getKey')}{' '}
            <a
              href="https://wavespeed.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
              onClick={(e) => {
                e.preventDefault()
                getPlatformService().openExternal('https://wavespeed.ai')
              }}
            >
              wavespeed.ai
              <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>

        {/* Settings link */}
        <p className="text-center mt-4 text-sm text-muted-foreground">
          {t('apiKeyRequired.orGoTo')}{' '}
          <Button
            variant="link"
            className="p-0 h-auto text-sm"
            onClick={() => navigate('/settings')}
          >
            {t('nav.settings')}
          </Button>
        </p>
      </div>
    </div>
  )

  return (
    <TooltipProvider>
      <div className="flex flex-col h-[100dvh] bg-background">
        {/* Header */}
        <MobileHeader />

        {/* Main content area */}
        <main className="flex-1 overflow-hidden pb-14">
          {requiresLogin ? loginContent : (
            <>
              {/* Regular routes via Outlet */}
              <div className={isFreeToolsPage ? 'hidden' : 'h-full overflow-auto'}>
                <Outlet />
              </div>

              {/* Persistent Free Tools pages */}
              {visitedPages.has('/free-tools/video') && (
                <div className={location.pathname === '/free-tools/video' ? 'h-full overflow-auto' : 'hidden'}>
                  <VideoEnhancerPage />
                </div>
              )}
              {visitedPages.has('/free-tools/image') && (
                <div className={location.pathname === '/free-tools/image' ? 'h-full overflow-auto' : 'hidden'}>
                  <ImageEnhancerPage />
                </div>
              )}
              {visitedPages.has('/free-tools/background-remover') && (
                <div className={location.pathname === '/free-tools/background-remover' ? 'h-full overflow-auto' : 'hidden'}>
                  <BackgroundRemoverPage />
                </div>
              )}
              {visitedPages.has('/free-tools/image-eraser') && (
                <div className={location.pathname === '/free-tools/image-eraser' ? 'h-full overflow-auto' : 'hidden'}>
                  <ImageEraserPage />
                </div>
              )}
              {visitedPages.has('/free-tools/segment-anything') && (
                <div className={location.pathname === '/free-tools/segment-anything' ? 'h-full overflow-auto' : 'hidden'}>
                  <MobileSegmentAnythingPage />
                </div>
              )}
              {visitedPages.has('/free-tools/video-converter') && (
                <div className={location.pathname === '/free-tools/video-converter' ? 'h-full overflow-auto' : 'hidden'}>
                  <VideoConverterPage />
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
