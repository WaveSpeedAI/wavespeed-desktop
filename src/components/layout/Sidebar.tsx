import { NavLink, useLocation } from 'react-router-dom'
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
  LayoutGrid,
  PlayCircle,
  FolderOpen,
  History,
  Settings,
  Zap,
  PanelLeftClose,
  PanelLeft
} from 'lucide-react'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { t } = useTranslation()
  const location = useLocation()

  const navItems = [
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
        "flex h-full flex-col border-r bg-card/50 backdrop-blur-sm transition-all duration-300",
        collapsed ? "w-16" : "w-48"
      )}
    >
      {/* Logo */}
      <div
        style={{ display: 'flex', alignItems: 'center', flexDirection: 'row' }}
        className={cn(
          "h-16 border-b",
          collapsed ? "justify-center px-2" : "gap-2 px-6"
        )}
      >
        <div className="gradient-bg rounded-lg p-1.5">
          <Zap className="h-5 w-5 text-white" style={{ flexShrink: 0 }} />
        </div>
        {!collapsed && (
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
                  <NavLink
                    to={item.href}
                    className={cn(
                      buttonVariants({ variant: active ? 'default' : 'ghost', size: 'sm' }),
                      'w-full justify-start',
                      collapsed ? 'justify-center px-2' : 'gap-3 px-3',
                      active && 'shadow-md'
                    )}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    {!collapsed && <span>{t(item.titleKey)}</span>}
                  </NavLink>
                </TooltipTrigger>
                {collapsed && (
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
          {bottomNavItems.map((item) => (
            <Tooltip key={item.href} delayDuration={0}>
              <TooltipTrigger asChild>
                <NavLink
                  to={item.href}
                  className={cn(
                    buttonVariants({ variant: location.pathname === item.href ? 'default' : 'ghost', size: 'sm' }),
                    'w-full justify-start',
                    collapsed ? 'justify-center px-2' : 'gap-3 px-3',
                    location.pathname === item.href && 'shadow-md'
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <span>{t(item.titleKey)}</span>}
                </NavLink>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">
                  {t(item.titleKey)}
                </TooltipContent>
              )}
            </Tooltip>
          ))}
        </nav>

        {/* Toggle Button */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              className={cn(
                "w-full mt-2",
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
      </div>
    </div>
  )
}
