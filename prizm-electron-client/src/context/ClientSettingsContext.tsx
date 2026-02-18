/**
 * 客户端 UI 设置：持久化到 localStorage，供输入框等使用
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { PrimaryColors, NeutralColors } from '@lobehub/ui'

const STORAGE_KEY_SEND = 'prizm.client.sendWithEnter'
const STORAGE_KEY_THEME = 'prizm.client.themeMode'
const STORAGE_KEY_PRIMARY_COLOR = 'prizm.client.primaryColor'
const STORAGE_KEY_NEUTRAL_COLOR = 'prizm.client.neutralColor'
/** Valid primary color names (matches @lobehub/ui PrimaryColors) */
const VALID_PRIMARY: PrimaryColors[] = [
  'blue',
  'cyan',
  'geekblue',
  'gold',
  'green',
  'lime',
  'magenta',
  'orange',
  'purple',
  'red',
  'volcano',
  'yellow'
]
/** Valid neutral color names (matches @lobehub/ui NeutralColors) */
const VALID_NEUTRAL: NeutralColors[] = ['mauve', 'olive', 'sage', 'sand', 'slate']

export type ThemeMode = 'auto' | 'light' | 'dark'

export interface ClientSettings {
  /** true: 回车发送 / false: Ctrl+Enter 发送 */
  sendWithEnter: boolean
  /** 主题模式 */
  themeMode: ThemeMode
  /** 主题强调色 */
  primaryColor: PrimaryColors | undefined
  /** 中性色调 */
  neutralColor: NeutralColors | undefined
}

const defaultSettings: ClientSettings = {
  sendWithEnter: true,
  themeMode: 'auto',
  primaryColor: undefined,
  neutralColor: undefined
}

function loadSendWithEnter(): boolean {
  if (typeof localStorage === 'undefined') return defaultSettings.sendWithEnter
  const raw = localStorage.getItem(STORAGE_KEY_SEND)
  if (raw === 'true') return true
  if (raw === 'false') return false
  return defaultSettings.sendWithEnter
}

function saveSendWithEnter(v: boolean) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY_SEND, String(v))
}

function loadThemeMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return defaultSettings.themeMode
  const raw = localStorage.getItem(STORAGE_KEY_THEME)
  if (raw === 'light' || raw === 'dark' || raw === 'auto') return raw
  return defaultSettings.themeMode
}

function saveThemeMode(v: ThemeMode) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY_THEME, v)
}

function loadPrimaryColor(): PrimaryColors | undefined {
  if (typeof localStorage === 'undefined') return undefined
  const raw = localStorage.getItem(STORAGE_KEY_PRIMARY_COLOR)
  if (raw && VALID_PRIMARY.includes(raw as PrimaryColors)) return raw as PrimaryColors
  return undefined
}

function savePrimaryColor(v: PrimaryColors | undefined) {
  if (typeof localStorage === 'undefined') return
  if (v) localStorage.setItem(STORAGE_KEY_PRIMARY_COLOR, v)
  else localStorage.removeItem(STORAGE_KEY_PRIMARY_COLOR)
}

function loadNeutralColor(): NeutralColors | undefined {
  if (typeof localStorage === 'undefined') return undefined
  const raw = localStorage.getItem(STORAGE_KEY_NEUTRAL_COLOR)
  if (raw && VALID_NEUTRAL.includes(raw as NeutralColors)) return raw as NeutralColors
  return undefined
}

function saveNeutralColor(v: NeutralColors | undefined) {
  if (typeof localStorage === 'undefined') return
  if (v) localStorage.setItem(STORAGE_KEY_NEUTRAL_COLOR, v)
  else localStorage.removeItem(STORAGE_KEY_NEUTRAL_COLOR)
}

export interface AccentSettings {
  primaryColor: PrimaryColors | undefined
  neutralColor: NeutralColors | undefined
}

interface ClientSettingsContextValue extends ClientSettings {
  setSendWithEnter: (v: boolean) => void
  setThemeMode: (v: ThemeMode) => void
  setPrimaryColor: (v: PrimaryColors | undefined) => void
  setNeutralColor: (v: NeutralColors | undefined) => void
}

const ClientSettingsContext = createContext<ClientSettingsContextValue | null>(null)

export function ClientSettingsProvider({ children }: { children: ReactNode }) {
  const [sendWithEnter, setSendWithEnterState] = useState(loadSendWithEnter)
  const [themeMode, setThemeModeState] = useState<ThemeMode>(loadThemeMode)
  const [primaryColor, setPrimaryColorState] = useState<PrimaryColors | undefined>(loadPrimaryColor)
  const [neutralColor, setNeutralColorState] = useState<NeutralColors | undefined>(loadNeutralColor)

  useEffect(() => {
    setSendWithEnterState(loadSendWithEnter())
    setThemeModeState(loadThemeMode())
    setPrimaryColorState(loadPrimaryColor())
    setNeutralColorState(loadNeutralColor())
  }, [])

  const setSendWithEnter = useCallback((v: boolean) => {
    setSendWithEnterState(v)
    saveSendWithEnter(v)
  }, [])

  const setThemeMode = useCallback((v: ThemeMode) => {
    setThemeModeState(v)
    saveThemeMode(v)
    window.dispatchEvent(new CustomEvent('prizm-theme-change', { detail: v }))
    // 同步到 Electron 主进程：更新 nativeTheme.themeSource 并持久化到 config.json
    // 确保下次启动窗口时不会闪烁
    window.prizm?.setNativeTheme?.(v)?.catch?.(() => {})
  }, [])

  const setPrimaryColor = useCallback((v: PrimaryColors | undefined) => {
    setPrimaryColorState(v)
    savePrimaryColor(v)
    window.dispatchEvent(
      new CustomEvent<AccentSettings>('prizm-accent-change', {
        detail: { primaryColor: v, neutralColor: loadNeutralColor() }
      })
    )
  }, [])

  const setNeutralColor = useCallback((v: NeutralColors | undefined) => {
    setNeutralColorState(v)
    saveNeutralColor(v)
    window.dispatchEvent(
      new CustomEvent<AccentSettings>('prizm-accent-change', {
        detail: { primaryColor: loadPrimaryColor(), neutralColor: v }
      })
    )
  }, [])

  const value: ClientSettingsContextValue = {
    sendWithEnter,
    setSendWithEnter,
    themeMode,
    setThemeMode,
    primaryColor,
    setPrimaryColor,
    neutralColor,
    setNeutralColor
  }

  return <ClientSettingsContext.Provider value={value}>{children}</ClientSettingsContext.Provider>
}

export function useClientSettings(): ClientSettingsContextValue {
  const ctx = useContext(ClientSettingsContext)
  if (!ctx) {
    return {
      sendWithEnter: defaultSettings.sendWithEnter,
      setSendWithEnter: () => {},
      themeMode: defaultSettings.themeMode,
      setThemeMode: () => {},
      primaryColor: defaultSettings.primaryColor,
      setPrimaryColor: () => {},
      neutralColor: defaultSettings.neutralColor,
      setNeutralColor: () => {}
    }
  }
  return ctx
}
