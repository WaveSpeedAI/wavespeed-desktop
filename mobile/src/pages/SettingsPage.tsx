import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { apiClient } from '@/api/client'
import { useThemeStore, type Theme } from '@/stores/themeStore'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/useToast'
import { Eye, EyeOff, Check, Loader2, Monitor, Moon, Sun, Download, RefreshCw, Github, Globe, Database, ChevronRight, X, Trash2, CheckCircle2, Circle, AlertCircle } from 'lucide-react'

interface CacheItem {
  cacheName: string
  url: string
  size: number
}

interface ModelDownloadState {
  name: string
  status: 'pending' | 'downloading' | 'completed' | 'error' | 'cached'
  progress: number
  error?: string
  type?: 'direct' | 'worker'  // direct = fetch URL, worker = use background remover worker
}

export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { apiKey, setApiKey, isValidated, isValidating: storeIsValidating, validateApiKey } = useApiKeyStore()
  const { theme, setTheme } = useThemeStore()
  const [inputKey, setInputKey] = useState(apiKey)
  const [showKey, setShowKey] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Balance state
  const [balance, setBalance] = useState<number | null>(null)
  const [isLoadingBalance, setIsLoadingBalance] = useState(false)

  // Cache state
  const [cacheSize, setCacheSize] = useState<number | null>(null)
  const [isClearingCache, setIsClearingCache] = useState(false)
  const [cacheItems, setCacheItems] = useState<CacheItem[]>([])
  const [showCacheDialog, setShowCacheDialog] = useState(false)
  const [isDeletingItem, setIsDeletingItem] = useState<string | null>(null)

  // Model download state
  const [isDownloadingModels, setIsDownloadingModels] = useState(false)
  const [modelDownloadStates, setModelDownloadStates] = useState<ModelDownloadState[]>([])
  const [overallProgress, setOverallProgress] = useState(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Update state
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{
    hasUpdate: boolean
    currentVersion: string
    latestVersion: string
    downloadUrl: string
    releaseNotes?: string
  } | null>(null)

  // Current app version
  const currentVersion = '0.8.1' // From package.json

  // Get the saved language preference (including 'auto')
  const [languagePreference, setLanguagePreference] = useState(() => {
    return localStorage.getItem('wavespeed_language') || 'auto'
  })

  const handleLanguageChange = useCallback((langCode: string) => {
    setLanguagePreference(langCode)
    localStorage.setItem('wavespeed_language', langCode)

    if (langCode === 'auto') {
      const browserLang = navigator.language || 'en'
      const supportedLangs = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'ru', 'pt', 'hi', 'id', 'ms', 'th', 'vi', 'tr', 'ar']
      const matchedLang = supportedLangs.find(l => browserLang.startsWith(l.split('-')[0])) || 'en'
      i18n.changeLanguage(matchedLang)
    } else {
      i18n.changeLanguage(langCode)
    }

    toast({
      title: t('settings.language.changed'),
      description: t('settings.language.changedDesc'),
    })
  }, [i18n, t])

  // Load cache details
  const loadCacheDetails = useCallback(async () => {
    try {
      const cacheNames = await caches.keys()
      const items: CacheItem[] = []
      let totalSize = 0

      for (const name of cacheNames) {
        const cache = await caches.open(name)
        const keys = await cache.keys()
        for (const request of keys) {
          const response = await cache.match(request)
          if (response) {
            const blob = await response.blob()
            items.push({
              cacheName: name,
              url: request.url,
              size: blob.size
            })
            totalSize += blob.size
          }
        }
      }

      setCacheItems(items)
      setCacheSize(totalSize)
    } catch {
      setCacheItems([])
      setCacheSize(0)
    }
  }, [])

  // Fetch account balance
  const fetchBalance = useCallback(async () => {
    if (!isValidated) return
    setIsLoadingBalance(true)
    try {
      const bal = await apiClient.getBalance()
      setBalance(bal)
    } catch {
      toast({
        title: t('common.error'),
        description: t('settings.balance.refreshFailed'),
        variant: 'destructive',
      })
    } finally {
      setIsLoadingBalance(false)
    }
  }, [isValidated, t])

  // Delete a single cache item
  const handleDeleteCacheItem = useCallback(async (cacheName: string, url: string) => {
    setIsDeletingItem(url)
    try {
      const cache = await caches.open(cacheName)
      await cache.delete(url)
      await loadCacheDetails()
    } catch {
      toast({
        title: t('common.error'),
        description: t('settings.cache.clearFailed'),
        variant: 'destructive',
      })
    } finally {
      setIsDeletingItem(null)
    }
  }, [loadCacheDetails, t])

  // Clear all caches
  const handleClearCache = useCallback(async () => {
    setIsClearingCache(true)
    try {
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.map((name) => caches.delete(name)))
      setCacheSize(0)
      setCacheItems([])
      setShowCacheDialog(false)
      toast({
        title: t('settings.cache.cleared'),
        description: t('settings.cache.clearedDesc'),
      })
    } catch {
      toast({
        title: t('common.error'),
        description: t('settings.cache.clearFailed'),
        variant: 'destructive',
      })
    } finally {
      setIsClearingCache(false)
    }
  }, [t])

  // Check for updates via GitHub API
  const handleCheckForUpdates = useCallback(async () => {
    setIsCheckingUpdate(true)
    setUpdateInfo(null)

    try {
      // Check GitHub releases for mobile APK
      const response = await fetch(
        'https://api.github.com/repos/WaveSpeedAI/wavespeed-desktop/releases',
        { headers: { 'Accept': 'application/vnd.github.v3+json' } }
      )

      if (!response.ok) {
        throw new Error('Failed to fetch releases')
      }

      const releases = await response.json()

      // Find the latest release that has an APK asset
      let latestMobileRelease = null
      let apkAsset = null

      for (const release of releases) {
        // Skip drafts and prereleases
        if (release.draft || release.prerelease) continue

        // Look for APK asset
        const apk = release.assets?.find((asset: { name: string }) =>
          asset.name.endsWith('.apk')
        )

        if (apk) {
          latestMobileRelease = release
          apkAsset = apk
          break
        }
      }

      if (!latestMobileRelease || !apkAsset) {
        // No mobile release found
        setUpdateInfo({
          hasUpdate: false,
          currentVersion,
          latestVersion: currentVersion,
          downloadUrl: '',
        })
        toast({
          title: t('settings.updates.notAvailable', { version: currentVersion }),
        })
        return
      }

      // Extract version from tag (e.g., "v0.8.2" -> "0.8.2")
      const latestVersion = latestMobileRelease.tag_name.replace(/^v/, '')

      // Compare versions
      const compareVersions = (v1: string, v2: string): number => {
        const parts1 = v1.split('.').map(Number)
        const parts2 = v2.split('.').map(Number)
        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
          const p1 = parts1[i] || 0
          const p2 = parts2[i] || 0
          if (p1 < p2) return -1
          if (p1 > p2) return 1
        }
        return 0
      }

      const hasUpdate = compareVersions(currentVersion, latestVersion) < 0

      setUpdateInfo({
        hasUpdate,
        currentVersion,
        latestVersion,
        downloadUrl: apkAsset.browser_download_url,
        releaseNotes: latestMobileRelease.body,
      })

      if (hasUpdate) {
        toast({
          title: t('settings.updates.available', { version: latestVersion }),
        })
      } else {
        toast({
          title: t('settings.updates.notAvailable', { version: currentVersion }),
        })
      }
    } catch (error) {
      console.error('Failed to check for updates:', error)
      toast({
        title: t('settings.updates.checkFailed'),
        variant: 'destructive',
      })
    } finally {
      setIsCheckingUpdate(false)
    }
  }, [currentVersion, t])

  // Download update (open browser to APK download)
  const handleDownloadUpdate = useCallback(async () => {
    if (!updateInfo?.downloadUrl) return

    try {
      // Use Capacitor Browser to open download URL
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url: updateInfo.downloadUrl })
    } catch {
      // Fallback to window.open
      window.open(updateInfo.downloadUrl, '_blank')
    }
  }, [updateInfo])

  // Check if a model is already cached
  const checkModelCached = async (url: string, cacheName: string): Promise<boolean> => {
    try {
      const cache = await caches.open(cacheName)
      const response = await cache.match(url)
      return !!response
    } catch {
      return false
    }
  }

  // Download a single model with progress
  const downloadModel = async (
    url: string,
    cacheName: string,
    onProgress: (progress: number) => void,
    signal: AbortSignal
  ): Promise<void> => {
    const response = await fetch(url, { mode: 'cors', signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const contentLength = response.headers.get('content-length')
    const total = contentLength ? parseInt(contentLength, 10) : 0
    const reader = response.body?.getReader()

    if (!reader) throw new Error('Failed to get response reader')

    const chunks: Uint8Array[] = []
    let received = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      chunks.push(value)
      received += value.length

      if (total > 0) {
        onProgress((received / total) * 100)
      }
    }

    // Combine chunks and cache
    const buffer = new Uint8Array(received)
    let position = 0
    for (const chunk of chunks) {
      buffer.set(chunk, position)
      position += chunk.length
    }

    const cache = await caches.open(cacheName)
    const cacheResponse = new Response(buffer.buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': buffer.byteLength.toString()
      }
    })
    await cache.put(url, cacheResponse)
  }

  // Background remover worker ref for pre-download
  const bgRemoverWorkerRef = useRef<Worker | null>(null)

  // Download all Free Tools models
  const handleDownloadModels = useCallback(async () => {
    // Use UMD build of FFmpeg - more stable
    const ffmpegBase = 'https://unpkg.com/@ffmpeg/core@0.12.4/dist/umd'

    // Define all models to download
    // Note: Upscaler models are bundled with npm packages, no download needed
    const models: Array<{
      name: string
      url: string
      cacheName: string
      size: string
      type: 'direct' | 'worker'
    }> = [
      {
        name: 'FFmpeg Core (JS)',
        url: `${ffmpegBase}/ffmpeg-core.js`,
        cacheName: 'ffmpeg-wasm-cache',
        size: '~150KB',
        type: 'direct'
      },
      {
        name: 'FFmpeg Core (WASM)',
        url: `${ffmpegBase}/ffmpeg-core.wasm`,
        cacheName: 'ffmpeg-wasm-cache',
        size: '~24MB',
        type: 'direct'
      },
      {
        name: 'Background Remover',
        url: '', // Uses worker-based warm-up
        cacheName: 'background-removal-assets', // Library's internal cache name
        size: '~44MB',
        type: 'worker'
      },
      {
        name: 'Image Eraser (LaMa)',
        url: 'https://huggingface.co/opencv/inpainting_lama/resolve/main/inpainting_lama_2025jan.onnx',
        cacheName: 'lama-model-cache',
        size: '~200MB',
        type: 'direct'
      },
      {
        name: 'SAM Vision Encoder',
        url: 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/main/onnx/vision_encoder_quantized.onnx',
        cacheName: 'sam-model-cache',
        size: '~9MB',
        type: 'direct'
      },
      {
        name: 'SAM Prompt Decoder',
        url: 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/main/onnx/prompt_encoder_mask_decoder_quantized.onnx',
        cacheName: 'sam-model-cache',
        size: '~5MB',
        type: 'direct'
      }
    ]

    // Initialize states
    const initialStates: ModelDownloadState[] = models.map(m => ({
      name: m.name,
      status: 'pending',
      progress: 0,
      type: m.type
    }))
    setModelDownloadStates(initialStates)
    setIsDownloadingModels(true)
    setOverallProgress(0)

    // Create abort controller
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    // Helper to check if Background Remover model is cached
    const checkBgRemoverCached = async (): Promise<boolean> => {
      try {
        // Check if the library's cache has any model data
        const cacheNames = await caches.keys()
        // The @imgly/background-removal library uses 'background-removal-assets' cache
        const bgCache = cacheNames.find(name => name.includes('background-removal') || name.includes('imgly'))
        if (bgCache) {
          const cache = await caches.open(bgCache)
          const keys = await cache.keys()
          // If there are multiple entries (model chunks), consider it cached
          return keys.length > 5
        }
        return false
      } catch {
        return false
      }
    }

    // Helper to download Background Remover via worker warm-up
    const downloadBgRemover = (
      onProgress: (progress: number) => void
    ): Promise<void> => {
      return new Promise((resolve, reject) => {
        // Create worker
        const worker = new Worker(
          new URL('../workers/backgroundRemover.worker.ts', import.meta.url),
          { type: 'module' }
        )
        bgRemoverWorkerRef.current = worker

        // Create a tiny 1x1 pixel test image as blob
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#000000'
        ctx.fillRect(0, 0, 1, 1)

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Failed to create test image'))
            return
          }

          worker.onmessage = (e) => {
            const { type, payload } = e.data

            if (type === 'progress') {
              const { phase, progress } = payload as { phase: string; progress: number }
              // Only report download phase progress
              if (phase === 'download') {
                onProgress(progress)
              }
            } else if (type === 'result' || type === 'resultAll') {
              // Model downloaded and cached
              worker.terminate()
              bgRemoverWorkerRef.current = null
              resolve()
            } else if (type === 'error') {
              worker.terminate()
              bgRemoverWorkerRef.current = null
              reject(new Error(payload as string))
            }
          }

          worker.onerror = (e) => {
            worker.terminate()
            bgRemoverWorkerRef.current = null
            reject(new Error(e.message))
          }

          // Process the tiny image to trigger model download
          worker.postMessage({
            type: 'process',
            payload: {
              imageBlob: blob,
              model: 'isnet_quint8',
              outputType: 'foreground',
              id: 0
            }
          })
        }, 'image/png')
      })
    }

    try {
      // Check which models are already cached
      for (let i = 0; i < models.length; i++) {
        const model = models[i]
        let isCached: boolean
        if (model.type === 'worker') {
          isCached = await checkBgRemoverCached()
        } else {
          isCached = await checkModelCached(model.url, model.cacheName)
        }
        if (isCached) {
          setModelDownloadStates(prev => {
            const newStates = [...prev]
            newStates[i] = { ...newStates[i], status: 'cached', progress: 100 }
            return newStates
          })
        }
      }

      // Download each model
      for (let i = 0; i < models.length; i++) {
        if (signal.aborted) break

        const model = models[i]

        // Check if already cached
        let isCached: boolean
        if (model.type === 'worker') {
          isCached = await checkBgRemoverCached()
        } else {
          isCached = await checkModelCached(model.url, model.cacheName)
        }
        if (isCached) {
          setModelDownloadStates(prev => {
            const newStates = [...prev]
            newStates[i] = { ...newStates[i], status: 'cached', progress: 100 }
            return newStates
          })
          continue
        }

        // Update to downloading state
        setModelDownloadStates(prev => {
          const newStates = [...prev]
          newStates[i] = { ...newStates[i], status: 'downloading', progress: 0 }
          return newStates
        })

        try {
          const updateProgress = (progress: number) => {
            setModelDownloadStates(prev => {
              const newStates = [...prev]
              newStates[i] = { ...newStates[i], progress }
              return newStates
            })
            // Update overall progress
            const completedCount = models.slice(0, i).filter((_, idx) => {
              const state = initialStates[idx]
              return state.status === 'completed' || state.status === 'cached'
            }).length
            const currentProgress = progress / 100
            setOverallProgress(((completedCount + currentProgress) / models.length) * 100)
          }

          if (model.type === 'worker') {
            // Download via worker warm-up
            await downloadBgRemover(updateProgress)
          } else {
            // Download directly
            await downloadModel(model.url, model.cacheName, updateProgress, signal)
          }

          // Mark as completed
          setModelDownloadStates(prev => {
            const newStates = [...prev]
            newStates[i] = { ...newStates[i], status: 'completed', progress: 100 }
            return newStates
          })
        } catch (error) {
          if (signal.aborted) break
          setModelDownloadStates(prev => {
            const newStates = [...prev]
            newStates[i] = {
              ...newStates[i],
              status: 'error',
              error: (error as Error).message
            }
            return newStates
          })
        }
      }

      // Refresh cache details
      await loadCacheDetails()

      if (!signal.aborted) {
        const hasErrors = modelDownloadStates.some(s => s.status === 'error')
        if (hasErrors) {
          toast({
            title: t('settings.cache.downloadPartial'),
            description: t('settings.cache.downloadPartialDesc'),
            variant: 'destructive',
          })
        } else {
          toast({
            title: t('settings.cache.downloadComplete'),
            description: t('settings.cache.downloadCompleteDesc'),
          })
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        toast({
          title: t('common.error'),
          description: (error as Error).message,
          variant: 'destructive',
        })
      }
    } finally {
      setIsDownloadingModels(false)
      setOverallProgress(100)
      abortControllerRef.current = null
    }
  }, [t, loadCacheDetails])

  // Cancel download
  const handleCancelDownload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    // Also terminate background remover worker if running
    if (bgRemoverWorkerRef.current) {
      bgRemoverWorkerRef.current.terminate()
      bgRemoverWorkerRef.current = null
    }
    setIsDownloadingModels(false)
    toast({
      title: t('settings.cache.downloadCancelled'),
      description: t('settings.cache.downloadCancelledDesc'),
    })
  }, [t])

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  // Get display name from URL
  const getDisplayName = (url: string) => {
    try {
      const urlObj = new URL(url)
      const path = urlObj.pathname
      const filename = path.split('/').pop() || path
      return filename.length > 40 ? filename.slice(0, 37) + '...' : filename
    } catch {
      return url.slice(0, 40)
    }
  }

  // Load settings on mount
  useEffect(() => {
    loadCacheDetails()
  }, [loadCacheDetails])

  // Fetch balance when authenticated
  useEffect(() => {
    if (isValidated) {
      fetchBalance()
    } else {
      setBalance(null)
    }
  }, [isValidated, fetchBalance])

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

  // Render model download status icon
  const renderStatusIcon = (status: ModelDownloadState['status']) => {
    switch (status) {
      case 'pending':
        return <Circle className="h-4 w-4 text-muted-foreground" />
      case 'downloading':
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'cached':
        return <CheckCircle2 className="h-4 w-4 text-blue-500" />
      case 'error':
        return <AlertCircle className="h-4 w-4 text-destructive" />
    }
  }

  return (
    <div className="container max-w-2xl py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{t('settings.title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('settings.mobileDescription')}
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
              <Badge variant="success" className="px-2">
                <Check className="h-4 w-4" />
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
                href="https://wavespeed.ai/accesskey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                wavespeed.ai/accesskey
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

      {isValidated && (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t('settings.balance.title')}</CardTitle>
                <CardDescription>
                  {t('settings.balance.description')}
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={fetchBalance}
                disabled={isLoadingBalance}
              >
                <RefreshCw className={`h-4 w-4 ${isLoadingBalance ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">
                {isLoadingBalance ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : balance !== null ? (
                  `$${balance.toFixed(2)}`
                ) : (
                  '—'
                )}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

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
            <Select value={languagePreference} onValueChange={handleLanguageChange}>
              <SelectTrigger id="language" className="w-[200px]">
                <SelectValue placeholder={t('settings.language.label')} />
              </SelectTrigger>
              <SelectContent>
                {languages.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      <span>{lang.code === 'auto' ? t('settings.language.auto') : lang.nativeName}</span>
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
          <CardTitle>{t('settings.cache.title')}</CardTitle>
          <CardDescription>
            {t('settings.cache.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-3 text-left hover:bg-muted/50 -ml-2 px-2 py-1 rounded-md transition-colors"
              onClick={() => setShowCacheDialog(true)}
              disabled={cacheSize === 0}
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <Label className="cursor-pointer">{t('settings.cache.aiModels')}</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('settings.cache.aiModelsDesc')}
                </p>
              </div>
              {cacheSize !== null && cacheSize > 0 && (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {cacheSize !== null
                  ? cacheSize > 0
                    ? formatSize(cacheSize)
                    : t('settings.cache.empty')
                  : t('settings.cache.calculating')}
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleClearCache}
                disabled={isClearingCache || cacheSize === 0}
              >
                {isClearingCache ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('settings.cache.clear')}
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Download Models Section */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Download className="h-4 w-4 text-muted-foreground" />
                  <Label>{t('settings.cache.predownload')}</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('settings.cache.predownloadDesc')}
                </p>
              </div>
              {isDownloadingModels ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelDownload}
                >
                  <X className="mr-2 h-4 w-4" />
                  {t('common.cancel')}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadModels}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {t('settings.cache.downloadModels')}
                </Button>
              )}
            </div>

            {/* Model download progress list */}
            {modelDownloadStates.length > 0 && (
              <div className="space-y-2 pt-2">
                {modelDownloadStates.map((model, index) => (
                  <div key={index} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        {renderStatusIcon(model.status)}
                        <span className={model.status === 'error' ? 'text-destructive' : ''}>
                          {model.name}
                        </span>
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {model.status === 'cached' && t('settings.cache.alreadyCached')}
                        {model.status === 'completed' && t('settings.cache.downloaded')}
                        {model.status === 'downloading' && `${Math.round(model.progress)}%`}
                        {model.status === 'error' && model.error}
                      </span>
                    </div>
                    {model.status === 'downloading' && (
                      <Progress value={model.progress} className="h-1" />
                    )}
                  </div>
                ))}

                {/* Overall progress */}
                {isDownloadingModels && (
                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-muted-foreground">{t('settings.cache.overallProgress')}</span>
                      <span className="text-muted-foreground">{Math.round(overallProgress)}%</span>
                    </div>
                    <Progress value={overallProgress} />
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cache Details Dialog */}
      <Dialog open={showCacheDialog} onOpenChange={setShowCacheDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{t('settings.cache.title')}</span>
              <span className="text-sm font-normal text-muted-foreground">
                {formatSize(cacheSize || 0)}
              </span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t('settings.cache.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto -mx-6 px-6">
            {cacheItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t('settings.cache.empty')}
              </p>
            ) : (
              <div className="space-y-2">
                {cacheItems.map((item) => (
                  <div
                    key={item.url}
                    className="flex items-center justify-between gap-3 p-2 rounded-md bg-muted/50 group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" title={item.url}>
                        {getDisplayName(item.url)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate" title={item.cacheName}>
                        {item.cacheName}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {formatSize(item.size)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleDeleteCacheItem(item.cacheName, item.url)}
                        disabled={isDeletingItem === item.url}
                      >
                        {isDeletingItem === item.url ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {cacheItems.length > 0 && (
            <div className="flex justify-end pt-4 border-t">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleClearCache}
                disabled={isClearingCache}
              >
                {isClearingCache ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                {t('settings.cache.clear')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Updates Card */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t('settings.updates.title')}</CardTitle>
          <CardDescription>
            {t('settings.updates.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t('settings.about.version')}: {currentVersion}
              </p>
              {updateInfo && (
                <p className="text-xs text-muted-foreground">
                  {updateInfo.hasUpdate
                    ? t('settings.updates.available', { version: updateInfo.latestVersion })
                    : t('settings.updates.notAvailable', { version: currentVersion })}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              onClick={handleCheckForUpdates}
              disabled={isCheckingUpdate}
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
          </div>

          {/* Show download button if update available */}
          {updateInfo?.hasUpdate && (
            <div className="flex flex-col gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">
                  {t('settings.updates.available', { version: updateInfo.latestVersion })}
                </span>
              </div>
              <Button onClick={handleDownloadUpdate}>
                <Download className="mr-2 h-4 w-4" />
                {t('settings.updates.downloadUpdate')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t('settings.about.title')}</CardTitle>
          <CardDescription>
            {t('settings.about.mobileDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('settings.about.mobileAboutText')}
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
