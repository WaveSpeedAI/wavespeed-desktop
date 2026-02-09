import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'

// All shared packages that need to be resolved from mobile/node_modules
const sharedPackages = [
  // React ecosystem
  'react',
  'react-dom',
  'react-router-dom',
  'react-dropzone',
  // i18n
  'react-i18next',
  'i18next',
  'i18next-browser-languagedetector',
  // State management
  'zustand',
  // HTTP
  'axios',
  // UI
  'lucide-react',
  'class-variance-authority',
  'clsx',
  'tailwind-merge',
  '@tanstack/react-virtual',
  // Radix UI
  '@radix-ui/react-alert-dialog',
  '@radix-ui/react-checkbox',
  '@radix-ui/react-dialog',
  '@radix-ui/react-dropdown-menu',
  '@radix-ui/react-hover-card',
  '@radix-ui/react-label',
  '@radix-ui/react-progress',
  '@radix-ui/react-scroll-area',
  '@radix-ui/react-select',
  '@radix-ui/react-separator',
  '@radix-ui/react-slider',
  '@radix-ui/react-slot',
  '@radix-ui/react-switch',
  '@radix-ui/react-tabs',
  '@radix-ui/react-toast',
  '@radix-ui/react-tooltip',
  // AI/ML
  '@huggingface/transformers',
  '@imgly/background-removal',
  'upscaler',
  '@upscalerjs/default-model',
  '@upscalerjs/esrgan-medium',
  '@upscalerjs/esrgan-slim',
  '@upscalerjs/esrgan-thick',
  // Video encoding
  'webm-muxer',
  'mp4-muxer',
  // ONNX Runtime
  'onnxruntime-web',
  // TensorFlow
  '@tensorflow/tfjs-core',
  '@tensorflow/tfjs-backend-wasm',
  // Capacitor plugins (used by platform service)
  '@capacitor/core',
  '@capacitor/preferences',
  '@capacitor/filesystem',
  '@capacitor/browser',
  '@capacitor/share',
  '@capacitor/app',
  '@capacitor/camera',
  '@capacitor/status-bar',
  '@capacitor/splash-screen',
  '@capacitor/keyboard',
]

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Copy ESRGAN model files to dist/models/
    // Only bundling slim models to keep APK size reasonable (~4MB)
    // Models are loaded from relative path 'models/x{scale}/model.json'
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@upscalerjs/esrgan-slim/models/*',
          dest: 'models'
        }
      ]
    })
  ],
  resolve: {
    alias: {
      // Mobile-specific overrides (must come before @/)
      '@/pages/SettingsPage': path.resolve(__dirname, './src/pages/SettingsPage'),
      // Mobile-specific code (must come before @/ to avoid prefix matching issues)
      '@mobile': path.resolve(__dirname, './src'),
      // Share code from the main src directory
      '@': path.resolve(__dirname, '../src')
    },
    // Dedupe these packages to ensure they're resolved from mobile/node_modules
    dedupe: sharedPackages
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-select', '@radix-ui/react-slider'],
          'ai-vendor': ['upscaler', '@imgly/background-removal', 'onnxruntime-web']
        }
      }
    }
  },
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    include: sharedPackages.filter(p => !['@huggingface/transformers', 'onnxruntime-web'].includes(p)),
    exclude: ['@huggingface/transformers', 'onnxruntime-web']
  },
  // Ensure WASM files are properly served
  assetsInclude: ['**/*.wasm'],
  server: {
    port: 5173,
    host: true, // Allow access from network for mobile device testing
    headers: {
      // Required for SharedArrayBuffer support (ONNX Runtime multi-threading)
      // Using 'credentialless' instead of 'require-corp' to allow loading external images
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless'
    },
    fs: {
      // Allow serving files from parent directory (for shared src)
      allow: ['..']
    }
  }
})
