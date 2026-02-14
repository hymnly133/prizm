#!/usr/bin/env node
/**
 * Scope 客户端测试脚本
 * 使用 @prizm/client-core 的 HTTP 逻辑，验证客户端请求的 scope 是否正确
 *
 * 用法: node scripts/scope-test-client.mjs [baseUrl] [apiKey]
 * 默认: http://127.0.0.1:4127
 *
 * 需要: 1) 服务端已启动  2) 有有效的 API Key（或 PRIZM_AUTH_DISABLED=1）
 */

const BASE_URL = (process.argv[2] || 'http://127.0.0.1:4127').replace(/\/+$/, '')
const API_KEY = process.argv[3] || process.env.PRIZM_API_KEY || ''

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
  console.log('=== Prizm Scope 客户端模拟测试 ===\n')
  console.log('Base URL:', BASE_URL)
  console.log('API Key:', API_KEY ? '(已设置)' : '(未设置，需 PRIZM_AUTH_DISABLED=1)')

  console.log('\n--- 模拟客户端: listNotes / listTasks / listDocuments ---\n')

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

      console.log(`  listXxx({ scope: 'default' }) => ${defaultCount} 条`)
      console.log(`  listXxx({ scope: 'online' })  => ${onlineCount} 条`)

      if (defaultCount === onlineCount && defaultCount > 0) {
        const defaultIds = (defaultData[key] || defaultData)
          .map((x) => x.id)
          .sort()
          .join(',')
        const onlineIds = (onlineData[key] || onlineData)
          .map((x) => x.id)
          .sort()
          .join(',')
        if (defaultIds === onlineIds) {
          console.log('  ⚠️  客户端请求不同 scope 但返回相同数据，服务端可能未按 scope 隔离')
        }
      } else {
        console.log('  ✓ 客户端按 scope 正确获取不同数据')
      }
    } catch (e) {
      console.error('  错误:', e.message)
    }
  }

  console.log('\n=== 客户端模拟测试完成 ===\n')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
