import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  screen,
  Tray,
  Menu,
  globalShortcut,
  nativeImage,
  clipboard,
  dialog
} from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as util from 'util'
import log from 'electron-log/main'

log.initialize()

/** 日志路径：开发时在项目根目录，运行时在 exe 所在目录 */
log.transports.file.resolvePathFn = () => {
  const isDev = !app.isPackaged
  if (isDev) {
    return path.join(app.getAppPath(), 'logs', 'main.log')
  }
  return path.join(path.dirname(app.getPath('exe')), 'logs', 'main.log')
}

/** 全局状态 */
let mainWindow: BrowserWindow | null = null
let notificationWindow: BrowserWindow | null = null
let quickPanelWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let trayEnabled = true
let minimizeToTray = true

/** 自定义 transport：将主进程日志推送到渲染进程 UI */
;(log.transports as Record<string, unknown>).renderer = (message: {
  data: unknown[]
  date: Date
  level: string
}) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const text = util.format.apply(util, message.data as [string, ...unknown[]])
    mainWindow.webContents.send('log-to-renderer', {
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

interface PrizmConfig {
  server: { host: string; port: string; is_dev?: string }
  client: { name: string; auto_register: string; requested_scopes: string[] }
  api_key: string
  tray: {
    enabled: string
    minimize_to_tray: string
    show_notification: string
  }
  notify_events?: string[]
}

/**
 * 获取配置文件路径：与 Tauri 大致对齐，存放在用户配置目录下的 prizm-client/config.json
 */
function getConfigPath(): { configDir: string; configPath: string } {
  const configDir = path.join(app.getPath('appData'), 'prizm-client')
  const configPath = path.join(configDir, 'config.json')
  return { configDir, configPath }
}

/**
 * 加载配置（如果不存在则返回默认配置）
 */
async function loadConfigFromDisk(): Promise<PrizmConfig> {
  const { configDir, configPath } = getConfigPath()

  await fs.promises.mkdir(configDir, { recursive: true })

  try {
    const content = await fs.promises.readFile(configPath, 'utf-8')
    return JSON.parse(content) as PrizmConfig
  } catch {
    return {
      server: {
        host: '127.0.0.1',
        port: '4127',
        is_dev: 'true'
      },
      client: {
        name: 'Prizm Electron Client',
        auto_register: 'true',
        requested_scopes: ['default', 'online']
      },
      api_key: '',
      tray: {
        enabled: 'true',
        minimize_to_tray: 'true',
        show_notification: 'true'
      },
      notify_events: ['notification', 'todo_list:created', 'todo_list:updated', 'todo_list:deleted']
    }
  }
}

/**
 * 保存配置到磁盘
 */
async function saveConfigToDisk(config: PrizmConfig): Promise<void> {
  const { configDir, configPath } = getConfigPath()
  await fs.promises.mkdir(configDir, { recursive: true })
  const content = JSON.stringify(config, null, 2)
  await fs.promises.writeFile(configPath, content, 'utf-8')
}

/**
 * 预加载托盘相关配置
 */
async function loadTraySettings(): Promise<void> {
  try {
    const config = await loadConfigFromDisk()
    const trayConfig = config.tray || {}
    trayEnabled = trayConfig.enabled !== 'false'
    minimizeToTray = trayConfig.minimize_to_tray !== 'false'
  } catch (err) {
    log.warn('[Electron] Failed to load tray settings, using defaults:', err)
    trayEnabled = true
    minimizeToTray = true
  }
}

/**
 * 从 serverUrl 中提取 host 和 port
 */
function extractHostPort(url: string): { host: string; port: string } {
  let clean = url
  const prefixes = ['http://', 'https://', 'ws://', 'wss://']
  for (const p of prefixes) {
    if (clean.startsWith(p)) {
      clean = clean.slice(p.length)
      break
    }
  }
  const idx = clean.lastIndexOf(':')
  if (idx === -1) {
    return { host: clean, port: '4127' }
  }
  return {
    host: clean.slice(0, idx),
    port: clean.slice(idx + 1)
  }
}

/**
 * 注册客户端：健康检查 + /auth/register
 */
async function registerClientOnServer(
  serverUrl: string,
  name: string,
  requestedScopes: string[]
): Promise<{ clientId?: string; apiKey?: string }> {
  const healthUrl = `${serverUrl.replace(/\/+$/, '')}/health`
  const resp = await fetch(healthUrl)
  if (!resp.ok) {
    throw new Error(`Health check failed: ${resp.status}`)
  }
  const health = (await resp.json()) as { status: string }
  if (health.status !== 'ok') {
    throw new Error('Server health check failed')
  }

  const registerUrl = `${serverUrl.replace(/\/+$/, '')}/auth/register`
  const body = {
    name,
    requestedScopes: requestedScopes && requestedScopes.length > 0 ? requestedScopes : undefined
  }

  const registerResp = await fetch(registerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Prizm-Panel': 'true'
    },
    body: JSON.stringify(body)
  })

  if (!registerResp.ok) {
    const text = await registerResp.text()
    throw new Error(`Register failed: ${registerResp.status} ${text}`)
  }

  return (await registerResp.json()) as { clientId?: string; apiKey?: string }
}

/**
 * 测试服务器连接
 */
async function testConnectionOnServer(serverUrl: string): Promise<boolean> {
  const healthUrl = `${serverUrl.replace(/\/+$/, '')}/health`
  const resp = await fetch(healthUrl)
  if (!resp.ok) {
    return false
  }
  const health = (await resp.json()) as { status: string }
  return health.status === 'ok'
}

/**
 * 创建主窗口
 */
function createMainWindow(): BrowserWindow {
  const isDev = !app.isPackaged

  if (mainWindow) {
    return mainWindow
  }

  mainWindow = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 400,
    minHeight: 500,
    resizable: true,
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5183')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return
    }
    if (trayEnabled && minimizeToTray) {
      event.preventDefault()
      mainWindow!.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 点击 Markdown 预览中的链接时，在外部浏览器打开，避免应用内导航导致程序失效
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
 * 创建无边框通知窗口（桌面独立弹出）
 */
const DEBUG_NOTIFY = true
function logNotify(...args: unknown[]) {
  if (DEBUG_NOTIFY) log.info('[Notify]', ...args)
}

function createNotificationWindow(): BrowserWindow {
  if (notificationWindow && !notificationWindow.isDestroyed()) {
    logNotify('createNotificationWindow: 复用已有窗口')
    return notificationWindow
  }
  logNotify('createNotificationWindow: 创建新窗口')

  const isDev = !app.isPackaged

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: workWidth, height: workHeight } = primaryDisplay.workAreaSize
  const workArea = primaryDisplay.workArea

  const winWidth = 400
  const margin = 12

  // 使用最通用的通知窗口配置：不设 parent，确保与主窗口完全独立
  notificationWindow = new BrowserWindow({
    width: winWidth,
    height: workHeight,
    x: workArea.x + workWidth - winWidth - margin,
    y: workArea.y,
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

  const loadPromise = isDev
    ? notificationWindow.loadURL('http://localhost:5183/notification.html')
    : notificationWindow.loadFile(path.join(__dirname, '..', 'dist', 'notification.html'))

  // 不在此处 flush：load 完成时 Vue 可能尚未挂载，改为在 notification-ready 时 flush
  // loadPromise.then(() => { flushNotificationQueue(notificationWindow!); });

  ipcMain.once('notification-ready', () => {
    logNotify('notification-ready 收到，flush 队列, queueLen=', notificationQueue.length)
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      flushNotificationQueue(notificationWindow)
      notificationWindow.show()
      notificationWindow.moveTop() // 确保通知窗口置于最前
    }
  })

  if (isDev) {
    notificationWindow.webContents.on('did-finish-load', () => {
      logNotify(
        'notification 窗口 load 完成, isLoading=',
        notificationWindow!.webContents.isLoading()
      )
    })
    notificationWindow.webContents.openDevTools({ mode: 'detach' })
  }

  // 显式设置置顶层级：pop-up-menu 在 Windows 上高于任务栏，主窗口最小化时仍能置顶
  notificationWindow.setAlwaysOnTop(true, 'pop-up-menu')

  // 常驻显示、不接收鼠标事件（点击穿透）
  notificationWindow.setIgnoreMouseEvents(true, { forward: false })

  // 通知窗口中的 Markdown 链接也应在外部浏览器打开
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
    notificationWindow = null
  })

  // 常驻显示：不再在面板为空时隐藏窗口
  ipcMain.on('notification-panel-empty', () => {
    // 保持窗口可见，不隐藏
  })

  return notificationWindow
}

/** 待发送通知队列（窗口未就绪时缓存） */
const notificationQueue: Array<{
  title?: string
  body?: string
  source?: string
  updateId?: string
  eventType?: string
  payload?: unknown
}> = []

/**
 * 在通知窗口显示通知
 * 支持两种格式：1) 旧格式 { title, body, updateId } 2) 新格式 { eventType, payload, updateId } 用于自定义展示
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
  win.moveTop() // 确保通知窗口置于最前

  const send = () => {
    logNotify('直接 send 到 renderer', payload)
    win.webContents.send('notification', payload)
  }

  if (win.webContents.isLoading()) {
    notificationQueue.push(payload)
    logNotify('窗口加载中，入队, queueLen=', notificationQueue.length)
    return
  }
  send()
}

/** 通知窗口加载完成后发送队列中的通知 */
function flushNotificationQueue(win: BrowserWindow): void {
  logNotify('flushNotificationQueue, count=', notificationQueue.length)
  for (const payload of notificationQueue) {
    logNotify('flush send', payload)
    win.webContents.send('notification', payload)
  }
  notificationQueue.length = 0
}

/**
 * 创建系统托盘
 */
function createTray(): void {
  if (!trayEnabled || tray) {
    return
  }

  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('Prizm Electron Client')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开 Prizm',
      click: () => {
        const win = createMainWindow()
        if (win) {
          win.show()
          win.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    const win = createMainWindow()
    if (!win) return
    if (win.isVisible()) {
      win.hide()
    } else {
      win.show()
      win.focus()
    }
  })
}

/**
 * 注册全局快捷键
 */
function registerGlobalShortcuts(): void {
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
      if (quickPanelWindow && !quickPanelWindow.isDestroyed()) {
        quickPanelWindow.webContents.send('show-quick-panel', { selectedText: selectedText || '' })
        quickPanelWindow.show()
        quickPanelWindow.focus()
      }
    })
    .catch((err) => {
      log.warn('[Electron] getSelectedText failed:', err)
      if (quickPanelWindow && !quickPanelWindow.isDestroyed()) {
        quickPanelWindow.webContents.send('show-quick-panel', { selectedText: '' })
        quickPanelWindow.show()
        quickPanelWindow.focus()
      }
    })
}

function createQuickPanelWindow(): BrowserWindow | null {
  if (quickPanelWindow && !quickPanelWindow.isDestroyed()) {
    return quickPanelWindow
  }
  const isDev = !app.isPackaged
  quickPanelWindow = new BrowserWindow({
    width: 320,
    height: 280,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'quickpanel-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
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
    quickPanelWindow = null
  })
  quickPanelWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  return quickPanelWindow
}

function registerQuickPanelDoubleTap(): void {
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

function stopQuickPanelHook(): void {
  if (!uiohookStarted) return
  try {
    const { uIOhook } = require('uiohook-napi')
    uIOhook.stop()
    uiohookStarted = false
  } catch {
    // ignore
  }
}

/** 剪贴板同步状态 */
let clipboardSyncInterval: ReturnType<typeof setInterval> | null = null
let lastClipboardText = ''

/**
 * 启动剪贴板同步：轮询系统剪贴板，变化时 POST 到服务器
 */
function startClipboardSync(serverUrl: string, apiKey: string, scope: string): void {
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
        if (resp.ok && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('clipboard-item-added')
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
function stopClipboardSync(): void {
  if (clipboardSyncInterval) {
    clearInterval(clipboardSyncInterval)
    clipboardSyncInterval = null
  }
}

/**
 * 注册 IPC 处理器
 */
function registerIpcHandlers(): void {
  ipcMain.handle('load_config', async () => {
    try {
      return await loadConfigFromDisk()
    } catch (err) {
      log.error('[Electron] load_config failed:', err)
      throw err
    }
  })

  ipcMain.handle('save_config', async (_event, config: PrizmConfig) => {
    try {
      if (
        !config ||
        typeof config !== 'object' ||
        !config.server ||
        !config.client ||
        typeof config.api_key === 'undefined' ||
        !config.tray
      ) {
        throw new Error('Invalid config payload')
      }

      await saveConfigToDisk(config)
      return true
    } catch (err) {
      log.error('[Electron] save_config failed:', err)
      throw err
    }
  })

  ipcMain.handle(
    'register_client',
    async (
      _event,
      {
        serverUrl,
        name,
        requestedScopes
      }: { serverUrl: string; name: string; requestedScopes: string[] }
    ) => {
      try {
        const register = await registerClientOnServer(serverUrl, name, requestedScopes)
        const config = await loadConfigFromDisk()

        const { host, port } = extractHostPort(serverUrl)
        config.server.host = host
        config.server.port = port
        config.server.is_dev = 'true'
        config.client.name = register.clientId || name
        config.api_key = register.apiKey || ''

        await saveConfigToDisk(config)
        return register.apiKey
      } catch (err) {
        log.error('[Electron] register_client failed:', err)
        throw err
      }
    }
  )

  ipcMain.handle('test_connection', async (_event, { serverUrl }: { serverUrl: string }) => {
    try {
      return await testConnectionOnServer(serverUrl)
    } catch (err) {
      log.error('[Electron] test_connection failed:', err)
      return false
    }
  })

  ipcMain.handle('get_app_version', () => {
    return app.getVersion()
  })

  ipcMain.handle('open_dashboard', async (_event, { serverUrl }: { serverUrl: string }) => {
    try {
      const base = serverUrl.replace(/\/+$/, '')
      const dashboardUrl = `${base}/dashboard/`
      await shell.openExternal(dashboardUrl)
      return true
    } catch (err) {
      log.error('[Electron] open_dashboard failed:', err)
      throw err
    }
  })

  ipcMain.handle('clipboard_read', () => {
    return clipboard.readText()
  })

  ipcMain.handle('clipboard_write', (_event, { text }: { text: string }) => {
    if (typeof text === 'string') {
      clipboard.writeText(text)
      return true
    }
    return false
  })

  ipcMain.handle(
    'clipboard_start_sync',
    async (
      _event,
      { serverUrl, apiKey, scope }: { serverUrl: string; apiKey?: string; scope?: string }
    ) => {
      startClipboardSync(serverUrl, apiKey || '', scope || 'default')
      return true
    }
  )

  ipcMain.handle('clipboard_stop_sync', () => {
    stopClipboardSync()
    return true
  })

  ipcMain.handle(
    'show_notification',
    (
      _event,
      payload: {
        title?: string
        body?: string
        source?: string
        updateId?: string
        eventType?: string
        payload?: unknown
      }
    ) => {
      logNotify('IPC show_notification 收到', payload)
      showNotificationInWindow(payload)
      return true
    }
  )

  ipcMain.handle('log_from_renderer', (_event, payload: { message: string; type: string }) => {
    const { message, type } = payload
    if (type === 'error') log.error(message)
    else if (type === 'warning') log.warn(message)
    else log.info(message)
    return true
  })

  ipcMain.handle('select_folder', async () => {
    const opts = {
      properties: ['openDirectory' as const],
      title: '选择工作区文件夹'
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.on('quick-panel-action', (_event, payload: { action: string; selectedText: string }) => {
    if (quickPanelWindow && !quickPanelWindow.isDestroyed()) {
      quickPanelWindow.hide()
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('execute-quick-action', payload)
    }
  })

  ipcMain.on('quick-panel-hide', () => {
    if (quickPanelWindow && !quickPanelWindow.isDestroyed()) {
      quickPanelWindow.hide()
    }
  })
}

app
  .whenReady()
  .then(async () => {
    await loadTraySettings()
    registerIpcHandlers()
    createMainWindow()
    createQuickPanelWindow()
    if (trayEnabled) {
      createTray()
    }
    registerGlobalShortcuts()
    registerQuickPanelDoubleTap()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      } else if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
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
  isQuitting = true
  stopClipboardSync()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopQuickPanelHook()
})
