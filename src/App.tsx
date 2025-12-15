import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { ModelsPage } from '@/pages/ModelsPage'
import { PlaygroundPage } from '@/pages/PlaygroundPage'
import { TemplatesPage } from '@/pages/TemplatesPage'
import { HistoryPage } from '@/pages/HistoryPage'
import { AssetsPage } from '@/pages/AssetsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { FreeToolsPage } from '@/pages/FreeToolsPage'
import { ZImagePage } from '@/pages/ZImagePage'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { useModelsStore } from '@/stores/modelsStore'
import { useThemeStore } from '@/stores/themeStore'

// Placeholder for persistent pages (rendered in Layout, not via router)
const PersistentPagePlaceholder = () => null

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
        <Route path="playground/*" element={<PlaygroundPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="assets" element={<AssetsPage />} />
        <Route path="z-image" element={<ZImagePage />} />
        <Route path="free-tools" element={<FreeToolsPage />} />
        {/* Free tools pages are rendered persistently in Layout */}
        <Route path="free-tools/video" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/image" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/background-remover" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/image-eraser" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/segment-anything" element={<PersistentPagePlaceholder />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}

export default App
