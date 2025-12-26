import { useState, useEffect, useRef } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './Sidebar'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/hooks/useToast'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { Loader2 } from 'lucide-react'
import { VideoEnhancerPage } from '@/pages/VideoEnhancerPage'
import { ImageEnhancerPage } from '@/pages/ImageEnhancerPage'
import { BackgroundRemoverPage } from '@/pages/BackgroundRemoverPage'
import { ImageEraserPage } from '@/pages/ImageEraserPage'
import { SegmentAnythingPage } from '@/pages/SegmentAnythingPage'
import { WelcomePage } from '@/pages/WelcomePage'

export function Layout() {
  useTranslation() // Keep for i18n context
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const hasShownUpdateToast = useRef(false)

  // Track which persistent pages have been visited (to delay initial mount)
  const [visitedPages, setVisitedPages] = useState<Set<string>>(new Set())
  // Track the last visited free-tools sub-page for navigation
  const [lastFreeToolsPage, setLastFreeToolsPage] = useState<string | null>(null)

  const { isLoading: isLoadingApiKey, isValidated } = useApiKeyStore()

  // Track visits to persistent pages and last visited free-tools page
  useEffect(() => {
    const persistentPaths = ['/free-tools/video', '/free-tools/image', '/free-tools/background-remover', '/free-tools/image-eraser', '/free-tools/segment-anything']
    if (persistentPaths.includes(location.pathname)) {
      // Track for lazy mounting
      if (!visitedPages.has(location.pathname)) {
        setVisitedPages(prev => new Set(prev).add(location.pathname))
      }
      // Track last visited for sidebar navigation
      setLastFreeToolsPage(location.pathname)
    } else if (location.pathname === '/free-tools') {
      // Clear last visited page when on main Free Tools page
      // So clicking sidebar will return to main page, not sub-page
      setLastFreeToolsPage(null)
    }
  }, [location.pathname, visitedPages])

  // Pages that don't require API key
  const publicPaths = ['/', '/settings', '/templates', '/assets', '/free-tools']
  const isPublicPage = publicPaths.some(path =>
    location.pathname === path || location.pathname.startsWith(path + '/')
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

  // Show loading state while API key is being loaded
  if (isLoadingApiKey) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Check if current page requires login (must have a validated API key)
  const requiresLogin = !isValidated && !isPublicPage

  // Welcome page content for users without API key
  const welcomeContent = <WelcomePage />

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden relative">
        {/* Abstract art background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          {/* Gradient orbs */}
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-float" />
          <div className="absolute top-1/2 -left-40 w-80 h-80 bg-primary/10 rounded-full blur-3xl animate-float-delayed" />
          <div className="absolute -bottom-40 right-1/3 w-72 h-72 bg-accent/15 rounded-full blur-3xl animate-float-slow" />

          {/* Abstract SVG shapes */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.15]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="hsl(var(--gradient-start))" />
                <stop offset="50%" stopColor="hsl(var(--gradient-mid))" />
                <stop offset="100%" stopColor="hsl(var(--gradient-end))" />
              </linearGradient>
            </defs>
            {/* Flowing curves */}
            <path
              d="M0,100 Q200,50 400,100 T800,100 T1200,100 T1600,100 T2000,100"
              fill="none"
              stroke="url(#grad1)"
              strokeWidth="2"
              className="animate-wave"
            />
            <path
              d="M0,200 Q200,150 400,200 T800,200 T1200,200 T1600,200 T2000,200"
              fill="none"
              stroke="url(#grad1)"
              strokeWidth="1.5"
              className="animate-wave-delayed"
            />
            <path
              d="M0,300 Q200,250 400,300 T800,300 T1200,300 T1600,300 T2000,300"
              fill="none"
              stroke="url(#grad1)"
              strokeWidth="1"
              className="animate-wave-slow"
            />
            {/* Geometric shapes */}
            <circle cx="15%" cy="20%" r="80" fill="none" stroke="url(#grad1)" strokeWidth="1" className="animate-rotate-slow" style={{ transformOrigin: '15% 20%' }} />
            <circle cx="85%" cy="70%" r="120" fill="none" stroke="url(#grad1)" strokeWidth="1" className="animate-rotate-reverse" style={{ transformOrigin: '85% 70%' }} />
            <polygon points="50,50 100,25 100,75" fill="url(#grad1)" className="animate-pulse-slow" style={{ transform: 'translate(70%, 60%)' }} />
            <rect x="80%" y="15%" width="60" height="60" rx="8" fill="none" stroke="url(#grad1)" strokeWidth="1" className="animate-spin-slow" style={{ transformOrigin: '83% 18%' }} />
          </svg>

          {/* Floating particles */}
          <div className="absolute top-1/4 left-1/4 w-3 h-3 rounded-full bg-primary/40 animate-particle" />
          <div className="absolute top-3/4 left-1/3 w-2.5 h-2.5 rounded-full bg-primary/30 animate-particle-delayed" />
          <div className="absolute top-1/3 right-1/4 w-4 h-4 rounded-full bg-accent/35 animate-particle-slow" />
          <div className="absolute bottom-1/4 right-1/3 w-2 h-2 rounded-full bg-primary/45 animate-particle" />
          <div className="absolute top-2/3 left-1/2 w-3 h-3 rounded-full bg-accent/30 animate-particle-delayed" />
        </div>
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          lastFreeToolsPage={lastFreeToolsPage}
        />
        <main className="flex-1 overflow-hidden relative">
          {requiresLogin ? welcomeContent : (
            <>
              {/* Regular routes via Outlet */}
              <div className={location.pathname === '/free-tools/video' || location.pathname === '/free-tools/image' || location.pathname === '/free-tools/background-remover' || location.pathname === '/free-tools/image-eraser' || location.pathname === '/free-tools/segment-anything' ? 'hidden' : 'h-full overflow-auto'}>
                <Outlet />
              </div>
              {/* Persistent Free Tools pages - mounted once visited, then persist via CSS show/hide */}
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
                  <SegmentAnythingPage />
                </div>
              )}
            </>
          )}
        </main>
        <Toaster />
      </div>
    </TooltipProvider>
  )
}
