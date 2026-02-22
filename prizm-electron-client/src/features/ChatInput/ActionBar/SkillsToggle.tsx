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

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="topLeft"
      arrow={false}
      content={
        <SkillManagerPanel
          sessionId={sessionId || ''}
          scope={scope}
          onClose={() => setOpen(false)}
        />
      }
      styles={{ content: { padding: 0, background: 'transparent', boxShadow: 'none' } }}
    >
      <Tooltip
        title={sessionId ? 'Skills 管理' : 'Skills（激活需在会话中）'}
        styles={{ container: {} }}
      >
        <ActionIcon
          icon={Sparkles}
          size={{ blockSize: 36, size: 20 }}
          onClick={handleToggle}
          style={{
            color: open ? 'var(--ant-color-warning)' : undefined,
            opacity: open ? 1 : sessionId ? 0.55 : 0.4
          }}
        />
      </Tooltip>
    </Popover>
  )
})

SkillsToggle.displayName = 'SkillsToggle'

export default SkillsToggle
