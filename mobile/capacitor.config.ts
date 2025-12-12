import type { CapacitorConfig } from '@capacitor/cli'

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
    webContentsDebuggingEnabled: true // Set to false in production
  }
}

export default config
