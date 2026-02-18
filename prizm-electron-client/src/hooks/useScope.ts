/**
 * useScope - Scope 管理与选择
 *
 * 底层委托给 ScopeContext，全应用共享同一份状态。
 * 所有已有的 import { useScope } from '../hooks/useScope' 无需修改。
 */
export { useScopeContext as useScope } from '../context/ScopeContext'
export type { ScopeContextValue, ScopeDetail } from '../context/ScopeContext'
