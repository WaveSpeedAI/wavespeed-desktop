import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import de from './locales/de.json'
import ru from './locales/ru.json'
import hi from './locales/hi.json'
import id from './locales/id.json'
import ms from './locales/ms.json'
import ar from './locales/ar.json'
import vi from './locales/vi.json'
import th from './locales/th.json'
import pt from './locales/pt.json'
import tr from './locales/tr.json'
import it from './locales/it.json'

export const languages = [
  { code: 'auto', name: 'Auto (System)', nativeName: 'Auto' },
  // Western languages
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  // Eastern/Asian languages
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu' },
  // Other languages
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
]

const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
  'zh-TW': { translation: zhTW },
  ja: { translation: ja },
  ko: { translation: ko },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  it: { translation: it },
  ru: { translation: ru },
  pt: { translation: pt },
  hi: { translation: hi },
  id: { translation: id },
  ms: { translation: ms },
  th: { translation: th },
  vi: { translation: vi },
  tr: { translation: tr },
  ar: { translation: ar },
}

// Get saved language from localStorage
const savedLanguage = localStorage.getItem('wavespeed_language')

// If 'auto' or not set, let the detector decide based on browser language
const effectiveLanguage = savedLanguage === 'auto' ? undefined : savedLanguage

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: effectiveLanguage || undefined, // Use saved language or let detector decide
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ['navigator'], // Only use navigator when auto mode
      caches: [], // Don't cache when in auto mode
    },
  })

export default i18n
