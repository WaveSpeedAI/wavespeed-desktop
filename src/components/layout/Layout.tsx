import { useState, useEffect, useRef, useCallback } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './Sidebar'
import { PageResetContext } from './PageResetContext'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/hooks/useToast'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { apiClient } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KeyRound, Eye, EyeOff, Loader2, Zap, ExternalLink } from 'lucide-react'
import { VideoEnhancerPage } from '@/pages/VideoEnhancerPage'
import { ImageEnhancerPage } from '@/pages/ImageEnhancerPage'
import { BackgroundRemoverPage } from '@/pages/BackgroundRemoverPage'
import { ImageEraserPage } from '@/pages/ImageEraserPage'
import { SegmentAnythingPage } from '@/pages/SegmentAnythingPage'
import { ZImagePage } from '@/pages/ZImagePage'
import { VideoConverterPage } from '@/pages/VideoConverterPage'
import { AudioConverterPage } from '@/pages/AudioConverterPage'
import { ImageConverterPage } from '@/pages/ImageConverterPage'
import { MediaTrimmerPage } from '@/pages/MediaTrimmerPage'
import { MediaMergerPage } from '@/pages/MediaMergerPage'
import { FaceEnhancerPage } from '@/pages/FaceEnhancerPage'
import { FaceSwapperPage } from '@/pages/FaceSwapperPage'
import { WorkflowPage } from '@/workflow/WorkflowPage'
import { useFreeToolListener } from '@/workflow/hooks/useFreeToolListener'

// Helper to generate next key
let keyCounter = 0
const nextKey = () => ++keyCounter


export function Layout() {
  const { t } = useTranslation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const navigate = useNavigate()
  const location = useLocation()
  const hasShownUpdateToast = useRef(false)

  // Register free-tool IPC listener globally (must be always mounted for workflow execution)
  useFreeToolListener()

  // Track which persistent pages have been visited (to delay initial mount)
  const [visitedPages, setVisitedPages] = useState<Set<string>>(new Set())
  // Track the last visited free-tools sub-page for navigation
  const [lastFreeToolsPage, setLastFreeToolsPage] = useState<string | null>(null)
  // Track keys for each page to force remount when reset
  const [pageKeys, setPageKeys] = useState<Record<string, number>>({})

  // Reset a persistent page by changing its key (forces remount)
  const resetPage = useCallback((path: string) => {
    setPageKeys(prev => ({
      ...prev,
      [path]: nextKey()
    }))
  }, [])

  const { isValidated, isValidating, loadApiKey, hasAttemptedLoad, isLoading: isLoadingApiKey } = useApiKeyStore()
  const [inputKey, setInputKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  // Load API key on app startup
  useEffect(() => {
    loadApiKey()
  }, [loadApiKey])

  // Reset login form when API key is cleared
  useEffect(() => {
    if (!isValidated) {
      setInputKey('')
      setError('')
    }
  }, [isValidated])

  // Track visits to persistent pages and last visited free-tools page
  useEffect(() => {
    const persistentPaths = ['/free-tools/video-enhancer', '/free-tools/image-enhancer', '/free-tools/face-enhancer', '/free-tools/face-swapper', '/free-tools/background-remover', '/free-tools/image-eraser', '/free-tools/segment-anything', '/free-tools/video-converter', '/free-tools/audio-converter', '/free-tools/image-converter', '/free-tools/media-trimmer', '/free-tools/media-merger', '/z-image', '/workflow']
    if (persistentPaths.includes(location.pathname)) {
      // Track for lazy mounting
      if (!visitedPages.has(location.pathname)) {
        setVisitedPages(prev => new Set(prev).add(location.pathname))
      }
      // Track last visited for sidebar navigation (only for free-tools sub-pages)
      if (location.pathname.startsWith('/free-tools/')) {
        setLastFreeToolsPage(location.pathname)
      }
    } else if (location.pathname === '/free-tools') {
      // Clear last visited page when on main Free Tools page
      // So clicking sidebar will return to main page, not sub-page
      setLastFreeToolsPage(null)
    }
  }, [location.pathname, visitedPages])

  // Pages that don't require API key
  const publicPaths = ['/', '/featured-models', '/settings', '/templates', '/assets', '/free-tools', '/z-image']
  const isPublicPage = publicPaths.some(path =>
    path === '/'
      ? location.pathname === '/'
      : location.pathname === path || location.pathname.startsWith(path + '/')
  )

  // Listen for update availability on startup
  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return

    const unsubscribe = window.electronAPI.onUpdateStatus((status) => {
      if (status.status === 'available' && !hasShownUpdateToast.current) {
        hasShownUpdateToast.current = true
        const version = (status as { version?: string }).version
        toast({
          title: 'Update Available',
          description: version ? `Version ${version} is ready to download` : 'A new version is available',
          action: (
            <ToastAction altText="View" onClick={() => navigate('/settings')}>
              View
            </ToastAction>
          ),
        })
      }
    })

    return unsubscribe
  }, [navigate])

  const handleSaveApiKey = async () => {
    if (!inputKey.trim()) return

    setIsSaving(true)
    setError('')
    try {
      // Validate the key first by trying to fetch models
      apiClient.setApiKey(inputKey.trim())
      await apiClient.listModels()

      // If we get here, the key is valid - save it directly
      if (window.electronAPI) {
        await window.electronAPI.setApiKey(inputKey.trim())
      } else {
        localStorage.setItem('wavespeed_api_key', inputKey.trim())
      }

      // Reload the API key state (force to bypass hasAttemptedLoad check)
      await loadApiKey(true)

      toast({
        title: t('settings.apiKey.saved'),
        description: t('settings.apiKey.savedDesc'),
      })
    } catch {
      // Validation failed - clear the temporary key from client
      apiClient.setApiKey('')
      setError(t('settings.apiKey.invalidDesc'))
    } finally {
      setIsSaving(false)
    }
  }

  // Check if current page requires login (must have a validated API key)
  // Only show login form after we've attempted to load the API key and finished loading/validating
  const requiresLogin = !isValidated && !isPublicPage && hasAttemptedLoad && !isLoadingApiKey && !isValidating

  // Login form content for protected pages
  const loginContent = (
    <div className="flex h-full items-center justify-center relative overflow-hidden">
      <div className="relative z-10 w-full max-w-md px-6">
        {/* Logo and title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <div className="gradient-bg rounded-xl p-3">
              <Zap className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold gradient-text mb-2">WaveSpeed</h1>
          <p className="text-muted-foreground">
            {t('apiKeyRequired.defaultDesc')}
          </p>
        </div>

        {/* API Key form */}
        <div className="bg-card border rounded-lg p-6 shadow-lg space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
            <h2 className="font-semibold">{t('settings.apiKey.title')}</h2>
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiKey">{t('settings.apiKey.label')}</Label>
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
                className="pr-10"
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
            className="w-full gradient-bg hover:opacity-90"
            onClick={handleSaveApiKey}
            disabled={isSaving || !inputKey.trim()}
          >
            {isSaving ? (
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
              href="https://wavespeed.ai/accesskey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              wavespeed.ai/accesskey
              <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>

        {/* Settings link */}
        <p className="text-center mt-4 text-sm text-muted-foreground">
          {t('apiKeyRequired.orGoTo')}{' '}
          <Button
            variant="link"
            className="p-0 h-auto"
            onClick={() => navigate('/settings')}
          >
            {t('nav.settings')}
          </Button>
        </p>
      </div>
    </div>
  )

  return (
    <PageResetContext.Provider value={{ resetPage }}>
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden relative">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(prev => !prev)}
          lastFreeToolsPage={lastFreeToolsPage}
          isMobileOpen={false}
          onMobileClose={() => {}}
        />
        <main className="relative flex-1 overflow-hidden md:pl-0">
          {requiresLogin ? loginContent : (
            <>
              {/* Regular routes via Outlet */}
              <div className={['/free-tools/video-enhancer', '/free-tools/image-enhancer', '/free-tools/face-enhancer', '/free-tools/face-swapper', '/free-tools/background-remover', '/free-tools/image-eraser', '/free-tools/segment-anything', '/free-tools/video-converter', '/free-tools/audio-converter', '/free-tools/image-converter', '/free-tools/media-trimmer', '/free-tools/media-merger', '/z-image', '/workflow'].includes(location.pathname) ? 'hidden' : 'h-full overflow-auto'}>
                <Outlet />
              </div>
              {/* Persistent Free Tools pages - mounted once visited, removed from visitedPages forces unmount */}
              {visitedPages.has('/free-tools/video-enhancer') && (
                <div className={location.pathname === '/free-tools/video-enhancer' ? 'h-full overflow-auto' : 'hidden'}>
                  <VideoEnhancerPage key={pageKeys['/free-tools/video-enhancer'] || 0} />
                </div>
              )}
              {visitedPages.has('/free-tools/image-enhancer') && (
                <div className={location.pathname === '/free-tools/image-enhancer' ? 'h-full overflow-auto' : 'hidden'}>
                  <ImageEnhancerPage key={pageKeys['/free-tools/image-enhancer'] || 0} />
                </div>
              )}
              {visitedPages.has('/free-tools/face-enhancer') && (
                <div className={location.pathname === '/free-tools/face-enhancer' ? 'h-full overflow-auto' : 'hidden'}>
                  <FaceEnhancerPage key={pageKeys['/free-tools/face-enhancer'] || 0} />
                </div>
              )}
              {visitedPages.has('/free-tools/face-swapper') && (
                <div className={location.pathname === '/free-tools/face-swapper' ? 'h-full overflow-auto' : 'hidden'}>
                  <FaceSwapperPage key={pageKeys['/free-tools/face-swapper'] || 0} />
                </div>
              )}
              {visitedPages.has('/free-tools/background-remover') && (
                <div className={location.pathname === '/free-tools/background-remover' ? 'h-full overflow-auto' : 'hidden'}>
                  <BackgroundRemoverPage key={pageKeys['/free-tools/background-remover'] || 0} />
                </div>
              )}
              {visitedPages.has('/free-tools/image-eraser') && (
                <div className={location.pathname === '/free-tools/image-eraser' ? 'h-full overflow-auto' : 'hidden'}>
                  <ImageEraserPage key={pageKeys['/free-tools/image-eraser'] || 0} />
                </div>
              )}
              {visitedPages.has('/free-tools/segment-anything') && (
                <div className={location.pathname === '/free-tools/segment-anything' ? 'h-full overflow-auto' : 'hidden'}>
                  <SegmentAnythingPage key={pageKeys['/free-tools/segment-anything'] || 0} />
                </div>
              )}
              {/* Persistent Z-Image page - mounted once visited, then persist via CSS show/hide */}
              {visitedPages.has('/z-image') && (
                <div className={location.pathname === '/z-image' ? 'h-full overflow-auto' : 'hidden'}>
                  <ZImagePage key={pageKeys['/z-image'] || 0} />
                </div>
              )}
              {visitedPages.has('/free-tools/video-converter') && (
                <div className={location.pathname === '/free-tools/video-converter' ? 'h-full overflow-auto' : 'hidden'}>
                  <VideoConverterPage key={pageKeys['/free-tools/video-converter'] || 0} />
                </div>
              )}
              {visitedPages.has('/free-tools/audio-converter') && (
                <div className={location.pathname === '/free-tools/audio-converter' ? 'h-full overflow-auto' : 'hidden'}>
                  <AudioConverterPage key={pageKeys['/free-tools/audio-converter'] || 0} />
                </div>
              )}
              {visitedPages.has('/free-tools/image-converter') && (
                <div className={location.pathname === '/free-tools/image-converter' ? 'h-full overflow-auto' : 'hidden'}>
                  <ImageConverterPage key={pageKeys['/free-tools/image-converter'] || 0} />
                </div>
              )}
              {visitedPages.has('/free-tools/media-trimmer') && (
                <div className={location.pathname === '/free-tools/media-trimmer' ? 'h-full overflow-auto' : 'hidden'}>
                  <MediaTrimmerPage key={pageKeys['/free-tools/media-trimmer'] || 0} />
                </div>
              )}
              {visitedPages.has('/free-tools/media-merger') && (
                <div className={location.pathname === '/free-tools/media-merger' ? 'h-full overflow-auto' : 'hidden'}>
                  <MediaMergerPage key={pageKeys['/free-tools/media-merger'] || 0} />
                </div>
              )}
              {/* Persistent Workflow page */}
              {visitedPages.has('/workflow') && (
                <div className={location.pathname === '/workflow' ? 'h-full overflow-hidden' : 'hidden'}>
                  <WorkflowPage key={pageKeys['/workflow'] || 0} />
                </div>
              )}
            </>
          )}
        </main>
        <Toaster />
      </div>
    </TooltipProvider>
    </PageResetContext.Provider>
  )
}
