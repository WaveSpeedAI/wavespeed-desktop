import type { CapacitorConfig } from '@capacitor/cli'

// Only enable debugging in development builds
const isDev = process.env.NODE_ENV === 'development'

const config: CapacitorConfig = {
  appId: 'ai.wavespeed.mobile',
  appName: 'WaveSpeed',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Uncomment for live reload during development:
    // url: 'http://YOUR_LOCAL_IP:5173',
    // cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0f172a',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f172a'
    },
    Camera: {
      presentationStyle: 'fullscreen'
    }
  },
  android: {
    allowMixedContent: true,
    // SECURITY: Only enable debugging in development, disabled in production builds
    webContentsDebuggingEnabled: isDev
  }
}

export default config
