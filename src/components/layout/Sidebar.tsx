import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
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
  return (
    <div
      className={cn(
        "flex h-full flex-col border-r bg-background transition-all duration-300",
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
        <Zap className="h-6 w-6 text-primary" style={{ flexShrink: 0 }} />
        {!collapsed && (
          <span className="text-lg font-semibold" style={{ whiteSpace: 'nowrap' }}>
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
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: collapsed ? 0 : '0.75rem'
                  }}
                  className={({ isActive }) =>
                    cn(
                      'rounded-lg text-sm font-medium transition-colors',
                      collapsed ? 'justify-center p-2' : 'px-3 py-2',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )
                  }
                >
                  <item.icon style={{ width: 20, height: 20, flexShrink: 0 }} />
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
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: collapsed ? 0 : '0.75rem'
                  }}
                  className={({ isActive }) =>
                    cn(
                      'rounded-lg text-sm font-medium transition-colors',
                      collapsed ? 'justify-center p-2' : 'px-3 py-2',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )
                  }
                >
                  <item.icon style={{ width: 20, height: 20, flexShrink: 0 }} />
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
