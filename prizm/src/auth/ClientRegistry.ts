/**
 * Prizm ClientRegistry - 客户端注册与 API Key 校验
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { ClientRecord } from '../types'

const DEFAULT_DATA_DIR = path.join(process.cwd(), '.prizm-data')
const CLIENTS_FILE = 'clients.json'

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
    const dir = dataDir ?? DEFAULT_DATA_DIR
    this.dataPath = path.join(dir, CLIENTS_FILE)
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
      for (const r of arr) {
        this.clients.set(r.clientId, r)
      }
    } catch (e) {
      console.error('[Prizm ClientRegistry] Failed to load:', e)
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
