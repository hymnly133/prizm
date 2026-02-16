/**
 * Prizm ClientRegistry - 客户端注册与 API Key 校验
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { ClientRecord } from '../types'
import { createLogger } from '../logger'
import { getConfig } from '../config'
import { ONLINE_SCOPE } from '../core/ScopeStore'
import { getClientsPath, getDataDir } from '../core/PathProviderCore'

const log = createLogger('ClientRegistry')

function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex')
}

function generateId(): string {
  return crypto.randomBytes(16).toString('hex')
}

function generateApiKey(): string {
  return `prizm_${crypto.randomBytes(32).toString('hex')}`
}

export interface RegisterResult {
  clientId: string
  apiKey: string
}

export interface ValidateResult {
  clientId: string
  allowedScopes: string[]
}

export class ClientRegistry {
  private dataPath: string
  private clients = new Map<string, ClientRecord>()

  constructor(dataDir?: string) {
    const dir = dataDir ? path.resolve(dataDir) : getDataDir()
    this.dataPath = dataDir ? path.join(dir, 'clients.json') : getClientsPath()
    this.ensureDataDir(dir)
    this.load()
  }

  private ensureDataDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  private load(): void {
    if (!fs.existsSync(this.dataPath)) {
      return
    }
    try {
      const content = fs.readFileSync(this.dataPath, 'utf-8')
      const arr = JSON.parse(content) as ClientRecord[]
      this.clients.clear()
      let migrated = false
      for (const r of arr) {
        // 迁移：online 是公共 scope，确保所有客户端都包含
        if (Array.isArray(r.allowedScopes) && !r.allowedScopes.includes(ONLINE_SCOPE)) {
          r.allowedScopes.push(ONLINE_SCOPE)
          migrated = true
        }
        this.clients.set(r.clientId, r)
      }
      if (migrated) {
        this.save()
        log.info("Migrated clients: ensured all clients have 'online' scope")
      }
    } catch (e) {
      log.error('Failed to load:', e)
    }
  }

  private save(): void {
    const arr = Array.from(this.clients.values())
    fs.writeFileSync(this.dataPath, JSON.stringify(arr, null, 2), 'utf-8')
  }

  /**
   * 按名称查找已有客户端（用于复用 clientId，避免记忆丢失）
   */
  findByName(name: string): ClientRecord | null {
    for (const record of this.clients.values()) {
      if (record.name === name) return record
    }
    return null
  }

  /**
   * 注册客户端。
   * 如果同名客户端已存在，则复用其 clientId（重新生成 apiKey、更新 scopes），
   * 避免因 clientId 变化导致记忆等用户数据丢失。
   */
  register(name: string, requestedScopes: string[]): RegisterResult {
    const scopes = requestedScopes.length > 0 ? requestedScopes : ['default']

    // 检查同名客户端是否已存在
    const existing = this.findByName(name)
    if (existing) {
      // 复用已有 clientId，只重新生成 apiKey 并更新 scopes
      const apiKey = generateApiKey()
      existing.apiKeyHash = hashApiKey(apiKey)
      existing.allowedScopes = scopes
      this.save()
      log.info(`Re-registered existing client "${name}" (clientId=${existing.clientId}), apiKey refreshed`)
      return { clientId: existing.clientId, apiKey }
    }

    // 新客户端
    const clientId = generateId()
    const apiKey = generateApiKey()
    const apiKeyHash = hashApiKey(apiKey)

    const record: ClientRecord = {
      clientId,
      apiKeyHash,
      name,
      allowedScopes: scopes,
      createdAt: Date.now()
    }
    this.clients.set(clientId, record)
    this.save()
    return { clientId, apiKey }
  }

  /**
   * 列出所有客户端（不含 apiKeyHash）
   */
  list(): Omit<ClientRecord, 'apiKeyHash'>[] {
    return Array.from(this.clients.values()).map(({ apiKeyHash: _, ...rest }) => rest)
  }

  /**
   * 为已有客户端重新生成 API Key（旧 Key 立即失效）
   */
  regenerateApiKey(clientId: string): string | null {
    const record = this.clients.get(clientId)
    if (!record) return null
    const apiKey = generateApiKey()
    record.apiKeyHash = hashApiKey(apiKey)
    this.save()
    return apiKey
  }

  /**
   * 吊销客户端
   */
  revoke(clientId: string): boolean {
    if (!this.clients.has(clientId)) return false
    this.clients.delete(clientId)
    this.save()
    return true
  }

  /**
   * 校验 API Key
   */
  validate(apiKey: string): ValidateResult | null {
    const hash = hashApiKey(apiKey)
    for (const record of this.clients.values()) {
      if (record.apiKeyHash === hash) {
        return {
          clientId: record.clientId,
          allowedScopes: record.allowedScopes
        }
      }
    }
    return null
  }
}

export const clientRegistry = new ClientRegistry()
