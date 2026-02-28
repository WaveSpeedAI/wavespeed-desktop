import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const AUTO_DISMISS_MS = 30_000

export function UpdateBanner() {
  const { t } = useTranslation()
  const [downloadedVersion, setDownloadedVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const dismissedVersionRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return

    const unsubscribe = window.electronAPI.onUpdateStatus((status) => {
      if (status.status === 'downloaded' && status.version) {
        // Don't re-show if user already dismissed this version
        if (dismissedVersionRef.current === status.version) return
        setDownloadedVersion(status.version)
        setDismissed(false)
      }
    })

    return unsubscribe
  }, [])

  // Auto-dismiss timer
  useEffect(() => {
    if (!downloadedVersion || dismissed) return

    timerRef.current = setTimeout(() => {
      setDismissed(true)
    }, AUTO_DISMISS_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [downloadedVersion, dismissed])

  const handleDismiss = useCallback(() => {
    if (downloadedVersion) {
      dismissedVersionRef.current = downloadedVersion
    }
    setDismissed(true)
  }, [downloadedVersion])

  const handleInstall = useCallback(() => {
    if (window.electronAPI?.installUpdate) {
      window.electronAPI.installUpdate()
    }
  }, [])

  const visible = !!downloadedVersion && !dismissed

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-[100]',
        'flex items-center justify-center gap-3 px-4 py-2',
        'bg-primary text-primary-foreground text-sm',
        'transition-all duration-500 ease-in-out',
        visible
          ? 'translate-y-0 opacity-100'
          : '-translate-y-full opacity-0 pointer-events-none'
      )}
    >
      <span>
        {t('settings.updates.downloaded', { version: downloadedVersion })}
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 gap-1.5 text-xs"
        onClick={handleInstall}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {t('settings.updates.restartInstall')}
      </Button>
      <button
        onClick={handleDismiss}
        className="ml-1 p-0.5 rounded hover:bg-primary-foreground/20 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
