import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Settings,
  Sparkles,
  Globe,
  Zap
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuickLinkProps {
  icon: React.ReactNode
  title: string
  description: string
  gradient: string
  onClick: () => void
}

function QuickLink({ icon, title, description, gradient, onClick }: QuickLinkProps) {
  return (
    <div
      className="relative group cursor-pointer overflow-hidden rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm transition-all duration-200 active:scale-[0.98]"
      onClick={onClick}
    >
      {/* Gradient background */}
      <div className={cn(
        "absolute inset-0 opacity-20",
        gradient
      )} />

      {/* Content */}
      <div className="relative z-10 p-4 flex items-center gap-4">
        <div className={cn(
          "p-3 rounded-xl bg-gradient-to-br shrink-0",
          gradient
        )}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold truncate">{title}</h3>
          <p className="text-sm text-muted-foreground truncate">{description}</p>
        </div>
      </div>
    </div>
  )
}

export function WelcomePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const handleOpenWebsite = () => {
    window.open('https://wavespeed.ai/', '_blank')
  }

  const quickLinks: QuickLinkProps[] = [
    {
      icon: <Settings className="h-6 w-6 text-white" />,
      title: t('welcome.quickLinks.settings.title'),
      description: t('welcome.quickLinks.settings.description'),
      gradient: 'from-blue-500/60 to-cyan-500/40',
      onClick: () => navigate('/settings')
    },
    {
      icon: <Sparkles className="h-6 w-6 text-white" />,
      title: t('welcome.quickLinks.freeTools.title'),
      description: t('welcome.quickLinks.freeTools.description'),
      gradient: 'from-purple-500/60 to-violet-500/40',
      onClick: () => navigate('/free-tools')
    },
    {
      icon: <Globe className="h-6 w-6 text-white" />,
      title: t('welcome.quickLinks.website.title'),
      description: t('welcome.quickLinks.website.description'),
      gradient: 'from-emerald-500/60 to-green-500/40',
      onClick: handleOpenWebsite
    }
  ]

  return (
    <div className="h-full flex flex-col p-4 overflow-auto">
      {/* Header */}
      <div className="text-center py-6">
        <div className="inline-flex items-center justify-center mb-3">
          <div className="gradient-bg rounded-xl p-3">
            <Zap className="h-8 w-8 text-white" />
          </div>
        </div>
        <h1 className="text-2xl font-bold gradient-text">
          WaveSpeed
        </h1>
      </div>

      {/* Quick Links */}
      <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full">
        <div className="space-y-3">
          {quickLinks.map((link, index) => (
            <QuickLink key={index} {...link} />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-4 text-xs text-muted-foreground">
        {t('welcome.footer')}
      </div>
    </div>
  )
}
