/**
 * RoundDebugTrigger — 开发模式下每轮对话上方的调试入口
 *
 * 仅当存在 roundDebug 时渲染小按钮，点击后弹层展示请求参数与系统提示词。
 */
import { memo, useState, useCallback, useEffect } from 'react'
import { Button, Modal, Typography } from 'antd'
import { Bug } from 'lucide-react'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'
import { useSessionChat } from '../../context/SessionChatContext'
import { usePrizmContext } from '../../context/PrizmContext'
import { useAgentSessionStore } from '../../store/agentSessionStore'
import type { RoundDebugInfo } from '../../store/agentSessionStore'

const { Text } = Typography

export interface RoundDebugTriggerProps {
  messageId: string
}

function roundDebugKey(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`
}

export const RoundDebugTrigger = memo(function RoundDebugTrigger({
  messageId
}: RoundDebugTriggerProps) {
  const { sessionId, scope } = useSessionChat()
  const manager = usePrizmContext().manager
  const roundDebug = useAgentSessionStore((s) =>
    s.roundDebugByKey[roundDebugKey(sessionId, messageId)]
  ) as RoundDebugInfo | undefined

  const [open, setOpen] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState<string>('')
  const [systemPromptLoading, setSystemPromptLoading] = useState(false)

  const http = manager?.getHttpClient()

  const loadSystemPrompt = useCallback(async () => {
    if (!http || !scope) return
    setSystemPromptLoading(true)
    try {
      const res = await http.getAgentSystemPrompt(scope, sessionId)
      setSystemPrompt(res.systemPrompt ?? '')
    } catch {
      setSystemPrompt('')
    } finally {
      setSystemPromptLoading(false)
    }
  }, [http, scope, sessionId])

  useEffect(() => {
    if (open && systemPrompt === '' && !systemPromptLoading) {
      loadSystemPrompt()
    }
  }, [open, loadSystemPrompt, systemPrompt, systemPromptLoading])

  const handleOpen = useCallback(() => {
    setOpen(true)
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [])

  if (!roundDebug) return null

  const { requestPayload } = roundDebug
  const payloadJson = JSON.stringify(requestPayload, null, 2)

  return (
    <>
      <Button
        type="text"
        size="small"
        className="round-debug-trigger"
        icon={<Bug size={14} />}
        onClick={handleOpen}
        aria-label="查看此轮请求的调试信息"
      >
        调试
      </Button>
      <Modal
        title="调试信息"
        open={open}
        onCancel={handleClose}
        footer={null}
        width={640}
        destroyOnClose
      >
        <div className="round-debug-modal">
          <section className="round-debug-modal__section">
            <Text strong>请求参数</Text>
            <pre
              className="round-debug-modal__pre"
              style={{ marginTop: 8 }}
              aria-label="请求参数 JSON"
            >
              {payloadJson}
            </pre>
          </section>
          <section className="round-debug-modal__section">
            <Text strong>系统提示词</Text>
            <div className="round-debug-modal__prompt-wrap" style={{ marginTop: 8 }}>
              {systemPromptLoading ? (
                <LoadingPlaceholder />
              ) : (
                <pre className="round-debug-modal__pre round-debug-modal__pre--scroll" aria-label="系统提示词">
                  {systemPrompt || '（无）'}
                </pre>
              )}
            </div>
          </section>
        </div>
      </Modal>
    </>
  )
})
