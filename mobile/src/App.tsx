import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { MobileLayout } from '@mobile/components/layout/MobileLayout'
import { WelcomePage } from '@/pages/WelcomePage'
import { FeaturedModelsPage } from '@/pages/FeaturedModelsPage'
import { SmartPlaygroundPage } from '@/pages/SmartPlaygroundPage'
import { MobileModelsPage } from '@mobile/pages/MobileModelsPage'
import { MobilePlaygroundPage } from '@mobile/pages/MobilePlaygroundPage'
import { MobileTemplatesPage } from '@mobile/pages/MobileTemplatesPage'
import { MobileHistoryPage } from '@mobile/pages/MobileHistoryPage'
import { MobileAssetsPage } from '@mobile/pages/MobileAssetsPage'
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
        <Route index element={<WelcomePage />} />
        <Route path="featured-models" element={<FeaturedModelsPage />} />
        <Route path="featured-models/:familyId" element={<SmartPlaygroundPage />} />
        <Route path="models" element={<MobileModelsPage />} />
        <Route path="playground" element={<MobilePlaygroundPage />} />
        <Route path="playground/*" element={<MobilePlaygroundPage />} />
        <Route path="templates" element={<MobileTemplatesPage />} />
        <Route path="history" element={<MobileHistoryPage />} />
        <Route path="assets" element={<MobileAssetsPage />} />
        <Route path="free-tools" element={<MobileFreeToolsPage />} />
        {/* Free tools pages are rendered persistently in MobileLayout */}
        <Route path="free-tools/video" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/image" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/face-enhancer" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/background-remover" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/image-eraser" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/segment-anything" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/video-converter" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/audio-converter" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/image-converter" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/media-trimmer" element={<PersistentPagePlaceholder />} />
        <Route path="free-tools/media-merger" element={<PersistentPagePlaceholder />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}

export default App
