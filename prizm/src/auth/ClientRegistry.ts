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
        // 迁移：仅有 default 的客户端补充 online，以支持 scope 切换
        if (
          Array.isArray(r.allowedScopes) &&
          r.allowedScopes.length === 1 &&
          r.allowedScopes[0] === 'default' &&
          !r.allowedScopes.includes(ONLINE_SCOPE)
        ) {
          r.allowedScopes = ['default', ONLINE_SCOPE]
          migrated = true
        }
        this.clients.set(r.clientId, r)
      }
      if (migrated) {
        this.save()
        log.info("Migrated clients: added 'online' scope to clients with only 'default'")
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
   * 注册新客户端
   */
  register(name: string, requestedScopes: string[]): RegisterResult {
    const clientId = generateId()
    const apiKey = generateApiKey()
    const apiKeyHash = hashApiKey(apiKey)

    const scopes = requestedScopes.length > 0 ? requestedScopes : ['default']
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
