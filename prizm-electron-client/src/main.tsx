/**
 * Prizm Electron 客户端 - React 入口
 * 统一使用 @lobehub/ui，仅 App 来自 antd（提供 useApp modal/message API）
 */
import { ConfigProvider, ThemeProvider, ToastHost } from '@lobehub/ui'
import { App } from 'antd'
import { motion } from 'motion/react'
import { createRoot } from 'react-dom/client'
import RootApp from './App'
import './styles.css'

const root = createRoot(document.getElementById('app')!)
root.render(
  <div className="app-root">
    <ConfigProvider motion={motion}>
      <ThemeProvider themeMode="auto">
        <App>
          <ToastHost position="bottom-right" duration={4000} />
          <RootApp />
        </App>
      </ThemeProvider>
    </ConfigProvider>
  </div>
)
