import { app, BrowserWindow, Menu, globalShortcut } from 'electron'
import * as path from 'path'
import * as util from 'util'
import log from 'electron-log/main'

import { sharedState } from './config'
import { loadTraySettings } from './config'
import { registerIpcHandlers } from './ipcHandlers'
import { createMainWindow, createQuickPanelWindow } from './windowManager'
import { createTray } from './trayManager'
import {
  registerGlobalShortcuts,
  registerQuickPanelDoubleTap,
  stopQuickPanelHook
} from './shortcuts'
import { stopClipboardSync } from './clipboardSync'

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
