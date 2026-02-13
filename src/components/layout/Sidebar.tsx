import { useState, useEffect, useRef } from 'react'
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
  GitBranch,
  Star,
  X
} from 'lucide-react'
import appIcon from '../../../build/icon.png'

interface NavItem {
  titleKey: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  matchPrefix?: boolean
}

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  lastFreeToolsPage: string | null
  isMobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ collapsed, onToggle, lastFreeToolsPage, isMobileOpen, onMobileClose }: SidebarProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()

  // Suppress tooltips during collapse/expand animation to prevent stale popups
  const [tooltipReady, setTooltipReady] = useState(true)
  const prevCollapsed = useRef(collapsed)
  useEffect(() => {
    if (prevCollapsed.current !== collapsed) {
      setTooltipReady(false)
      const timer = setTimeout(() => setTooltipReady(true), 350)
      prevCollapsed.current = collapsed
      return () => clearTimeout(timer)
    }
  }, [collapsed])

  const createItems: NavItem[] = [
    {
      titleKey: 'nav.home',
      href: '/',
      icon: Home
    },
    {
      titleKey: 'nav.featuredModels',
      href: '/featured-models',
      icon: Star
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
      matchPrefix: true
    },
  ]

  const manageItems: NavItem[] = [
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
    }
  ]

  const toolsItems: NavItem[] = [
    {
      titleKey: 'nav.workflow',
      href: '/workflow',
      icon: GitBranch,
      matchPrefix: true
    },
    {
      titleKey: 'nav.freeTools',
      href: '/free-tools',
      icon: Sparkles,
      matchPrefix: true
    },
    {
      titleKey: 'nav.zImage',
      href: '/z-image',
      icon: Zap
    }
  ]

  // Check if a nav item is active
  const isActive = (item: NavItem) => {
    if (item.matchPrefix) {
      return location.pathname === item.href || location.pathname.startsWith(item.href + '/')
    }
    return location.pathname === item.href
  }

  const navGroups = [
    { key: 'create', label: 'Create', items: createItems },
    { key: 'tools', label: 'Tools', items: toolsItems },
    { key: 'manage', label: 'Manage', items: manageItems },
  ]

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
        "flex h-full flex-col border-r border-border/70 bg-background/95 backdrop-blur transition-all duration-300",
        // Desktop styles
        "hidden md:flex",
        collapsed ? "w-20" : "w-52",
        // Mobile styles - fixed positioned drawer
        isMobileOpen && "!flex fixed inset-y-0 left-0 z-50 w-72 shadow-2xl"
      )}
    >
      {/* Mobile close button */}
      {isMobileOpen && (
        <button
          className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-muted md:hidden"
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
          "h-16 border-b border-border/70",
          collapsed && !isMobileOpen ? "justify-center px-2" : "gap-3 px-5"
        )}
      >
        <img
          src={appIcon}
          alt="WaveSpeed"
          className="h-10 w-10 rounded-xl shadow-sm object-cover"
          style={{ flexShrink: 0 }}
        />
        {(!collapsed || isMobileOpen) && (
          <div className="min-w-0">
            <span className="block whitespace-nowrap text-lg font-bold gradient-text">WaveSpeed</span>
            <span className="block whitespace-nowrap text-[11px] text-muted-foreground">AI Creative Studio</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-4">
          {navGroups.map((group) => (
            <div key={group.key} className="space-y-1">
              {(!collapsed || isMobileOpen) && (
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                  {group.label}
                </div>
              )}

              {group.items.map((item) => {
                const active = isActive(item)
                const showTooltip = collapsed && !isMobileOpen && tooltipReady
                const isNewFeature = item.href === '/workflow'
                return (
                  <Tooltip key={item.href} delayDuration={0} open={showTooltip ? undefined : false}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => {
                          if (item.matchPrefix && location.pathname.startsWith(item.href + '/')) {
                            return
                          }
                          if (item.href === '/free-tools' && lastFreeToolsPage) {
                            navigate(lastFreeToolsPage)
                            return
                          }
                          navigate(item.href)
                        }}
                        className={cn(
                          buttonVariants({ variant: 'ghost', size: 'sm' }),
                          'h-10 w-full rounded-xl text-sm transition-all relative overflow-visible',
                          collapsed && !isMobileOpen ? 'justify-center px-2' : 'justify-start gap-3 px-3',
                          active
                            ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/95 hover:text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                          isNewFeature && !active && 'ring-2 ring-blue-500/20 hover:ring-blue-500/30'
                        )}
                      >
                        {/* Glow effect for new feature */}
                        {isNewFeature && !active && (
                          <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 animate-pulse" />
                        )}
                        
                        <item.icon className="h-4 w-4 shrink-0 relative z-10" />
                        {(!collapsed || isMobileOpen) && (
                          <span className="relative z-10 flex items-center gap-1.5">
                            {t(item.titleKey)}
                            {isNewFeature && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-sm">
                                NEW
                              </span>
                            )}
                          </span>
                        )}
                        {/* Red dot for collapsed state */}
                        {isNewFeature && (collapsed && !isMobileOpen) && (
                          <span className="absolute top-1 right-1 flex h-2 w-2 z-10">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                          </span>
                        )}
                      </button>
                    </TooltipTrigger>
                    {showTooltip && (
                      <TooltipContent side="right" className="flex items-center gap-2">
                        <span>{t(item.titleKey)}</span>
                        {isNewFeature && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gradient-to-r from-blue-500 to-purple-500 text-white">
                            NEW
                          </span>
                        )}
                      </TooltipContent>
                    )}
                  </Tooltip>
                )
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* Bottom Navigation */}
      <div className="mt-auto border-t border-border/70 p-3">
        <nav className="flex flex-col gap-1">
          {bottomNavItems.map((item) => {
            const active = location.pathname === item.href
            const showTooltip = collapsed && !isMobileOpen && tooltipReady
            return (
              <Tooltip key={item.href} delayDuration={0} open={showTooltip ? undefined : false}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => navigate(item.href)}
                    className={cn(
                      buttonVariants({ variant: 'ghost', size: 'sm' }),
                      'h-10 w-full rounded-xl transition-all',
                      collapsed && !isMobileOpen ? 'justify-center px-2' : 'justify-start gap-3 px-3',
                      active
                        ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/95 hover:text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {(!collapsed || isMobileOpen) && <span>{t(item.titleKey)}</span>}
                  </button>
                </TooltipTrigger>
                {showTooltip && (
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
          <Tooltip delayDuration={0} open={collapsed && tooltipReady ? undefined : false}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggle}
                className={cn(
                  "mt-2 hidden h-10 w-full rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground md:flex",
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
            <TooltipContent side="right">{t('nav.expand', 'Expand')}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
