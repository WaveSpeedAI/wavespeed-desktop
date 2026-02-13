import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Stub Capacitor modules for desktop dev server (they only run on mobile)
const CAPACITOR_MODULES = ['@capacitor/core', '@capacitor/filesystem', '@capacitor/browser']
function stubCapacitorPlugin(): Plugin {
  return {
    name: 'stub-capacitor',
    resolveId(id) {
      if (CAPACITOR_MODULES.includes(id)) return '\0' + id
    },
    load(id) {
      if (id.startsWith('\0@capacitor/')) return 'export default {}; export const CapacitorHttp = {}; export const Filesystem = {}; export const Directory = {}; export const Browser = {};'
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts')
        },
        external: ['sql.js']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    plugins: [stubCapacitorPlugin(), react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
        // Externalize Capacitor modules - they're only used in mobile builds
        external: CAPACITOR_MODULES
      }
    },
    optimizeDeps: {
      exclude: ['@google/model-viewer']
    },
    server: {
      port: 5173,
      strictPort: false,  // Auto-find available port if 5173 is in use
      host: '0.0.0.0'
    },
    worker: {
      format: 'es'
    }
  }
})
