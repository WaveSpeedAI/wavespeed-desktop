import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { ModelsPage } from '@/pages/ModelsPage'
import { PlaygroundPage } from '@/pages/PlaygroundPage'
import { TemplatesPage } from '@/pages/TemplatesPage'
import { HistoryPage } from '@/pages/HistoryPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { useModelsStore } from '@/stores/modelsStore'
import { useThemeStore } from '@/stores/themeStore'

function App() {
  const { loadApiKey, isValidated } = useApiKeyStore()
  const { fetchModels } = useModelsStore()
  const { initTheme } = useThemeStore()

  useEffect(() => {
    initTheme()
    loadApiKey()
  }, [initTheme, loadApiKey])

  useEffect(() => {
    if (isValidated) {
      fetchModels()
    }
  }, [isValidated, fetchModels])

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/models" replace />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="playground" element={<PlaygroundPage />} />
        <Route path="playground/:modelId" element={<PlaygroundPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}

export default App
