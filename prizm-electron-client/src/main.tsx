/**
 * Prizm Electron 客户端 - React 入口
 * 统一使用 @lobehub/ui，仅 App 来自 antd（提供 useApp modal/message API）
 */
import { ConfigProvider, ThemeProvider, ToastHost } from '@lobehub/ui'
import type { PrimaryColors, NeutralColors } from '@lobehub/ui'
import { App } from 'antd'
import { motion } from 'motion/react'
import { createRoot } from 'react-dom/client'
import { useState, useEffect } from 'react'
import { createClientLogger, addTransport } from '@prizm/client-core'
import { ErrorBoundary } from './components/ErrorBoundary'
import RootApp from './App'
import type { ThemeMode, AccentSettings } from './context/ClientSettingsContext'
import './styles/index.css'

// 注册 IPC transport：将渲染进程日志通过 IPC 写入 electron-log 文件
if (typeof window !== 'undefined' && window.prizm?.writeLog) {
  addTransport((level, module, message) => {
    window.prizm?.writeLog(level, module, message).catch(() => {})
  })
}

// 全局错误捕获：未处理的异常和 Promise rejection
const globalErrorLog = createClientLogger('GlobalError')
window.addEventListener('error', (event) => {
  globalErrorLog.error('Uncaught error:', event.error?.stack || event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  globalErrorLog.error('Unhandled rejection:', event.reason)
})

// 平台检测：为自定义标题栏设置 CSS 适配
const platform = navigator.platform
if (platform.startsWith('Win')) {
  document.documentElement.dataset.platform = 'win32'
} else if (platform.startsWith('Mac')) {
  document.documentElement.dataset.platform = 'darwin'
} else {
  document.documentElement.dataset.platform = 'linux'
}

// Windows: 监听系统主题变化，同步 titleBarOverlay 窗口控件颜色
if (document.documentElement.dataset.platform === 'win32' && window.prizm?.setTitleBarOverlay) {
  const updateOverlayTheme = (dark: boolean) => {
    window.prizm.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: dark ? '#CCCCCC' : '#333333'
    })
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  updateOverlayTheme(mq.matches)
  mq.addEventListener('change', (e) => updateOverlayTheme(e.matches))
}

// 在 React 首次渲染前同步检测实际主题
// nativeTheme.themeSource 已在主进程设置，此处 matchMedia 结果已反映用户选择
const effectiveDark = window.matchMedia('(prefers-color-scheme: dark)').matches
const initialAppearance = effectiveDark ? 'dark' : 'light'

/** Read persisted theme mode from localStorage (before React context is available) */
function getPersistedThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem('prizm.client.themeMode')
    if (raw === 'light' || raw === 'dark' || raw === 'auto') return raw
  } catch {}
  return 'auto'
}

/** Read persisted accent colors from localStorage (before React context is available) */
function getPersistedAccent(): AccentSettings {
  try {
    const p = localStorage.getItem('prizm.client.primaryColor') as PrimaryColors | null
    const n = localStorage.getItem('prizm.client.neutralColor') as NeutralColors | null
    return { primaryColor: p || undefined, neutralColor: n || undefined }
  } catch {
    return { primaryColor: undefined, neutralColor: undefined }
  }
}

// 首次渲染前同步设置 prizm-light class，避免浅色主题首帧闪白
if (!effectiveDark) {
  document.documentElement.classList.add('prizm-light')
}

/**
 * Wrapper that listens to theme mode and accent color changes via custom events
 * dispatched by ClientSettingsContext, so ThemeProvider (above context)
 * can respond to theme changes.
 *
 * 柔和浅色主题通过 CSS 变量覆盖实现（见 styles/soft-light.css），
 * 由 html.prizm-light class 控制，与 ThemeProvider 解耦，手动/自动切换均即时生效。
 */
function ThemeWrapper({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getPersistedThemeMode)
  const [accent, setAccent] = useState<AccentSettings>(getPersistedAccent)

  useEffect(() => {
    function onThemeChange(e: Event) {
      const detail = (e as CustomEvent<ThemeMode>).detail
      setThemeMode(detail)
    }
    function onAccentChange(e: Event) {
      const detail = (e as CustomEvent<AccentSettings>).detail
      setAccent(detail)
    }
    window.addEventListener('prizm-theme-change', onThemeChange)
    window.addEventListener('prizm-accent-change', onAccentChange)
    return () => {
      window.removeEventListener('prizm-theme-change', onThemeChange)
      window.removeEventListener('prizm-accent-change', onAccentChange)
    }
  }, [])

  const customTheme =
    accent.primaryColor || accent.neutralColor
      ? { primaryColor: accent.primaryColor, neutralColor: accent.neutralColor }
      : undefined

  // 同步切换 html.prizm-light class，驱动 soft-light.css 中的 CSS 变量覆盖
  const [systemDark, setSystemDark] = useState(effectiveDark)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const isLight = themeMode === 'light' || (themeMode === 'auto' && !systemDark)

  useEffect(() => {
    document.documentElement.classList.toggle('prizm-light', isLight)
  }, [isLight])

  return (
    <ThemeProvider
      themeMode={themeMode}
      defaultAppearance={initialAppearance}
      customTheme={customTheme}
    >
      {children}
    </ThemeProvider>
  )
}

const root = createRoot(document.getElementById('app')!)
root.render(
  <div className="app-root">
    <ConfigProvider motion={motion}>
      <ThemeWrapper>
        <App>
          <ToastHost position="bottom-right" duration={4000} />
          <ErrorBoundary>
            <div className="app-root__content">
              <div className="app-root__content-inner">
                <RootApp />
              </div>
            </div>
          </ErrorBoundary>
        </App>
      </ThemeWrapper>
    </ConfigProvider>
  </div>
)
