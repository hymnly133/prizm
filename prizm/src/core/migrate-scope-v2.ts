/**
 * Scope 存储结构迁移脚本 V2
 * 1. 应用级：evermemos.db/evermemos_vec -> .prizm-data/memory/，evermemos.db -> search-index.db
 * 2. Scope 级：notes/documents/todo/groups -> prizm_type + .prizm/ 新结构
 *
 * 执行: node dist/core/migrate-scope-v2.js 或 tsx src/core/migrate-scope-v2.ts
 */

import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import Database from 'better-sqlite3'
import { getConfig } from '../config'
import {
  getSessionDir,
  getSessionFilePath,
  getSessionSummaryPath,
  getScopeMemoryDbPath,
  ensureScopeMemoryDir
} from './PathProviderCore'

const EXT = '.md'
const PRIZM_DIR = '.prizm'
const SCOPES_DIR = 'scopes'
const MEMORY_DIR = 'memory'
const REGISTRY_FILENAME = 'scope-registry.json'
const EVERMEMOS_DB = 'evermemos.db'
const EVERMEMOS_VEC = 'evermemos_vec'
const SEARCH_INDEX_DB = 'search-index.db'

const DEFAULT_TYPES_JSON = {
  types: {
    prizm_type: 'select',
    tags: 'tags',
    status: 'select',
    taskId: 'text',
    sourceApp: 'text',
    title: 'text',
    llmSummary: 'text', // @deprecated 兼容存量数据索引
    createdAt: 'number',
    updatedAt: 'number'
  },
  selectOptions: {
    prizm_type: [
      'note',
      'document',
      'todo_list',
      'pomodoro_session',
      'clipboard_item',
      'agent_session'
    ],
    status: ['todo', 'doing', 'done']
  }
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown'
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

const MEMORIES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    content TEXT,
    user_id TEXT,
    group_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    metadata JSON
  );
  CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
`
const SEARCH_INDEX_SCHEMA = `
  CREATE TABLE IF NOT EXISTS search_index (
    scope TEXT PRIMARY KEY,
    mini_search_blob TEXT NOT NULL,
    by_id_blob TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`

/** 应用级存储迁移：记忆 DB、向量库、搜索索引（供服务端启动时自动执行） */
export function migrateAppLevelStorage(dataDir: string): void {
  const dir = path.resolve(dataDir)
  const memoryDir = path.join(dir, MEMORY_DIR)
  const oldEvermemosDb = path.join(dir, EVERMEMOS_DB)
  const oldEvermemosVec = path.join(dir, EVERMEMOS_VEC)
  const newEvermemosDb = path.join(memoryDir, EVERMEMOS_DB)
  const newEvermemosVec = path.join(memoryDir, EVERMEMOS_VEC)
  const searchIndexDb = path.join(dir, SEARCH_INDEX_DB)

  let migrated = false

  if (fs.existsSync(oldEvermemosDb) || fs.existsSync(oldEvermemosVec)) {
    ensureDir(memoryDir)
  }

  if (fs.existsSync(oldEvermemosDb)) {
    if (!fs.existsSync(newEvermemosDb)) {
      fs.copyFileSync(oldEvermemosDb, newEvermemosDb)
      console.log('Migrated evermemos.db -> memory/evermemos.db')
      migrated = true
    }
    if (!fs.existsSync(searchIndexDb)) {
      fs.copyFileSync(oldEvermemosDb, searchIndexDb)
      console.log('Migrated evermemos.db -> search-index.db')
      migrated = true
    }
  }

  if (fs.existsSync(oldEvermemosVec)) {
    const stat = fs.statSync(oldEvermemosVec)
    if (stat.isDirectory()) {
      if (!fs.existsSync(newEvermemosVec)) {
        fs.cpSync(oldEvermemosVec, newEvermemosVec, { recursive: true })
        console.log('Migrated evermemos_vec/ -> memory/evermemos_vec/')
        migrated = true
      }
    } else {
      if (!fs.existsSync(newEvermemosVec)) {
        fs.copyFileSync(oldEvermemosVec, newEvermemosVec)
        console.log('Migrated evermemos_vec -> memory/evermemos_vec')
        migrated = true
      }
    }
  }

  migrateGlobalMemoryToLevels(dir)
  if (migrated) {
    console.log('App-level storage migration done')
  }
}

/**
 * 将全局 evermemos.db 拆分为 user.db（PROFILE）+ 各 scope 的 scope.db
 * 向量数据不迁移，后续重建
 */
function migrateGlobalMemoryToLevels(dataDir: string): void {
  const memoryDir = path.join(dataDir, MEMORY_DIR)
  const sourceDbPath = path.join(memoryDir, EVERMEMOS_DB)
  if (!fs.existsSync(sourceDbPath)) return

  const userDbPath = path.join(dataDir, MEMORY_DIR, 'user.db')
  if (path.resolve(userDbPath) !== path.resolve(sourceDbPath) && fs.existsSync(userDbPath)) {
    return
  }

  let db: Database.Database
  try {
    db = new Database(sourceDbPath, { readonly: true })
  } catch (e) {
    console.warn('Cannot open source memory db for split:', e)
    return
  }

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'")
    .all()
  if (tables.length === 0) {
    db.close()
    return
  }

  const rows = db.prepare('SELECT * FROM memories').all() as Array<{
    id: string
    type: string
    content: string | null
    user_id: string | null
    group_id: string | null
    created_at: string | null
    updated_at: string | null
    metadata: string | null
  }>
  db.close()

  const profileRows = rows.filter((r) => r.group_id === null || r.group_id === '')
  const scopeRows = rows.filter((r) => r.group_id != null && r.group_id !== '')
  const scopeIds = new Set<string>()
  for (const r of scopeRows) {
    const scope = (r.group_id ?? '').split(':')[0]
    if (scope) scopeIds.add(scope)
  }

  if (profileRows.length > 0) {
    ensureDir(memoryDir)
    const userDb = new Database(userDbPath)
    userDb.exec(MEMORIES_SCHEMA)
    const insert = userDb.prepare(
      `INSERT OR REPLACE INTO memories (id, type, content, user_id, group_id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const r of profileRows) {
      insert.run(
        r.id,
        r.type,
        r.content ?? null,
        r.user_id ?? null,
        'user',
        r.created_at ?? null,
        r.updated_at ?? null,
        r.metadata ?? null
      )
    }
    userDb.close()
    console.log('Migrated PROFILE memories to user.db:', profileRows.length)
  }

  const scopesPath = path.join(dataDir, SCOPES_DIR)
  if (!fs.existsSync(scopesPath)) return

  for (const scopeId of scopeIds) {
    const scopeDir = path.join(scopesPath, scopeId)
    if (!fs.existsSync(scopeDir)) continue

    const scopeDbPath = getScopeMemoryDbPath(scopeDir)
    const prefix = scopeId + ':'
    const matching = scopeRows.filter(
      (r) => (r.group_id ?? '').startsWith(prefix) || r.group_id === scopeId
    )
    if (matching.length === 0) continue

    ensureScopeMemoryDir(scopeDir)
    const scopeDb = new Database(scopeDbPath)
    scopeDb.exec(MEMORIES_SCHEMA)
    const insert = scopeDb.prepare(
      `INSERT OR REPLACE INTO memories (id, type, content, user_id, group_id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const r of matching) {
      insert.run(
        r.id,
        r.type,
        r.content ?? null,
        r.user_id ?? null,
        r.group_id ?? null,
        r.created_at ?? null,
        r.updated_at ?? null,
        r.metadata ?? null
      )
    }
    scopeDb.close()
    console.log('Migrated scope memories to', scopeId, ':', matching.length)
  }
}

/**
 * 将 agent-sessions 下平铺的 .md 转为目录结构：{sessionId}/session.md + summary.md
 */
function migrateSessionsToFolders(scopeRoot: string): void {
  const prizmDir = path.join(scopeRoot, PRIZM_DIR)
  const sessionsDir = path.join(prizmDir, 'agent-sessions')
  if (!fs.existsSync(sessionsDir)) return

  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
  for (const e of entries) {
    if (e.isDirectory()) continue
    if (!e.name.endsWith(EXT)) continue

    const fp = path.join(sessionsDir, e.name)
    let raw: string
    try {
      raw = fs.readFileSync(fp, 'utf-8')
    } catch {
      continue
    }
    const parsed = matter(raw)
    const id = (parsed.data.id as string) || path.basename(e.name, EXT)
    if (!id) continue

    const sessionDir = getSessionDir(scopeRoot, id)
    ensureDir(sessionDir)
    const sessionFilePath = getSessionFilePath(scopeRoot, id)
    const { llmSummary, ...restData } = parsed.data as Record<string, unknown>
    const sessionFrontmatter = { ...restData, prizm_type: 'agent_session', id }
    fs.writeFileSync(
      sessionFilePath,
      matter.stringify(parsed.content, sessionFrontmatter, { lineWidth: -1 } as never)
    )
    if (typeof llmSummary === 'string' && llmSummary.trim()) {
      const summaryPath = getSessionSummaryPath(scopeRoot, id)
      fs.writeFileSync(
        summaryPath,
        matter.stringify(llmSummary.trim(), { prizm_type: 'agent_session_summary' }, {
          lineWidth: -1
        } as never)
      )
    }
    try {
      fs.unlinkSync(fp)
    } catch {}
  }
}

function moveWithPrizmType(
  srcPath: string,
  destDir: string,
  prizmType: string,
  frontmatterOverride: Record<string, unknown> = {}
): void {
  if (!fs.existsSync(srcPath)) return
  const raw = fs.readFileSync(srcPath, 'utf-8')
  const parsed = matter(raw)
  const data = { ...parsed.data, prizm_type: prizmType, ...frontmatterOverride } as Record<
    string,
    unknown
  >
  const filename = path.basename(srcPath)
  const destPath = path.join(destDir, filename)
  ensureDir(destDir)
  fs.writeFileSync(destPath, matter.stringify(parsed.content, data, { lineWidth: -1 } as never))
}

function migrateScope(scopeDir: string, scopeId: string, dataDir: string): void {
  const prizmDir = path.join(scopeDir, PRIZM_DIR)
  ensureDir(prizmDir)

  const scopeJson = {
    id: scopeId,
    label: scopeId,
    createdAt: Date.now(),
    settings: {
      defaultPrizmType: null as string | null,
      excludePatterns: ['node_modules', 'dist', '.git'],
      newItemLocation: 'root'
    }
  }
  fs.writeFileSync(path.join(prizmDir, 'scope.json'), JSON.stringify(scopeJson, null, 2), 'utf-8')
  fs.writeFileSync(
    path.join(prizmDir, 'types.json'),
    JSON.stringify(DEFAULT_TYPES_JSON, null, 2),
    'utf-8'
  )

  const usedIds = new Set<string>()

  function writeUserFile(
    subdir: string,
    prizmType: string,
    parseFn: (
      fp: string,
      content: string
    ) => { id: string; frontmatter: Record<string, unknown>; body: string } | null
  ): void {
    const srcDir = path.join(scopeDir, subdir)
    if (!fs.existsSync(srcDir)) return
    const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(EXT)) continue
      const fp = path.join(srcDir, e.name)
      const raw = fs.readFileSync(fp, 'utf-8')
      const parsed = matter(raw)
      const content = parsed.content.trim()
      const result = parseFn(fp, raw)
      if (!result) continue
      let { id } = result
      if (usedIds.has(id)) id = `${prizmType}-${id}`
      usedIds.add(id)
      const frontmatter = { ...result.frontmatter, prizm_type: prizmType, id }
      const destName = `${safeId(id)}${EXT}`
      const destPath = path.join(scopeDir, destName)
      fs.writeFileSync(
        destPath,
        matter.stringify(result.body, frontmatter, { lineWidth: -1 } as never)
      )
    }
  }

  writeUserFile('notes', 'note', (fp, raw) => {
    const p = matter(raw)
    const id = (p.data.id as string) || path.basename(fp, EXT)
    return {
      id,
      frontmatter: p.data as Record<string, unknown>,
      body: p.content
    }
  })

  writeUserFile('documents', 'document', (fp, raw) => {
    const p = matter(raw)
    const id = (p.data.id as string) || path.basename(fp, EXT)
    return {
      id,
      frontmatter: p.data as Record<string, unknown>,
      body: p.content
    }
  })

  writeUserFile('todo', 'todo_list', (fp, raw) => {
    const p = matter(raw)
    const id = (p.data.id as string) || path.basename(fp, EXT)
    return {
      id,
      frontmatter: p.data as Record<string, unknown>,
      body: p.content
    }
  })

  const systemDirs = [
    ['agent-sessions', 'agent_session'],
    ['clipboard', 'clipboard_item'],
    ['pomodoro', 'pomodoro_session']
  ] as const
  for (const [subdir, prizmType] of systemDirs) {
    const srcDir = path.join(scopeDir, subdir)
    if (!fs.existsSync(srcDir)) continue
    const destDir = path.join(prizmDir, subdir)
    ensureDir(destDir)
    const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(EXT)) continue
      moveWithPrizmType(path.join(srcDir, e.name), destDir, prizmType)
    }
  }
  migrateSessionsToFolders(scopeDir)

  const tokenUsagePath = path.join(scopeDir, 'token_usage.md')
  if (fs.existsSync(tokenUsagePath)) {
    fs.renameSync(tokenUsagePath, path.join(prizmDir, 'token_usage.md'))
  }

  const searchIndexPath = path.join(scopeDir, 'search-index.json')
  if (fs.existsSync(searchIndexPath)) {
    fs.renameSync(searchIndexPath, path.join(prizmDir, 'search-index.json'))
  }

  const oldDirs = [
    'notes',
    'documents',
    'todo',
    'groups',
    'clipboard',
    'pomodoro',
    'agent-sessions'
  ]
  for (const d of oldDirs) {
    const p = path.join(scopeDir, d)
    if (fs.existsSync(p)) {
      try {
        fs.rmSync(p, { recursive: true })
      } catch {
        // ignore
      }
    }
  }
}

/** 当 .prizm 已存在但仍有旧子目录时，将其扁平化到新结构 */
function migrateOldSubdirsToFlat(scopeDir: string): void {
  const prizmDir = path.join(scopeDir, PRIZM_DIR)
  if (!fs.existsSync(prizmDir)) return

  const usedIds = new Set<string>()
  const ensurePrizmDir = () => {
    if (!fs.existsSync(prizmDir)) fs.mkdirSync(prizmDir, { recursive: true })
  }

  function flattenUserDir(subdir: string, prizmType: string): void {
    const srcDir = path.join(scopeDir, subdir)
    if (!fs.existsSync(srcDir)) return
    const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(EXT)) continue
      const fp = path.join(srcDir, e.name)
      const raw = fs.readFileSync(fp, 'utf-8')
      const parsed = matter(raw)
      const id = (parsed.data.id as string) || path.basename(fp, EXT)
      const destId = usedIds.has(id) ? `${prizmType}-${id}` : id
      usedIds.add(destId)
      const frontmatter = { ...parsed.data, prizm_type: prizmType, id: destId }
      const destPath = path.join(scopeDir, `${safeId(destId)}${EXT}`)
      fs.writeFileSync(
        destPath,
        matter.stringify(parsed.content, frontmatter, { lineWidth: -1 } as never)
      )
    }
  }

  function moveSystemDir(subdir: string, prizmType: string): void {
    const srcDir = path.join(scopeDir, subdir)
    if (!fs.existsSync(srcDir)) return
    const destDir = path.join(prizmDir, subdir)
    ensurePrizmDir()
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(EXT)) continue
      moveWithPrizmType(path.join(srcDir, e.name), destDir, prizmType)
    }
  }

  flattenUserDir('notes', 'note')
  flattenUserDir('documents', 'document')
  flattenUserDir('todo', 'todo_list')
  moveSystemDir('agent-sessions', 'agent_session')
  moveSystemDir('clipboard', 'clipboard_item')
  moveSystemDir('pomodoro', 'pomodoro_session')
  migrateSessionsToFolders(scopeDir)

  const tokenUsagePath = path.join(scopeDir, 'token_usage.md')
  if (fs.existsSync(tokenUsagePath) && !fs.existsSync(path.join(prizmDir, 'token_usage.md'))) {
    fs.renameSync(tokenUsagePath, path.join(prizmDir, 'token_usage.md'))
  }

  const searchIndexPath = path.join(scopeDir, 'search-index.json')
  if (fs.existsSync(searchIndexPath) && !fs.existsSync(path.join(prizmDir, 'search-index.json'))) {
    fs.renameSync(searchIndexPath, path.join(prizmDir, 'search-index.json'))
  }

  const oldDirs = [
    'notes',
    'documents',
    'todo',
    'groups',
    'clipboard',
    'pomodoro',
    'agent-sessions'
  ]
  for (const d of oldDirs) {
    const p = path.join(scopeDir, d)
    if (fs.existsSync(p)) {
      try {
        fs.rmSync(p, { recursive: true })
      } catch {
        // ignore
      }
    }
  }
}

export function runMigration(dataDir?: string): void {
  const dir = path.resolve(dataDir ?? getConfig().dataDir)
  console.log('Migration data dir:', dir)

  migrateAppLevelStorage(dir)

  const scopesPath = path.join(dir, SCOPES_DIR)
  if (!fs.existsSync(scopesPath)) {
    console.log('No scopes directory found, scope migration skipped')
    console.log('Migration complete')
    return
  }

  const backupDir = `${scopesPath}.backup-${Date.now()}`
  console.log('Backing up to', backupDir)
  fs.cpSync(scopesPath, backupDir, { recursive: true })

  const entries = fs.readdirSync(scopesPath, { withFileTypes: true })
  const scopeDirs = entries.filter((e) => e.isDirectory())
  if (scopeDirs.length === 0) {
    console.log('No scope directories to migrate')
    return
  }

  const hasOldSubdir = (scopeDir: string) =>
    ['notes', 'documents', 'todo', 'clipboard', 'agent-sessions', 'pomodoro'].some((d) =>
      fs.existsSync(path.join(scopeDir, d))
    )

  for (const e of scopeDirs) {
    const scopeId = e.name
    const scopeDir = path.join(scopesPath, scopeId)
    const hasPrizmDir = fs.existsSync(path.join(scopeDir, PRIZM_DIR))
    const hasOld = hasOldSubdir(scopeDir)
    if (hasPrizmDir && !hasOld) {
      migrateSessionsToFolders(scopeDir)
      console.log('Skip (already migrated):', scopeId)
      continue
    }
    if (hasPrizmDir && hasOld) {
      console.log('Flatten remaining old dirs:', scopeId)
      migrateOldSubdirsToFlat(scopeDir)
      continue
    }
    console.log('Migrating scope:', scopeId)
    migrateScope(scopeDir, scopeId, dir)
  }

  const registryPath = path.join(dir, REGISTRY_FILENAME)
  if (!fs.existsSync(registryPath)) {
    const scopes: Record<
      string,
      { path: string; label: string; builtin: boolean; createdAt: number }
    > = {}
    const now = Date.now()
    for (const e of scopeDirs) {
      const id = e.name
      const relPath = path.join(SCOPES_DIR, id)
      scopes[id] = {
        path: relPath,
        label: id,
        builtin: id === 'default' || id === 'online',
        createdAt: now
      }
    }
    fs.writeFileSync(registryPath, JSON.stringify({ version: 1, scopes }, null, 2), 'utf-8')
    console.log('Created scope-registry.json')
  }

  console.log('Migration complete')
}

const isMain = process.argv[1]?.includes('migrate-scope-v2')
if (isMain) {
  const dataDir = process.argv[2]
  runMigration(dataDir)
}
