/**
 * SkillsToggle — ActionBar 中的 Skills 管理按钮
 * 点击弹出 SkillManagerPanel Popover
 */
import { ActionIcon, Tooltip } from '@lobehub/ui'
import { Popover } from 'antd'
import { Sparkles } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { useSessionChat } from '../../../context/SessionChatContext'
import { SkillManagerPanel } from '../../../components/agent/SkillManagerPanel'

const SkillsToggle = memo(() => {
  const [open, setOpen] = useState(false)

  let sessionId = ''
  let scope = 'default'
  try {
    const ctx = useSessionChat()
    sessionId = ctx.sessionId
    scope = ctx.scope
  } catch {
    // Not inside a SessionChatContext — button will be inert
  }

  const handleToggle = useCallback(() => {
    setOpen((v) => !v)
  }, [])

  if (!sessionId) {
    return (
      <Tooltip title="Skills（需要活跃会话）">
        <ActionIcon
          icon={Sparkles}
          size={{ blockSize: 36, size: 20 }}
          style={{ opacity: 0.3 }}
          disabled
        />
      </Tooltip>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="topLeft"
      arrow={false}
      content={
        <SkillManagerPanel
          sessionId={sessionId}
          scope={scope}
          onClose={() => setOpen(false)}
        />
      }
      overlayInnerStyle={{ padding: 0, background: 'transparent', boxShadow: 'none' }}
    >
      <Tooltip title="Skills 管理">
        <ActionIcon
          icon={Sparkles}
          size={{ blockSize: 36, size: 20 }}
          onClick={handleToggle}
          style={{
            color: open ? 'var(--ant-color-warning)' : undefined,
            opacity: open ? 1 : 0.55
          }}
        />
      </Tooltip>
    </Popover>
  )
})

SkillsToggle.displayName = 'SkillsToggle'

export default SkillsToggle
