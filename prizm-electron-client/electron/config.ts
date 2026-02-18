import { app } from 'electron'
import type { BrowserWindow, Tray } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import log from 'electron-log/main'

export type ThemeMode = 'auto' | 'light' | 'dark'

export interface PrizmConfig {
  server: { host: string; port: string; is_dev?: string }
  client: { name: string; auto_register: string; requested_scopes: string[] }
  api_key: string
  tray: {
    enabled: string
    minimize_to_tray: string
    show_notification: string
  }
  notify_events?: string[]
  /** 用户手动选择的主题模式，持久化以便主进程启动时读取 */
  themeMode?: ThemeMode
}

export interface NotificationQueueItem {
  title?: string
  body?: string
  source?: string
  updateId?: string
  eventType?: string
  payload?: unknown
}

/** Shared state used by windowManager, trayManager, ipcHandlers, etc. */
export const sharedState: {
  mainWindow: BrowserWindow | null
  notificationWindow: BrowserWindow | null
  quickPanelWindow: BrowserWindow | null
  tray: Tray | null
  isQuitting: boolean
  trayEnabled: boolean
  minimizeToTray: boolean
  notificationQueue: NotificationQueueItem[]
} = {
  mainWindow: null,
  notificationWindow: null,
  quickPanelWindow: null,
  tray: null,
  isQuitting: false,
  trayEnabled: true,
  minimizeToTray: true,
  notificationQueue: []
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
export async function loadConfigFromDisk(): Promise<PrizmConfig> {
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
export async function saveConfigToDisk(config: PrizmConfig): Promise<void> {
  const { configDir, configPath } = getConfigPath()
  await fs.promises.mkdir(configDir, { recursive: true })
  const content = JSON.stringify(config, null, 2)
  await fs.promises.writeFile(configPath, content, 'utf-8')
}

/**
 * 加载持久化的主题模式（供主进程在创建窗口前使用）
 */
export async function loadThemeMode(): Promise<ThemeMode> {
  try {
    const config = await loadConfigFromDisk()
    const mode = config.themeMode
    if (mode === 'light' || mode === 'dark' || mode === 'auto') return mode
  } catch {}
  return 'auto'
}

/**
 * 保存主题模式到配置文件
 */
export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  try {
    const config = await loadConfigFromDisk()
    config.themeMode = mode
    await saveConfigToDisk(config)
  } catch (err) {
    log.warn('[Electron] Failed to save theme mode:', err)
  }
}

/**
 * 预加载托盘相关配置
 */
export async function loadTraySettings(): Promise<void> {
  try {
    const config = await loadConfigFromDisk()
    const trayConfig = config.tray || {}
    sharedState.trayEnabled = trayConfig.enabled !== 'false'
    sharedState.minimizeToTray = trayConfig.minimize_to_tray !== 'false'
  } catch (err) {
    log.warn('[Electron] Failed to load tray settings, using defaults:', err)
    sharedState.trayEnabled = true
    sharedState.minimizeToTray = true
  }
}
