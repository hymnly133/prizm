/**
 * Prizm Tauri 客户端主入口
 */

import { PrizmWebSocketClient } from './websocket/connection'
import { NotificationHandler } from './notification/handler'
import type { WebSocketConfig, NotificationPayload } from './types'
import { invoke } from '@tauri-apps/api/core'
import type { PrizmConfig } from './types'

// Tauri 命令类型定义
interface LoadConfigResult {
  ok: boolean
  data?: PrizmConfig
}

interface RegisterResult {
  ok: boolean
  data?: string
  error?: string
}

interface TestConnectionResult {
  ok: boolean
  data?: boolean
  error?: string
}

// 全局状态
let wsClient: PrizmWebSocketClient | null = null
let currentConfig: PrizmConfig | null = null

/**
 * UI 更新函数
 */
function updateStatus(status: string, color: string = 'text-gray-600'): void {
  const statusEl = document.getElementById('status')
  const statusIcon = document.getElementById('status-icon')
  if (statusEl) {
    statusEl.textContent = status
    statusEl.className = `text-lg font-semibold ${color}`
  }
  if (statusIcon) {
    statusIcon.innerHTML = getIconHtml(color)
  }
}

function getIconHtml(color: string): string {
  const iconColor = color.includes('green')
    ? '#10b981'
    : color.includes('red')
    ? '#ef4444'
    : color.includes('blue')
    ? '#3b82f6'
    : '#6b7280'

  return `<svg class="w-6 h-6 inline-block" fill="none" stroke="${iconColor}" stroke-width="2" viewBox="0 0 24 24">
    ${color.includes('green')
      ? '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7M12 14l9-9" />'
      : color.includes('red')
      ? '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12M18 6L6 18" />'
      : color.includes('blue')
      ? '<circle cx="12" cy="12" r="10" /><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0l3 3m-3-3l3 3m-6-3l3 3" />'
      : '<circle cx="12" cy="12" r="10" stroke-dasharray="4 4" />'}
  </svg>`
}

function addLog(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info'): void {
  const logEl = document.getElementById('logs')
  if (!logEl) return

  const logItem = document.createElement('div')
  const timestamp = new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  const colorClass = {
    info: 'text-blue-600 bg-blue-50/50',
    success: 'text-green-600 bg-green-50/50',
    error: 'text-red-600 bg-red-50/50',
    warning: 'text-amber-600 bg-amber-50/50'
  }[type]

  logItem.className = `px-3 py-2 rounded ${colorClass}`
  logItem.innerHTML = `
    <span class="text-gray-400 text-xs font-mono mr-2">[${timestamp}]</span>
    <span class="font-medium">${message}</span>
  `

  logEl.insertBefore(logItem, logEl.firstChild)

  // 保持最多 50 条日志
  while (logEl.children.length > 50) {
    logEl.removeChild(logEl.lastChild!)
  }
}

function showNotification(title: string, body?: string): void {
  addLog(`通知: ${title}`, 'info')
}

/**
 * 加载配置
 */
async function loadConfig(): Promise<PrizmConfig | null> {
  try {
    const result = await invoke<LoadConfigResult>('load_config')
    if (result.ok && result.data) {
      return result.data
    }
    return null
  } catch (error) {
    addLog(`加载配置失败: ${error}`, 'error')
    return null
  }
}

/**
 * 保存配置
 */
async function saveConfig(config: PrizmConfig): Promise<boolean> {
  try {
    await invoke('save_config', { config })
    return true
  } catch (error) {
    addLog(`保存配置失败: ${error}`, 'error')
    return false
  }
}

/**
 * 测试服务器连接
 */
async function testConnection(serverUrl: string): Promise<boolean> {
  try {
    const result = await invoke<TestConnectionResult>('test_connection', { serverUrl })
    return result.data ?? false
  } catch (error) {
    addLog(`连接测试失败: ${error}`, 'error')
    return false
  }
}

/**
 * 注册客户端
 */
async function registerClient(
  serverUrl: string,
  clientName: string,
  scopes: string[]
): Promise<string | null> {
  try {
    updateStatus('注册中...', 'text-blue-600')
    const result = await invoke<RegisterResult>('register_client', {
      serverUrl,
      name: clientName,
      requestedScopes: scopes
    })

    if (result.ok && result.data) {
      addLog('客户端注册成功', 'success')
      return result.data
    } else {
      throw new Error(result.error || '注册失败')
    }
  } catch (error) {
    addLog(`注册失败: ${error}`, 'error')
    return null
  }
}

/**
 * 初始化 WebSocket 客户端
 */
async function initializeWebSocket(config: PrizmConfig): Promise<void> {
  try {
    // 清理旧连接
    if (wsClient) {
      wsClient.disconnect()
    }

    const wsConfig: WebSocketConfig = {
      host: config.server.host,
      port: parseInt(config.server.port, 10),
      apiKey: config.api_key
    }

    // 创建新客户端
    wsClient = new PrizmWebSocketClient(wsConfig)

    // 注册事件处理器
    wsClient.on('connected', (msg) => {
      updateStatus('已连接', 'text-green-600')
      addLog(`WebSocket 已连接 - Client ID: ${msg.clientId}`, 'success')
    })

    wsClient.on('disconnected', () => {
      updateStatus('连接断开', 'text-amber-600')
      addLog('WebSocket 已断开连接', 'warning')
    })

    wsClient.on('error', (error) => {
      updateStatus('连接错误', 'text-red-600')
      addLog(`错误: ${error.message}`, 'error')
    })

    wsClient.on('notification', async (payload: NotificationPayload) => {
      showNotification(payload.title, payload.body)
      try {
        await NotificationHandler.show(payload)
      } catch (err) {
        addLog(`显示通知失败: ${err}`, 'error')
      }
    })

    // 连接
    await wsClient.connect()
  } catch (error) {
    console.error('[Prizm Client] Failed to initialize:', error)
    updateStatus('初始化失败', 'text-red-600')
    addLog(`初始化失败: ${error}`, 'error')
  }
}

/**
 * 构建服务器 URL
 */
function buildServerUrl(host: string, port: string): string {
  return `${host}:${port}`
}

/**
 * 显示配置面板
 */
function showConfigPanel(): void {
  const panel = document.getElementById('config-panel') as HTMLElement
  if (panel) {
    panel.classList.remove('hidden')
  }

  // 如果没有配置，预填充开发环境默认值
  if (!currentConfig) {
    const hostInput = document.getElementById('host-input') as HTMLInputElement
    const portInput = document.getElementById('port-input') as HTMLInputElement
    const nameInput = document.getElementById('client-name-input') as HTMLInputElement
    const scopesInput = document.getElementById('scopes-input') as HTMLInputElement

    if (hostInput) hostInput.value = '127.0.0.1'
    if (portInput) portInput.value = '4127'
    if (nameInput) nameInput.value = 'Prizm Dev Client'
    if (scopesInput) scopesInput.value = 'default'
  }
}

/**
 * 隐藏配置面板
 */
function hideConfigPanel(): void {
  const panel = document.getElementById('config-panel') as HTMLElement
  if (panel) {
    panel.classList.add('hidden')
  }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  addLog('Prizm 通知客户端启动', 'info')

  const config = await loadConfig()
  if (!config) {
    addLog('正在初始化默认配置', 'warning')
    showConfigPanel()
    return
  }

  currentConfig = config

  // 更新 UI 显示
  const serverDisplay = document.getElementById('server-display')
  const clientIdDisplay = document.getElementById('client-id-display')
  const scopesDisplay = document.getElementById('scopes-display')
  const apiKeySection = document.getElementById('api-key-section') as HTMLElement
  const apiKeyDisplay = document.getElementById('api-key-display') as HTMLInputElement

  if (serverDisplay) {
    serverDisplay.textContent = `${config.server.host}:${config.server.port}`
  }
  if (clientIdDisplay) {
    clientIdDisplay.textContent = config.client.name || '-'
  }
  if (scopesDisplay) {
    const scopesText = config.client.requested_scopes.length > 0
      ? config.client.requested_scopes.join(', ')
      : 'default'
    scopesDisplay.textContent = scopesText
  }

  // 检查是否有 API Key
  if (!config.api_key || config.api_key.length === 0) {
    updateStatus('等待配置', 'text-amber-600')
    addLog('需要注册客户端获取 API Key', 'warning')
    showConfigPanel()
    return
  }

  // 显示 API Key
  if (apiKeyDisplay && apiKeySection) {
    apiKeySection.classList.remove('hidden')
    apiKeyDisplay.value = config.api_key
  }

  // 初始化 WebSocket
  updateStatus('连接中...', 'text-blue-600')
  await initializeWebSocket(config)
}

/**
 * 设置事件监听器
 */
function setupEventListeners(): void {
  // 填充配置表单
  if (currentConfig) {
    const hostInput = document.getElementById('host-input') as HTMLInputElement
    const portInput = document.getElementById('port-input') as HTMLInputElement
    const nameInput = document.getElementById('client-name-input') as HTMLInputElement
    const scopesInput = document.getElementById('scopes-input') as HTMLInputElement

    if (hostInput) hostInput.value = currentConfig.server.host
    if (portInput) portInput.value = currentConfig.server.port
    if (nameInput) nameInput.value = currentConfig.client.name
    if (scopesInput) {
      scopesInput.value = currentConfig.client.requested_scopes.join(', ')
    }
  }

  // 配置面板保存
  const saveBtn = document.getElementById('save-config-btn')
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const hostInput = document.getElementById('host-input') as HTMLInputElement
      const portInput = document.getElementById('port-input') as HTMLInputElement
      const nameInput = document.getElementById('client-name-input') as HTMLInputElement
      const scopesInput = document.getElementById('scopes-input') as HTMLInputElement

      const host = hostInput.value.trim()
      const port = portInput.value.trim()
      const name = nameInput.value.trim()
      const scopesText = scopesInput.value.trim()
      const scopes = scopesText
        ? scopesText.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : ['default']

      if (!host || !port) {
        addLog('请填写服务器地址和端口', 'error')
        return
      }

      if (!name) {
        addLog('请填写客户端名称', 'error')
        return
      }

      if (currentConfig) {
        currentConfig.server.host = host
        currentConfig.server.port = port
        currentConfig.client.name = name
        currentConfig.client.requested_scopes = scopes

        const saved = await saveConfig(currentConfig)
        if (saved) {
          addLog('配置已保存', 'success')
          hideConfigPanel()
        }
      }
    })
  }

  // 测试连接按钮
  const testBtn = document.getElementById('test-connection-btn')
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const hostInput = document.getElementById('host-input') as HTMLInputElement
      const portInput = document.getElementById('port-input') as HTMLInputElement

      const host = hostInput.value.trim()
      const port = portInput.value.trim()
      const serverUrl = buildServerUrl(host, port)

      if (!host || !port) {
        addLog('请填写服务器地址和端口', 'error')
        return
      }

      testBtn.disabled = true
      testBtn.textContent = '测试中...'

      const success = await testConnection(serverUrl)

      testBtn.disabled = false
      testBtn.textContent = '测试连接'

      if (success) {
        addLog('服务器连接成功', 'success')
      } else {
        addLog('无法连接到服务器', 'error')
      }
    })
  }

  // 注册客户端按钮
  const registerBtn = document.getElementById('register-client-btn')
  if (registerBtn) {
    registerBtn.addEventListener('click', async () => {
      const hostInput = document.getElementById('host-input') as HTMLInputElement
      const portInput = document.getElementById('port-input') as HTMLInputElement
      const nameInput = document.getElementById('client-name-input') as HTMLInputElement
      const scopesInput = document.getElementById('scopes-input') as HTMLInputElement

      const host = hostInput.value.trim()
      const port = portInput.value.trim()
      const name = nameInput.value.trim()
      const scopesText = scopesInput.value.trim()
      const scopes = scopesText
        ? scopesText.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : ['default']

      if (!host || !port) {
        addLog('请填写服务器地址和端口', 'error')
        return
      }

      if (!name) {
        addLog('请填写客户端名称', 'error')
        return
      }

      const serverUrl = buildServerUrl(host, port)
      registerBtn.disabled = true
      registerBtn.textContent = '注册中...'

      const apiKey = await registerClient(serverUrl, name, scopes)

      registerBtn.disabled = false
      registerBtn.textContent = '注册客户端'

      if (apiKey) {
        if (currentConfig) {
          currentConfig.server.host = host
          currentConfig.server.port = port
          currentConfig.client.name = name
          currentConfig.api_key = apiKey
          currentConfig.client.requested_scopes = scopes

          await saveConfig(currentConfig)

          // 填充 API Key 输入框
          const apiKeyInput = document.getElementById('api-key-display') as HTMLInputElement
          if (apiKeyInput) {
            apiKeyInput.value = apiKey
          }

          hideConfigPanel()
        }
      }
    })
  }

  // 重新连接按钮
  const reconnectBtn = document.getElementById('reconnect-btn')
  if (reconnectBtn) {
    reconnectBtn.addEventListener('click', async () => {
      if (!currentConfig) {
        addLog('没有配置可用的服务器', 'error')
        return
      }

      reconnectBtn.disabled = true
      updateStatus('重新连接中...', 'text-blue-600')
      await initializeWebSocket(currentConfig)
      reconnectBtn.disabled = false
    })
  }

  // 打开仪表板
  const dashboardBtn = document.getElementById('open-dashboard-btn')
  if (dashboardBtn) {
    dashboardBtn.addEventListener('click', async () => {
      if (!currentConfig) {
        addLog('没有配置可用的服务器', 'error')
        return
      }

      const serverUrl = buildServerUrl(currentConfig.server.host, currentConfig.server.port)
      try {
        await invoke('open_dashboard', { serverUrl })
        addLog('已打开仪表板', 'success')
      } catch (error) {
        addLog(`打开仪表板失败: ${error}`, 'error')
      }
    })
  }

  // 配置按钮
  const configBtn = document.getElementById('config-btn')
  if (configBtn) {
    configBtn.addEventListener('click', () => {
      showConfigPanel()
    })
  }

  // 关闭配置面板
  const closePanelBtn = document.getElementById('close-panel-btn')
  if (closePanelBtn) {
    closePanelBtn.addEventListener('click', () => {
      hideConfigPanel()
    })
  }
}

// 应用启动时初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 获取应用版本
  try {
    const version = await invoke<string>('get_app_version')
    const versionEl = document.getElementById('app-version')
    if (versionEl) {
      versionEl.textContent = `v${version}`
    }
  } catch (error) {
    console.error('Failed to get app version:', error)
  }

  main().catch((error) => {
    console.error('[Prizm Client] Fatal error:', error)
    addLog(`致命错误: ${error}`, 'error')
  })

  setupEventListeners()
})
