/**
 * 卡片悬浮菜单：独立 overlay 层，使用 Lobe UI Menu 组件
 * portal 到 .app-root 以继承主题 CSS 变量
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { Menu, type GenericItemType } from '@lobehub/ui'
import { MessageSquare, MessageSquarePlus } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useTheme } from 'antd-style'
import { usePrizmContext } from '../context/PrizmContext'
import { useChatWithFile } from '../context/ChatWithFileContext'
import type { FileItem } from '../hooks/useFileList'
import type { AgentSession } from '@prizm/client-core'

export interface DataCardHoverMenuContentProps {
  file: FileItem
  scope: string
  onClose: () => void
  anchorRect: DOMRect
  mouseY: number
}

export function DataCardHoverMenuContent({
  file,
  scope,
  onClose,
  anchorRect,
  mouseY
}: DataCardHoverMenuContentProps) {
  const theme = useTheme()
  const { manager } = usePrizmContext()
  const { chatWith } = useChatWithFile()
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const fetchedRef = useRef(false)

  const openNewChat = useCallback(() => {
    chatWith({ files: [{ kind: file.kind, id: file.id }] })
    onClose()
  }, [file.kind, file.id, chatWith, onClose])

  const openInSession = useCallback(
    (sessionId: string) => {
      chatWith({ files: [{ kind: file.kind, id: file.id }], sessionId })
      onClose()
    },
    [file.kind, file.id, chatWith, onClose]
  )

  const loadSessions = useCallback(async () => {
    const http = manager?.getHttpClient()
    if (!http || !scope) return
    setSessionsLoading(true)
    try {
      const list = await http.listAgentSessions(scope)
      setSessions(list)
    } catch {
      setSessions([])
    } finally {
      setSessionsLoading(false)
    }
  }, [manager, scope])

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true
      loadSessions()
    }
  }, [loadSessions])

  const sessionChildren: GenericItemType[] = sessionsLoading
    ? [{ key: '__loading', label: '加载中...', disabled: true }]
    : sessions.length === 0
    ? [{ key: '__empty', label: '暂无会话', disabled: true }]
    : sessions.map((s) => ({
        key: s.id,
        label: s.title || '新会话'
      }))

  const items: GenericItemType[] = [
    {
      key: 'new-chat',
      icon: MessageSquare,
      label: '聊聊他'
    },
    {
      key: 'open-in-session',
      icon: MessageSquarePlus,
      label: '在现有对话中打开',
      children: sessionChildren
    }
  ]

  const onClick = ({ key }: { key: string }) => {
    if (key === 'new-chat') {
      openNewChat()
    } else if (key !== '__loading' && key !== '__empty') {
      openInSession(key)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: mouseY,
        left: anchorRect.right + 6,
        transform: 'translateY(-50%)',
        zIndex: 1100,
        background: theme.colorBgElevated,
        borderRadius: theme.borderRadiusLG,
        border: `2px solid ${theme.colorBorder}`,
        boxShadow: theme.boxShadowSecondary
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <Menu items={items} onClick={onClick} mode="vertical" style={{ minWidth: 160 }} />
    </div>
  )
}

export interface HoveredCardState {
  file: FileItem
  scope: string
  anchorRect: DOMRect
  mouseY: number
}

export interface CardHoverOverlayProps {
  hoveredCard: HoveredCardState | null
  onClose: () => void
  onMenuEnter?: () => void
  children: React.ReactNode
}

/**
 * 独立 overlay 层：将菜单 portal 到 #app，不包裹卡片
 */
export function CardHoverOverlay({
  hoveredCard,
  onClose,
  onMenuEnter,
  children
}: CardHoverOverlayProps) {
  if (!hoveredCard) return <>{children}</>

  const portalRoot = document.getElementById('app') ?? document.body

  const el = (
    <div
      role="presentation"
      onMouseEnter={onMenuEnter}
      onMouseLeave={onClose}
      style={{ display: 'contents' }}
    >
      <DataCardHoverMenuContent
        file={hoveredCard.file}
        scope={hoveredCard.scope}
        anchorRect={hoveredCard.anchorRect}
        mouseY={hoveredCard.mouseY}
        onClose={onClose}
      />
    </div>
  )

  return (
    <>
      {children}
      {createPortal(el, portalRoot)}
    </>
  )
}
