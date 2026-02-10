#!/usr/bin/env node

/**
 * Prizm Server CLI
 *
 * Usage:
 *   node cli.js [port] [--host <host>]
 *
 * Example:
 *   node cli.js
 *   node cli.js 5000
 *   node cli.js --host 0.0.0.0
 *   yarn start -- --host 0.0.0.0
 */

const { createPrizmServer, createDefaultAdapters } = require('./dist/index.js')

const args = process.argv.slice(2)
let port = 4127
let host = '127.0.0.1'

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--host' || args[i] === '-H') {
    host = args[++i] || '127.0.0.1'
  } else if (args[i] === '--port' || args[i] === '-p') {
    port = parseInt(args[++i]) || 4127
  } else if (/^\d+$/.test(args[i])) {
    port = parseInt(args[i])
  }
}

async function main() {
  console.log('🎯 Prizm Server CLI\n')

  const adapters = createDefaultAdapters()
  const authDisabled = process.env.PRIZM_AUTH_DISABLED === '1'
  const server = createPrizmServer(adapters, {
    port,
    host,
    enableCors: true,
    authEnabled: !authDisabled
  })

  try {
    await server.start()
    const addr = server.getAddress()
    console.log(`✅ Server running at ${addr}`)
    console.log(`   Dashboard: ${addr}/dashboard/\n`)
  } catch (error) {
    console.error('❌ Failed to start:', error.message)
    process.exit(1)
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n\n👋 Shutting down...')
    await server.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error('💥 Fatal error:', error)
  process.exit(1)
})
