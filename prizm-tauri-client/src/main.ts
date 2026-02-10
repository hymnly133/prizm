/**
 * Prizm Tauri 客户端主入口
 */

import { PrizmWebSocketClient } from './websocket/connection'
import { NotificationHandler } from './notification/handler'
import type { WebSocketConfig, NotificationPayload, ServerMessage, EventPushMessage } from './types'

// 默认配置
const DEFAULT_CONFIG: WebSocketConfig = {
  host: '127.0.0.1',
  port: 4127,
  apiKey: ''
}

/**
 * 全局 WebSocket 客户端实例
 */
let wsClient: PrizmWebSocketClient | null = null

/**
 * 加载配置
 */
function loadConfig(): WebSocketConfig {
  const savedHost = localStorage.getItem('prizm_host')
  const savedPort = localStorage.getItem('prizm_port')
  const savedApiKey = localStorage.getItem('prizm_api_key')

  return {
    host: savedHost || DEFAULT_CONFIG.host,
    port: savedPort ? parseInt(savedPort, 10) : DEFAULT_CONFIG.port,
    apiKey: savedApiKey || ''
  }
}

/**
 * 保存配置
 */
function saveConfig(config: WebSocketConfig): void {
  localStorage.setItem('prizm_host', config.host)
  localStorage.setItem('prizm_port', config.port.toString())
  if (config.apiKey) {
    localStorage.setItem('prizm_api_key', config.apiKey)
  }
}

/**
 * 检查配置完整性
 */
function hasValidConfig(): boolean {
  const config = loadConfig()
  return config.apiKey.length > 0
}

/**
 * 简单的 UI 更新函数
 */
function updateStatus(status: string, color: string = 'text-gray-600'): void {
  const statusEl = document.getElementById('status')
  if (statusEl) {
    statusEl.textContent = status
    statusEl.className = `text-lg font-semibold ${color}`
  }
}

function addLog(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
  const logEl = document.getElementById('logs')
  if (!logEl) return

  const logItem = document.createElement('div')
  const timestamp = new Date().toLocaleTimeString()

  const colorClass = {
    info: 'text-blue-600',
    success: 'text-green-600',
    error: 'text-red-600'
  }[type]

  logItem.innerHTML = `
    <span class="text-gray-400 text-sm">[${timestamp}]</span>
    <span class="${colorClass}">${message}</span>
  `

  logEl.insertBefore(logItem, logEl.firstChild)

  // 保持最多 50 条日志
  while (logEl.children.length > 50) {
    logEl.removeChild(logEl.lastChild!)
  }
}

/**
 * 初始化 WebSocket 客户端
 */
async function initializeWebSocket(config: WebSocketConfig): Promise<void> {
  try {
    // 清理旧连接
    if (wsClient) {
      wsClient.disconnect()
    }

    // 创建新客户端
    wsClient = new PrizmWebSocketClient(config)

    // 注册事件处理器
    wsClient.on('connected', (msg) => {
      updateStatus('已连接', 'text-green-600')
      addLog(`WebSocket 已连接 - Client ID: ${msg.clientId}`, 'success')
    })

    wsClient.on('disconnected', () => {
      updateStatus('连接断开', 'text-yellow-600')
      addLog('WebSocket 已断开连接', 'info')
    })

    wsClient.on('error', (error) => {
      updateStatus('连接错误', 'text-red-600')
      addLog(`错误: ${error.message}`, 'error')
    })

    wsClient.on('notification', async (payload: NotificationPayload) => {
      addLog(`收到通知: ${payload.title}`, 'info')
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
 * 主函数
 */
async function main(): Promise<void> {
  addLog('Prizm 通知客户端启动', 'info')

  const config = loadConfig()

  // 如果没有 API Key，显示配置界面
  if (!hasValidConfig()) {
    updateStatus('等待配置', 'text-yellow-600')
    addLog('请配置服务器地址和 API Key', 'info')
    showConfigDialog()
    return
  }

  // 初始化 WebSocket
  updateStatus('连接中...', 'text-blue-600')
  await initializeWebSocket(config)
}

/**
 * 显示配置对话框
 */
function showConfigDialog(): void {
  const config = loadConfig()
  const hostInput = prompt('服务器地址:', config.host)
  if (hostInput === null) return

  const portInput = prompt('端口:', config.port.toString())
  if (portInput === null) return

  const apiKeyInput = prompt('API Key:', config.apiKey)
  if (apiKeyInput === null) return

  const newConfig: WebSocketConfig = {
    host: hostInput.trim() || config.host,
    port: parseInt(portInput, 10) || config.port,
    apiKey: apiKeyInput.trim()
  }

  saveConfig(newConfig)
  addLog('配置已更新', 'success')
}

// 应用启动时初始化
document.addEventListener('DOMContentLoaded', () => {
  main().catch((error) => {
    console.error('[Prizm Client] Fatal error:', error)
    addLog(`致命错误: ${error}`, 'error')
  })

  // 设置配置按钮事件
  const configBtn = document.getElementById('config-btn')
  if (configBtn) {
    configBtn.addEventListener('click', () => {
      showConfigDialog()
    })
  }

  // 设置重新连接按钮事件
  const reconnectBtn = document.getElementById('reconnect-btn')
  if (reconnectBtn) {
    reconnectBtn.addEventListener('click', async () => {
      reconnectBtn.disabled = true
      updateStatus('重新连接中...', 'text-blue-600')
      const config = loadConfig()
      await initializeWebSocket(config)
      reconnectBtn.disabled = false
    })
  }
})
