import { contextBridge, ipcRenderer, webUtils } from 'electron'

/**
 * 向渲染进程暴露一个与 Tauri invoke 语义接近的 API
 */
contextBridge.exposeInMainWorld('prizm', {
  loadConfig() {
    return ipcRenderer.invoke('load_config')
  },

  saveConfig(config: unknown) {
    return ipcRenderer.invoke('save_config', config)
  },

  testConnection(serverUrl: string) {
    return ipcRenderer.invoke('test_connection', { serverUrl })
  },

  registerClient(serverUrl: string, name: string, scopes: string[]) {
    return ipcRenderer.invoke('register_client', {
      serverUrl,
      name,
      requestedScopes: scopes
    })
  },

  getAppVersion() {
    return ipcRenderer.invoke('get_app_version')
  },

  openDashboard(serverUrl: string) {
    return ipcRenderer.invoke('open_dashboard', { serverUrl })
  },

  readClipboard() {
    return ipcRenderer.invoke('clipboard_read')
  },

  writeClipboard(text: string) {
    return ipcRenderer.invoke('clipboard_write', { text })
  },

  startClipboardSync(config: { serverUrl: string; apiKey: string; scope?: string }) {
    return ipcRenderer.invoke('clipboard_start_sync', config)
  },

  stopClipboardSync() {
    return ipcRenderer.invoke('clipboard_stop_sync')
  },

  onClipboardItemAdded(callback: () => void) {
    const handler = () => callback()
    ipcRenderer.on('clipboard-item-added', handler)
    return () => {
      ipcRenderer.removeListener('clipboard-item-added', handler)
    }
  },

  showNotification(
    payload:
      | { title: string; body?: string; updateId?: string }
      | { eventType: string; payload: unknown; updateId?: string; title?: string; body?: string }
  ) {
    return ipcRenderer.invoke('show_notification', payload)
  },

  onLogFromMain(
    callback: (entry: { level: string; message: string; timestamp: string; source: string }) => void
  ) {
    const handler = (
      _: unknown,
      entry: { level: string; message: string; timestamp: string; source: string }
    ) => callback(entry)
    ipcRenderer.on('log-to-renderer', handler)
    return () => {
      ipcRenderer.removeListener('log-to-renderer', handler)
    }
  },

  logFromRenderer(message: string, type: string) {
    return ipcRenderer.invoke('log_from_renderer', { message, type })
  },

  writeLog(level: string, module: string, message: string) {
    return ipcRenderer.invoke('write_log', { level, module, message })
  },

  selectFolder() {
    return ipcRenderer.invoke('select_folder')
  },

  readFiles(paths: string[]) {
    return ipcRenderer.invoke('read_files', { paths })
  },

  selectAndReadFiles() {
    return ipcRenderer.invoke('select_and_read_files')
  },

  /** Electron 40 中 File.path 已弃用，用 webUtils.getPathForFile 替代 */
  getPathForFile(file: File): string {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },

  onExecuteQuickAction(callback: (payload: { action: string; selectedText: string }) => void) {
    const handler = (_: unknown, payload: { action: string; selectedText: string }) =>
      callback(payload)
    ipcRenderer.on('execute-quick-action', handler)
    return () => {
      ipcRenderer.removeListener('execute-quick-action', handler)
    }
  },

  getPlatform() {
    return ipcRenderer.invoke('get_platform') as Promise<string>
  },

  setTitleBarOverlay(options: { color?: string; symbolColor?: string; height?: number }) {
    return ipcRenderer.invoke('set_titlebar_overlay', options)
  }
})
