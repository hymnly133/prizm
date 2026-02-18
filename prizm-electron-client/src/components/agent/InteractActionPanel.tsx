/**
 * InteractActionPanel — 固定在聊天底部的交互授权面板
 *
 * 当 agent 工具需要用户授权访问路径时，在消息区底部显示醒目的操作面板，
 * 包含需要授权的路径列表和批准/拒绝按钮。
 * 解决 ToolCardAwaitingInteract 可能被滚出可视区域导致用户无法操作的问题。
 */
import { useState, useCallback, memo } from 'react'
import { Flexbox } from '@lobehub/ui'
import { ShieldCheck, AlertCircle, FolderOpen } from 'lucide-react'
import { getToolDisplayName } from '@prizm/client-core'
import type { InteractRequestPayload } from '@prizm/client-core'

export interface InteractActionPanelProps {
  pendingInteract: InteractRequestPayload
  onRespond: (requestId: string, approved: boolean, paths?: string[]) => Promise<void>
}

export const InteractActionPanel = memo(function InteractActionPanel({
  pendingInteract,
  onRespond
}: InteractActionPanelProps) {
  const [responding, setResponding] = useState(false)

  const handleApprove = useCallback(async () => {
    if (responding) return
    setResponding(true)
    try {
      await onRespond(pendingInteract.requestId, true, pendingInteract.paths)
    } finally {
      setResponding(false)
    }
  }, [pendingInteract, onRespond, responding])

  const handleDeny = useCallback(async () => {
    if (responding) return
    setResponding(true)
    try {
      await onRespond(pendingInteract.requestId, false)
    } finally {
      setResponding(false)
    }
  }, [pendingInteract, onRespond, responding])

  const displayName = getToolDisplayName(pendingInteract.toolName)

  return (
    <div className="interact-panel">
      <div className="interact-panel__header">
        <ShieldCheck size={16} className="interact-panel__icon" />
        <span className="interact-panel__title">
          <strong>{displayName}</strong> 需要您的授权
        </span>
      </div>

      <div className="interact-panel__desc">工具需要访问以下路径，请确认是否允许：</div>

      {pendingInteract.paths.length > 0 && (
        <div className="interact-panel__paths">
          {pendingInteract.paths.map((p, i) => (
            <div key={i} className="interact-panel__path-item">
              <FolderOpen size={12} />
              <code>{p}</code>
            </div>
          ))}
        </div>
      )}

      <Flexbox horizontal gap={10} style={{ marginTop: 10 }}>
        <button
          className="interact-panel__btn interact-panel__btn--approve"
          onClick={handleApprove}
          disabled={responding}
        >
          <ShieldCheck size={14} />
          <span>{responding ? '处理中…' : '允许访问'}</span>
        </button>
        <button
          className="interact-panel__btn interact-panel__btn--deny"
          onClick={handleDeny}
          disabled={responding}
        >
          <AlertCircle size={14} />
          <span>拒绝</span>
        </button>
      </Flexbox>
    </div>
  )
})
