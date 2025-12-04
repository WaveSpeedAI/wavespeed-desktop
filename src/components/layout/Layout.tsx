import { useState, useEffect, useRef } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/hooks/useToast'

export function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const navigate = useNavigate()
  const hasShownUpdateToast = useRef(false)

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
        />
        <main className="flex-1 overflow-auto relative">
          <Outlet />
        </main>
        <Toaster />
      </div>
    </TooltipProvider>
  )
}
