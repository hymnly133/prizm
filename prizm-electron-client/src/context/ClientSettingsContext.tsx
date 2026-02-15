/**
 * 客户端 UI 设置：持久化到 localStorage，供输入框等使用
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

const STORAGE_KEY = 'prizm.client.sendWithEnter'

export interface ClientSettings {
  /** true: 回车发送 / false: Ctrl+Enter 发送 */
  sendWithEnter: boolean
}

const defaultSettings: ClientSettings = {
  sendWithEnter: true
}

function loadSendWithEnter(): boolean {
  if (typeof localStorage === 'undefined') return defaultSettings.sendWithEnter
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === 'true') return true
  if (raw === 'false') return false
  return defaultSettings.sendWithEnter
}

function saveSendWithEnter(v: boolean) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, String(v))
}

interface ClientSettingsContextValue extends ClientSettings {
  setSendWithEnter: (v: boolean) => void
}

const ClientSettingsContext = createContext<ClientSettingsContextValue | null>(null)

export function ClientSettingsProvider({ children }: { children: ReactNode }) {
  const [sendWithEnter, setSendWithEnterState] = useState(loadSendWithEnter)

  useEffect(() => {
    setSendWithEnterState(loadSendWithEnter())
  }, [])

  const setSendWithEnter = useCallback((v: boolean) => {
    setSendWithEnterState(v)
    saveSendWithEnter(v)
  }, [])

  const value: ClientSettingsContextValue = {
    sendWithEnter,
    setSendWithEnter
  }

  return <ClientSettingsContext.Provider value={value}>{children}</ClientSettingsContext.Provider>
}

export function useClientSettings(): ClientSettingsContextValue {
  const ctx = useContext(ClientSettingsContext)
  if (!ctx) {
    return {
      sendWithEnter: defaultSettings.sendWithEnter,
      setSendWithEnter: () => {}
    }
  }
  return ctx
}
