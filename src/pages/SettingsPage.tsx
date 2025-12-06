import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { useThemeStore, type Theme } from '@/stores/themeStore'
import { useAssetsStore } from '@/stores/assetsStore'
import { languages } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/useToast'
import { Eye, EyeOff, Check, Loader2, Monitor, Moon, Sun, Download, RefreshCw, Rocket, AlertCircle, Shield, Github, Globe, FolderOpen } from 'lucide-react'
import { Switch } from '@/components/ui/switch'

type UpdateChannel = 'stable' | 'nightly'

interface UpdateStatus {
  status: string
  version?: string
  releaseNotes?: string | null
  percent?: number
  message?: string
}

export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { apiKey, setApiKey, isValidated, isValidating: storeIsValidating, validateApiKey } = useApiKeyStore()
  const { theme, setTheme } = useThemeStore()
  const { settings: assetsSettings, loadSettings: loadAssetsSettings, setAutoSave, setAssetsDirectory } = useAssetsStore()
  const [inputKey, setInputKey] = useState(apiKey)
  const [showKey, setShowKey] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Update state
  const [appVersion, setAppVersion] = useState<string>('')
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>('stable')
  const [autoCheckUpdate, setAutoCheckUpdate] = useState<boolean>(true)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const handleLanguageChange = useCallback((langCode: string) => {
    i18n.changeLanguage(langCode)
    localStorage.setItem('wavespeed_language', langCode)
    toast({
      title: t('settings.language.changed'),
      description: t('settings.language.changedDesc'),
    })
  }, [i18n, t])

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (window.electronAPI) {
        const version = await window.electronAPI.getAppVersion()
        setAppVersion(version)

        const settings = await window.electronAPI.getSettings()
        setUpdateChannel(settings.updateChannel || 'stable')
        setAutoCheckUpdate(settings.autoCheckUpdate !== false)
      }
      // Load assets settings
      loadAssetsSettings()
    }
    loadSettings()
  }, [loadAssetsSettings])

  // Subscribe to update status events
  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return

    const unsubscribe = window.electronAPI.onUpdateStatus((status) => {
      setUpdateStatus(status)

      if (status.status === 'checking') {
        setIsCheckingUpdate(true)
      } else {
        setIsCheckingUpdate(false)
      }

      if (status.status === 'downloading') {
        setIsDownloading(true)
      } else if (status.status === 'downloaded' || status.status === 'error') {
        setIsDownloading(false)
      }
    })

    return unsubscribe
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await setApiKey(inputKey)
      const isValid = await validateApiKey()
      if (isValid) {
        toast({
          title: t('settings.apiKey.saved'),
          description: t('settings.apiKey.savedDesc'),
        })
      } else {
        toast({
          title: t('settings.apiKey.invalid'),
          description: t('settings.apiKey.invalidDesc'),
          variant: 'destructive',
        })
      }
    } catch {
      toast({
        title: t('settings.apiKey.error'),
        description: t('settings.apiKey.errorDesc'),
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleClear = async () => {
    setInputKey('')
    await setApiKey('')
    toast({
      title: t('settings.apiKey.cleared'),
      description: t('settings.apiKey.clearedDesc'),
    })
  }

  const handleChannelChange = useCallback(async (channel: UpdateChannel) => {
    setUpdateChannel(channel)
    setUpdateStatus(null)
    if (window.electronAPI?.setUpdateChannel) {
      await window.electronAPI.setUpdateChannel(channel)
      toast({
        title: t('settings.updates.channelChanged'),
        description: t('settings.updates.channelChangedDesc', { channel }),
      })
    }
  }, [t])

  const handleAutoCheckUpdateChange = useCallback(async (checked: boolean) => {
    setAutoCheckUpdate(checked)
    if (window.electronAPI?.setSettings) {
      await window.electronAPI.setSettings({ autoCheckUpdate: checked })
    }
  }, [])

  const handleAutoSaveAssetsChange = useCallback(async (checked: boolean) => {
    await setAutoSave(checked)
    toast({
      title: checked ? t('settings.assets.autoSaveEnabled') : t('settings.assets.autoSaveDisabled'),
      description: checked ? t('settings.assets.autoSaveEnabledDesc') : t('settings.assets.autoSaveDisabledDesc'),
    })
  }, [setAutoSave, t])

  const handleSelectAssetsDirectory = useCallback(async () => {
    if (!window.electronAPI?.selectDirectory) {
      toast({
        title: t('common.error'),
        description: t('settings.assets.desktopOnly'),
        variant: 'destructive',
      })
      return
    }

    const result = await window.electronAPI.selectDirectory()
    if (result.success && result.path) {
      await setAssetsDirectory(result.path)
      toast({
        title: t('settings.assets.directoryChanged'),
        description: t('settings.assets.directoryChangedDesc', { path: result.path }),
      })
    }
  }, [setAssetsDirectory, t])

  const handleCheckForUpdates = useCallback(async () => {
    if (!window.electronAPI?.checkForUpdates) {
      toast({
        title: t('settings.updates.devMode'),
        description: t('settings.updates.notAvailableInDev'),
        variant: 'destructive',
      })
      return
    }

    setIsCheckingUpdate(true)
    setUpdateStatus(null)

    try {
      const result = await window.electronAPI.checkForUpdates()
      if (result.status === 'dev-mode') {
        toast({
          title: t('settings.updates.devMode'),
          description: t('settings.updates.devModeDesc'),
        })
      } else if (result.status === 'error') {
        toast({
          title: t('settings.updates.checkFailed'),
          description: result.message || t('settings.updates.checkFailed'),
          variant: 'destructive',
        })
      }
    } catch {
      toast({
        title: t('common.error'),
        description: t('settings.updates.checkFailed'),
        variant: 'destructive',
      })
    } finally {
      setIsCheckingUpdate(false)
    }
  }, [t])

  const handleDownloadUpdate = useCallback(async () => {
    if (!window.electronAPI?.downloadUpdate) return

    setIsDownloading(true)
    try {
      await window.electronAPI.downloadUpdate()
    } catch {
      toast({
        title: t('settings.updates.downloadFailed'),
        description: t('settings.updates.downloadFailedDesc'),
        variant: 'destructive',
      })
      setIsDownloading(false)
    }
  }, [t])

  const handleInstallUpdate = useCallback(() => {
    if (window.electronAPI?.installUpdate) {
      window.electronAPI.installUpdate()
    }
  }, [])

  const renderUpdateStatus = () => {
    if (!updateStatus) return null

    switch (updateStatus.status) {
      case 'checking':
        return (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t('settings.updates.checking')}</span>
          </div>
        )

      case 'available':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Download className="h-4 w-4" />
              <span>{t('settings.updates.available', { version: updateStatus.version })}</span>
            </div>
            <Button onClick={handleDownloadUpdate} disabled={isDownloading}>
              <Download className="mr-2 h-4 w-4" />
              {t('settings.updates.downloadUpdate')}
            </Button>
          </div>
        )

      case 'not-available':
        return (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Check className="h-4 w-4" />
            <span>{t('settings.updates.notAvailable', { version: updateStatus.version })}</span>
          </div>
        )

      case 'downloading':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('settings.updates.downloading', { percent: Math.round(updateStatus.percent || 0) })}</span>
            </div>
            <Progress value={updateStatus.percent || 0} />
          </div>
        )

      case 'downloaded':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Check className="h-4 w-4" />
              <span>{t('settings.updates.downloaded', { version: updateStatus.version })}</span>
            </div>
            <Button onClick={handleInstallUpdate}>
              <Rocket className="mr-2 h-4 w-4" />
              {t('settings.updates.restartInstall')}
            </Button>
          </div>
        )

      case 'error':
        return (
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{t('settings.updates.error', { message: updateStatus.message })}</span>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="container max-w-2xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{t('settings.title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('settings.description')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('settings.apiKey.title')}</CardTitle>
              <CardDescription>
                {t('settings.apiKey.description')}
              </CardDescription>
            </div>
            {apiKey && storeIsValidating && (
              <Badge variant="secondary">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" /> {t('settings.apiKey.validating')}
              </Badge>
            )}
            {apiKey && !storeIsValidating && isValidated && (
              <Badge variant="success">
                <Check className="mr-1 h-3 w-3" /> {t('settings.apiKey.valid')}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="apiKey">{t('settings.apiKey.label')}</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="apiKey"
                  type={showKey ? 'text' : 'password'}
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder={t('settings.apiKey.placeholder')}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('settings.apiKey.getKey')}{' '}
              <a
                href="https://wavespeed.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                wavespeed.ai
              </a>
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={isSaving || !inputKey}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('settings.apiKey.validating')}
                </>
              ) : (
                t('settings.apiKey.save')
              )}
            </Button>
            <Button variant="outline" onClick={handleClear} disabled={!apiKey}>
              {t('common.clear')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t('settings.appearance.title')}</CardTitle>
          <CardDescription>
            {t('settings.appearance.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="theme">{t('settings.appearance.theme')}</Label>
            <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
              <SelectTrigger id="theme" className="w-[200px]">
                <SelectValue placeholder={t('settings.appearance.theme')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4" />
                    <span>{t('settings.appearance.themeAuto')}</span>
                  </div>
                </SelectItem>
                <SelectItem value="light">
                  <div className="flex items-center gap-2">
                    <Sun className="h-4 w-4" />
                    <span>{t('settings.appearance.themeLight')}</span>
                  </div>
                </SelectItem>
                <SelectItem value="dark">
                  <div className="flex items-center gap-2">
                    <Moon className="h-4 w-4" />
                    <span>{t('settings.appearance.themeDark')}</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('settings.appearance.themeDesc')}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t('settings.language.title')}</CardTitle>
          <CardDescription>
            {t('settings.language.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="language">{t('settings.language.label')}</Label>
            <Select value={i18n.language} onValueChange={handleLanguageChange}>
              <SelectTrigger id="language" className="w-[200px]">
                <SelectValue placeholder={t('settings.language.label')} />
              </SelectTrigger>
              <SelectContent>
                {languages.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      <span>{lang.nativeName}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t('settings.assets.title')}</CardTitle>
          <CardDescription>
            {t('settings.assets.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="autoSaveAssets">{t('settings.assets.autoSave')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.assets.autoSaveDesc')}
              </p>
            </div>
            <Switch
              id="autoSaveAssets"
              checked={assetsSettings.autoSaveAssets}
              onCheckedChange={handleAutoSaveAssetsChange}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('settings.assets.directory')}</Label>
            <div className="flex gap-2">
              <Input
                value={assetsSettings.assetsDirectory || t('settings.assets.defaultDirectory')}
                readOnly
                className="flex-1"
              />
              <Button variant="outline" onClick={handleSelectAssetsDirectory}>
                <FolderOpen className="mr-2 h-4 w-4" />
                {t('settings.assets.browse')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('settings.assets.directoryDesc')}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('settings.updates.title')}</CardTitle>
              <CardDescription>
                {t('settings.updates.description')}
              </CardDescription>
            </div>
            {appVersion && (
              <Badge variant="outline">v{appVersion}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="updateChannel">{t('settings.updates.channel')}</Label>
            <Select value={updateChannel} onValueChange={(value) => handleChannelChange(value as UpdateChannel)}>
              <SelectTrigger id="updateChannel" className="w-[200px]">
                <SelectValue placeholder={t('settings.updates.channel')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stable">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    <span>{t('settings.updates.stable')}</span>
                  </div>
                </SelectItem>
                <SelectItem value="nightly">
                  <div className="flex items-center gap-2">
                    <Rocket className="h-4 w-4" />
                    <span>{t('settings.updates.nightly')}</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {updateChannel === 'stable'
                ? t('settings.updates.stableDesc')
                : t('settings.updates.nightlyDesc')}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="autoCheckUpdate">{t('settings.updates.autoCheck')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.updates.autoCheckDesc')}
              </p>
            </div>
            <Switch
              id="autoCheckUpdate"
              checked={autoCheckUpdate}
              onCheckedChange={handleAutoCheckUpdateChange}
            />
          </div>

          <div className="space-y-3">
            <Button
              variant="outline"
              onClick={handleCheckForUpdates}
              disabled={isCheckingUpdate || isDownloading}
            >
              {isCheckingUpdate ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('settings.updates.checking')}
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t('settings.updates.checkForUpdates')}
                </>
              )}
            </Button>

            {renderUpdateStatus()}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t('settings.about.title')}</CardTitle>
          <CardDescription>
            {t('settings.about.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('settings.about.aboutText')}
          </p>
          <Button
            variant="outline"
            onClick={() => window.open('https://github.com/WaveSpeedAI/wavespeed-desktop', '_blank')}
          >
            <Github className="mr-2 h-4 w-4" />
            {t('settings.about.viewOnGitHub')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
