/**
 * Prizm WebSocket 测试客户端
 * 用于测试 WebSocket 连接和事件订阅
 */

const WebSocket = require('ws')
const readline = require('readline')

// 配置
const SERVER_URL = 'ws://127.0.0.1:4127/ws'
const API_KEY = 'prizm_test_key'

let ws: WebSocket | null = null

/**
 * 连接到 WebSocket 服务器
 */
function connect(apiKey: string): void {
  const url = `${SERVER_URL}?apiKey=${encodeURIComponent(apiKey)}`
  console.log(`\n正在连接到: ${url}`)

  ws = new WebSocket(url)

  ws.on('open', () => {
    console.log('✅ WebSocket 连接已建立')
  })

  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString())
      console.log('📨 收到消息:', JSON.stringify(message, null, 2))
    } catch (error) {
      console.error('❌ 解析消息失败:', error)
    }
  })

  ws.on('close', (code: number, reason: string) => {
    console.log(`\n🔌 WebSocket 已关闭`)
    console.log(`   Code: ${code}`)
    console.log(`   Reason: ${reason}`)
    ws = null
  })

  ws.on('error', (error: Error) => {
    console.error('❌ WebSocket 错误:', error.message)
  })
}

/**
 * 发送消息
 */
function sendMessage(data: unknown): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('❌ WebSocket 未连接')
    return
  }

  ws.send(JSON.stringify(data))
  console.log('📤 已发送:', JSON.stringify(data))
}

/**
 * 显示菜单
 */
function showMenu(): void {
  console.log('\n========== Prizm WebSocket 测试客户端 ==========')
  console.log('1. 连接服务器')
  console.log('2. 注册通知事件')
  console.log('3. 取消注册通知事件')
  console.log('4. 发送 Ping')
  console.log('5. 断开连接')
  console.log('q. 退出')
  console.log('==================================================')
  console.log('请输入选项: ')
}

// 创建 readline 接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

/**
 * 处理用户输入
 */
function handleInput(input: string): void {
  switch (input.trim()) {
    case '1':
      console.log('\n请输入 API Key (直接回车使用测试密钥): ')
      rl.question('', (apiKey: string) => {
        const key = apiKey.trim() || API_KEY
        connect(key)
        showMenu()
      })
      break

    case '2':
      sendMessage({
        type: 'register',
        eventType: 'notification'
      })
      showMenu()
      break

    case '3':
      sendMessage({
        type: 'unregister',
        eventType: 'notification'
      })
      showMenu()
      break

    case '4':
      sendMessage({ type: 'ping' })
      showMenu()
      break

    case '5':
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close()
      } else {
        console.log('❌ WebSocket 未连接')
      }
      showMenu()
      break

    case 'q':
    case 'Q':
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
      rl.close()
      console.log('\n👋 再见！')
      process.exit(0)
      break

    default:
      console.log('❌ 无效选项')
      showMenu()
  }
}

// 启动
showMenu()
rl.on('line', handleInput)
