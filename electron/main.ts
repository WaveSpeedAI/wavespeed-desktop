import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// Linux-specific flags
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

// Settings storage
const userDataPath = app.getPath('userData')
const settingsPath = join(userDataPath, 'settings.json')

interface Settings {
  apiKey: string
  theme: 'light' | 'dark' | 'system'
  defaultPollInterval: number
  defaultTimeout: number
}

const defaultSettings: Settings = {
  apiKey: '',
  theme: 'system',
  defaultPollInterval: 1000,
  defaultTimeout: 36000
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
  const mainWindow = new BrowserWindow({
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
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Error handling for renderer
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', errorCode, errorDescription, validatedURL)
  })

  mainWindow.webContents.on('render-process-gone', (event, details) => {
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
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.meta || input.control) && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools()
    }
    // Also allow F12
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools()
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
    defaultTimeout: settings.defaultTimeout
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

// App lifecycle
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.wavespeed.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
