#!/usr/bin/env node
/**
 * 模拟 Vue/Electron 客户端的 scope 行为
 * 复现 useFileList + currentScope 的调用逻辑
 *
 * 用法: node scripts/scope-test-vue-sim.mjs [baseUrl] [apiKey]
 */

const BASE_URL = (process.argv[2] || 'http://127.0.0.1:4127').replace(/\/+$/, '')
let API_KEY = process.argv[3] || process.env.PRIZM_API_KEY || ''

async function register() {
  const res = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'scope-vue-sim',
      requestedScopes: ['default', 'online', '*']
    })
  })
  if (!res.ok) throw new Error(`Register failed: ${res.status}`)
  const data = await res.json()
  return data.apiKey
}

// 模拟 PrizmClient.listNotes / listTasks / listDocuments 的请求逻辑
function buildHeaders(scope, defaultScope = 'online') {
  const resolvedScope = scope ?? defaultScope
  const headers = {
    'Content-Type': 'application/json',
    'X-Prizm-Scope': resolvedScope
  }
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`
  return headers
}

function buildUrl(path, query = {}) {
  const url = new URL(path, BASE_URL)
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, v)
  }
  return url.toString()
}

async function listNotes(options = {}) {
  const scope = options.scope ?? 'online'
  const url = buildUrl('/notes', {
    q: options.q,
    groupId: options.groupId,
    scope
  })
  const res = await fetch(url, { method: 'GET', headers: buildHeaders(scope) })
  if (!res.ok) throw new Error(`listNotes: ${res.status}`)
  const data = await res.json()
  return data.notes
}

async function listTasks(options = {}) {
  const scope = options.scope ?? 'online'
  const query = { scope }
  if (options.status) query.status = options.status
  const url = buildUrl('/todo', query)
  const res = await fetch(url, { method: 'GET', headers: buildHeaders(scope) })
  if (!res.ok) throw new Error(`listTasks: ${res.status}`)
  const data = await res.json()
  return data.tasks
}

async function listDocuments(options = {}) {
  const scope = options.scope ?? 'online'
  const url = buildUrl('/documents', { scope })
  const res = await fetch(url, { method: 'GET', headers: buildHeaders(scope) })
  if (!res.ok) throw new Error(`listDocuments: ${res.status}`)
  const data = await res.json()
  return data.documents
}

// 模拟 refreshFileList(scope)
async function refreshFileList(scope) {
  const [notes, tasks, documents] = await Promise.all([
    listNotes({ scope }),
    listTasks({ scope }),
    listDocuments({ scope })
  ])
  return { notes, tasks, documents }
}

async function run() {
  console.log('=== 模拟 Vue 客户端 scope 测试 ===\n')
  console.log('Base URL:', BASE_URL)

  if (!API_KEY) {
    API_KEY = await register()
    console.log('已注册获取 API Key\n')
  }

  console.log('--- 模拟 refreshFileList(scope) 调用 ---\n')

  // 模拟 currentScope = "online" 后切换为 "default"
  console.log("1. refreshFileList('online')")
  const onlineData = await refreshFileList('online')
  console.log(
    `   notes: ${onlineData.notes.length}, tasks: ${onlineData.tasks.length}, documents: ${onlineData.documents.length}`
  )

  console.log("\n2. refreshFileList('default')")
  const defaultData = await refreshFileList('default')
  console.log(
    `   notes: ${defaultData.notes.length}, tasks: ${defaultData.tasks.length}, documents: ${defaultData.documents.length}`
  )

  console.log("\n2. 再次 refreshFileList('online')")
  const onlineData2 = await refreshFileList('online')
  console.log(
    `   notes: ${onlineData2.notes.length}, tasks: ${onlineData2.tasks.length}, documents: ${onlineData2.documents.length}`
  )

  if (onlineData.notes.length === defaultData.notes.length && defaultData.notes.length > 0) {
    console.log('\n⚠️  online 与 default 返回相同数量，若 default 应有更多数据则异常')
  } else {
    console.log('\n✓ 按 scope 正确返回不同数据')
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
