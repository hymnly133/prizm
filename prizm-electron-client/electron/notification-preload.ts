import { contextBridge, ipcRenderer } from 'electron'
import log from 'electron-log/renderer'

/**
 * 通知窗口预加载脚本
 * 暴露接收通知的 API
 */
contextBridge.exposeInMainWorld('notificationApi', {
  onNotification(
    callback: (payload: {
      title: string
      body?: string
      source?: string
      updateId?: string
    }) => void
  ) {
    const handler = (
      _: unknown,
      payload: { title: string; body?: string; source?: string; updateId?: string }
    ) => {
      log.info('[Notify preload] 收到 IPC notification', payload)
      callback(payload)
    }
    log.info('[Notify preload] 注册 onNotification 监听')
    ipcRenderer.on('notification', handler)
    return () => {
      ipcRenderer.removeListener('notification', handler)
    }
  },
  /** 通知面板已空，可隐藏窗口以释放鼠标穿透 */
  notifyPanelEmpty: () => {
    log.info('[Notify preload] notifyPanelEmpty')
    ipcRenderer.send('notification-panel-empty')
  },
  /** 通知面板已就绪，可接收通知（Vue 挂载完成后调用） */
  notifyReady: () => {
    log.info('[Notify preload] notifyReady 发送')
    ipcRenderer.send('notification-ready')
  }
})
