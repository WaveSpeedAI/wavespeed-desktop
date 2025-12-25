import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8989,
    host: '0.0.0.0',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers', '@ffmpeg/ffmpeg', '@ffmpeg/util']
  },
  build: {
    outDir: 'dist-web',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  base: './',
})
