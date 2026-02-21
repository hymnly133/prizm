/**
 * AgentChatZone — 聊天区域复合组件
 *
 * 封装 KeepAlive 池渲染、EmptyConversation、ErrorBanner、InputArea，
 * 被 AgentPage 和 AgentPane 共享，消除重复的 JSX 结构。
 */
import { memo } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { EnrichedSession } from '@prizm/client-core'
import { SessionChatProvider } from '../../context/SessionChatContext'
import { SessionChatPanel } from './SessionChatPanel'
import { EmptyConversation } from './EmptyConversation'
import { DesktopChatInput, PendingChatPayloadApplicator } from '../../features/ChatInput'
import { DRAFT_KEY_NEW, DraftCacheManager } from './chatMessageAdapter'
import { EASE_OUT_EXPO } from '../../theme/motionPresets'

export interface AgentChatZoneInputStyle {
  minHeight?: number
  borderRadius?: number
  boxShadow?: string
}

export interface AgentChatZoneProps {
  scope: string
  currentSession: EnrichedSession | null
  aliveSessionIds: string[]
  error: string | null
  loading: boolean
  onQuickPrompt: (text: string) => void
  onClear: () => void
  inputStyle?: AgentChatZoneInputStyle
  /** Extra children rendered inside the input wrap (e.g. CtrlLHandler) */
  extraInputChildren?: ReactNode
}

const DEFAULT_INPUT_STYLE: AgentChatZoneInputStyle = {
  minHeight: 88,
  borderRadius: 20,
  boxShadow: '0 12px 32px rgba(0,0,0,.04)'
}

export const AgentChatZone = memo(function AgentChatZone({
  scope,
  currentSession,
  aliveSessionIds,
  error,
  loading,
  onQuickPrompt,
  onClear,
  inputStyle = DEFAULT_INPUT_STYLE,
  extraInputChildren
}: AgentChatZoneProps) {
  const {
    minHeight = DEFAULT_INPUT_STYLE.minHeight,
    borderRadius = DEFAULT_INPUT_STYLE.borderRadius,
    boxShadow = DEFAULT_INPUT_STYLE.boxShadow
  } = inputStyle

  return (
    <>
      {/* KeepAlive pool */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {aliveSessionIds.map((id) => (
          <div
            key={id}
            style={{
              position: 'absolute',
              inset: 0,
              display: id === currentSession?.id ? 'flex' : 'none',
              flexDirection: 'column'
            }}
          >
            <SessionChatProvider sessionId={id} scope={scope} active={id === currentSession?.id}>
              <SessionChatPanel />
            </SessionChatProvider>
          </div>
        ))}
        {!currentSession && (
          <motion.div
            key="empty"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column'
            }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24, scale: 0.97 }}
            transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
          >
            <EmptyConversation onSendPrompt={onQuickPrompt} loading={loading} />
          </motion.div>
        )}
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="agent-error-banner"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input area：有当前会话时包在 SessionChatProvider 内，以便 ActionBar（如 SkillsToggle）能拿到 sessionId */}
      <div className="agent-input-wrap agent-input-floating">
        {currentSession ? (
          <SessionChatProvider sessionId={currentSession.id} scope={scope} active={true}>
            <DraftCacheManager sessionId={currentSession.id} />
            <PendingChatPayloadApplicator />
            {extraInputChildren}
            <DesktopChatInput
              onClear={onClear}
              inputContainerProps={{
                minHeight,
                style: {
                  borderRadius,
                  boxShadow,
                  transition: 'box-shadow 0.3s, border-color 0.3s'
                }
              }}
            />
          </SessionChatProvider>
        ) : (
          <>
            <DraftCacheManager sessionId={DRAFT_KEY_NEW} />
            <PendingChatPayloadApplicator />
            {extraInputChildren}
            <DesktopChatInput
              onClear={onClear}
              inputContainerProps={{
                minHeight,
                style: {
                  borderRadius,
                  boxShadow,
                  transition: 'box-shadow 0.3s, border-color 0.3s'
                }
              }}
            />
          </>
        )}
      </div>
    </>
  )
})
