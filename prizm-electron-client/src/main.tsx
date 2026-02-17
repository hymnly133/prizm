/**
 * Prizm Electron 客户端 - React 入口
 * 统一使用 @lobehub/ui，仅 App 来自 antd（提供 useApp modal/message API）
 */
import { ConfigProvider, ThemeProvider, ToastHost } from '@lobehub/ui'
import { App } from 'antd'
import { motion } from 'motion/react'
import { createRoot } from 'react-dom/client'
import { createClientLogger, addTransport } from '@prizm/client-core'
import { ErrorBoundary } from './components/ErrorBoundary'
import RootApp from './App'
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

// 在 React 首次渲染前同步检测系统主题，传入 defaultAppearance 防止 CSS-in-JS 层 FOUC
// 参考 antd-style 官方最佳实践：https://ant-design.github.io/antd-style/best-practice/fix-switch-theme-fouc/
const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
const initialAppearance = systemDark ? 'dark' : 'light'

const root = createRoot(document.getElementById('app')!)
root.render(
  <div className="app-root">
    <ConfigProvider motion={motion}>
      <ThemeProvider themeMode="auto" defaultAppearance={initialAppearance}>
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
      </ThemeProvider>
    </ConfigProvider>
  </div>
)
