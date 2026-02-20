import { ActionIcon, Tooltip } from '@lobehub/ui'
import { LayoutList, Rows3 } from 'lucide-react'
import { memo, useCallback } from 'react'
import { useAgentSessionStore } from '../../../store/agentSessionStore'

const ToolCompactToggle = memo(() => {
  const compact = useAgentSessionStore((s) => s.toolCardCompact)

  const toggle = useCallback(() => {
    useAgentSessionStore.getState().toggleToolCardCompact()
  }, [])

  return (
    <Tooltip title={compact ? '工具卡片：精简模式' : '工具卡片：详细模式'}>
      <ActionIcon
        icon={compact ? Rows3 : LayoutList}
        size={{ blockSize: 36, size: 20 }}
        onClick={toggle}
        style={{
          color: compact ? 'var(--ant-color-primary)' : undefined,
          opacity: compact ? 1 : 0.45
        }}
      />
    </Tooltip>
  )
})

ToolCompactToggle.displayName = 'ToolCompactToggle'

export default ToolCompactToggle
