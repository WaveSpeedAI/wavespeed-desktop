import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { MobileLayout } from '@mobile/components/layout/MobileLayout'
import { ModelsPage } from '@/pages/ModelsPage'
import { MobilePlaygroundPage } from '@mobile/pages/MobilePlaygroundPage'
import { MobileTemplatesPage } from '@mobile/pages/MobileTemplatesPage'
import { MobileHistoryPage } from '@mobile/pages/MobileHistoryPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { MobileFreeToolsPage } from '@mobile/pages/MobileFreeToolsPage'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { useModelsStore } from '@/stores/modelsStore'
import { useThemeStore } from '@/stores/themeStore'

// Placeholder for persistent pages (rendered in MobileLayout, not via router)
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
      <Route path="/" element={<MobileLayout />}>
        <Route index element={<Navigate to="/models" replace />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="playground" element={<MobilePlaygroundPage />} />
        <Route path="playground/:modelId" element={<MobilePlaygroundPage />} />
        <Route path="templates" element={<MobileTemplatesPage />} />
        <Route path="history" element={<MobileHistoryPage />} />
        <Route path="free-tools" element={<MobileFreeToolsPage />} />
        {/* Free tools pages are rendered persistently in MobileLayout */}
        <Route path="free-tools/video" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/image" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/background-remover" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/image-eraser" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/segment-anything" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/video-converter" element={<PersistentPagePlaceholder />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}

export default App
