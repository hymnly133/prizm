import { app, ipcMain, shell, dialog, clipboard } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import log from 'electron-log/main'
import { sharedState } from './config'
import type { PrizmConfig } from './config'
import { loadConfigFromDisk, saveConfigToDisk } from './config'
import { startClipboardSync, stopClipboardSync } from './clipboardSync'
import { showNotificationInWindow } from './windowManager'

const DEBUG_NOTIFY = true
function logNotify(...args: unknown[]) {
  if (DEBUG_NOTIFY) log.info('[Notify]', ...args)
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

/** 文本文件扩展名白名单 */
const TEXT_EXTS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.xml',
  '.html',
  '.htm',
  '.yaml',
  '.yml',
  '.log',
  '.js',
  '.ts',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.css',
  '.scss',
  '.less',
  '.vue',
  '.jsx',
  '.tsx',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.sh',
  '.bat',
  '.ps1',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.sql',
  '.r',
  '.lua',
  '.pl',
  '.env',
  '.gitignore',
  '.editorconfig',
  '.prettierrc',
  '.eslintrc'
])
const MAX_TEXT_SIZE = 1024 * 1024 // 1 MB

interface ReadFileResult {
  path: string
  name: string
  size: number
  content: string | null
  ext: string
  unsupported?: boolean
  truncated?: boolean
}

function readFilesFromPaths(paths: string[]): ReadFileResult[] {
  const results: ReadFileResult[] = []
  for (const filePath of paths) {
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) continue
      const ext = path.extname(filePath).toLowerCase()
      const name = path.basename(filePath)
      const isTextExt = TEXT_EXTS.has(ext) || ext === ''
      if (isTextExt || stat.size < 256 * 1024) {
        let content = fs.readFileSync(filePath, 'utf-8')
        let truncated = false
        if (content.length > MAX_TEXT_SIZE) {
          content = content.slice(0, MAX_TEXT_SIZE)
          truncated = true
        }
        results.push({ path: filePath, name, size: stat.size, content, ext, truncated })
      } else {
        results.push({
          path: filePath,
          name,
          size: stat.size,
          content: null,
          ext,
          unsupported: true
        })
      }
    } catch (err) {
      log.warn('[read_files] skip file:', filePath, err)
    }
  }
  return results
}

/**
 * 注册 IPC 处理器
 */
export function registerIpcHandlers(): void {
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

  ipcMain.handle(
    'write_log',
    (_event, payload: { level: string; module: string; message: string }) => {
      const { level, message } = payload
      if (level === 'error') log.error(message)
      else if (level === 'warn') log.warn(message)
      else if (level === 'debug') log.debug(message)
      else log.info(message)
      return true
    }
  )

  ipcMain.handle('select_folder', async () => {
    const opts = {
      properties: ['openDirectory' as const],
      title: '选择工作区文件夹'
    }
    const result = sharedState.mainWindow
      ? await dialog.showOpenDialog(sharedState.mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('read_files', async (_event, { paths }: { paths: string[] }) => {
    return readFilesFromPaths(paths)
  })

  ipcMain.handle('select_and_read_files', async () => {
    const opts = {
      properties: ['openFile' as const, 'multiSelections' as const],
      title: '选择要导入的文件',
      filters: [
        {
          name: '文本文件',
          extensions: [
            'txt',
            'md',
            'json',
            'csv',
            'xml',
            'html',
            'yaml',
            'yml',
            'log',
            'js',
            'ts',
            'py',
            'java',
            'go',
            'rs',
            'c',
            'cpp',
            'css',
            'vue',
            'jsx',
            'tsx'
          ]
        },
        { name: '所有文件', extensions: ['*'] }
      ]
    }
    const result = sharedState.mainWindow
      ? await dialog.showOpenDialog(sharedState.mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths.length) return null
    return readFilesFromPaths(result.filePaths)
  })

  ipcMain.handle('get_platform', () => {
    return process.platform
  })

  ipcMain.handle(
    'set_titlebar_overlay',
    (_event, options: { color?: string; symbolColor?: string; height?: number }) => {
      if (
        sharedState.mainWindow &&
        !sharedState.mainWindow.isDestroyed() &&
        process.platform === 'win32'
      ) {
        sharedState.mainWindow.setTitleBarOverlay(options)
      }
      return true
    }
  )

  ipcMain.on('quick-panel-action', (_event, payload: { action: string; selectedText: string }) => {
    if (sharedState.quickPanelWindow && !sharedState.quickPanelWindow.isDestroyed()) {
      sharedState.quickPanelWindow.hide()
    }
    if (sharedState.mainWindow && !sharedState.mainWindow.isDestroyed()) {
      sharedState.mainWindow.show()
      sharedState.mainWindow.focus()
      sharedState.mainWindow.webContents.send('execute-quick-action', payload)
    }
  })

  ipcMain.on('quick-panel-hide', () => {
    if (sharedState.quickPanelWindow && !sharedState.quickPanelWindow.isDestroyed()) {
      sharedState.quickPanelWindow.hide()
    }
  })
}
