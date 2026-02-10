/**
 * Prizm Server 独立运行示例
 *
 * 运行方式：
 * cd prizm
 * node example.js
 */

const { createPrizmServer, createDefaultAdapters } = require('./dist/index.js')

async function main() {
  console.log('🚀 Starting Prizm Server example...\n')

  // 创建默认适配器
  const adapters = createDefaultAdapters()

  // 创建服务器
  const server = createPrizmServer(adapters, {
    port: 4127,
    host: '127.0.0.1',
    enableCors: true
  })

  // 启动服务器
  try {
    await server.start()
    console.log(`✅ Prizm Server is running at ${server.getAddress()}`)
    console.log('\n📖 Try these commands:\n')
    console.log('  curl http://127.0.0.1:4127/health')
    console.log(
      '  curl -X POST http://127.0.0.1:4127/notes -H "Content-Type: application/json" -d \'{"content":"test"}\''
    )
    console.log('  curl http://127.0.0.1:4127/notes')
    console.log(
      '  curl -X POST http://127.0.0.1:4127/notify -H "Content-Type: application/json" -d \'{"title":"hi","body":"world"}\''
    )
    console.log('\n  Press Ctrl+C to stop\n')
  } catch (error) {
    console.error('❌ Failed to start server:', error)
    process.exit(1)
  }

  // 优雅退出
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Stopping server...')
    await server.stop()
    console.log('✅ Server stopped')
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('\n\n🛑 Stopping server...')
    await server.stop()
    console.log('✅ Server stopped')
    process.exit(0)
  })
}

main().catch((error) => {
  console.error('❌ Error:', error)
  process.exit(1)
})
