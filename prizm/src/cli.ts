#!/usr/bin/env node

/**
 * Prizm Server CLI
 *
 * Usage:
 *   node cli.js [port] [--host <host>] [--port <port>] [--open]
 *
 * Env:
 *   PRIZM_PORT, PRIZM_HOST, PRIZM_DATA_DIR, PRIZM_AUTH_DISABLED
 *   从 .env 加载（支持项目根目录或 prizm 目录）
 *
 * Example:
 *   node cli.js
 *   node cli.js 5000
 *   node cli.js --host 0.0.0.0
 *   node cli.js --open   # 启动后自动打开浏览器到 Dashboard
 *   PRIZM_AUTH_DISABLED=1 yarn start
 */

import path from 'path'
import { exec } from 'child_process'
import { config as loadDotenv } from 'dotenv'

// 加载 .env：1) 当前工作目录 2) 项目根目录（monorepo 场景，根目录 .env 优先）
loadDotenv()
loadDotenv({ path: path.resolve(process.cwd(), '..', '.env'), override: true })

import { createPrizmServer, createDefaultAdapters } from './index'
import { getConfig } from './config'

const args = process.argv.slice(2)
const cfg = getConfig()
let port = cfg.port
let host = cfg.host
let openBrowser = false

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--host' || args[i] === '-H') {
    host = args[++i] || cfg.host
  } else if (args[i] === '--port' || args[i] === '-p') {
    port = parseInt(args[++i]) || cfg.port
  } else if (args[i] === '--open' || args[i] === '-o') {
    openBrowser = true
  } else if (/^\d+$/.test(args[i])) {
    port = parseInt(args[i])
  }
}

/** 使用系统默认浏览器打开 URL（跨平台） */
function openUrl(url: string): void {
  const safe = url.replace(/"/g, '')
  const cmd =
    process.platform === 'win32'
      ? `start "" "${safe}"`
      : process.platform === 'darwin'
      ? `open "${safe}"`
      : `xdg-open "${safe}"`
  exec(cmd, (err) => {
    if (err) console.warn('无法打开浏览器:', err.message)
  })
}

async function main(): Promise<void> {
  console.log('🎯 Prizm Server CLI\n')

  const adapters = createDefaultAdapters()
  const server = createPrizmServer(adapters, {
    port,
    host,
    authEnabled: cfg.authEnabled
  })

  try {
    await server.start()
    const addr = server.getAddress()
    if (!addr) throw new Error('Server address not available')
    console.log(`✅ Server running at ${addr}`)
    console.log(`   Dashboard: ${addr}/dashboard/`)
    console.log(`   桌面客户端：在客户端「设置」中使用上述地址与端口（默认 127.0.0.1:4127）\n`)
    if (openBrowser) {
      openUrl(`${addr}/dashboard/`)
    }
  } catch (error) {
    console.error('❌ Failed to start:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  const shutdown = async (): Promise<void> => {
    console.log('\n\n👋 Shutting down...')
    await server.stop()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((error) => {
  console.error('💥 Fatal error:', error)
  process.exit(1)
})
