import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Box, Sparkles, History, Images, MoreHorizontal, FileText, Settings, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  path: string
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
  matchPaths?: string[]
}

const navItems: NavItem[] = [
  {
    path: '/models',
    labelKey: 'nav.models',
    icon: Box,
  },
  {
    path: '/playground',
    labelKey: 'nav.playground',
    icon: Sparkles,
    matchPaths: ['/playground'],
  },
  {
    path: '/history',
    labelKey: 'nav.history',
    icon: History,
  },
  {
    path: '/assets',
    labelKey: 'nav.assets',
    icon: Images,
  },
]

const moreItems: NavItem[] = [
  {
    path: '/free-tools',
    labelKey: 'nav.freeTools',
    icon: Wand2,
  },
  {
    path: '/templates',
    labelKey: 'nav.templates',
    icon: FileText,
  },
  {
    path: '/settings',
    labelKey: 'nav.settings',
    icon: Settings,
  },
]

// Paths that work without API key
const publicNavPaths = ['/settings', '/free-tools']

interface BottomNavigationProps {
  isValidated?: boolean
}

export function BottomNavigation({ isValidated = true }: BottomNavigationProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [showMore, setShowMore] = useState(false)

  const isActive = (item: NavItem) => {
    if (item.matchPaths) {
      return item.matchPaths.some(p => location.pathname.startsWith(p))
    }
    return location.pathname === item.path || location.pathname.startsWith(item.path + '/')
  }

  const isMoreActive = moreItems.some(item => isActive(item))

  const handleNavClick = (path: string) => {
    if (!isValidated && !publicNavPaths.some(p => path === p || path.startsWith(p + '/'))) {
      navigate('/')
      return
    }
    navigate(path)
  }

  const handleMoreItemClick = (path: string) => {
    setShowMore(false)
    handleNavClick(path)
  }

  return (
    <>
      {/* More menu overlay */}
      {showMore && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowMore(false)}
        />
      )}

      {/* More menu popup */}
      {showMore && (
        <div className="fixed bottom-[calc(56px+env(safe-area-inset-bottom,0px))] right-2 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[160px] animate-in fade-in slide-in-from-bottom-2 duration-150">
          {moreItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item)

            return (
              <button
                key={item.path}
                onClick={() => handleMoreItemClick(item.path)}
                className={cn(
                  'flex items-center gap-3 w-full px-4 py-3 text-sm transition-colors',
                  active ? 'text-primary bg-accent/50' : 'text-foreground active:bg-accent/50'
                )}
              >
                <Icon className={cn('h-5 w-5', active ? 'text-primary' : 'text-muted-foreground')} />
                <span>{t(item.labelKey)}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Bottom navigation bar */}
      <nav className="bottom-nav">
        <div className="flex items-center justify-around h-14">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item)

            return (
              <button
                key={item.path}
                onClick={() => { setShowMore(false); handleNavClick(item.path) }}
                className={cn(
                  'bottom-nav-item ripple',
                  active && 'active'
                )}
              >
                <Icon className={cn(
                  'h-5 w-5 mb-0.5',
                  active ? 'text-primary' : 'text-muted-foreground'
                )} />
                <span className={cn(
                  'text-[10px]',
                  active ? 'text-primary font-medium' : 'text-muted-foreground'
                )}>
                  {t(item.labelKey)}
                </span>
              </button>
            )
          })}

          {/* More button */}
          <button
            onClick={() => setShowMore(!showMore)}
            className={cn(
              'bottom-nav-item ripple',
              (showMore || isMoreActive) && 'active'
            )}
          >
            <MoreHorizontal className={cn(
              'h-5 w-5 mb-0.5',
              (showMore || isMoreActive) ? 'text-primary' : 'text-muted-foreground'
            )} />
            <span className={cn(
              'text-[10px]',
              (showMore || isMoreActive) ? 'text-primary font-medium' : 'text-muted-foreground'
            )}>
              {t('nav.more', 'More')}
            </span>
          </button>
        </div>
      </nav>
    </>
  )
}
