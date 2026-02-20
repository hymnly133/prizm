import { app, BrowserWindow, ipcMain, shell, screen, nativeTheme } from 'electron'
import * as path from 'path'
import log from 'electron-log/main'
import { sharedState } from './config'

const DEBUG_NOTIFY = true
function logNotify(...args: unknown[]) {
  if (DEBUG_NOTIFY) log.info('[Notify]', ...args)
}

/**
 * 创建主窗口
 */
export function createMainWindow(): BrowserWindow {
  const isDev = !app.isPackaged

  if (sharedState.mainWindow) {
    return sharedState.mainWindow
  }

  const isDark = nativeTheme.shouldUseDarkColors
  const bgColor = isDark ? '#000000' : '#ffffff'

  sharedState.mainWindow = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 400,
    minHeight: 500,
    resizable: true,
    show: false,
    backgroundColor: bgColor,
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32' && {
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: isDark ? '#CCCCCC' : '#333333',
        height: 36
      }
    }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const mainWindow = sharedState.mainWindow

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5183')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('close', (event) => {
    if (sharedState.isQuitting) {
      return
    }
    if (sharedState.trayEnabled && sharedState.minimizeToTray) {
      event.preventDefault()
      sharedState.mainWindow!.hide()
    }
  })

  mainWindow.on('closed', () => {
    sharedState.mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isAppUrl =
      url.startsWith('http://localhost:5183') || url.startsWith('file://') || url === 'about:blank'
    if (!isAppUrl) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  return mainWindow
}

/**
 * 在通知窗口显示通知
 */
function showNotificationInWindow(payload: {
  title?: string
  body?: string
  source?: string
  updateId?: string
  eventType?: string
  payload?: unknown
}): void {
  logNotify('showNotificationInWindow 被调用', payload)
  const win = createNotificationWindow()
  win.show()
  win.moveTop()

  const send = () => {
    logNotify('直接 send 到 renderer', payload)
    win.webContents.send('notification', payload)
  }

  if (win.webContents.isLoading()) {
    sharedState.notificationQueue.push(payload)
    logNotify('窗口加载中，入队, queueLen=', sharedState.notificationQueue.length)
    return
  }
  send()
}

/** 通知窗口加载完成后发送队列中的通知 */
function flushNotificationQueue(win: BrowserWindow): void {
  logNotify('flushNotificationQueue, count=', sharedState.notificationQueue.length)
  for (const payload of sharedState.notificationQueue) {
    logNotify('flush send', payload)
    win.webContents.send('notification', payload)
  }
  sharedState.notificationQueue.length = 0
}

export { showNotificationInWindow }

/**
 * 创建无边框通知窗口（桌面独立弹出）
 */
export function createNotificationWindow(): BrowserWindow {
  if (sharedState.notificationWindow && !sharedState.notificationWindow.isDestroyed()) {
    logNotify('createNotificationWindow: 复用已有窗口')
    return sharedState.notificationWindow
  }
  logNotify('createNotificationWindow: 创建新窗口')

  const isDev = !app.isPackaged

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: workWidth, height: workHeight } = primaryDisplay.workAreaSize
  const workArea = primaryDisplay.workArea

  const winWidth = 400
  const winHeight = Math.min(Math.round(workHeight * 0.6), 520)
  const margin = 12

  sharedState.notificationWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: workArea.x + workWidth - winWidth - margin,
    y: workArea.y + workHeight - winHeight - margin,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    ...(process.platform === 'linux' && { type: 'notification' }),
    webPreferences: {
      preload: path.join(__dirname, 'notification-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const notificationWindow = sharedState.notificationWindow

  if (isDev) {
    notificationWindow.loadURL('http://localhost:5183/notification.html')
  } else {
    notificationWindow.loadFile(path.join(__dirname, '..', 'dist', 'notification.html'))
  }

  ipcMain.once('notification-ready', () => {
    logNotify(
      'notification-ready 收到，flush 队列, queueLen=',
      sharedState.notificationQueue.length
    )
    if (sharedState.notificationWindow && !sharedState.notificationWindow.isDestroyed()) {
      flushNotificationQueue(sharedState.notificationWindow)
      sharedState.notificationWindow.show()
      sharedState.notificationWindow.moveTop()
    }
  })

  if (isDev) {
    notificationWindow.webContents.on('did-finish-load', () => {
      logNotify(
        'notification 窗口 load 完成, isLoading=',
        notificationWindow.webContents.isLoading()
      )
    })
    notificationWindow.webContents.openDevTools({ mode: 'detach' })
  }

  notificationWindow.setAlwaysOnTop(true, 'pop-up-menu')
  notificationWindow.setIgnoreMouseEvents(true, { forward: true })

  const onSetInteractive = (_event: unknown, interactive: boolean) => {
    if (sharedState.notificationWindow && !sharedState.notificationWindow.isDestroyed()) {
      if (interactive) {
        sharedState.notificationWindow.setIgnoreMouseEvents(false)
      } else {
        sharedState.notificationWindow.setIgnoreMouseEvents(true, { forward: true })
      }
    }
  }
  ipcMain.on('notification-set-interactive', onSetInteractive)

  const onPanelEmpty = () => {
    /* keep window visible */
  }
  ipcMain.on('notification-panel-empty', onPanelEmpty)

  notificationWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  notificationWindow.webContents.on('will-navigate', (event, url) => {
    const isAppUrl =
      url.startsWith('http://localhost:5183') || url.startsWith('file://') || url === 'about:blank'
    if (!isAppUrl) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  notificationWindow.on('closed', () => {
    ipcMain.removeListener('notification-set-interactive', onSetInteractive)
    ipcMain.removeListener('notification-panel-empty', onPanelEmpty)
    sharedState.notificationWindow = null
  })

  return notificationWindow
}

/**
 * 创建快捷面板窗口
 */
export function createQuickPanelWindow(): BrowserWindow | null {
  if (sharedState.quickPanelWindow && !sharedState.quickPanelWindow.isDestroyed()) {
    return sharedState.quickPanelWindow
  }
  const isDev = !app.isPackaged
  sharedState.quickPanelWindow = new BrowserWindow({
    width: 280,
    height: 280,
    frame: false,
    thickFrame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    backgroundColor: '#16161c',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'quickpanel-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const quickPanelWindow = sharedState.quickPanelWindow
  if (isDev) {
    quickPanelWindow.loadURL('http://localhost:5183/quickpanel.html')
  } else {
    quickPanelWindow.loadFile(path.join(__dirname, '..', 'dist', 'quickpanel.html'))
  }
  quickPanelWindow.setAlwaysOnTop(true, 'pop-up-menu')
  quickPanelWindow.on('blur', () => {
    quickPanelWindow?.hide()
  })
  quickPanelWindow.on('closed', () => {
    sharedState.quickPanelWindow = null
  })
  quickPanelWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  return quickPanelWindow
}
