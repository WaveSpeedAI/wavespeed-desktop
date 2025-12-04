import { NavLink, useLocation } from 'react-router-dom'
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

const navItems = [
  {
    title: 'Models',
    href: '/models',
    icon: LayoutGrid
  },
  {
    title: 'Playground',
    href: '/playground',
    icon: PlayCircle
  },
  {
    title: 'Templates',
    href: '/templates',
    icon: FolderOpen
  },
  {
    title: 'History',
    href: '/history',
    icon: History
  }
]

const bottomNavItems = [
  {
    title: 'Settings',
    href: '/settings',
    icon: Settings
  }
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation()

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
          {navItems.map((item) => (
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
                  {!collapsed && <span>{item.title}</span>}
                </NavLink>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">
                  {item.title}
                </TooltipContent>
              )}
            </Tooltip>
          ))}
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
                  {!collapsed && <span>{item.title}</span>}
                </NavLink>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">
                  {item.title}
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
                  <span>Collapse</span>
                </>
              )}
            </Button>
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right">
              Expand sidebar
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </div>
  )
}
