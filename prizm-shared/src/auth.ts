/**
 * Auth / 权限相关类型
 */

export interface ClientInfo {
  clientId: string
  name: string
  allowedScopes: string[]
  createdAt: number
}

export type { ScopeDescription } from './scopes'
