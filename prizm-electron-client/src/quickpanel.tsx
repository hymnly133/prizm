import { ConfigProvider, ThemeProvider } from '@lobehub/ui'
import { motion } from 'motion/react'
import { createRoot } from 'react-dom/client'
import QuickPanelApp from './QuickPanelApp'
import './styles.css'

const root = createRoot(document.getElementById('quickpanel-app')!)
root.render(
  <ConfigProvider motion={motion}>
    <ThemeProvider enableGlobalStyle={false}>
      <QuickPanelApp />
    </ThemeProvider>
  </ConfigProvider>
)
