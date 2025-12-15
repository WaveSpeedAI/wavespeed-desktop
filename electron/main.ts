import { app, BrowserWindow, shell, ipcMain, dialog, Menu, clipboard, protocol, net } from 'electron'
import { join, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, createWriteStream, unlinkSync, statSync, readdirSync, chmodSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater, UpdateInfo } from 'electron-updater'
import { spawn, execSync } from 'child_process'
import https from 'https'
import http from 'http'
import { pathToFileURL } from 'url'
import AdmZip from 'adm-zip'

// Linux-specific flags
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

// Settings storage
const userDataPath = app.getPath('userData')
const settingsPath = join(userDataPath, 'settings.json')

// Global reference to active SD generation process
let activeSDProcess: ReturnType<typeof spawn> | null = null

// Global reference to active SD binary download
let activeSDDownloadItem: Electron.DownloadItem | null = null

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
 * Get system information (platform and acceleration type)
 */
ipcMain.handle('sd-get-system-info', () => {
  const platform = process.platform

  let acceleration = 'CPU'

  if (platform === 'darwin') {
    acceleration = 'Metal'
  } else if (platform === 'win32') {
    acceleration = 'CPU' // TODO: Can detect CUDA in the future
  } else if (platform === 'linux') {
    acceleration = 'CPU' // TODO: Can detect CUDA/ROCm in the future
  }

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

    if (!existsSync(binaryPath)) {
      return {
        success: false,
        error: `Binary not found at: ${binaryPath}`
      }
    }

    // Sanitize prompt (escape dangerous characters)
    const sanitizePrompt = (text: string) => text.replace(/["`$\\]/g, '\\$&').trim()
    const safePrompt = sanitizePrompt(params.prompt)
    const safeNegPrompt = params.negativePrompt ? sanitizePrompt(params.negativePrompt) : ''

    // Ensure output directory exists
    const outputDir = dirname(params.outputPath)
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    // Build command arguments
    const args = [
      '--diffusion-model', params.modelPath,
      '-p', safePrompt,
      '-W', params.width.toString(),
      '-H', params.height.toString(),
      '--cfg-scale', params.cfgScale.toString(),
      '-o', params.outputPath,
      '-v', // Verbose
      '--offload-to-cpu', // Offload to CPU when needed
      '--diffusion-fa' // Use Flash Attention
    ]

    // Add LLM (text encoder) if provided
    if (params.llmPath && existsSync(params.llmPath)) {
      args.push('--llm', params.llmPath)
    }

    // Add VAE if provided
    if (params.vaePath && existsSync(params.vaePath)) {
      args.push('--vae', params.vaePath)
    }

    if (safeNegPrompt) {
      args.push('-n', safeNegPrompt)
    }

    if (params.seed !== undefined) {
      args.push('--seed', params.seed.toString())
    }

    // Spawn child process
    const childProcess = spawn(binaryPath, args, {
      cwd: outputDir,
      env: { ...process.env }
    })

    // Track active process for cancellation
    activeSDProcess = childProcess

    let stderrData = ''

    // Listen to stderr and parse progress
    childProcess.stderr.on('data', (data) => {
      stderrData += data.toString()

      // Parse progress: "step: 12/20" or "sampling: 18/20"
      const stepMatch = stderrData.match(/(?:step|sampling):\s*(\d+)\/(\d+)/)
      if (stepMatch) {
        const current = parseInt(stepMatch[1], 10)
        const total = parseInt(stepMatch[2], 10)
        const progress = Math.round((current / total) * 100)

        // Send progress update
        event.sender.send('sd-progress', {
          phase: 'generate',
          progress,
          detail: { current, total, unit: 'steps' }
        })
      }
    })

    // Wait for process to end
    return new Promise((resolve) => {
      childProcess.on('close', (code) => {
        activeSDProcess = null

        if (code === 0 && existsSync(params.outputPath)) {
          resolve({
            success: true,
            outputPath: params.outputPath
          })
        } else {
          // Extract error information
          const errorLines = stderrData.split('\n').filter(line => line.trim())
          const errorMsg = errorLines.length > 0
            ? errorLines[errorLines.length - 1]
            : `Process exited with code ${code}`

          resolve({
            success: false,
            error: errorMsg
          })
        }
      })

      childProcess.on('error', (err) => {
        activeSDProcess = null
        resolve({
          success: false,
          error: err.message
        })
      })
    })
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
})

/**
 * download model with retry logic
 */
ipcMain.handle('sd-download-model', async (event, url: string, destPath: string) => {
  const maxRetries = 3
  let lastError = ''

  // make sure dest dir exists
  const destDir = dirname(destPath)
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true })
  }

  // Attempt download with retries
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await attemptDownload(event, url, destPath, attempt)
      if (result.success) {
        return result
      }
      lastError = result.error || 'Unknown error'

      // If not the last attempt, wait before retrying
      if (attempt < maxRetries) {
        const waitTime = attempt * 2000 // 2s, 4s, 6s
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    } catch (error) {
      lastError = (error as Error).message

      // If not the last attempt, wait before retrying
      if (attempt < maxRetries) {
        const waitTime = attempt * 2000
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }
  }

  // All retries failed
  return {
    success: false,
    error: `Download failed after ${maxRetries} attempts: ${lastError}`
  }
})

/**
 * Attempt single download
 */
function attemptDownload(
  event: Electron.IpcMainInvokeEvent,
  url: string,
  destPath: string,
  _attempt: number
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  return new Promise((resolve) => {
    const downloadFile = (downloadUrl: string) => {
      const file = createWriteStream(destPath)
      const protocol = downloadUrl.startsWith('https') ? https : http
      let inactivityTimer: NodeJS.Timeout | null = null

      // Reset inactivity timer - only triggers if no data received for 2 minutes
      const resetInactivityTimer = () => {
        if (inactivityTimer) {
          clearTimeout(inactivityTimer)
        }
        inactivityTimer = setTimeout(() => {
          request.destroy()
          file.close()
          if (existsSync(destPath)) {
            unlinkSync(destPath)
          }
          resolve({
            success: false,
            error: 'Download stalled (no data received for 2 minutes)'
          })
        }, 120000) // 2 minutes of inactivity
      }

      const request = protocol.get(downloadUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Connection': 'keep-alive'
        },
        timeout: 30000 // 30 second connection timeout
      }, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            file.close()
            if (inactivityTimer) clearTimeout(inactivityTimer)
            downloadFile(redirectUrl)
            return
          }
        }

        // Check for successful response
        if (response.statusCode !== 200) {
          file.close()
          if (existsSync(destPath)) {
            unlinkSync(destPath)
          }
          if (inactivityTimer) clearTimeout(inactivityTimer)
          resolve({
            success: false,
            error: `HTTP ${response.statusCode}: ${response.statusMessage}`
          })
          return
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10)
        let downloadedBytes = 0
        let lastProgressUpdate = Date.now()

        // Start inactivity monitoring
        resetInactivityTimer()

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length

          // Reset inactivity timer on each data chunk
          resetInactivityTimer()

          // Throttle progress updates to every 500ms
          const now = Date.now()
          if (now - lastProgressUpdate > 500 || downloadedBytes === totalBytes) {
            const progress = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0
            event.sender.send('sd-download-progress', {
              phase: 'download',
              progress,
              detail: { current: downloadedBytes, total: totalBytes, unit: 'bytes' }
            })
            lastProgressUpdate = now
          }
        })

        response.on('error', (err) => {
          file.close()
          if (existsSync(destPath)) {
            unlinkSync(destPath)
          }
          if (inactivityTimer) clearTimeout(inactivityTimer)
          resolve({
            success: false,
            error: `Response error: ${err.message}`
          })
        })

        response.pipe(file)

        file.on('finish', () => {
          file.close()
          if (inactivityTimer) clearTimeout(inactivityTimer)
          resolve({
            success: true,
            filePath: destPath
          })
        })

        file.on('error', (err) => {
          file.close()
          if (existsSync(destPath)) {
            unlinkSync(destPath)
          }
          if (inactivityTimer) clearTimeout(inactivityTimer)
          resolve({
            success: false,
            error: `File write error: ${err.message}`
          })
        })
      })

      request.on('error', (err) => {
        file.close()
        if (existsSync(destPath)) {
          unlinkSync(destPath)
        }
        if (inactivityTimer) clearTimeout(inactivityTimer)
        resolve({
          success: false,
          error: `Request error: ${err.message}`
        })
      })

      request.on('timeout', () => {
        request.destroy()
        file.close()
        if (existsSync(destPath)) {
          unlinkSync(destPath)
        }
        if (inactivityTimer) clearTimeout(inactivityTimer)
        resolve({
          success: false,
          error: 'Connection timeout'
        })
      })
    }

    downloadFile(url)
  })
}

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
      .filter(f => f.endsWith('.gguf'))
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
 * Download auxiliary model (LLM or VAE)
 */
ipcMain.handle('sd-download-auxiliary-model', async (event, type: 'llm' | 'vae', url: string) => {
  const maxRetries = 3
  let lastError = ''

  try {
    const auxDir = getAuxiliaryModelsDir()
    if (!existsSync(auxDir)) {
      mkdirSync(auxDir, { recursive: true })
    }

    const fileName = type === 'llm'
      ? 'Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf'
      : 'ae.safetensors'
    const destPath = join(auxDir, fileName)

    // Check if already exists
    if (existsSync(destPath)) {
      return {
        success: true,
        filePath: destPath
      }
    }

    // Download with retries
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await attemptDownload(event, url, destPath, attempt)
        if (result.success) {
          return result
        }
        lastError = result.error || 'Unknown error'

        if (attempt < maxRetries) {
          const waitTime = attempt * 2000
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
      } catch (error) {
        lastError = (error as Error).message
        if (attempt < maxRetries) {
          const waitTime = attempt * 2000
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
      }
    }

    return {
      success: false,
      error: `Download failed after ${maxRetries} attempts: ${lastError}`
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
})

/**
 * Download and install stable-diffusion binary
 */
ipcMain.handle('sd-download-binary', async (event) => {
  const RELEASE_TAG = 'master-410-11ab095'
  const SHORT_VERSION = '11ab095'
  const macOSVersion = '15.7.2' // Fixed version as only 15.7.2 is available

  try {
    const platform = process.platform
    const arch = process.arch

    // Determine platform-specific filename
    let platformStr = ''
    if (platform === 'darwin' && arch === 'arm64') {
      platformStr = `Darwin-macOS-${macOSVersion}-arm64`
    } else if (platform === 'darwin' && arch === 'x64') {
      platformStr = `Darwin-macOS-${macOSVersion}-x64`
    } else if (platform === 'win32' && arch === 'x64') {
      platformStr = 'Windows-x64'
    } else if (platform === 'linux' && arch === 'x64') {
      platformStr = 'Ubuntu-x64'
    } else {
      return {
        success: false,
        error: `Unsupported platform: ${platform}-${arch}`
      }
    }

    const downloadUrl = `https://github.com/leejet/stable-diffusion.cpp/releases/download/${RELEASE_TAG}/sd-master-${SHORT_VERSION}-bin-${platformStr}.zip`

    // Determine binary directory
    const basePath = is.dev
      ? join(__dirname, '../../resources/bin/stable-diffusion')
      : join(process.resourcesPath, 'bin/stable-diffusion')

    const binaryDir = join(basePath, `${platform}-${arch}`)
    const binaryName = platform === 'win32' ? 'sd.exe' : 'sd'
    const binaryPath = join(binaryDir, binaryName)
    const zipPath = join(binaryDir, 'sd.zip')

    // Check if binary already exists
    if (existsSync(binaryPath)) {
      console.log('[SD Download] Binary already exists, skipping download')
      return {
        success: true,
        path: binaryPath
      }
    }

    // Create directory
    if (!existsSync(binaryDir)) {
      mkdirSync(binaryDir, { recursive: true })
    }

    // Use Electron's session download for more reliable large file downloads
    console.log('[SD Download] Downloading from:', downloadUrl)

    return new Promise((resolve) => {
      // Start download using Electron's session API
      event.sender.downloadURL(downloadUrl)

      let currentDownloadItem: Electron.DownloadItem | null = null

      // Listen for download start
      event.sender.session.once('will-download', (_, item) => {
        currentDownloadItem = item
        activeSDDownloadItem = item

        // Set save path
        item.setSavePath(zipPath)

        // Track progress
        item.on('updated', (_, state) => {
          if (state === 'progressing') {
            if (!item.isPaused()) {
              const receivedBytes = item.getReceivedBytes()
              const totalBytes = item.getTotalBytes()
              const progress = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0

              console.log(`[SD Download] Progress: ${receivedBytes} / ${totalBytes} bytes (${progress}%)`)

              event.sender.send('sd-binary-download-progress', {
                phase: 'download',
                progress,
                detail: { current: receivedBytes, total: totalBytes, unit: 'bytes' }
              })
            }
          }
        })

        // Handle completion
        item.once('done', async (_, state) => {
          activeSDDownloadItem = null
          currentDownloadItem = null

          if (state === 'completed') {
            console.log('[SD Download] Download completed')

            // Send 100% download progress first
            event.sender.send('sd-binary-download-progress', {
              phase: 'download',
              progress: 100,
              detail: {
                current: item.getTotalBytes(),
                total: item.getTotalBytes(),
                unit: 'bytes'
              }
            })

            // Extract zip
            event.sender.send('sd-binary-download-progress', {
              phase: 'extract',
              progress: 95,
              detail: {}
            })

            try {
              const zip = new AdmZip(zipPath)
              zip.extractAllTo(binaryDir, true)
              console.log('[SD Download] Extraction completed')
            } catch (error) {
              // Clean up
              if (existsSync(zipPath)) {
                unlinkSync(zipPath)
              }
              resolve({
                success: false,
                error: `Failed to extract binary: ${(error as Error).message}`
              })
              return
            }

            // Set executable permissions (Unix-like systems)
            const binaryName = platform === 'win32' ? 'sd.exe' : 'sd'
            const binaryPath = join(binaryDir, binaryName)

            if (existsSync(binaryPath) && platform !== 'win32') {
              try {
                chmodSync(binaryPath, 0o755) // rwxr-xr-x
              } catch (error) {
                // Non-fatal, continue
                console.warn('Failed to set executable permissions:', error)
              }

              // Remove macOS quarantine attribute to prevent security warning
              if (platform === 'darwin') {
                try {
                  execSync(`xattr -d com.apple.quarantine "${binaryPath}" 2>/dev/null || true`, { stdio: 'ignore' })
                  // Also remove quarantine from the dylib if it exists
                  const dylibPath = join(binaryDir, 'libstable-diffusion.dylib')
                  if (existsSync(dylibPath)) {
                    execSync(`xattr -d com.apple.quarantine "${dylibPath}" 2>/dev/null || true`, { stdio: 'ignore' })
                  }

                  // Fix dylib rpath for macOS to use @executable_path
                  try {
                    execSync(`cd "${binaryDir}" && install_name_tool -add_rpath @executable_path "${binaryPath}" 2>/dev/null || true`, { stdio: 'ignore' })
                  } catch (error) {
                    // Non-fatal, continue
                    console.warn('Failed to fix dylib rpath:', error)
                  }
                } catch (error) {
                  // Non-fatal, continue
                  console.warn('Failed to remove quarantine attribute:', error)
                }
              }
            }

            // Clean up zip file
            if (existsSync(zipPath)) {
              unlinkSync(zipPath)
            }

            // Verify binary exists
            if (!existsSync(binaryPath)) {
              resolve({
                success: false,
                error: `Binary not found after extraction: ${binaryPath}`
              })
              return
            }

            event.sender.send('sd-binary-download-progress', {
              phase: 'complete',
              progress: 100,
              detail: {}
            })

            console.log('[SD Download] Installation completed')

            resolve({
              success: true,
              path: binaryPath
            })
          } else if (state === 'cancelled') {
            console.log('[SD Download] Download cancelled')
            // Clean up partial download
            if (existsSync(zipPath)) {
              unlinkSync(zipPath)
            }
            resolve({
              success: false,
              error: 'Download cancelled'
            })
          } else {
            console.log('[SD Download] Download failed:', state)
            // Clean up partial download
            if (existsSync(zipPath)) {
              unlinkSync(zipPath)
            }
            resolve({
              success: false,
              error: `Download ${state}`
            })
          }
        })
      })
    })
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
})

/**
 * Cancel SD binary download
 */
ipcMain.handle('sd-cancel-download', async () => {
  try {
    if (activeSDDownloadItem && !activeSDDownloadItem.isPaused()) {
      console.log('[SD Download] Cancelling download')
      activeSDDownloadItem.cancel()
      activeSDDownloadItem = null
      return { success: true }
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
 * Cancel SD image generation
 */
ipcMain.handle('sd-cancel-generation', async () => {
  try {
    if (activeSDProcess) {
      console.log('[SD Generation] Cancelling generation')
      activeSDProcess.kill('SIGTERM')
      activeSDProcess = null
      return { success: true }
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
