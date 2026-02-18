import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('quickPanelApi', {
  onShow(callback: (data: { clipboardText: string }) => void) {
    const handler = (_: unknown, data: { clipboardText: string }) => callback(data)
    ipcRenderer.on('show-quick-panel', handler)
    return () => {
      ipcRenderer.removeListener('show-quick-panel', handler)
    }
  },

  onSelectionUpdate(callback: (data: { selectedText: string }) => void) {
    const handler = (_: unknown, data: { selectedText: string }) => callback(data)
    ipcRenderer.on('update-quick-panel-selection', handler)
    return () => {
      ipcRenderer.removeListener('update-quick-panel-selection', handler)
    }
  },

  executeAction(action: string, selectedText: string) {
    ipcRenderer.send('quick-panel-action', { action, selectedText })
  },

  hidePanel() {
    ipcRenderer.send('quick-panel-hide')
  }
})
