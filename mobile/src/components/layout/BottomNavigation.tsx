import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Box, Sparkles, FileText, History, Settings } from 'lucide-react'
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
    path: '/templates',
    labelKey: 'nav.templates',
    icon: FileText,
  },
  {
    path: '/history',
    labelKey: 'nav.history',
    icon: History,
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

  const isActive = (item: NavItem) => {
    if (item.matchPaths) {
      return item.matchPaths.some(p => location.pathname.startsWith(p))
    }
    return location.pathname === item.path || location.pathname.startsWith(item.path + '/')
  }

  const handleNavClick = (path: string) => {
    // When not validated, only allow public nav paths; redirect others to welcome page
    if (!isValidated && !publicNavPaths.some(p => path === p || path.startsWith(p + '/'))) {
      navigate('/')
      return
    }
    navigate(path)
  }

  return (
    <nav className="bottom-nav">
      <div className="flex items-center justify-around h-14">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item)

          return (
            <button
              key={item.path}
              onClick={() => handleNavClick(item.path)}
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
      </div>
    </nav>
  )
}
