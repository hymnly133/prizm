/**
 * 通知窗口 - React 入口
 * 统一使用 @lobehub/ui
 */
import { ConfigProvider, ThemeProvider } from '@lobehub/ui'
import { motion } from 'motion/react'
import { createRoot } from 'react-dom/client'
import NotificationApp from './NotificationApp'
import './styles/index.css'

declare global {
  interface Window {
    notificationApi?: {
      onNotification: (callback: (payload: { title: string; body?: string }) => void) => void
      notifyPanelEmpty?: () => void
      notifyReady?: () => void
    }
  }
}

const root = createRoot(document.getElementById('notification-app')!)
root.render(
  <ConfigProvider motion={motion}>
    <ThemeProvider enableGlobalStyle={false}>
      <NotificationApp />
    </ThemeProvider>
  </ConfigProvider>
)
