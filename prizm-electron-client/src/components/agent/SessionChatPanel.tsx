/**
 * SessionChatPanel — 单会话聊天面板
 *
 * 从 AgentPage 提取出来，通过 useSessionChat() 零 props 消费会话数据。
 * 每个实例管理自己的滚动状态，配合 KeepAlive 池实现 O(1) 会话切换。
 */
import { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { ActionIcon, ActionIconGroup, Markdown } from '@lobehub/ui'
import { ChatList, type ChatMessage } from '@lobehub/ui/chat'
import type { ChatActionsBarProps } from '@lobehub/ui/chat'
import { Modal, message } from 'antd'
import { motion, AnimatePresence } from 'motion/react'
import { Copy, Edit, RotateCw, Undo2, Check, X } from 'lucide-react'
import type { MessagePart, MessagePartTool, SessionCheckpoint } from '@prizm/client-core'
import { ToolCallCard } from './ToolCallCard'
import { ToolCallBadge } from './ToolCallBadge'
import { ToolGroup } from './ToolGroup'
import { AssistantMessageExtra } from './AssistantMessageExtra'
import { ReasoningBlock } from './ReasoningBlock'
import { ThinkingDots } from './ThinkingDots'
import { InteractActionPanel } from './InteractActionPanel'
import { ScrollToBottom } from './ScrollToBottom'
import { useSessionChat } from '../../context/SessionChatContext'
import { useAgentSessionStore } from '../../store/agentSessionStore'
import { EASE_SMOOTH } from '../../theme/motionPresets'

/* ── 按角色区分的 ActionBar（统一操作入口） ── */

function UserActionsBar(props: ChatActionsBarProps & ChatMessage) {
  const { onActionClick, extra } = props
  const checkpoint = (extra as { checkpoint?: SessionCheckpoint } | undefined)?.checkpoint
  const items = [
    { icon: Edit, key: 'editAndResend', label: '编辑' },
    ...(checkpoint ? [{ icon: Undo2, key: 'rollback', label: '回退' }] : []),
    { icon: Copy, key: 'copy', label: '复制' }
  ]
  return <ActionIconGroup items={items} menu={items} onActionClick={onActionClick} />
}

function AssistantActionsBar(props: ChatActionsBarProps & ChatMessage) {
  const { onActionClick } = props
  const items = [
    { icon: RotateCw, key: 'regenerate', label: '重新生成' },
    { icon: Copy, key: 'copy', label: '复制' }
  ]
  return <ActionIconGroup items={items} menu={items} onActionClick={onActionClick} />
}

/* ── 用户消息内联编辑器 ── */

function UserMessageEditor({
  content,
  onConfirm,
  onCancel
}: {
  content: string
  onConfirm: (newContent: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${e.target.scrollHeight}px`
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (value.trim()) onConfirm(value)
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    },
    [value, onConfirm, onCancel]
  )

  return (
    <div className="user-message-editor">
      <textarea
        ref={textareaRef}
        className="user-message-editor__textarea"
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        rows={1}
      />
      <div className="user-message-editor__actions">
        <ActionIcon
          icon={Check}
          size="small"
          title="确认编辑并重新发送 (Enter)"
          onClick={() => value.trim() && onConfirm(value)}
        />
        <ActionIcon icon={X} size="small" title="取消 (Esc)" onClick={onCancel} />
      </div>
    </div>
  )
}

/**
 * Group consecutive tool parts into runs for compact ToolGroup rendering.
 * Returns mixed segments: { type: 'text', ... } or { type: 'tool-group', tools: [...] }
 */
type MessagePartText = Extract<MessagePart, { type: 'text' }>

type PartSegment =
  | { kind: 'text'; part: MessagePartText; index: number }
  | { kind: 'tool'; part: MessagePartTool; index: number }
  | { kind: 'tool-group'; tools: MessagePartTool[]; startIndex: number }

function groupPartsForCompact(parts: MessagePart[]): PartSegment[] {
  const segments: PartSegment[] = []
  let toolRun: MessagePartTool[] = []
  let toolRunStart = 0

  const flushToolRun = () => {
    if (toolRun.length === 0) return
    if (toolRun.length >= 2) {
      const allDone = toolRun.every((t) => (t.status ?? 'done') === 'done')
      if (allDone) {
        segments.push({ kind: 'tool-group', tools: [...toolRun], startIndex: toolRunStart })
      } else {
        for (const t of toolRun) segments.push({ kind: 'tool', part: t, index: toolRunStart })
      }
    } else {
      segments.push({ kind: 'tool', part: toolRun[0], index: toolRunStart })
    }
    toolRun = []
  }

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.type === 'text') {
      flushToolRun()
      segments.push({ kind: 'text', part: p as MessagePartText, index: i })
    } else {
      if (toolRun.length === 0) toolRunStart = i
      toolRun.push(p as MessagePartTool)
    }
  }
  flushToolRun()
  return segments
}

const AssistantPartsMessage = memo(function AssistantPartsMessage({
  parts
}: {
  parts: MessagePart[]
}) {
  const compact = useAgentSessionStore((s) => s.toolCardCompact)

  if (!compact) {
    return (
      <div className="assistant-message-by-parts">
        {parts.map((p, i) =>
          p.type === 'text' ? (
            <div key={`text-${i}`} className="assistant-part-text">
              <Markdown>{p.content}</Markdown>
            </div>
          ) : (
            <ToolCallCard key={p.id} tc={p as MessagePartTool} />
          )
        )}
      </div>
    )
  }

  const segments = groupPartsForCompact(parts)

  return (
    <div className="assistant-message-by-parts">
      {segments.map((seg) => {
        if (seg.kind === 'text') {
          return (
            <div key={`text-${seg.index}`} className="assistant-part-text">
              <Markdown>{seg.part.content}</Markdown>
            </div>
          )
        }
        if (seg.kind === 'tool-group') {
          return (
            <ToolGroup
              key={`tg-${seg.startIndex}`}
              tools={seg.tools}
            />
          )
        }
        return <ToolCallCard key={seg.part.id} tc={seg.part} />
      })}
    </div>
  )
})

export const SessionChatPanel = memo(function SessionChatPanel() {
  const _renderStart = performance.now()
  const ctx = useSessionChat()
  const {
    active,
    session,
    sessionId,
    sending,
    thinking,
    pendingInteract,
    chatData,
    messagesContainerRef,
    messagesEndRef,
    showScrollBtn,
    scrollToBottom,
    handleMessagesScroll,
    rollbackToCheckpoint,
    editingMessageId,
    setEditingMessageId,
    editAndResend,
    regenerate
  } = ctx

  const renderActionsObj = useMemo(
    () => ({
      user: UserActionsBar,
      assistant: AssistantActionsBar
    }),
    []
  )

  const handleActionsClick = useCallback(
    (action: { key: string }, msg: ChatMessage) => {
      if (sending) return
      switch (action.key) {
        case 'editAndResend':
          setEditingMessageId(msg.id)
          break
        case 'regenerate':
          regenerate(msg.id)
          break
        case 'rollback': {
          const cp = (msg.extra as { checkpoint?: SessionCheckpoint } | undefined)?.checkpoint
          if (!cp) break
          const fileCount = cp.fileChanges?.length ?? 0
          Modal.confirm({
            title: '回退到此消息之前',
            content:
              fileCount > 0
                ? `将撤销后续所有消息，并恢复 ${fileCount} 个被修改的文件。`
                : '将撤销后续所有消息。',
            okText: '确认回退',
            cancelText: '取消',
            okButtonProps: { danger: true },
            onOk: async () => {
              try {
                await rollbackToCheckpoint(cp.id, true)
                message.success('已回退到此 checkpoint')
              } catch {
                message.error('回退失败')
              }
            }
          })
          break
        }
        case 'copy':
          break
      }
    },
    [sending, setEditingMessageId, regenerate, rollbackToCheckpoint]
  )

  const handleEditConfirm = useCallback(
    (messageId: string, newContent: string) => {
      editAndResend(messageId, newContent)
    },
    [editAndResend]
  )

  const handleEditCancel = useCallback(() => {
    setEditingMessageId(null)
  }, [setEditingMessageId])

  const renderMessagesObj = useMemo(
    () => ({
      default: (props: ChatMessage & { editableContent: React.ReactNode }) =>
        props.editableContent ?? null,
      user: (props: ChatMessage & { editableContent: React.ReactNode }) => {
        if (editingMessageId === props.id) {
          return (
            <UserMessageEditor
              content={props.content ?? ''}
              onConfirm={(newContent) => handleEditConfirm(props.id, newContent)}
              onCancel={handleEditCancel}
            />
          )
        }
        return props.editableContent ?? null
      },
      assistant: (props: ChatMessage & { editableContent: React.ReactNode }) => {
        const extra = props.extra as {
          parts?: MessagePart[]
          reasoning?: string
          streaming?: boolean
        } | undefined
        const parts = extra?.parts
        const reasoning = extra?.reasoning
        const isStreaming = !!extra?.streaming

        const hasReasoning = !!reasoning?.trim()
        const hasContent = Array.isArray(parts) && parts.length > 0
          ? true
          : !!props.content?.trim?.()

        return (
          <>
            {hasReasoning && (
              <ReasoningBlock
                reasoning={reasoning!}
                streaming={isStreaming && !hasContent}
              />
            )}
            {hasContent && Array.isArray(parts) && parts.length > 0 ? (
              <AssistantPartsMessage parts={parts} />
            ) : (
              props.editableContent ?? null
            )}
          </>
        )
      }
    }),
    [editingMessageId, handleEditConfirm, handleEditCancel]
  )

  const renderMessagesExtraObj = useMemo(
    () => ({
      assistant: AssistantMessageExtra
    }),
    []
  )

  const lastMsg = chatData[chatData.length - 1]
  const lastExtra = lastMsg?.extra as { parts?: MessagePart[] } | undefined
  const lastMsgHasContent =
    !!lastMsg?.content?.trim?.() || (Array.isArray(lastExtra?.parts) && lastExtra!.parts.length > 0)
  const loadingId =
    sending && chatData.length > 0 && (!lastMsgHasContent || thinking)
      ? chatData[chatData.length - 1].id
      : undefined

  const _renderEnd = performance.now()
  console.log(
    `[perf] SessionChatPanel render(${sessionId.slice(0, 8)}) %c${(
      _renderEnd - _renderStart
    ).toFixed(1)}ms`,
    'color:#00BCD4;font-weight:bold',
    { active, msgs: chatData.length }
  )

  return (
    <div
      className="agent-messages"
      ref={messagesContainerRef}
      onScroll={handleMessagesScroll}
      style={{ position: 'relative' }}
    >
      <ChatList
        data={chatData}
        variant="bubble"
        showAvatar
        showTitle
        loadingId={loadingId}
        renderActions={renderActionsObj}
        renderMessages={renderMessagesObj}
        renderMessagesExtra={renderMessagesExtraObj}
        onActionsClick={handleActionsClick}
      />

      <AnimatePresence>
        {pendingInteract && sending && (
          <motion.div
            key="interact-panel"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: EASE_SMOOTH }}
            style={{ padding: '8px 48px' }}
          >
            <InteractActionPanel
              pendingInteract={pendingInteract}
              onRespond={ctx.respondToInteract}
            />
          </motion.div>
        )}
        {thinking && sending && !pendingInteract && (
          <motion.div
            key="thinking-indicator"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
            style={{ padding: '8px 48px' }}
          >
            <ThinkingDots label="AI 正在生成工具参数…" />
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={messagesEndRef} />
      <ScrollToBottom visible={showScrollBtn} onClick={scrollToBottom} />
    </div>
  )
})
