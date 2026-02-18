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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 保存当前剪贴板内容（文本 + HTML 格式）
 */
function saveClipboard(): { text: string; html: string; formats: string[] } {
  const text = clipboard.readText()
  const html = clipboard.readHTML()
  const formats = clipboard.availableFormats()
  return { text, html, formats }
}

/**
 * 恢复之前保存的剪贴板内容
 */
function restoreClipboard(saved: { text: string; html: string; formats: string[] }): void {
  if (saved.formats.includes('text/html') && saved.html) {
    clipboard.write({ text: saved.text, html: saved.html })
  } else if (saved.text) {
    clipboard.writeText(saved.text)
  }
}

function toggleQuickPanel(): void {
  const win = sharedState.quickPanelWindow
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.hide()
    return
  }
  showQuickPanel()
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

  // 读取当前剪贴板内容（同步）
  const existingClipboard = clipboard.readText().trim()

  // 在目标应用仍有焦点时，立即保存剪贴板并模拟 Ctrl+C
  const saved = saveClipboard()
  clipboard.writeText('')
  try {
    const { uIOhook, UiohookKey } = require('uiohook-napi')
    uIOhook.keyTap(UiohookKey.C, [UiohookKey.Ctrl])
  } catch (e) {
    log.warn('[QuickPanel] uiohook keyTap failed:', e)
  }

  // 立即弹出面板（此时用已有剪贴板内容）
  win.webContents.send('show-quick-panel', { clipboardText: existingClipboard })
  win.show()
  win.focus()

  // 等待 Ctrl+C 结果写入剪贴板，增量更新面板
  sleep(250).then(() => {
    const selectedText = clipboard.readText().trim()
    restoreClipboard(saved)
    if (selectedText && !win.isDestroyed()) {
      win.webContents.send('update-quick-panel-selection', { selectedText })
    }
  })
}

export function registerQuickPanelDoubleTap(): void {
  try {
    const { uIOhook, UiohookKey } = require('uiohook-napi')
    const ctrl = UiohookKey.Ctrl
    const rightCtrl = UiohookKey.CtrlRight
    uIOhook.on('keydown', (e: { keycode: number }) => {
      if (e.keycode !== ctrl && e.keycode !== rightCtrl) {
        ctrlDownWithoutOtherKeys = false
      }
    })
    uIOhook.on('keyup', (e: { keycode: number }) => {
      if (e.keycode === ctrl || e.keycode === rightCtrl) {
        const now = Date.now()
        if (ctrlDownWithoutOtherKeys && now - lastCtrlUpAt < DOUBLE_TAP_MS) {
          lastCtrlUpAt = 0
          toggleQuickPanel()
        } else {
          lastCtrlUpAt = now
        }
        ctrlDownWithoutOtherKeys = true
      }
    })
    uIOhook.start()
    uiohookStarted = true
    log.info(
      '[Electron] Quick panel double-tap Ctrl registered (Ctrl=%d, CtrlRight=%d)',
      ctrl,
      rightCtrl
    )
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
