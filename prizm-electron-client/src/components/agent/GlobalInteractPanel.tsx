/**
 * GlobalInteractPanel — 全局交互审批面板（占位条 + 展开内容）
 *
 * 不再内联弹出，而是在标题栏与内容区之间固定占位：
 * - 无待审批时：占位条折叠显示，保留空间
 * - 有待审批时：展开显示审批内容，并支持「查看来源」跳转到对应会话
 *
 * 遵循 ui-ux-pro-max：44px 最小触控、焦点环、键盘可访问、过渡 150–300ms
 */
import { memo, useCallback, useState } from 'react'
import { ShieldCheck, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { getToolDisplayName } from '@prizm/client-core'
import { useFirstPendingInteract } from '../../events/agentBackgroundStore'
import { useScope } from '../../hooks/useScope'
import { useAgentSessionStore, PLAYGROUND_SESSION_ID } from '../../store/agentSessionStore'
import { InteractActionPanel } from './InteractActionPanel'

const PANEL_COLLAPSED_HEIGHT = 40

export interface GlobalInteractPanelProps {
  onNavigateToAgent: () => void
  onNavigateToSession?: (sessionId: string) => void
}

function useSessionTitle(sessionId: string | null): string {
  return useAgentSessionStore((s) => {
    if (!sessionId) return ''
    const session = s.sessions.find((sess) => sess.id === sessionId)
    if (!session) return sessionId.slice(0, 8)
    const summary = session.llmSummary?.trim()
    if (summary) return summary.slice(0, 32) + (summary.length > 32 ? '…' : '')
    const firstUser = session.messages?.find((m) => m.role === 'user')
    if (firstUser) {
      const text = typeof firstUser.parts?.[0] === 'object' && firstUser.parts?.[0] && 'content' in firstUser.parts[0]
        ? String((firstUser.parts[0] as { content?: string }).content ?? '').trim()
        : ''
      return text.slice(0, 24) + (text.length > 24 ? '…' : '') || sessionId.slice(0, 8)
    }
    return sessionId.slice(0, 8)
  })
}

export const GlobalInteractPanel = memo(function GlobalInteractPanel({
  onNavigateToAgent,
  onNavigateToSession
}: GlobalInteractPanelProps) {
  const first = useFirstPendingInteract()
  const { currentScope } = useScope()
  const [collapsed, setCollapsed] = useState(false)

  const sessionTitle = useSessionTitle(first?.sessionId ?? null)
  const respondToInteract = useAgentSessionStore((s) => s.respondToInteract)
  const loadSession = useAgentSessionStore((s) => s.loadSession)
  const switchSession = useAgentSessionStore((s) => s.switchSession)

  const handleRespond = useCallback(
    async (requestId: string, approved: boolean, paths?: string[]) => {
      if (!first) return
      await respondToInteract(first.sessionId, requestId, approved, currentScope, paths)
    },
    [first, respondToInteract, currentScope]
  )

  const handleViewSource = useCallback(() => {
    if (!first) return
    onNavigateToAgent()
    if (onNavigateToSession) {
      onNavigateToSession(first.sessionId)
    } else {
      loadSession(first.sessionId, currentScope).then(() => {
        switchSession(first.sessionId)
      })
    }
  }, [first, onNavigateToAgent, onNavigateToSession, loadSession, switchSession, currentScope])

  const hasPending = first != null

  if (!hasPending) return null

  return (
    <section
      className="global-interact-strip"
      aria-label="待审批操作"
      style={{
        height: !collapsed ? 'auto' : PANEL_COLLAPSED_HEIGHT
      }}
    >
      <div className="global-interact-strip__inner">
        <>
            <button
              type="button"
              className="global-interact-strip__toggle"
              onClick={() => setCollapsed((c) => !c)}
              aria-expanded={!collapsed}
              aria-controls="global-interact-panel-content"
            >
              <ShieldCheck size={14} aria-hidden />
              <span>
                {getToolDisplayName(first.interact.toolName)} 待审批
                {sessionTitle && ` · ${sessionTitle}`}
              </span>
              {collapsed ? (
                <ChevronDown size={14} aria-hidden />
              ) : (
                <ChevronUp size={14} aria-hidden />
              )}
            </button>

            {!collapsed && (
              <div
                id="global-interact-panel-content"
                className="global-interact-strip__content"
                role="region"
                aria-label="审批操作详情"
              >
                <div className="global-interact-strip__source">
                  <span className="global-interact-strip__source-label">来源</span>
                  <span className="global-interact-strip__source-value">
                    {first.sessionId === PLAYGROUND_SESSION_ID
                      ? 'Playground 模拟'
                      : `${sessionTitle || first.sessionId.slice(0, 8)} · ${first.interact.toolName}`}
                  </span>
                  {first.sessionId !== PLAYGROUND_SESSION_ID && (
                    <button
                      type="button"
                      className="global-interact-strip__view-source"
                      onClick={handleViewSource}
                      title="跳转到该会话"
                    >
                      <ExternalLink size={12} aria-hidden />
                      <span>查看来源</span>
                    </button>
                  )}
                </div>
                <InteractActionPanel
                  pendingInteract={first.interact}
                  onRespond={handleRespond}
                />
              </div>
            )}
        </>
      </div>
    </section>
  )
})
