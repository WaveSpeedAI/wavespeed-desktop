import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import './i18n'
// Inject the electronAPI mock in browser environments.
import './lib/electronAPI.web'

// Mark document for Electron-specific CSS (e.g. titlebar overlay spacing)
if (navigator.userAgent.toLowerCase().includes('electron')) {
  document.documentElement.classList.add('is-electron')
  if (/mac/i.test(navigator.platform)) {
    document.documentElement.classList.add('is-mac')
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </HashRouter>
  </React.StrictMode>
)
