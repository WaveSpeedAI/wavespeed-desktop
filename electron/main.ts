import { app, BrowserWindow, shell, ipcMain, dialog, Menu, clipboard, protocol, net } from 'electron'
import { join, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, createWriteStream, unlinkSync, statSync, readdirSync, chmodSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater, UpdateInfo } from 'electron-updater'
import { spawn, execSync } from 'child_process'
import https from 'https'
import http from 'http'
import { pathToFileURL } from 'url'
import { SDGenerator } from './lib/sdGenerator'

// Linux-specific flags
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

// Settings storage
const userDataPath = app.getPath('userData')
const settingsPath = join(userDataPath, 'settings.json')

// Global instances for SD operations
const sdGenerator = new SDGenerator()

// Global reference to active SD generation process (deprecated - using sdGenerator)
let activeSDProcess: ReturnType<typeof spawn> | null = null

interface Settings {
  apiKey: string
  theme: 'light' | 'dark' | 'system'
  defaultPollInterval: number
  defaultTimeout: number
  updateChannel: 'stable' | 'nightly'
  autoCheckUpdate: boolean
  autoSaveAssets: boolean
  assetsDirectory: string
}

interface AssetMetadata {
  id: string
  filePath: string
  fileName: string
  type: 'image' | 'video' | 'audio' | 'text' | 'json'
  modelId: string
  modelName: string
  createdAt: string
  fileSize: number
  tags: string[]
  favorite: boolean
  predictionId?: string
  originalUrl?: string
}

const defaultAssetsDirectory = join(app.getPath('documents'), 'WaveSpeed')
const assetsMetadataPath = join(userDataPath, 'assets-metadata.json')

const defaultSettings: Settings = {
  apiKey: '',
  theme: 'system',
  defaultPollInterval: 1000,
  defaultTimeout: 36000,
  updateChannel: 'stable',
  autoCheckUpdate: true,
  autoSaveAssets: true,
  assetsDirectory: defaultAssetsDirectory
}

function loadSettings(): Settings {
  try {
    if (existsSync(settingsPath)) {
      const data = readFileSync(settingsPath, 'utf-8')
      return { ...defaultSettings, ...JSON.parse(data) }
    }
  } catch (error) {
    console.error('Failed to load settings:', error)
  }
  return { ...defaultSettings }
}

function saveSettings(settings: Partial<Settings>): void {
  try {
    const currentSettings = loadSettings()
    const newSettings = { ...currentSettings, ...settings }
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true })
    }
    writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2))
  } catch (error) {
    console.error('Failed to save settings:', error)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // macOS: Hide window instead of closing when clicking the red button
  // The app will only quit when user presses Cmd+Q
  if (process.platform === 'darwin') {
    mainWindow.on('close', (event) => {
      if (!(app as typeof app & { isQuitting?: boolean }).isQuitting) {
        event.preventDefault()
        mainWindow?.hide()
      }
    })
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Error handling for renderer
  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', errorCode, errorDescription, validatedURL)
  })

  mainWindow.webContents.on('render-process-gone', (_, details) => {
    console.error('Render process gone:', details)
  })

  // Load the app
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    const indexPath = join(__dirname, '../renderer/index.html')
    console.log('Loading renderer from:', indexPath)
    console.log('File exists:', existsSync(indexPath))
    mainWindow.loadFile(indexPath)
  }

  // Open DevTools with keyboard shortcut (Cmd+Opt+I on Mac, Ctrl+Shift+I on Windows/Linux)
  mainWindow.webContents.on('before-input-event', (_, input) => {
    if ((input.meta || input.control) && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow?.webContents.toggleDevTools()
    }
    // Also allow F12
    if (input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  // Enable right-click context menu
  mainWindow.webContents.on('context-menu', (_, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = []

    // Add text editing options when in editable field
    if (params.isEditable) {
      menuItems.push(
        { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: 'Select All', role: 'selectAll' }
      )
    } else if (params.selectionText) {
      // Add copy option when text is selected
      menuItems.push(
        { label: 'Copy', role: 'copy' }
      )
    }

    // Add link options
    if (params.linkURL) {
      if (menuItems.length > 0) menuItems.push({ type: 'separator' })
      menuItems.push(
        {
          label: 'Open Link in Browser',
          click: () => shell.openExternal(params.linkURL)
        },
        {
          label: 'Copy Link',
          click: () => clipboard.writeText(params.linkURL)
        }
      )
    }

    // Add image options
    if (params.mediaType === 'image') {
      if (menuItems.length > 0) menuItems.push({ type: 'separator' })
      menuItems.push(
        {
          label: 'Copy Image',
          click: () => mainWindow?.webContents.copyImageAt(params.x, params.y)
        },
        {
          label: 'Open Image in Browser',
          click: () => shell.openExternal(params.srcURL)
        }
      )
    }

    if (menuItems.length > 0) {
      const menu = Menu.buildFromTemplate(menuItems)
      menu.popup()
    }
  })
}

// IPC Handlers
ipcMain.handle('get-api-key', () => {
  const settings = loadSettings()
  return settings.apiKey
})

ipcMain.handle('set-api-key', (_, apiKey: string) => {
  saveSettings({ apiKey })
  return true
})

ipcMain.handle('get-settings', () => {
  const settings = loadSettings()
  return {
    theme: settings.theme,
    defaultPollInterval: settings.defaultPollInterval,
    defaultTimeout: settings.defaultTimeout,
    updateChannel: settings.updateChannel,
    autoCheckUpdate: settings.autoCheckUpdate
  }
})

ipcMain.handle('set-settings', (_, newSettings: Partial<Settings>) => {
  saveSettings(newSettings)
  return true
})

ipcMain.handle('clear-all-data', () => {
  saveSettings(defaultSettings)
  return true
})

// Open external URL handler
ipcMain.handle('open-external', async (_, url: string) => {
  await shell.openExternal(url)
})

// Download file handler
ipcMain.handle('download-file', async (_, url: string, defaultFilename: string) => {
  const mainWindow = BrowserWindow.getFocusedWindow()
  if (!mainWindow) return { success: false, error: 'No focused window' }

  // Show save dialog
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultFilename,
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      { name: 'Videos', extensions: ['mp4', 'webm', 'mov'] }
    ]
  })

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true }
  }

  // Download the file
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http
    const file = createWriteStream(result.filePath!)

    protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location
        if (redirectUrl) {
          const redirectProtocol = redirectUrl.startsWith('https') ? https : http
          redirectProtocol.get(redirectUrl, (redirectResponse) => {
            redirectResponse.pipe(file)
            file.on('finish', () => {
              file.close()
              resolve({ success: true, filePath: result.filePath })
            })
          }).on('error', (err) => {
            resolve({ success: false, error: err.message })
          })
          return
        }
      }

      response.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve({ success: true, filePath: result.filePath })
      })
    }).on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
})

// Assets metadata helpers
function loadAssetsMetadata(): AssetMetadata[] {
  try {
    if (existsSync(assetsMetadataPath)) {
      const data = readFileSync(assetsMetadataPath, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error('Failed to load assets metadata:', error)
  }
  return []
}

function saveAssetsMetadata(metadata: AssetMetadata[]): void {
  try {
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true })
    }
    writeFileSync(assetsMetadataPath, JSON.stringify(metadata, null, 2))
  } catch (error) {
    console.error('Failed to save assets metadata:', error)
  }
}

// Assets IPC Handlers
ipcMain.handle('get-assets-settings', () => {
  const settings = loadSettings()
  return {
    autoSaveAssets: settings.autoSaveAssets,
    assetsDirectory: settings.assetsDirectory || defaultAssetsDirectory
  }
})

ipcMain.handle('set-assets-settings', (_, newSettings: { autoSaveAssets?: boolean; assetsDirectory?: string }) => {
  saveSettings(newSettings)
  return true
})

ipcMain.handle('get-default-assets-directory', () => {
  return defaultAssetsDirectory
})

ipcMain.handle('select-directory', async () => {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  if (!focusedWindow) return { success: false, error: 'No focused window' }

  const result = await dialog.showOpenDialog(focusedWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Assets Directory'
  })

  if (result.canceled || !result.filePaths[0]) {
    return { success: false, canceled: true }
  }

  return { success: true, path: result.filePaths[0] }
})

ipcMain.handle('save-asset', async (_, url: string, _type: string, fileName: string, subDir: string) => {
  const settings = loadSettings()
  const baseDir = settings.assetsDirectory || defaultAssetsDirectory
  const targetDir = join(baseDir, subDir)

  // Ensure directory exists
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }

  const filePath = join(targetDir, fileName)

  // Download file
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http
    const file = createWriteStream(filePath)

    const handleResponse = (response: http.IncomingMessage) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location
        if (redirectUrl) {
          const redirectProtocol = redirectUrl.startsWith('https') ? https : http
          redirectProtocol.get(redirectUrl, (redirectResponse) => {
            handleResponse(redirectResponse)
          }).on('error', (err) => {
            resolve({ success: false, error: err.message })
          })
          return
        }
      }

      response.pipe(file)
      file.on('finish', () => {
        file.close()
        try {
          const stats = statSync(filePath)
          resolve({ success: true, filePath, fileSize: stats.size })
        } catch {
          resolve({ success: true, filePath, fileSize: 0 })
        }
      })
    }

    protocol.get(url, handleResponse).on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
})

ipcMain.handle('delete-asset', async (_, filePath: string) => {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('delete-assets-bulk', async (_, filePaths: string[]) => {
  let deleted = 0
  for (const filePath of filePaths) {
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath)
        deleted++
      }
    } catch (error) {
      console.error('Failed to delete:', filePath, error)
    }
  }
  return { success: true, deleted }
})

ipcMain.handle('get-assets-metadata', () => {
  return loadAssetsMetadata()
})

ipcMain.handle('save-assets-metadata', (_, metadata: AssetMetadata[]) => {
  saveAssetsMetadata(metadata)
  return true
})

ipcMain.handle('open-file-location', async (_, filePath: string) => {
  if (existsSync(filePath)) {
    shell.showItemInFolder(filePath)
    return { success: true }
  }
  return { success: false, error: 'File not found' }
})

/**
 * File operations for chunked downloads from Worker/Renderer
 */
ipcMain.handle('file-get-size', (_, filePath: string) => {
  try {
    if (existsSync(filePath)) {
      return { success: true, size: statSync(filePath).size }
    }
    return { success: true, size: 0 }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('file-append-chunk', (_, filePath: string, chunk: ArrayBuffer) => {
  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const buffer = Buffer.from(chunk)

    // Append to file (create if not exists)
    if (existsSync(filePath)) {
      const fd = require('fs').openSync(filePath, 'a')
      require('fs').writeSync(fd, buffer)
      require('fs').closeSync(fd)
    } else {
      writeFileSync(filePath, buffer)
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('file-rename', (_, oldPath: string, newPath: string) => {
  try {
    if (existsSync(oldPath)) {
      require('fs').renameSync(oldPath, newPath)
      return { success: true }
    }
    return { success: false, error: 'File not found' }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('file-delete', (_, filePath: string) => {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
      return { success: true }
    }
    return { success: true } // Already deleted
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('check-file-exists', (_, filePath: string) => {
  return existsSync(filePath)
})

ipcMain.handle('open-assets-folder', async () => {
  const settings = loadSettings()
  const assetsDir = settings.assetsDirectory || defaultAssetsDirectory

  // Ensure directory exists
  if (!existsSync(assetsDir)) {
    mkdirSync(assetsDir, { recursive: true })
  }

  const result = await shell.openPath(assetsDir)
  return { success: !result, error: result || undefined }
})

// SD download path helpers for chunked downloads
ipcMain.handle('sd-get-binary-download-path', () => {
  try {
    const platform = process.platform
    const arch = process.arch
    let binaryName = 'sd'

    if (platform === 'win32') {
      binaryName = 'sd.exe'
    } else if (platform === 'darwin') {
      // Check for Metal support
      const metalSupported = checkMetalSupport()
      binaryName = metalSupported ? 'sd-metal' : 'sd'
    }

    const binaryDir = join(app.getPath('userData'), 'sd-bin')
    const binaryPath = join(binaryDir, binaryName)

    // Ensure directory exists
    if (!existsSync(binaryDir)) {
      mkdirSync(binaryDir, { recursive: true })
    }

    return { success: true, path: binaryPath }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('sd-get-auxiliary-model-download-path', (_, type: 'llm' | 'vae') => {
  try {
    const auxDir = getAuxiliaryModelsDir()

    // Ensure directory exists
    if (!existsSync(auxDir)) {
      mkdirSync(auxDir, { recursive: true })
    }

    const filename = type === 'llm'
      ? 'Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf'
      : 'ae.safetensors'

    const filePath = join(auxDir, filename)

    return { success: true, path: filePath }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('sd-get-models-dir', () => {
  try {
    const modelsDir = getModelsDir()

    // Ensure directory exists
    if (!existsSync(modelsDir)) {
      mkdirSync(modelsDir, { recursive: true })
    }

    return { success: true, path: modelsDir }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

// Auto-updater state
let mainWindow: BrowserWindow | null = null

// Configure auto-updater
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

function sendUpdateStatus(status: string, data?: Record<string, unknown>) {
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { status, ...data })
  }
}

function setupAutoUpdater() {
  const settings = loadSettings()
  const channel = settings.updateChannel || 'stable'

  // Configure update channel
  if (channel === 'nightly') {
    autoUpdater.allowPrerelease = true
    autoUpdater.channel = 'nightly'
    // Use generic provider pointing to nightly release assets
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: 'https://github.com/WaveSpeedAI/wavespeed-desktop/releases/download/nightly'
    })
  } else {
    autoUpdater.allowPrerelease = false
    autoUpdater.channel = 'latest'
  }

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('checking')
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    sendUpdateStatus('available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate
    })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    sendUpdateStatus('not-available', { version: info.version })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    sendUpdateStatus('downloaded', {
      version: info.version,
      releaseNotes: info.releaseNotes
    })
  })

  autoUpdater.on('error', (error) => {
    sendUpdateStatus('error', { message: error.message })
  })
}

// Auto-updater IPC handlers
ipcMain.handle('check-for-updates', async () => {
  if (is.dev) {
    return { status: 'dev-mode', message: 'Auto-update disabled in development' }
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    return { status: 'success', updateInfo: result?.updateInfo }
  } catch (error) {
    return { status: 'error', message: (error as Error).message }
  }
})

ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate()
    return { status: 'success' }
  } catch (error) {
    return { status: 'error', message: (error as Error).message }
  }
})

ipcMain.handle('install-update', () => {
  // Set quitting flag before calling quitAndInstall so macOS window close handler allows quit
  ;(app as typeof app & { isQuitting: boolean }).isQuitting = true
  autoUpdater.quitAndInstall(false, true)
})

ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

ipcMain.handle('set-update-channel', (_, channel: 'stable' | 'nightly') => {
  saveSettings({ updateChannel: channel })
  // Reconfigure updater with new channel
  if (channel === 'nightly') {
    autoUpdater.allowPrerelease = true
    autoUpdater.channel = 'nightly'
    // Use generic provider pointing to nightly release assets
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: 'https://github.com/WaveSpeedAI/wavespeed-desktop/releases/download/nightly'
    })
  } else {
    autoUpdater.allowPrerelease = false
    autoUpdater.channel = 'latest'
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'WaveSpeedAI',
      repo: 'wavespeed-desktop',
      releaseType: 'release'
    })
  }
  return true
})

// ==============================================================================
// Stable Diffusion IPC Handlers
// ==============================================================================

/**
 * Get stable-diffusion binary path
 */
ipcMain.handle('sd-get-binary-path', () => {
  try {
    const platform = process.platform
    const arch = process.arch
    const binaryName = platform === 'win32' ? 'sd.exe' : 'sd'

    // Use different paths for development and production modes
    const basePath = is.dev
      ? join(__dirname, '../../resources/bin/stable-diffusion')
      : join(process.resourcesPath, 'bin/stable-diffusion')

    const binaryPath = join(basePath, `${platform}-${arch}`, binaryName)

    if (!existsSync(binaryPath)) {
      return {
        success: false,
        error: `Binary not found at: ${binaryPath}`
      }
    }

    return {
      success: true,
      path: binaryPath
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
})

/**
 * Check if macOS system supports Metal acceleration
 */
function checkMetalSupport(): boolean {
  try {
    // Check macOS version - Metal requires OS X 10.11 (El Capitan) or later
    const osRelease = require('os').release()
    const majorVersion = parseInt(osRelease.split('.')[0], 10)

    // Darwin kernel version 15.x = OS X 10.11 (El Capitan)
    // Metal was introduced in OS X 10.11
    if (majorVersion < 15) {
      console.log('[Metal Check] macOS version too old for Metal (Darwin kernel < 15)')
      return false
    }

    // Check GPU capabilities using system_profiler
    try {
      const output = execSync('system_profiler SPDisplaysDataType', {
        encoding: 'utf8',
        timeout: 5000
      })

      // Check if output contains "Metal" support indication
      const hasMetalSupport = output.toLowerCase().includes('metal')
      console.log(`[Metal Check] Metal support detected: ${hasMetalSupport}`)
      return hasMetalSupport
    } catch (error) {
      console.error('[Metal Check] Failed to run system_profiler:', error)
      // If system_profiler fails but OS version is new enough, assume Metal is available
      return majorVersion >= 15
    }
  } catch (error) {
    console.error('[Metal Check] Failed to check Metal support:', error)
    return false
  }
}

/**
 * Get system information (platform and acceleration type)
 */
ipcMain.handle('sd-get-system-info', () => {
  const platform = process.platform

  let acceleration = 'CPU'

  if (platform === 'darwin') {
    // macOS: Check for Metal acceleration support
    acceleration = checkMetalSupport() ? 'Metal' : 'CPU'
  } else if (platform === 'win32' || platform === 'linux') {
    // Check for NVIDIA GPU (CUDA support)
    try {
      const { execSync } = require('child_process')

      // Try to detect NVIDIA GPU
      if (platform === 'win32') {
        // Windows: Check for nvidia-smi
        try {
          execSync('nvidia-smi', { stdio: 'ignore', timeout: 3000 })
          acceleration = 'CUDA'
        } catch {
          // nvidia-smi not found or failed, use CPU
        }
      } else if (platform === 'linux') {
        // Linux: Check for NVIDIA GPU in lspci or nvidia-smi
        try {
          const output = execSync('lspci 2>/dev/null | grep -i nvidia', { encoding: 'utf8', timeout: 3000 })
          if (output.toLowerCase().includes('nvidia')) {
            acceleration = 'CUDA'
          }
        } catch {
          // Try nvidia-smi as fallback
          try {
            execSync('nvidia-smi', { stdio: 'ignore', timeout: 3000 })
            acceleration = 'CUDA'
          } catch {
            // No NVIDIA GPU detected, use CPU
          }
        }
      }
    } catch (error) {
      console.error('[System Info] Failed to detect GPU:', error)
      // Fall back to CPU on error
    }
  }

  console.log(`[System Info] Platform: ${platform}, Acceleration: ${acceleration}`)

  return {
    platform,
    acceleration,
    supported: true
  }
})

/**
 * Generate image
 */
ipcMain.handle('sd-generate-image', async (event, params: {
  modelPath: string
  llmPath?: string
  vaePath?: string
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  steps: number
  cfgScale: number
  seed?: number
  outputPath: string
}) => {
  try {
    // Get binary path
    const platform = process.platform
    const arch = process.arch
    const binaryName = platform === 'win32' ? 'sd.exe' : 'sd'

    const basePath = is.dev
      ? join(__dirname, '../../resources/bin/stable-diffusion')
      : join(process.resourcesPath, 'bin/stable-diffusion')

    const binaryPath = join(basePath, `${platform}-${arch}`, binaryName)

    // Use SDGenerator class for image generation
    const result = await sdGenerator.generate({
      binaryPath,
      modelPath: params.modelPath,
      llmPath: params.llmPath,
      vaePath: params.vaePath,
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      width: params.width,
      height: params.height,
      steps: params.steps,
      cfgScale: params.cfgScale,
      seed: params.seed,
      outputPath: params.outputPath,
      onProgress: (progress) => {
        // Send progress to frontend
        event.sender.send('sd-progress', {
          phase: progress.phase,
          progress: progress.progress,
          detail: progress.detail
        })
      },
      onLog: (log) => {
        // Send logs to frontend
        event.sender.send('sd-log', {
          type: log.type,
          message: log.message
        })
      }
    })

    // Also track via legacy activeSDProcess for backward compatibility
    // (This will be set/cleared by SDGenerator internally)

    return result
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
})

/**
 * list models
 */
ipcMain.handle('sd-list-models', () => {
  try {
    const modelsDir = join(userDataPath, 'models', 'stable-diffusion')

    if (!existsSync(modelsDir)) {
      return { success: true, models: [] }
    }

    const files = readdirSync(modelsDir)
    const models = files
      .filter(f => f.endsWith('.gguf') && !f.endsWith('.part'))  // Exclude .part files
      .map(f => {
        const filePath = join(modelsDir, f)
        const stats = statSync(filePath)
        return {
          name: f,
          path: filePath,
          size: stats.size,
          createdAt: stats.birthtime.toISOString()
        }
      })

    return { success: true, models }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
})

/**
 * delete model
 */
ipcMain.handle('sd-delete-model', (_, modelPath: string) => {
  try {
    if (existsSync(modelPath)) {
      unlinkSync(modelPath)
    }
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
})

/**
 * Get file size
 */
ipcMain.handle('get-file-size', (_, filePath: string) => {
  try {
    if (existsSync(filePath)) {
      const stats = statSync(filePath)
      return stats.size
    }
    return 0
  } catch (error) {
    console.error('Failed to get file size:', error)
    return 0
  }
})

/**
 * Delete SD binary
 */
ipcMain.handle('sd-delete-binary', () => {
  try {
    const binaryPath = getSDPath()
    if (existsSync(binaryPath)) {
      unlinkSync(binaryPath)
    }
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
})

/**
 * Get auxiliary models directory
 */
function getAuxiliaryModelsDir(): string {
  const assetsDir = join(app.getPath('documents'), 'WaveSpeed')
  return join(assetsDir, '../models/stable-diffusion/auxiliary')
}


/**
 * Check if auxiliary models exist
 */
ipcMain.handle('sd-check-auxiliary-models', () => {
  try {
    const auxDir = getAuxiliaryModelsDir()
    const llmPath = join(auxDir, 'Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf')
    const vaePath = join(auxDir, 'ae.safetensors')

    return {
      success: true,
      llmExists: existsSync(llmPath),
      vaeExists: existsSync(vaePath),
      llmPath,
      vaePath
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
})

/**
 * List all auxiliary models (LLM and VAE)
 */
ipcMain.handle('sd-list-auxiliary-models', () => {
  try {
    const auxDir = getAuxiliaryModelsDir()
    const models: Array<{ name: string; path: string; size: number; type: 'llm' | 'vae' }> = []

    if (!existsSync(auxDir)) {
      return { success: true, models: [] }
    }

    const llmPath = join(auxDir, 'Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf')
    const vaePath = join(auxDir, 'ae.safetensors')

    if (existsSync(llmPath)) {
      const stats = statSync(llmPath)
      models.push({
        name: 'Qwen3-4B-Instruct LLM',
        path: llmPath,
        size: stats.size,
        type: 'llm'
      })
    }

    if (existsSync(vaePath)) {
      const stats = statSync(vaePath)
      models.push({
        name: 'Z-Image VAE',
        path: vaePath,
        size: stats.size,
        type: 'vae'
      })
    }

    return { success: true, models }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
})

/**
 * Delete an auxiliary model
 */
ipcMain.handle('sd-delete-auxiliary-model', (_, type: 'llm' | 'vae') => {
  try {
    const auxDir = getAuxiliaryModelsDir()
    const fileName = type === 'llm'
      ? 'Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf'
      : 'ae.safetensors'
    const filePath = join(auxDir, fileName)

    if (existsSync(filePath)) {
      unlinkSync(filePath)
      console.log(`[Auxiliary Models] Deleted ${type} model:`, filePath)
      return { success: true }
    } else {
      return { success: false, error: 'Model file not found' }
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
})



/**
 * Cancel SD image generation
 */
ipcMain.handle('sd-cancel-generation', async () => {
  try {
    console.log('[SD Generation] Cancelling generation')

    // Cancel via SDGenerator class
    const cancelled = sdGenerator.cancel()

    // Also cancel legacy activeSDProcess if exists
    if (activeSDProcess) {
      activeSDProcess.kill('SIGTERM')
      activeSDProcess = null
    }

    return { success: true, cancelled }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
})

/**
 * Save model from browser cache to file system
 */
ipcMain.handle('sd-save-model-from-cache', async (_, fileName: string, data: Uint8Array, type: 'llm' | 'vae' | 'model') => {
  try {
    let destPath: string

    if (type === 'model') {
      // Main model goes to models directory
      const modelsDir = join(userDataPath, 'models', 'stable-diffusion')
      if (!existsSync(modelsDir)) {
        mkdirSync(modelsDir, { recursive: true })
      }
      destPath = join(modelsDir, fileName)
    } else {
      // Auxiliary models (LLM, VAE) go to auxiliary directory
      const auxDir = getAuxiliaryModelsDir()
      if (!existsSync(auxDir)) {
        mkdirSync(auxDir, { recursive: true })
      }
      destPath = join(auxDir, fileName)
    }

    // Write file
    writeFileSync(destPath, data)

    return {
      success: true,
      filePath: destPath
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
})

// Register custom protocol for local asset files (must be before app.whenReady)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-asset',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

// App lifecycle
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.wavespeed.desktop')

  // Handle local-asset:// protocol for loading local files (videos, images, etc.)
  protocol.handle('local-asset', (request) => {
    const filePath = decodeURIComponent(request.url.replace('local-asset://', ''))
    return net.fetch(pathToFileURL(filePath).href)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  // Setup auto-updater after window is created
  setupAutoUpdater()

  // Check for updates on startup (after a short delay) if autoCheckUpdate is enabled
  if (!is.dev) {
    const settings = loadSettings()
    if (settings.autoCheckUpdate !== false) {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
          console.error('Failed to check for updates:', err)
        })
      }, 3000)
    }
  }

  app.on('activate', function () {
    // macOS: Show the hidden window when clicking dock icon
    if (mainWindow) {
      mainWindow.show()
    } else {
      createWindow()
    }
  })
})

// macOS: Set quitting flag so window close handler allows actual quit
app.on('before-quit', () => {
  (app as typeof app & { isQuitting: boolean }).isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
