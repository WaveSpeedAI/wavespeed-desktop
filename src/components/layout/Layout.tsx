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
      <div className="flex h-screen overflow-hidden">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
        <Toaster />
      </div>
    </TooltipProvider>
  )
}
