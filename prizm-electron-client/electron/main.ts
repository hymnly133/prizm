import { app, BrowserWindow, Menu, globalShortcut, nativeTheme } from 'electron'
import * as path from 'path'
import * as util from 'util'
import log from 'electron-log/main'

import { sharedState } from './config'
import { loadTraySettings, loadThemeMode } from './config'
import { registerIpcHandlers } from './ipcHandlers'
import { createMainWindow, createQuickPanelWindow } from './windowManager'
import { createTray } from './trayManager'
import {
  registerGlobalShortcuts,
  registerQuickPanelDoubleTap,
  stopQuickPanelHook
} from './shortcuts'
import { stopClipboardSync } from './clipboardSync'

// 启用 Electron 自身的远程调试能力，使其可以作为 Internal Browser Node 参与 Agent 执行
app.commandLine.appendSwitch('remote-debugging-port', '9222')

log.initialize()

process.on('uncaughtException', (err) => {
  log.error('[UncaughtException]', err)
})
process.on('unhandledRejection', (reason) => {
  log.error('[UnhandledRejection]', reason)
})

/** 日志路径：开发时在项目根目录，运行时在 exe 所在目录 */
log.transports.file.resolvePathFn = () => {
  const isDev = !app.isPackaged
  if (isDev) {
    return path.join(app.getAppPath(), 'logs', 'main.log')
  }
  return path.join(path.dirname(app.getPath('exe')), 'logs', 'main.log')
}

/** 自定义 transport：将主进程日志推送到渲染进程 UI */
;(log.transports as Record<string, unknown>).renderer = (message: {
  data: unknown[]
  date: Date
  level: string
}) => {
  if (sharedState.mainWindow && !sharedState.mainWindow.isDestroyed()) {
    const text = util.format.apply(util, message.data as [string, ...unknown[]])
    sharedState.mainWindow.webContents.send('log-to-renderer', {
      level: message.level,
      message: text,
      timestamp: message.date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
      source: 'main'
    })
  }
}

app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(null)

    await loadTraySettings()

    // 在创建窗口前设置 nativeTheme.themeSource，确保：
    // 1. BrowserWindow.backgroundColor 使用正确主题色
    // 2. CSS prefers-color-scheme 媒体查询匹配用户选择
    // 3. 消除窗口预加载时的主题闪烁
    const themeMode = await loadThemeMode()
    nativeTheme.themeSource = themeMode === 'auto' ? 'system' : themeMode
    log.info('[Electron] nativeTheme.themeSource set to:', nativeTheme.themeSource)

    registerIpcHandlers()
    createMainWindow()
    createQuickPanelWindow()
    if (sharedState.trayEnabled) {
      createTray()
    }
    registerGlobalShortcuts()
    registerQuickPanelDoubleTap()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      } else if (sharedState.mainWindow) {
        sharedState.mainWindow.show()
        sharedState.mainWindow.focus()
      }
    })
  })
  .catch((err) => {
    log.error('[Electron] app.whenReady error:', err)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  log.info('[Electron] before-quit')
  sharedState.isQuitting = true
  stopClipboardSync()
})

app.on('will-quit', () => {
  log.info('[Electron] will-quit')
  globalShortcut.unregisterAll()
  stopQuickPanelHook()
})
