#!/usr/bin/env node
/**
 * Scope 隔离测试脚本
 * 直接测试服务端 API，验证 scope 参数是否生效
 *
 * 用法: node scripts/scope-test.mjs [baseUrl]
 * 默认: http://127.0.0.1:4127
 *
 * 需要: 1) 服务端已启动  2) 有有效的 API Key（或 PRIZM_AUTH_DISABLED=1）
 */

const BASE_URL = (process.argv[2] || 'http://127.0.0.1:4127').replace(/\/+$/, '')

// 从环境变量或先注册获取 API Key；PRIZM_AUTH_DISABLED=1 时可不传
let API_KEY = process.env.PRIZM_API_KEY || ''

async function register() {
  const res = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'scope-test-client',
      requestedScopes: ['default', 'online', '*']
    })
  })
  if (!res.ok) {
    throw new Error(`Register failed: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  return data.apiKey
}

async function fetchWithScope(path, scope, method = 'GET') {
  const url = new URL(path, BASE_URL)
  url.searchParams.set('scope', scope)

  const headers = {
    'Content-Type': 'application/json',
    'X-Prizm-Scope': scope
  }
  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`
  }

  const res = await fetch(url.toString(), { method, headers })
  if (!res.ok) {
    throw new Error(`${path}?scope=${scope} => ${res.status} ${await res.text()}`)
  }
  return res.json()
}

async function run() {
  console.log('=== Prizm Scope 隔离测试 ===\n')
  console.log('Base URL:', BASE_URL)

  // 1. 健康检查
  try {
    const health = await fetch(`${BASE_URL}/health`).then((r) => r.json())
    console.log('Health:', health.status || 'ok')
  } catch (e) {
    console.error('无法连接服务端，请确保已启动 (yarn dev 或 yarn start):', e.message)
    process.exit(1)
  }

  // 2. 获取 API Key（如需鉴权）
  if (!API_KEY) {
    try {
      API_KEY = await register()
      console.log('已注册获取 API Key')
    } catch (e) {
      if (process.env.PRIZM_AUTH_DISABLED === '1') {
        console.log('PRIZM_AUTH_DISABLED=1，跳过鉴权')
      } else {
        console.error('需要 API Key。请设置 PRIZM_API_KEY 或 PRIZM_AUTH_DISABLED=1')
        console.error('或先启动服务后运行: PRIZM_AUTH_DISABLED=1 node scripts/scope-test.mjs')
        process.exit(1)
      }
    }
  }

  console.log('\n--- 服务端 API 直接测试（fetch + ?scope= + X-Prizm-Scope）---\n')

  const endpoints = [
    ['/notes', 'notes'],
    ['/todo', 'todo'],
    ['/documents', 'documents']
  ]

  for (const [path, key] of endpoints) {
    console.log(`\n${path}:`)
    try {
      const defaultData = await fetchWithScope(path, 'default')
      const onlineData = await fetchWithScope(path, 'online')

      const defaultCount = (defaultData[key] || defaultData).length
      const onlineCount = (onlineData[key] || onlineData).length

      console.log(`  scope=default: ${defaultCount} 条`)
      console.log(`  scope=online:  ${onlineCount} 条`)

      if (defaultCount === onlineCount && defaultData === onlineData) {
        console.log('  ⚠️  两个 scope 返回数据相同，可能未按 scope 隔离')
      } else {
        console.log('  ✓ scope 隔离正常')
      }
    } catch (e) {
      console.error('  错误:', e.message)
    }
  }

  console.log('\n=== 测试完成 ===\n')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
