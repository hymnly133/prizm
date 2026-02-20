/**
 * 上下文预算管理 — 统一导出
 */

export type {
  BudgetAllocation,
  ContextBudgetConfig,
  ContextBudgetSnapshot
} from './types'
export { TRIM_PRIORITIES } from './types'
export {
  createContextBudget,
  estimateTokens,
  BUDGET_AREAS
} from './budgetManager'
