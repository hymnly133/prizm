/**
 * 会话统计面板：Token 消耗（含记忆消耗明细）、记忆引用
 */
import { useMemo } from 'react'
import { Brain, Coins, Sparkles } from 'lucide-react'
import type { SessionStats } from './agentSidebarTypes'
import {
  formatToken,
  isMemoryCategory,
  TOKEN_CATEGORY_LABELS,
  TOKEN_CATEGORY_ORDER
} from './agentSidebarTypes'
import { EmptyState } from '../ui/EmptyState'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'

export interface SessionStatsPanelProps {
  currentSession: { id: string } | null
  sessionStats: SessionStats | null
  sessionStatsLoading: boolean
}

export function SessionStatsPanel({
  currentSession,
  sessionStats,
  sessionStatsLoading
}: SessionStatsPanelProps) {
  const { orderedCategories, extraCategories, memorySubtotal } = useMemo(() => {
    const byCategory = sessionStats?.tokenUsage.byCategory
    if (!byCategory || Object.keys(byCategory).length === 0) {
      return { orderedCategories: [], extraCategories: [], memorySubtotal: 0 }
    }

    const knownSet = new Set<string>(TOKEN_CATEGORY_ORDER)
    const ordered = TOKEN_CATEGORY_ORDER.filter((c) => byCategory[c])
    const extra = Object.keys(byCategory).filter((c) => !knownSet.has(c))

    let memTotal = 0
    for (const [cat, info] of Object.entries(byCategory)) {
      if (isMemoryCategory(cat)) memTotal += info.total
    }

    return {
      orderedCategories: ordered,
      extraCategories: extra,
      memorySubtotal: memTotal
    }
  }, [sessionStats?.tokenUsage.byCategory])

  if (!currentSession) {
    return <EmptyState description="选择会话后显示" />
  }
  if (sessionStatsLoading && !sessionStats) {
    return <LoadingPlaceholder />
  }

  if (!sessionStats) {
    return <EmptyState description="暂无统计" />
  }

  const byCategory = sessionStats.tokenUsage.byCategory ?? {}
  const hasCategories = orderedCategories.length > 0 || extraCategories.length > 0

  return (
    <div className="agent-session-stats">
      {/* Token 消耗 */}
      <div className="agent-stats-group">
        <span className="agent-stats-group-label">
          <Coins size={12} />
          Token 消耗
        </span>
        <div className="agent-stats-rows">
          <div className="agent-stats-row">
            <span className="agent-stats-key">合计</span>
            <span className="agent-stats-value">
              {formatToken(sessionStats.tokenUsage.totalTokens)}
            </span>
          </div>
          <div className="agent-stats-row">
            <span className="agent-stats-key">输入 / 输出</span>
            <span className="agent-stats-value agent-stats-value-secondary">
              {formatToken(sessionStats.tokenUsage.totalInputTokens)} /{' '}
              {formatToken(sessionStats.tokenUsage.totalOutputTokens)}
            </span>
          </div>
          <div className="agent-stats-row">
            <span className="agent-stats-key">对话轮次</span>
            <span className="agent-stats-value">{sessionStats.tokenUsage.rounds}</span>
          </div>

          {/* 按功能类别 */}
          {hasCategories && (
            <>
              {orderedCategories.map((c) => {
                const info = byCategory[c]!
                const isMemory = isMemoryCategory(c)
                return (
                  <div
                    key={c}
                    className={`agent-stats-row agent-stats-row-sub${
                      isMemory ? ' agent-stats-row-memory' : ''
                    }`}
                  >
                    <span className="agent-stats-key" title={TOKEN_CATEGORY_LABELS[c] ?? c}>
                      {TOKEN_CATEGORY_LABELS[c] ?? c}
                    </span>
                    <span className="agent-stats-value agent-stats-value-secondary">
                      {formatToken(info.total)} ({info.count}次)
                    </span>
                  </div>
                )
              })}
              {extraCategories.map((c) => {
                const info = byCategory[c]!
                const label = (TOKEN_CATEGORY_LABELS as Record<string, string>)[c]
                return (
                  <div key={c} className="agent-stats-row agent-stats-row-sub">
                    <span className="agent-stats-key" title={c}>
                      {label ?? c}
                    </span>
                    <span className="agent-stats-value agent-stats-value-secondary">
                      {formatToken(info.total)} ({info.count}次)
                    </span>
                  </div>
                )
              })}
            </>
          )}

          {/* 记忆消耗小计 */}
          {memorySubtotal > 0 && (
            <div className="agent-stats-row agent-stats-row-highlight">
              <span className="agent-stats-key">
                <Brain size={11} style={{ marginRight: 3, verticalAlign: -1 }} />
                记忆消耗小计
              </span>
              <span className="agent-stats-value">{formatToken(memorySubtotal)}</span>
            </div>
          )}

          {/* 按模型分组 */}
          {Object.keys(sessionStats.tokenUsage.byModel).length > 1 &&
            Object.entries(sessionStats.tokenUsage.byModel).map(([model, info]) => (
              <div key={model} className="agent-stats-row agent-stats-row-sub">
                <span className="agent-stats-key" title={model}>
                  {model.length > 18 ? `${model.slice(0, 18)}…` : model}
                </span>
                <span className="agent-stats-value agent-stats-value-secondary">
                  {formatToken(info.total)} ({info.count}次)
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* 记忆引用统计 */}
      <div className="agent-stats-group">
        <span className="agent-stats-group-label">
          <Sparkles size={12} />
          记忆引用
        </span>
        {sessionStats.memoryCreated.totalCount === 0 && sessionStats.memoryInjectedTotal === 0 ? (
          <EmptyState description="本会话暂未产生记忆引用" />
        ) : (
          <div className="agent-stats-rows">
            <div className="agent-stats-row">
              <span className="agent-stats-key">新增记忆</span>
              <span className="agent-stats-value">{sessionStats.memoryCreated.totalCount} 条</span>
            </div>
            {sessionStats.memoryCreated.ids.user.length > 0 && (
              <div className="agent-stats-row agent-stats-row-sub">
                <span className="agent-stats-key" title="用户画像 / 偏好">
                  <span style={{ color: '#faad14', marginRight: 2 }}>●</span>
                  User · 画像
                </span>
                <span className="agent-stats-value agent-stats-value-secondary">
                  {sessionStats.memoryCreated.ids.user.length}
                </span>
              </div>
            )}
            {sessionStats.memoryCreated.ids.scope.length > 0 && (
              <>
                <div className="agent-stats-row agent-stats-row-sub">
                  <span className="agent-stats-key" title="情景叙事 / 前瞻计划">
                    <span style={{ color: '#1677ff', marginRight: 2 }}>●</span>
                    Scope · 叙事/前瞻
                  </span>
                  <span className="agent-stats-value agent-stats-value-secondary">
                    {sessionStats.memoryCreated.ids.scope.length}
                  </span>
                </div>
                <div
                  className="agent-stats-row agent-stats-row-sub"
                  style={{ paddingLeft: 12, fontSize: 11, opacity: 0.75 }}
                >
                  <span className="agent-stats-key" title="含文档总览 / 文档事实 / 文档前瞻">
                    <span style={{ color: '#eb2f96', marginRight: 2 }}>●</span>
                    含文档记忆
                  </span>
                </div>
              </>
            )}
            {sessionStats.memoryCreated.ids.session.length > 0 && (
              <div className="agent-stats-row agent-stats-row-sub">
                <span className="agent-stats-key" title="本次会话原子事实">
                  <span style={{ color: '#13c2c2', marginRight: 2 }}>●</span>
                  Session · 事件日志
                </span>
                <span className="agent-stats-value agent-stats-value-secondary">
                  {sessionStats.memoryCreated.ids.session.length}
                </span>
              </div>
            )}
            <div className="agent-stats-row">
              <span className="agent-stats-key">注入上下文</span>
              <span className="agent-stats-value">{sessionStats.memoryInjectedTotal} 次</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
