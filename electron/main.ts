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
    // macOS always has Metal acceleration
    acceleration = 'Metal'
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
      '--steps', params.steps.toString(),
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
    let stdoutData = ''

    // Listen to stdout and send logs
    childProcess.stdout.on('data', (data) => {
      const log = data.toString()
      stdoutData += log

      // Send log to frontend
      event.sender.send('sd-log', {
        type: 'stdout',
        message: log
      })

      // Parse progress from stdout (some SD versions output here)
      // Only match specific patterns to avoid false positives (like resolution 512/512)
      let stepMatch = log.match(/(?:step|sampling):\s*(\d+)\/(\d+)/)
      if (!stepMatch) {
        // Match progress bar format: |===...===| 12/20 - time
        stepMatch = log.match(/\|[=\s>-]+\|\s*(\d+)\/(\d+)\s*[-\s]/)
      }

      if (stepMatch) {
        const current = parseInt(stepMatch[1], 10)
        const total = parseInt(stepMatch[2], 10)
        // Validate: reasonable step range and current <= total
        if (total >= 4 && total <= 200 && current > 0 && current <= total) {
          const progress = Math.round((current / total) * 100)
          event.sender.send('sd-progress', {
            phase: 'generate',
            progress,
            detail: { current, total, unit: 'steps' }
          })
        }
      }
    })

    // Listen to stderr and parse progress
    childProcess.stderr.on('data', (data) => {
      const log = data.toString()
      stderrData += log

      // Send log to frontend
      event.sender.send('sd-log', {
        type: 'stderr',
        message: log
      })

      // Parse progress from stderr
      // Only match specific patterns to avoid false positives (like resolution 512/512)
      // 1. "step: 12/20" or "sampling: 18/20"
      // 2. "|==================================================| 12/12 - 7.28s/it"
      let stepMatch = log.match(/(?:step|sampling):\s*(\d+)\/(\d+)/)
      if (!stepMatch) {
        // Match progress bar format: |===...===| 12/20 - time
        // Must have dash or space after the numbers to avoid matching resolution
        stepMatch = log.match(/\|[=\s>-]+\|\s*(\d+)\/(\d+)\s*[-\s]/)
      }

      if (stepMatch) {
        const current = parseInt(stepMatch[1], 10)
        const total = parseInt(stepMatch[2], 10)
        // Validate: reasonable step range (4-200) and current > 0 and current <= total
        if (total >= 4 && total <= 200 && current > 0 && current <= total) {
          const progress = Math.round((current / total) * 100)

          // Send progress update
          event.sender.send('sd-progress', {
            phase: 'generate',
            progress,
            detail: { current, total, unit: 'steps' }
          })
        }
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
 * download model with retry logic and resume support
 */
ipcMain.handle('sd-download-model', async (event, url: string, destPath: string) => {
  console.log(`\n======================================`)
  console.log(`[SD Model Download] *** HANDLER CALLED ***`)
  console.log(`[SD Model Download] URL: ${url}`)
  console.log(`[SD Model Download] Dest: ${destPath}`)
  console.log(`======================================\n`)

  // Cancel any existing model download
  if (activeRequests.model) {
    console.log('[SD Model Download] Cancelling previous model download')
    activeRequests.model.cancelled = true
    activeRequests.model.request.destroy()
    if (activeRequests.model.fileStream) {
      activeRequests.model.fileStream.close()
    }
    delete activeRequests.model
  }

  const maxRetries = 3
  let lastError = ''

  // make sure dest dir exists
  const destDir = dirname(destPath)
  if (!existsSync(destDir)) {
    console.log(`[SD Model Download] Creating directory: ${destDir}`)
    mkdirSync(destDir, { recursive: true })
  }

  const partPath = destPath + '.part'

  console.log(`[SD Model Download] Final path: ${destPath}`)
  console.log(`[SD Model Download] Temp path: ${partPath}`)

  // Check if final file already exists
  if (existsSync(destPath)) {
    const stats = statSync(destPath)
    const fileSizeMB = Math.round(stats.size / 1024 / 1024)
    console.log(`[SD Model Download] Found existing file: ${fileSizeMB}MB`)

    // IMPORTANT: Validate file size to detect incomplete downloads
    // All Z-Image models are >= 1.5GB, if file is < 500MB it's likely incomplete
    const MIN_VALID_SIZE = 500 * 1024 * 1024 // 500MB

    if (stats.size < MIN_VALID_SIZE) {
      console.warn(`[SD Model Download] File is too small (${fileSizeMB}MB < 500MB), likely incomplete from previous download`)
      console.warn(`[SD Model Download] Deleting incomplete file and restarting download...`)
      unlinkSync(destPath)
    } else {
      console.log(`[SD Model Download] File size looks valid (${fileSizeMB}MB), skipping download`)
      return {
        success: true,
        filePath: destPath
      }
    }
  }

  // Check for partial download
  let startByte = 0
  if (existsSync(partPath)) {
    const stats = statSync(partPath)
    startByte = stats.size
    console.log(`[SD Model Download] Found partial download: ${Math.round(startByte / 1024 / 1024)}MB`)
    console.log(`[SD Model Download] Will resume from ${Math.round(startByte / 1024 / 1024)}MB`)
  } else {
    console.log(`[SD Model Download] No partial download found, starting fresh`)
  }

  // Attempt download with retries
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await attemptDownloadWithResume(event, url, partPath, destPath, startByte, attempt)
      if (result.success) {
        return result
      }
      lastError = result.error || 'Unknown error'

      // CRITICAL: If user cancelled, don't retry - return immediately
      if (lastError.includes('cancelled by user')) {
        console.log('[SD Model Download] User cancelled download, stopping retry attempts')
        return {
          success: false,
          error: lastError
        }
      }

      // If not the last attempt, wait before retrying
      if (attempt < maxRetries) {
        const waitTime = attempt * 2000 // 2s, 4s, 6s
        console.log(`[SD Model Download] Retry ${attempt + 1}/${maxRetries} in ${waitTime / 1000}s...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))

        // Update startByte for resume
        if (existsSync(partPath)) {
          startByte = statSync(partPath).size
        }
      }
    } catch (error) {
      lastError = (error as Error).message
      console.error(`[SD Model Download] Attempt ${attempt} failed:`, lastError)

      // CRITICAL: If user cancelled, don't retry - return immediately
      if (lastError.includes('cancelled by user')) {
        console.log('[SD Model Download] User cancelled download, stopping retry attempts')
        return {
          success: false,
          error: lastError
        }
      }

      // If not the last attempt, wait before retrying
      if (attempt < maxRetries) {
        const waitTime = attempt * 2000
        await new Promise(resolve => setTimeout(resolve, waitTime))

        // Update startByte for resume
        if (existsSync(partPath)) {
          startByte = statSync(partPath).size
        }
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
 * Attempt download with resume support using HTTP Range requests
 */
function attemptDownloadWithResume(
  event: Electron.IpcMainInvokeEvent,
  url: string,
  partPath: string,
  destPath: string,
  startByte: number,
  attempt: number
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  return new Promise((resolve) => {
    // Use follow-redirects for automatic redirect handling
    const { https } = require('follow-redirects')
    const { createWriteStream, renameSync, existsSync, unlinkSync } = require('fs')

    console.log(`[SD Model Download] Attempt ${attempt}: Starting download from:`, url)

    // Parse URL
    const urlObj = new URL(url)

    // Check for proxy settings from environment variables
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy ||
                    process.env.HTTP_PROXY || process.env.http_proxy

    const options: any = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: startByte > 0 ? {
        'Range': `bytes=${startByte}-`,
        'User-Agent': 'Mozilla/5.0'
      } : {
        'User-Agent': 'Mozilla/5.0'
      },
      maxRedirects: 5,  // Allow up to 5 redirects
      timeout: 30000    // 30 second connection timeout
    }

    // Use proxy if configured
    if (proxyUrl) {
      const { HttpsProxyAgent } = require('https-proxy-agent')
      options.agent = new HttpsProxyAgent(proxyUrl)
      console.log(`[SD Model Download] Using proxy: ${proxyUrl}`)
    }

    console.log(`[SD Model Download] Connecting to ${urlObj.hostname}...`)
    if (startByte > 0) {
      console.log(`[SD Model Download] Requesting resume from byte ${startByte} (${Math.round(startByte / 1024 / 1024)}MB)`)
    }

    let inactivityTimer: NodeJS.Timeout | null = null
    let fileStream: any = null

    // Reset inactivity timer - only triggers if no data received for 2 minutes
    const resetInactivityTimer = () => {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer)
      }
      inactivityTimer = setTimeout(() => {
        console.error('[SD Model Download] Download stalled (no data received for 2 minutes)')
        if (fileStream) fileStream.close()
        resolve({
          success: false,
          error: 'Download stalled (no data received for 2 minutes)'
        })
      }, 120000) // 2 minutes of inactivity
    }

    const request = https.get(options, (response: any) => {
      console.log(`[SD Model Download] Connected! Response status: ${response.statusCode}`)
      if (response.responseUrl) {
        console.log(`[SD Model Download] Final URL after redirects: ${response.responseUrl}`)
      }

      // Check for valid response (200 for new download, 206 for resumed download)
      if (response.statusCode !== 200 && response.statusCode !== 206) {
        if (inactivityTimer) clearTimeout(inactivityTimer)
        delete activeRequests.model
        resolve({
          success: false,
          error: `Server responded with status ${response.statusCode}`
        })
        return
      }

      // CRITICAL: Check if server supports resume
      if (startByte > 0 && response.statusCode === 200) {
        console.warn('[SD Model Download] WARNING: Server does NOT support Range requests!')
        console.warn('[SD Model Download] Server returned 200 instead of 206, will restart download from 0')
        console.warn('[SD Model Download] Deleting .part file and restarting...')
        // Server doesn't support resume, need to delete partial file and restart
        if (existsSync(partPath)) {
          unlinkSync(partPath)
        }
        startByte = 0  // Reset to 0
      }

      // Get total size from headers
      let totalBytes = 0
      if (response.statusCode === 206 && response.headers['content-range']) {
        // Parse content-range: "bytes 0-1023/1024"
        const match = response.headers['content-range'].match(/bytes \d+-\d+\/(\d+)/)
        if (match) {
          totalBytes = parseInt(match[1], 10)
        }
        console.log(`[SD Model Download] ✓ Server supports resume! Content-Range: ${response.headers['content-range']}`)
      } else if (response.headers['content-length']) {
        const contentLength = parseInt(response.headers['content-length'], 10)
        totalBytes = startByte > 0 ? startByte + contentLength : contentLength
      }

      console.log(`[SD Model Download] Total size: ${Math.round(totalBytes / 1024 / 1024)}MB`)
      console.log(`[SD Model Download] Starting from: ${Math.round(startByte / 1024 / 1024)}MB (${startByte > 0 ? 'RESUME' : 'NEW'})`)

      // Open .part file for appending (if resuming) or writing (if new)
      const writeMode = startByte > 0 ? 'a' : 'w'
      console.log(`[SD Model Download] Writing to: ${partPath}`)
      console.log(`[SD Model Download] File write mode: ${writeMode} (${writeMode === 'a' ? 'append' : 'overwrite'})`)
      fileStream = createWriteStream(partPath, { flags: writeMode })

      let receivedBytes = startByte
      let lastProgressUpdate = Date.now()
      let lastFlushTime = Date.now()

      // Save request and fileStream for cancellation
      activeRequests.model = {
        request,
        cancelled: false,
        fileStream
      }

      // Start inactivity monitoring
      resetInactivityTimer()

      console.log('[SD Model Download] Starting to receive data...')

      // Track progress
      response.on('data', (chunk: Buffer) => {
        // Check if download was cancelled
        if (activeRequests.model?.cancelled) {
          console.log('[SD Model Download] Download cancelled by user')
          fileStream.close()
          if (inactivityTimer) clearTimeout(inactivityTimer)
          delete activeRequests.model
          resolve({
            success: false,
            error: 'Download cancelled by user'
          })
          return
        }

        receivedBytes += chunk.length

        // Reset inactivity timer on each data chunk
        resetInactivityTimer()

        // Throttle progress updates to every 500ms
        const now = Date.now()
        if (now - lastProgressUpdate > 500 || receivedBytes === totalBytes) {
          const progress = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0

          console.log(`[SD Model Download] Progress: ${receivedBytes} / ${totalBytes} bytes (${progress}%)`)

          event.sender.send('sd-download-progress', {
            phase: 'download',
            progress,
            detail: { current: receivedBytes, total: totalBytes, unit: 'bytes' }
          })
          lastProgressUpdate = now
        }

        // Flush to disk every 5 seconds to ensure data is saved even if process is killed
        const timeSinceLastFlush = now - lastFlushTime
        if (timeSinceLastFlush >= 5000) {
          fileStream.write('', () => {
            // Force flush to disk
            if (fileStream.fd) {
              require('fs').fsync(fileStream.fd, (err: any) => {
                if (err) console.error('[SD Model Download] Flush error:', err)
              })
            }
          })
          lastFlushTime = now
        }
      })

      response.on('error', (err: Error) => {
        if (fileStream) fileStream.close()
        if (inactivityTimer) clearTimeout(inactivityTimer)
        console.error('[SD Model Download] Response error:', err.message)
        delete activeRequests.model
        resolve({
          success: false,
          error: `Response error: ${err.message}`
        })
      })

      response.pipe(fileStream)

      fileStream.on('finish', () => {
        fileStream.close()
        if (inactivityTimer) clearTimeout(inactivityTimer)

        // CRITICAL: Check if download was cancelled
        if (activeRequests.model?.cancelled) {
          console.log('[SD Model Download] Download was cancelled, NOT renaming .part file')
          console.log(`[SD Model Download] Partial file saved at: ${partPath} (${Math.round(receivedBytes / 1024 / 1024)}MB)`)
          delete activeRequests.model
          resolve({
            success: false,
            error: 'Download cancelled by user'
          })
          return
        }

        console.log(`[SD Model Download] Download completed, received ${Math.round(receivedBytes / 1024 / 1024)}MB`)

        // Rename .part file to final filename
        try {
          console.log(`[SD Model Download] Renaming ${partPath} -> ${destPath}`)
          renameSync(partPath, destPath)
          console.log(`[SD Model Download] File successfully saved to ${destPath}`)

          // Send 100% progress
          event.sender.send('sd-download-progress', {
            phase: 'download',
            progress: 100,
            detail: { current: totalBytes, total: totalBytes, unit: 'bytes' }
          })

          // Clear active request
          delete activeRequests.model

          resolve({
            success: true,
            filePath: destPath
          })
        } catch (error) {
          console.error('[SD Model Download] Failed to rename file:', error)
          delete activeRequests.model
          resolve({
            success: false,
            error: `Failed to rename file: ${(error as Error).message}`
          })
        }
      })

      fileStream.on('error', (err: Error) => {
        fileStream.close()
        if (inactivityTimer) clearTimeout(inactivityTimer)
        console.error('[SD Model Download] File write error:', err.message)
        delete activeRequests.model
        resolve({
          success: false,
          error: `File write error: ${err.message}`
        })
      })
    })

    request.on('error', (err: Error) => {
      if (fileStream) fileStream.close()
      if (inactivityTimer) clearTimeout(inactivityTimer)
      console.error('[SD Model Download] Request error:', err.message)
      delete activeRequests.model
      resolve({
        success: false,
        error: `Request error: ${err.message}`
      })
    })

    request.on('timeout', () => {
      request.destroy()
      if (fileStream) fileStream.close()
      if (inactivityTimer) clearTimeout(inactivityTimer)
      console.error('[SD Model Download] Connection timeout')
      delete activeRequests.model
      resolve({
        success: false,
        error: 'Connection timeout'
      })
    })
  })
}

/**
 * Attempt single download (OLD VERSION - keeping for reference)
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
 * Get auxiliary models directory
 */
function getAuxiliaryModelsDir(): string {
  const assetsDir = join(app.getPath('documents'), 'WaveSpeed')
  return join(assetsDir, '../models/stable-diffusion/auxiliary')
}

// Global download state tracking
const activeDownloads: {
  llm?: { progress: number; receivedBytes: number; totalBytes: number }
  vae?: { progress: number; receivedBytes: number; totalBytes: number }
} = {}

// Track active HTTP requests for cancellation
const activeRequests: {
  llm?: { request: any; cancelled: boolean; fileStream?: any }
  vae?: { request: any; cancelled: boolean; fileStream?: any }
  model?: { request: any; cancelled: boolean; fileStream?: any }
} = {}

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
 * Get current download status for auxiliary models
 */
ipcMain.handle('sd-get-download-status', () => {
  return {
    llm: activeDownloads.llm || null,
    vae: activeDownloads.vae || null
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
 * Download auxiliary model (LLM or VAE) with resume support using HTTP Range requests
 */
ipcMain.handle('sd-download-auxiliary-model', async (event, type: 'llm' | 'vae', url: string) => {
  try {
    // Cancel any existing download for this type
    if (activeRequests[type]) {
      console.log(`[Auxiliary Download] Cancelling previous ${type} download`)
      activeRequests[type].cancelled = true
      activeRequests[type].request.destroy()
      if (activeRequests[type].fileStream) {
        activeRequests[type].fileStream.close()
      }
      delete activeRequests[type]
      delete activeDownloads[type]
    }

    const auxDir = getAuxiliaryModelsDir()
    if (!existsSync(auxDir)) {
      mkdirSync(auxDir, { recursive: true })
    }

    const fileName = type === 'llm'
      ? 'Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf'
      : 'ae.safetensors'
    const destPath = join(auxDir, fileName)
    const partPath = destPath + '.part'  // Temporary file for downloading
    const expectedSize = type === 'llm' ? 2400000000 : 335000000 // LLM: 2.4GB, VAE: 335MB

    console.log(`[Auxiliary Download] ${type} Final path: ${destPath}`)
    console.log(`[Auxiliary Download] ${type} Temp path: ${partPath}`)
    console.log(`[Auxiliary Download] ${type} Expected size: ${Math.round(expectedSize / 1024 / 1024)}MB`)

    // Check if final file already exists and is complete
    if (existsSync(destPath)) {
      const stats = statSync(destPath)
      console.log(`[Auxiliary Download] ${type} Found complete file: ${Math.round(stats.size / 1024 / 1024)}MB`)

      // Validate file size (allow 5% tolerance)
      const sizeOk = stats.size >= expectedSize * 0.95

      if (sizeOk) {
        console.log(`[Auxiliary Download] ${type} File is complete, skipping download`)

        // Broadcast 100% progress to ALL windows to notify UI
        const completionData = {
          phase: `download-${type}`,
          progress: 100,
          detail: {
            current: stats.size,
            total: stats.size,
            unit: 'bytes'
          }
        }

        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send(`sd-${type}-download-progress`, completionData)
        })

        // Clear global state
        delete activeDownloads[type]

        return {
          success: true,
          filePath: destPath
        }
      } else {
        console.log(`[Auxiliary Download] ${type} Complete file is corrupted (wrong size), deleting...`)
        unlinkSync(destPath)
      }
    }

    // Check for partial download (.part file)
    let startByte = 0
    if (existsSync(partPath)) {
      const stats = statSync(partPath)
      startByte = stats.size
      console.log(`[Auxiliary Download] ${type} Found partial download: ${Math.round(startByte / 1024 / 1024)}MB`)
      console.log(`[Auxiliary Download] ${type} Will resume from ${Math.round(startByte / 1024 / 1024)}MB`)
    } else {
      console.log(`[Auxiliary Download] ${type} No partial download found, starting fresh`)
    }

    // Use HTTP Range requests for proper resume support
    console.log(`[Auxiliary Download] Starting download ${type} from:`, url)

    return new Promise((resolve, reject) => {
      // Use follow-redirects for automatic redirect handling
      const { https } = require('follow-redirects')
      const { createWriteStream, renameSync } = require('fs')

      // Parse URL
      const urlObj = new URL(url)

      // Check for proxy settings from environment variables
      const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy ||
                      process.env.HTTP_PROXY || process.env.http_proxy

      const options: any = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers: startByte > 0 ? {
          'Range': `bytes=${startByte}-`,
          'User-Agent': 'Mozilla/5.0'
        } : {
          'User-Agent': 'Mozilla/5.0'
        },
        maxRedirects: 5  // Allow up to 5 redirects
      }

      // Use proxy if configured
      if (proxyUrl) {
        const { HttpsProxyAgent } = require('https-proxy-agent')
        options.agent = new HttpsProxyAgent(proxyUrl)
        console.log(`[Auxiliary Download] ${type} Using proxy: ${proxyUrl}`)
      }

      console.log(`[Auxiliary Download] ${type} Connecting to ${urlObj.hostname}...`)
      console.log(`[Auxiliary Download] ${type} Request headers:`, options.headers)

      const request = https.get(options, (response: any) => {

        console.log(`[Auxiliary Download] ${type} Connected! Response status: ${response.statusCode}`)
        console.log(`[Auxiliary Download] ${type} Final URL after redirects: ${response.responseUrl}`)

        // Check for valid response (200 for new download, 206 for resumed download)
        if (response.statusCode !== 200 && response.statusCode !== 206) {
          delete activeDownloads[type]
          delete activeRequests[type]
          resolve({
            success: false,
            error: `Server responded with status ${response.statusCode}`
          })
          return
        }

        // CRITICAL: Check if server supports resume
        if (startByte > 0 && response.statusCode === 200) {
          console.warn(`[Auxiliary Download] ${type} WARNING: Server does NOT support Range requests!`)
          console.warn(`[Auxiliary Download] ${type} Server returned 200 instead of 206, will restart download from 0`)
          console.warn(`[Auxiliary Download] ${type} Deleting .part file and restarting...`)
          // Server doesn't support resume, need to delete partial file and restart
          if (existsSync(partPath)) {
            unlinkSync(partPath)
          }
          startByte = 0  // Reset to 0
        }

        // Get total size from headers
        let totalBytes = expectedSize
        if (response.statusCode === 206 && response.headers['content-range']) {
          // Parse content-range: "bytes 0-1023/1024"
          const match = response.headers['content-range'].match(/bytes \d+-\d+\/(\d+)/)
          if (match) {
            totalBytes = parseInt(match[1], 10)
          }
          console.log(`[Auxiliary Download] ${type} ✓ Server supports resume! Content-Range: ${response.headers['content-range']}`)
        } else if (response.headers['content-length']) {
          const contentLength = parseInt(response.headers['content-length'], 10)
          totalBytes = startByte > 0 ? startByte + contentLength : contentLength
        }

        console.log(`[Auxiliary Download] ${type} Total size: ${Math.round(totalBytes / 1024 / 1024)}MB`)
        console.log(`[Auxiliary Download] ${type} Starting from: ${Math.round(startByte / 1024 / 1024)}MB (${startByte > 0 ? 'RESUME' : 'NEW'})`)

        // Open .part file for appending (if resuming) or writing (if new)
        const writeMode = startByte > 0 ? 'a' : 'w'
        console.log(`[Auxiliary Download] ${type} Writing to: ${partPath}`)
        console.log(`[Auxiliary Download] ${type} File write mode: ${writeMode} (${writeMode === 'a' ? 'append' : 'overwrite'})`)
        const fileStream = createWriteStream(partPath, { flags: writeMode })

        let receivedBytes = startByte
        let lastBroadcastTime = Date.now()
        let lastBroadcastBytes = startByte
        let lastFlushTime = Date.now()

        // Save request and fileStream for cancellation (before setting up event handlers)
        activeRequests[type] = {
          request,
          cancelled: false,
          fileStream
        }

        console.log(`[Auxiliary Download] ${type} Starting to receive data...`)

        // Track progress
        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length
          const progress = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0

          // Update global state on every chunk
          activeDownloads[type] = { progress, receivedBytes, totalBytes }

          // Broadcast progress to ALL windows (throttle to every 500ms or every 1MB)
          const now = Date.now()
          const bytesSinceLastBroadcast = receivedBytes - lastBroadcastBytes
          const timeSinceLastBroadcast = now - lastBroadcastTime

          if (bytesSinceLastBroadcast >= 1048576 || timeSinceLastBroadcast >= 500) {
            console.log(`[Auxiliary Download] ${type} Progress: ${receivedBytes} / ${totalBytes} bytes (${progress}%)`)

            const progressData = {
              phase: `download-${type}`,
              progress,
              detail: { current: receivedBytes, total: totalBytes, unit: 'bytes' }
            }

            BrowserWindow.getAllWindows().forEach((win) => {
              win.webContents.send(`sd-${type}-download-progress`, progressData)
            })

            lastBroadcastTime = now
            lastBroadcastBytes = receivedBytes
          }

          // Flush to disk every 5 seconds to ensure data is saved even if process is killed
          const timeSinceLastFlush = now - lastFlushTime
          if (timeSinceLastFlush >= 5000) {
            fileStream.write('', () => {
              // Force flush to disk
              if (fileStream.fd) {
                require('fs').fsync(fileStream.fd, (err: any) => {
                  if (err) console.error(`[Auxiliary Download] ${type} Flush error:`, err)
                })
              }
            })
            lastFlushTime = now
          }
        })

        // Pipe response to file
        response.pipe(fileStream)

        fileStream.on('finish', () => {
          fileStream.close()
          console.log(`[Auxiliary Download] ${type} Download completed, received ${Math.round(receivedBytes / 1024 / 1024)}MB`)

          // Rename .part file to final filename
          try {
            console.log(`[Auxiliary Download] ${type} Renaming ${partPath} -> ${destPath}`)
            renameSync(partPath, destPath)
            console.log(`[Auxiliary Download] ${type} File successfully saved to ${destPath}`)
          } catch (error) {
            console.error(`[Auxiliary Download] ${type} Failed to rename file:`, error)
            delete activeDownloads[type]
            delete activeRequests[type]
            resolve({
              success: false,
              error: `Failed to rename file: ${(error as Error).message}`
            })
            return
          }

          // Broadcast 100% progress to ALL windows
          const completionData = {
            phase: `download-${type}`,
            progress: 100,
            detail: {
              current: totalBytes,
              total: totalBytes,
              unit: 'bytes'
            }
          }

          BrowserWindow.getAllWindows().forEach((win) => {
            win.webContents.send(`sd-${type}-download-progress`, completionData)
          })

          // Clear global state
          delete activeDownloads[type]
          delete activeRequests[type]

          resolve({
            success: true,
            filePath: destPath
          })
        })

        fileStream.on('error', (error: Error) => {
          console.error(`[Auxiliary Download] ${type} file write error:`, error)
          fileStream.close()

          // Don't delete partial file - allow resume
          // Clear global state
          delete activeDownloads[type]
          delete activeRequests[type]

          resolve({
            success: false,
            error: `File write error: ${error.message}`
          })
        })
      })

      request.on('error', (error: Error) => {
        console.error(`[Auxiliary Download] ${type} download error:`, error)

        // Don't delete partial file - allow resume
        // Clear global state
        delete activeDownloads[type]
        delete activeRequests[type]

        resolve({
          success: false,
          error: `Download error: ${error.message} - you can retry to resume from ${Math.round(startByte / 1024 / 1024)}MB`
        })
      })

      request.end()
    })
  } catch (error) {
    // Clear global state
    delete activeDownloads[type]
    delete activeRequests[type]

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
  const RELEASE_TAG = 'master-417-43a70e8'
  const SHORT_VERSION = '43a70e8'
  const macOSVersion = '15.7.2' // Fixed version as only 15.7.2 is available

  try {
    const platform = process.platform
    const arch = process.arch

    // Determine download URL based on platform
    let downloadUrl = ''

    if (platform === 'darwin') {
      // macOS: Use custom Metal-enabled build
      downloadUrl = 'https://d1q70pf5vjeyhc.wavespeed.ai/media/archives/1765804301239005334_mKJRPNLJ.zip'
    } else {
      // Windows/Linux: Use official GitHub releases
      let platformStr = ''
      if (platform === 'win32' && arch === 'x64') {
        platformStr = 'Windows-x64'
      } else if (platform === 'linux' && arch === 'x64') {
        platformStr = 'Ubuntu-x64'
      } else {
        return {
          success: false,
          error: `Unsupported platform: ${platform}-${arch}`
        }
      }
      downloadUrl = `https://github.com/leejet/stable-diffusion.cpp/releases/download/${RELEASE_TAG}/sd-master-${SHORT_VERSION}-bin-${platformStr}.zip`
    }

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
 * Cancel SD binary download and auxiliary models download
 */
ipcMain.handle('sd-cancel-download', async () => {
  try {
    let cancelled = false

    // Cancel SD binary download
    if (activeSDDownloadItem && !activeSDDownloadItem.isPaused()) {
      console.log('[SD Download] Cancelling binary download')
      activeSDDownloadItem.cancel()
      activeSDDownloadItem = null
      cancelled = true
    }

    // Cancel LLM download
    if (activeRequests.llm) {
      console.log('[SD Download] Cancelling LLM download')
      activeRequests.llm.cancelled = true
      activeRequests.llm.request.destroy()
      if (activeRequests.llm.fileStream) {
        activeRequests.llm.fileStream.close()
      }
      delete activeRequests.llm
      delete activeDownloads.llm
      cancelled = true
    }

    // Cancel VAE download
    if (activeRequests.vae) {
      console.log('[SD Download] Cancelling VAE download')
      activeRequests.vae.cancelled = true
      activeRequests.vae.request.destroy()
      if (activeRequests.vae.fileStream) {
        activeRequests.vae.fileStream.close()
      }
      delete activeRequests.vae
      delete activeDownloads.vae
      cancelled = true
    }

    // Cancel model download
    if (activeRequests.model) {
      console.log('[SD Download] Cancelling model download')
      activeRequests.model.cancelled = true
      activeRequests.model.request.destroy()
      if (activeRequests.model.fileStream) {
        activeRequests.model.fileStream.close()
      }
      // IMPORTANT: Don't delete immediately - let the finish/error handlers clean up
      // Otherwise the cancelled flag won't be accessible in the finish event
      cancelled = true
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
