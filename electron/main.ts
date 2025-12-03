import { app, BrowserWindow, shell, ipcMain, dialog, Menu, clipboard } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import https from 'https'
import http from 'http'

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
      mainWindow.webContents.toggleDevTools()
    }
    // Also allow F12
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools()
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
          click: () => mainWindow.webContents.copyImageAt(params.x, params.y)
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
