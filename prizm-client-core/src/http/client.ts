/**
 * PrizmClient — HTTP API 客户端基类
 *
 * 各领域方法通过 mixin 模式在 ./mixins/ 下按领域拆分，
 * 通过 declaration merging + prototype assignment 合并到本类。
 * 对外 API 保持不变。
 */

import type { PrizmConfig } from '../types'
import { PrizmWebSocketClient } from '../websocket/connection'
import type { WebSocketConfig } from '../types'

export interface PrizmClientOptions {
  /**
   * 服务器基础地址，例如 http://127.0.0.1:4127
   */
  baseUrl: string
  /**
   * API Key，用于访问受保护接口
   */
  apiKey?: string
  /**
   * 默认 scope，不传则为 default
   */
  defaultScope?: string
}

export interface HttpRequestOptions extends RequestInit {
  scope?: string
}

export class PrizmClient {
  /** @internal */
  readonly baseUrl: string
  /** @internal */
  readonly apiKey?: string
  /** @internal */
  readonly defaultScope: string

  constructor(options: PrizmClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.apiKey = options.apiKey
    this.defaultScope = options.defaultScope ?? 'default'
  }

  // ============ WebSocket ============

  /**
   * 基于 PrizmConfig 创建 WebSocket 客户端（快捷方式）
   */
  createWebSocketClientFromConfig(config: PrizmConfig): PrizmWebSocketClient {
    const wsConfig: WebSocketConfig = {
      host: config.server.host,
      port: parseInt(config.server.port, 10),
      apiKey: config.api_key
    }
    return new PrizmWebSocketClient(wsConfig)
  }

  /**
   * 创建 WebSocket 客户端
   */
  createWebSocketClient(config: WebSocketConfig): PrizmWebSocketClient {
    return new PrizmWebSocketClient(config)
  }

  // ============ HTTP 基础封装 ============

  /** @internal */
  buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(path, this.baseUrl)
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value)
        }
      }
    }
    return url.toString()
  }

  /** @internal */
  buildHeaders(): Headers {
    const headers = new Headers()
    headers.set('Content-Type', 'application/json')
    if (this.apiKey) {
      headers.set('Authorization', `Bearer ${this.apiKey}`)
    }
    return headers
  }

  /** @internal */
  async request<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
    const { scope, ...init } = options
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const method = (init.method ?? 'GET').toUpperCase()

    let url: string
    let body = init.body
    if (scope !== undefined) {
      url = this.buildUrl(normalizedPath, { scope })
      if (method !== 'GET' && method !== 'DELETE') {
        if (body && typeof body === 'string') {
          try {
            const parsed = JSON.parse(body) as Record<string, unknown>
            parsed.scope = scope
            body = JSON.stringify(parsed)
          } catch {
            // 非 JSON body 忽略
          }
        } else if (!body) {
          body = JSON.stringify({ scope })
        }
      }
    } else {
      url = this.buildUrl(normalizedPath)
    }

    const headers = this.buildHeaders()
    if (init.headers) {
      const extra = new Headers(init.headers as HeadersInit)
      extra.forEach((value, key) => {
        headers.set(key, value)
      })
    }

    const response = await fetch(url, {
      ...init,
      body,
      headers
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }

    // 某些 204 响应用不到 body
    if (response.status === 204) {
      return undefined as unknown as T
    }

    return (await response.json()) as T
  }
}
