/**
 * 助手消息额外信息：思考过程 + MessageUsage + 记忆标签；工具已内联时不再底部汇总
 */
import type { ChatMessage } from '@lobehub/ui/chat'
import { Flexbox } from '@lobehub/ui'
import type { MemoryIdsByLayer } from '@prizm/shared'
import { useCallback } from 'react'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'
import { MessageUsage } from '../MessageUsage'
import { MemoryRefsTag } from './MemoryRefsTag'

export interface AssistantMessageExtraProps extends ChatMessage {}

export function AssistantMessageExtra(props: AssistantMessageExtraProps) {
  const { manager } = usePrizmContext() ?? {}
  const { currentScope } = useScope()
  const extra = props.extra as
    | {
        model?: string
        usage?: { totalTokens?: number; totalInputTokens?: number; totalOutputTokens?: number }
        reasoning?: string
        parts?: import('@prizm/client-core').MessagePart[]
        memoryRefs?: import('@prizm/shared').MemoryRefs | null
        messageId?: string
      }
    | undefined
  const hasReasoning = !!extra?.reasoning?.trim()
  const http = manager?.getHttpClient()

  const handleResolve = useCallback(
    async (byLayer: MemoryIdsByLayer) => {
      if (!http) return {}
      return http.resolveMemoryIds(byLayer, currentScope)
    },
    [http, currentScope]
  )

  return (
    <div className="assistant-message-extra">
      {hasReasoning && (
        <details className="reasoning-details">
          <summary className="reasoning-summary">思考过程</summary>
          <pre className="reasoning-content">{extra!.reasoning}</pre>
        </details>
      )}
      <Flexbox horizontal align="center" gap={4} wrap="wrap">
        <MessageUsage model={extra?.model} usage={extra?.usage} />
        <MemoryRefsTag
          memoryRefs={extra?.memoryRefs}
          onResolve={handleResolve}
          scope={currentScope}
        />
      </Flexbox>
    </div>
  )
}
