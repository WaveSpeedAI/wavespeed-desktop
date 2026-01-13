import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Home,
  LayoutGrid,
  PlayCircle,
  FolderOpen,
  History,
  Settings,
  Zap,
  PanelLeftClose,
  PanelLeft,
  FolderHeart,
  Sparkles,
  X
} from 'lucide-react'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  lastFreeToolsPage: string | null
  isMobileOpen?: boolean
  onMobileClose?: () => void
}

// Check if running in Electron (not web)
const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron')

export function Sidebar({ collapsed, onToggle, lastFreeToolsPage, isMobileOpen, onMobileClose }: SidebarProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()

  const navItems = [
    {
      titleKey: 'nav.home',
      href: '/',
      icon: Home
    },
    {
      titleKey: 'nav.models',
      href: '/models',
      icon: LayoutGrid
    },
    {
      titleKey: 'nav.playground',
      href: '/playground',
      icon: PlayCircle,
      matchPrefix: true  // Match /playground/*
    },
    {
      titleKey: 'nav.templates',
      href: '/templates',
      icon: FolderOpen
    },
    {
      titleKey: 'nav.history',
      href: '/history',
      icon: History
    },
    {
      titleKey: 'nav.assets',
      href: '/assets',
      icon: FolderHeart
    },
    // Z-Image only available in desktop Electron app
    ...(isElectron ? [{
      titleKey: 'nav.zImage',
      href: '/z-image',
      icon: Zap
    }] : []),
    {
      titleKey: 'nav.freeTools',
      href: '/free-tools',
      icon: Sparkles,
      matchPrefix: true
    }
  ]

  // Check if a nav item is active
  const isActive = (item: typeof navItems[0]) => {
    if (item.matchPrefix) {
      return location.pathname === item.href || location.pathname.startsWith(item.href + '/')
    }
    return location.pathname === item.href
  }

  const bottomNavItems = [
    {
      titleKey: 'nav.settings',
      href: '/settings',
      icon: Settings
    }
  ]

  return (
    <div
      className={cn(
        "flex h-full flex-col border-r bg-slate-200 dark:bg-slate-900 transition-transform duration-300",
        // Desktop styles
        "hidden md:flex",
        collapsed ? "w-16" : "w-48",
        // Mobile styles - fixed positioned drawer
        isMobileOpen && "!flex fixed inset-y-0 left-0 z-50 w-64 shadow-xl"
      )}
    >
      {/* Mobile close button */}
      {isMobileOpen && (
        <button
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-800 md:hidden"
          onClick={onMobileClose}
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      )}

      {/* Logo */}
      <div
        style={{ display: 'flex', alignItems: 'center', flexDirection: 'row' }}
        className={cn(
          "h-16 border-b border-slate-300 dark:border-slate-800",
          collapsed && !isMobileOpen ? "justify-center px-2" : "gap-2 px-6"
        )}
      >
        <div className="gradient-bg rounded-lg p-1.5">
          <Zap className="h-5 w-5 text-white" style={{ flexShrink: 0 }} />
        </div>
        {(!collapsed || isMobileOpen) && (
          <span className="text-lg font-bold gradient-text" style={{ whiteSpace: 'nowrap' }}>
            WaveSpeed
          </span>
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-2 py-4">
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => {
            const active = isActive(item)
            return (
              <Tooltip key={item.href} delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      // If on a sub-page of this item, don't navigate (stay on current page)
                      if (item.matchPrefix && location.pathname.startsWith(item.href + '/')) {
                        return
                      }
                      // For Free Tools, navigate to last visited sub-page if available
                      if (item.href === '/free-tools' && lastFreeToolsPage) {
                        navigate(lastFreeToolsPage)
                        return
                      }
                      // Otherwise navigate to the item's href
                      navigate(item.href)
                    }}
                    className={cn(
                      buttonVariants({ variant: active ? 'default' : 'ghost', size: 'sm' }),
                      'w-full justify-start',
                      collapsed && !isMobileOpen ? 'justify-center px-2' : 'gap-3 px-3',
                      active && 'shadow-md'
                    )}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    {(!collapsed || isMobileOpen) && <span>{t(item.titleKey)}</span>}
                  </button>
                </TooltipTrigger>
                {collapsed && !isMobileOpen && (
                  <TooltipContent side="right">
                    {t(item.titleKey)}
                  </TooltipContent>
                )}
              </Tooltip>
            )
          })}
        </nav>
      </ScrollArea>

      {/* Bottom Navigation */}
      <div className="mt-auto border-t p-2">
        <nav className="flex flex-col gap-1">
          {bottomNavItems.map((item) => {
            const active = location.pathname === item.href
            return (
              <Tooltip key={item.href} delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => navigate(item.href)}
                    className={cn(
                      buttonVariants({ variant: active ? 'default' : 'ghost', size: 'sm' }),
                      'w-full justify-start',
                      collapsed && !isMobileOpen ? 'justify-center px-2' : 'gap-3 px-3',
                      active && 'shadow-md'
                    )}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    {(!collapsed || isMobileOpen) && <span>{t(item.titleKey)}</span>}
                  </button>
                </TooltipTrigger>
                {collapsed && !isMobileOpen && (
                  <TooltipContent side="right">
                    {t(item.titleKey)}
                  </TooltipContent>
                )}
              </Tooltip>
            )
          })}
        </nav>

        {/* Toggle Button - hidden on mobile */}
        {!isMobileOpen && (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggle}
                className={cn(
                  "w-full mt-2 hidden md:flex",
                  collapsed ? "justify-center px-2" : "justify-start gap-3 px-3"
                )}
              >
                {collapsed ? (
                  <PanelLeft className="h-4 w-4" />
                ) : (
                  <>
                    <PanelLeftClose className="h-4 w-4" style={{ flexShrink: 0 }} />
                    <span>{t('nav.collapse')}</span>
                  </>
                )}
              </Button>
            </TooltipTrigger>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
