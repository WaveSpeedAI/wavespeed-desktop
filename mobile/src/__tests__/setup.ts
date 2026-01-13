import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock Capacitor plugins
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn().mockResolvedValue({ value: null }),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: vi.fn().mockResolvedValue({ uri: 'mock-uri' }),
    readFile: vi.fn().mockResolvedValue({ data: '' }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue({ files: [] }),
    mkdir: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ type: 'file', size: 0, mtime: Date.now() }),
    getUri: vi.fn().mockResolvedValue({ uri: 'mock-uri' })
  },
  Directory: {
    Documents: 'DOCUMENTS',
    Cache: 'CACHE',
    Data: 'DATA'
  },
  Encoding: {
    UTF8: 'utf8'
  }
}))

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock('@capacitor/share', () => ({
  Share: {
    share: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock('@capacitor/camera', () => ({
  Camera: {
    getPhoto: vi.fn().mockResolvedValue({ base64String: '', dataUrl: '', path: '' }),
    pickImages: vi.fn().mockResolvedValue({ photos: [] })
  },
  CameraResultType: {
    Uri: 'uri',
    Base64: 'base64',
    DataUrl: 'dataUrl'
  },
  CameraSource: {
    Prompt: 'PROMPT',
    Camera: 'CAMERA',
    Photos: 'PHOTOS'
  }
}))

vi.mock('@capacitor/status-bar', () => ({
  StatusBar: {
    setStyle: vi.fn().mockResolvedValue(undefined),
    setBackgroundColor: vi.fn().mockResolvedValue(undefined)
  },
  Style: {
    Dark: 'DARK',
    Light: 'LIGHT'
  }
}))

vi.mock('@capacitor/splash-screen', () => ({
  SplashScreen: {
    hide: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    addListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
    removeAllListeners: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
    removeAllListeners: vi.fn().mockResolvedValue(undefined),
    exitApp: vi.fn()
  }
}))

// Mock window.matchMedia for theme detection
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
})

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver
})

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver
})

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn()
}
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
})

// Mock URL.createObjectURL
Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: vi.fn(() => 'mock-url')
})

Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: vi.fn()
})

// Suppress console errors during tests
const originalError = console.error
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    // Suppress specific React warnings during tests
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Warning:') || args[0].includes('act('))
    ) {
      return
    }
    originalError.call(console, ...args)
  }
})

afterAll(() => {
  console.error = originalError
})
