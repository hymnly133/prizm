#!/usr/bin/env node

/**
 * clean-data.mjs — 可复用的数据清理脚本
 *
 * 用法:
 *   node scripts/clean-data.mjs [选项]
 *
 * 选项:
 *   --memory     清除所有记忆数据（用户级 + scope 级 memory 目录）
 *   --token      清除 token 统计数据（token_usage.db）
 *   --sessions   清除所有会话数据（各 scope 下的 agent-sessions 目录）
 *   --audit      清除审计日志（agent_audit.db）
 *   --search     清除搜索索引（search-index.db）
 *   --locks      清除资源锁（resource_locks.db）
 *   --all        清除以上全部
 *   --dry-run    仅打印将要删除的内容，不实际删除
 *
 * 示例:
 *   node scripts/clean-data.mjs --memory --token
 *   node scripts/clean-data.mjs --all --dry-run
 *   node scripts/clean-data.mjs --sessions
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── 配置 ───────────────────────────────────────────────
const DATA_DIR = path.resolve(__dirname, '..', process.env.PRIZM_DATA_DIR || '.prizm-data')

// ─── 参数解析 ───────────────────────────────────────────
const args = new Set(process.argv.slice(2).map((a) => a.toLowerCase()))

if (args.size === 0 || args.has('--help') || args.has('-h')) {
  console.log(`
  clean-data.mjs — Prizm 数据清理工具

  用法: node scripts/clean-data.mjs [选项]

  选项:
    --memory     清除记忆数据（用户级 + 各 scope memory 目录）
    --token      清除 token 统计数据（token_usage.db）
    --sessions   清除会话数据（各 scope 下 agent-sessions）
    --audit      清除审计日志（agent_audit.db）
    --search     清除搜索索引（search-index.db）
    --locks      清除资源锁（resource_locks.db）
    --all        清除以上全部
    --dry-run    仅预览，不实际删除
    --help       显示此帮助
  `)
  process.exit(0)
}

const isAll = args.has('--all')
const dryRun = args.has('--dry-run')
const cleanMemory = isAll || args.has('--memory')
const cleanToken = isAll || args.has('--token')
const cleanSessions = isAll || args.has('--sessions')
const cleanAudit = isAll || args.has('--audit')
const cleanSearch = isAll || args.has('--search')
const cleanLocks = isAll || args.has('--locks')

if (!cleanMemory && !cleanToken && !cleanSessions && !cleanAudit && !cleanSearch && !cleanLocks) {
  console.error(
    '错误: 请指定至少一个清理选项（--memory / --token / --sessions / --audit / --search / --locks / --all）'
  )
  process.exit(1)
}

// ─── 工具函数 ───────────────────────────────────────────

let deletedCount = 0

function removeFile(filePath, label) {
  if (!fs.existsSync(filePath)) return
  if (dryRun) {
    console.log(`  [dry-run] 删除文件: ${filePath}`)
  } else {
    try {
      fs.unlinkSync(filePath)
      console.log(`  ✓ 已删除: ${filePath}`)
      deletedCount++
    } catch (e) {
      console.warn(`  ✗ 删除失败 ${filePath}: ${e.message}`)
    }
  }
}

function removeDir(dirPath, label) {
  if (!fs.existsSync(dirPath)) return
  if (dryRun) {
    const count = countItems(dirPath)
    console.log(`  [dry-run] 删除目录: ${dirPath} (${count} 项)`)
  } else {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true })
      console.log(`  ✓ 已删除目录: ${dirPath}`)
      deletedCount++
    } catch (e) {
      console.warn(`  ✗ 删除失败 ${dirPath}: ${e.message}`)
    }
  }
}

function removeSqliteDb(basePath, label) {
  removeFile(basePath, label)
  removeFile(basePath + '-shm', label + ' (shm)')
  removeFile(basePath + '-wal', label + ' (wal)')
  removeFile(basePath + '-journal', label + ' (journal)')
}

function countItems(dirPath) {
  try {
    let count = 0
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      count++
      if (entry.isDirectory()) {
        count += countItems(path.join(dirPath, entry.name))
      }
    }
    return count
  } catch {
    return 0
  }
}

function getScopeRoots() {
  const scopesDir = path.join(DATA_DIR, 'scopes')
  if (!fs.existsSync(scopesDir)) return []
  return fs
    .readdirSync(scopesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('__test'))
    .map((d) => path.join(scopesDir, d.name))
}

// ─── 执行清理 ───────────────────────────────────────────

console.log(`\n📂 数据目录: ${DATA_DIR}`)
if (dryRun) console.log('🔍 预览模式（不会实际删除）\n')
else console.log('')

if (!fs.existsSync(DATA_DIR)) {
  console.log('数据目录不存在，无需清理。')
  process.exit(0)
}

// 1) 记忆数据
if (cleanMemory) {
  console.log('── 记忆数据 ──')
  // 用户级记忆
  const userMemDir = path.join(DATA_DIR, 'memory')
  removeDir(userMemDir, '用户级记忆目录')

  // Scope 级记忆
  for (const scopeRoot of getScopeRoots()) {
    const scopeMemDir = path.join(scopeRoot, '.prizm', 'memory')
    removeDir(scopeMemDir, `scope 记忆 (${path.basename(scopeRoot)})`)
  }
  console.log('')
}

// 2) Token 统计
if (cleanToken) {
  console.log('── Token 统计 ──')
  removeSqliteDb(path.join(DATA_DIR, 'token_usage.db'), 'token_usage.db')
  console.log('')
}

// 3) 会话数据
if (cleanSessions) {
  console.log('── 会话数据 ──')
  for (const scopeRoot of getScopeRoots()) {
    const sessionsDir = path.join(scopeRoot, '.prizm', 'agent-sessions')
    removeDir(sessionsDir, `agent-sessions (${path.basename(scopeRoot)})`)
  }
  console.log('')
}

// 4) 审计日志
if (cleanAudit) {
  console.log('── 审计日志 ──')
  removeSqliteDb(path.join(DATA_DIR, 'agent_audit.db'), 'agent_audit.db')
  console.log('')
}

// 5) 搜索索引
if (cleanSearch) {
  console.log('── 搜索索引 ──')
  removeSqliteDb(path.join(DATA_DIR, 'search-index.db'), 'search-index.db')
  console.log('')
}

// 6) 资源锁
if (cleanLocks) {
  console.log('── 资源锁 ──')
  removeSqliteDb(path.join(DATA_DIR, 'resource_locks.db'), 'resource_locks.db')
  console.log('')
}

// ─── 汇总 ───────────────────────────────────────────────
if (dryRun) {
  console.log('预览完成。使用不带 --dry-run 的命令来实际执行删除。')
} else {
  console.log(`✅ 清理完成，共删除 ${deletedCount} 项。`)
}
console.log('⚠️  提示: 清理后请重启服务器以重新初始化数据库。\n')
