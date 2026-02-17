import { clipboard } from 'electron'
import log from 'electron-log/main'
import { sharedState } from './config'

let clipboardSyncInterval: ReturnType<typeof setInterval> | null = null
let lastClipboardText = ''

/**
 * 启动剪贴板同步：轮询系统剪贴板，变化时 POST 到服务器
 */
export function startClipboardSync(serverUrl: string, apiKey: string, scope: string): void {
  if (clipboardSyncInterval) {
    return
  }
  lastClipboardText = clipboard.readText()

  clipboardSyncInterval = setInterval(() => {
    const text = clipboard.readText()
    if (!text || text === lastClipboardText) {
      return
    }
    lastClipboardText = text

    const base = serverUrl.replace(/\/+$/, '')
    const url = `${base}/clipboard`
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        type: 'text',
        content: text,
        createdAt: Date.now(),
        scope: scope || 'default'
      })
    })
      .then((resp) => {
        if (resp.ok && sharedState.mainWindow && !sharedState.mainWindow.isDestroyed()) {
          sharedState.mainWindow.webContents.send('clipboard-item-added')
        }
      })
      .catch((err: Error) => {
        log.warn('[Electron] Clipboard sync failed:', err.message)
      })
  }, 1500)
}

/**
 * 停止剪贴板同步
 */
export function stopClipboardSync(): void {
  if (clipboardSyncInterval) {
    clearInterval(clipboardSyncInterval)
    clipboardSyncInterval = null
  }
}
