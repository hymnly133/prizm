import { globalShortcut, clipboard, screen } from 'electron'
import log from 'electron-log/main'
import { sharedState } from './config'
import { createMainWindow, createQuickPanelWindow } from './windowManager'

/**
 * 注册全局快捷键
 */
export function registerGlobalShortcuts(): void {
  const accelerator = process.platform === 'darwin' ? 'Command+Shift+P' : 'Control+Shift+P'
  const ok = globalShortcut.register(accelerator, () => {
    const win = createMainWindow()
    if (!win) return
    if (win.isVisible()) {
      win.hide()
    } else {
      win.show()
      win.focus()
    }
  })
  if (!ok) {
    log.warn('[Electron] Failed to register global shortcut:', accelerator)
  }
}

/** 快捷面板：双击 Ctrl 触发 */
const DOUBLE_TAP_MS = 350
let lastCtrlUpAt = 0
let ctrlDownWithoutOtherKeys = true
let uiohookStarted = false

async function getSelectedTextAsync(): Promise<string> {
  const prev = clipboard.readText()
  clipboard.writeText('')
  try {
    const { uIOhook, UiohookKey } = require('uiohook-napi')
    uIOhook.keyTap(UiohookKey.C, [UiohookKey.LeftCtrl])
  } catch (e) {
    log.warn('[Electron] uiohook keyTap failed:', e)
  }
  await new Promise((r) => setTimeout(r, 150))
  const text = clipboard.readText().trim()
  clipboard.writeText(prev)
  return text
}

function showQuickPanel(): void {
  const win = createQuickPanelWindow()
  if (!win || win.isDestroyed()) return
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const bounds = display.bounds
  const [w, h] = win.getSize()
  let x = cursor.x - Math.round(w / 2)
  let y = cursor.y + 16
  x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - w))
  y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - h))
  win.setPosition(x, y)
  getSelectedTextAsync()
    .then((selectedText) => {
      if (sharedState.quickPanelWindow && !sharedState.quickPanelWindow.isDestroyed()) {
        sharedState.quickPanelWindow.webContents.send('show-quick-panel', {
          selectedText: selectedText || ''
        })
        sharedState.quickPanelWindow.show()
        sharedState.quickPanelWindow.focus()
      }
    })
    .catch((err) => {
      log.warn('[Electron] getSelectedText failed:', err)
      if (sharedState.quickPanelWindow && !sharedState.quickPanelWindow.isDestroyed()) {
        sharedState.quickPanelWindow.webContents.send('show-quick-panel', { selectedText: '' })
        sharedState.quickPanelWindow.show()
        sharedState.quickPanelWindow.focus()
      }
    })
}

export function registerQuickPanelDoubleTap(): void {
  try {
    const { uIOhook, UiohookKey } = require('uiohook-napi')
    uIOhook.on('keydown', (e: { keycode: number }) => {
      const ctrl = UiohookKey.LeftCtrl ?? 29
      const rightCtrl = UiohookKey.RightCtrl ?? 361
      if (e.keycode !== ctrl && e.keycode !== rightCtrl) {
        ctrlDownWithoutOtherKeys = false
      }
    })
    uIOhook.on('keyup', (e: { keycode: number }) => {
      const ctrl = UiohookKey.LeftCtrl ?? 29
      const rightCtrl = UiohookKey.RightCtrl ?? 361
      if (e.keycode === ctrl || e.keycode === rightCtrl) {
        const now = Date.now()
        if (ctrlDownWithoutOtherKeys && now - lastCtrlUpAt < DOUBLE_TAP_MS) {
          lastCtrlUpAt = 0
          showQuickPanel()
        } else {
          lastCtrlUpAt = now
        }
        ctrlDownWithoutOtherKeys = true
      }
    })
    uIOhook.start()
    uiohookStarted = true
    log.info('[Electron] Quick panel double-tap Ctrl registered')
  } catch (e) {
    log.warn('[Electron] uiohook-napi not available, quick panel disabled:', e)
  }
}

export function stopQuickPanelHook(): void {
  if (!uiohookStarted) return
  try {
    const { uIOhook } = require('uiohook-napi')
    uIOhook.stop()
    uiohookStarted = false
  } catch {
    // ignore
  }
}
