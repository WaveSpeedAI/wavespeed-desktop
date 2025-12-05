import { useState, useEffect, useCallback } from 'react'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { useThemeStore, type Theme } from '@/stores/themeStore'
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
import { Eye, EyeOff, Check, Loader2, Monitor, Moon, Sun, Download, RefreshCw, Rocket, AlertCircle, Shield, Github } from 'lucide-react'
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
  const { apiKey, setApiKey, isValidated, isValidating: storeIsValidating, validateApiKey } = useApiKeyStore()
  const { theme, setTheme } = useThemeStore()
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
    }
    loadSettings()
  }, [])

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
          title: 'API Key saved',
          description: 'Your API key has been validated and saved successfully.',
        })
      } else {
        toast({
          title: 'Invalid API Key',
          description: 'The API key could not be validated. Please check and try again.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to save API key.',
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
      title: 'API Key cleared',
      description: 'Your API key has been removed.',
    })
  }

  const handleChannelChange = useCallback(async (channel: UpdateChannel) => {
    setUpdateChannel(channel)
    setUpdateStatus(null)
    if (window.electronAPI?.setUpdateChannel) {
      await window.electronAPI.setUpdateChannel(channel)
      toast({
        title: 'Update channel changed',
        description: `Switched to ${channel} channel. Click "Check for Updates" to see available updates.`,
      })
    }
  }, [])

  const handleAutoCheckUpdateChange = useCallback(async (checked: boolean) => {
    setAutoCheckUpdate(checked)
    if (window.electronAPI?.setSettings) {
      await window.electronAPI.setSettings({ autoCheckUpdate: checked })
    }
  }, [])

  const handleCheckForUpdates = useCallback(async () => {
    if (!window.electronAPI?.checkForUpdates) {
      toast({
        title: 'Not available',
        description: 'Auto-update is not available in development mode.',
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
          title: 'Development Mode',
          description: 'Auto-update is disabled in development mode.',
        })
      } else if (result.status === 'error') {
        toast({
          title: 'Update check failed',
          description: result.message || 'Failed to check for updates.',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to check for updates.',
        variant: 'destructive',
      })
    } finally {
      setIsCheckingUpdate(false)
    }
  }, [])

  const handleDownloadUpdate = useCallback(async () => {
    if (!window.electronAPI?.downloadUpdate) return

    setIsDownloading(true)
    try {
      await window.electronAPI.downloadUpdate()
    } catch (error) {
      toast({
        title: 'Download failed',
        description: 'Failed to download the update.',
        variant: 'destructive',
      })
      setIsDownloading(false)
    }
  }, [])

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
            <span>Checking for updates...</span>
          </div>
        )

      case 'available':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Download className="h-4 w-4" />
              <span>Version {updateStatus.version} is available!</span>
            </div>
            <Button onClick={handleDownloadUpdate} disabled={isDownloading}>
              <Download className="mr-2 h-4 w-4" />
              Download Update
            </Button>
          </div>
        )

      case 'not-available':
        return (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Check className="h-4 w-4" />
            <span>You're on the latest version ({updateStatus.version})</span>
          </div>
        )

      case 'downloading':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Downloading update... {Math.round(updateStatus.percent || 0)}%</span>
            </div>
            <Progress value={updateStatus.percent || 0} />
          </div>
        )

      case 'downloaded':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Check className="h-4 w-4" />
              <span>Update downloaded! Version {updateStatus.version} is ready to install.</span>
            </div>
            <Button onClick={handleInstallUpdate}>
              <Rocket className="mr-2 h-4 w-4" />
              Restart & Install
            </Button>
          </div>
        )

      case 'error':
        return (
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>Update error: {updateStatus.message}</span>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="container max-w-2xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Configure your WaveSpeed Desktop application
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>API Key</CardTitle>
              <CardDescription>
                Enter your WaveSpeed API key to access the models
              </CardDescription>
            </div>
            {apiKey && storeIsValidating && (
              <Badge variant="secondary">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Validating
              </Badge>
            )}
            {apiKey && !storeIsValidating && isValidated && (
              <Badge variant="success">
                <Check className="mr-1 h-3 w-3" /> Valid
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="apiKey"
                  type={showKey ? 'text' : 'password'}
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder="Enter your API key"
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
              Get your API key from{' '}
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
                  Validating...
                </>
              ) : (
                'Save API Key'
              )}
            </Button>
            <Button variant="outline" onClick={handleClear} disabled={!apiKey}>
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Customize the look of the application
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="theme">Theme</Label>
            <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
              <SelectTrigger id="theme" className="w-[200px]">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4" />
                    <span>Auto (System)</span>
                  </div>
                </SelectItem>
                <SelectItem value="light">
                  <div className="flex items-center gap-2">
                    <Sun className="h-4 w-4" />
                    <span>Light</span>
                  </div>
                </SelectItem>
                <SelectItem value="dark">
                  <div className="flex items-center gap-2">
                    <Moon className="h-4 w-4" />
                    <span>Dark</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Choose how the application looks. Auto will follow your system preference.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Updates</CardTitle>
              <CardDescription>
                Manage application updates
              </CardDescription>
            </div>
            {appVersion && (
              <Badge variant="outline">v{appVersion}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="updateChannel">Update Channel</Label>
            <Select value={updateChannel} onValueChange={(value) => handleChannelChange(value as UpdateChannel)}>
              <SelectTrigger id="updateChannel" className="w-[200px]">
                <SelectValue placeholder="Select channel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stable">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    <span>Stable</span>
                  </div>
                </SelectItem>
                <SelectItem value="nightly">
                  <div className="flex items-center gap-2">
                    <Rocket className="h-4 w-4" />
                    <span>Nightly</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {updateChannel === 'stable'
                ? 'Receive stable releases with thoroughly tested features.'
                : 'Receive nightly builds with the latest features (may be unstable).'}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="autoCheckUpdate">Check for updates automatically</Label>
              <p className="text-xs text-muted-foreground">
                Automatically check for updates when the app starts.
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
                  Checking...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Check for Updates
                </>
              )}
            </Button>

            {renderUpdateStatus()}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>About</CardTitle>
          <CardDescription>
            WaveSpeed Desktop - AI Model Playground
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            An open-source desktop application for running AI models with WaveSpeed API.
          </p>
          <Button
            variant="outline"
            onClick={() => window.open('https://github.com/WaveSpeedAI/wavespeed-desktop', '_blank')}
          >
            <Github className="mr-2 h-4 w-4" />
            View on GitHub
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
