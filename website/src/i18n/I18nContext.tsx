import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import zh from './locales/zh.json'
import en from './locales/en.json'

export type Locale = 'zh' | 'en'

const messages: Record<Locale, typeof zh> = { zh, en }

type Messages = typeof zh

const I18nContext = createContext<{
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Messages
} | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof navigator !== 'undefined' && navigator.language.startsWith('zh')) return 'zh'
    return 'en'
  })
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
  }, [])
  const t = useMemo(() => messages[locale], [locale])
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
