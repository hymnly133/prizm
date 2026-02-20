import { ActionIcon, Tooltip } from '@lobehub/ui'
import { BrainCircuit } from 'lucide-react'
import { memo, useCallback } from 'react'
import { useAgentSessionStore } from '../../../store/agentSessionStore'

const ThinkingToggle = memo(() => {
  const thinkingEnabled = useAgentSessionStore((s) => s.thinkingEnabled)

  const toggle = useCallback(() => {
    useAgentSessionStore.getState().setThinkingEnabled(!thinkingEnabled)
  }, [thinkingEnabled])

  return (
    <Tooltip title={thinkingEnabled ? '深度思考已开启' : '深度思考已关闭'}>
      <ActionIcon
        icon={BrainCircuit}
        size={{ blockSize: 36, size: 20 }}
        onClick={toggle}
        style={{
          color: thinkingEnabled ? 'var(--ant-color-primary)' : undefined,
          opacity: thinkingEnabled ? 1 : 0.45
        }}
      />
    </Tooltip>
  )
})

ThinkingToggle.displayName = 'ThinkingToggle'

export default ThinkingToggle
