/**
 * AgentDetailSidebar — Agent 右侧详情面板（共享组件）
 *
 * 三标签页布局：上下文 / 文件 / 终端
 * 被 AgentPage 和 CollaborationPage 的 AgentPane 共同使用。
 */
import { Flexbox } from '@lobehub/ui'
import { Segmented } from '../ui/Segmented'
import { motion, AnimatePresence } from 'motion/react'
import { FolderTree, MessageSquare, Terminal as TerminalLucide } from 'lucide-react'
import { memo, useState } from 'react'
import type { EnrichedSession, AgentMessage } from '@prizm/client-core'
import { AgentRightSidebar } from '../AgentRightSidebar'
import { FileTreePanel } from './FileTreePanel'
import { TerminalSidebarTab } from './TerminalSidebarTab'

export interface AgentDetailSidebarProps {
  sending: boolean
  error: string | null
  currentSession: EnrichedSession | null
  optimisticMessages: AgentMessage[]
  selectedModel?: string
  onModelChange?: (model: string | undefined) => void
  scope: string
  /** 文件面板点击文件时的回调 */
  onPreviewFile?: (relativePath: string) => void
}

export const AgentDetailSidebar = memo(function AgentDetailSidebar({
  sending,
  error,
  currentSession,
  optimisticMessages,
  selectedModel,
  onModelChange,
  scope,
  onPreviewFile
}: AgentDetailSidebarProps) {
  const [sidebarTab, setSidebarTab] = useState<'context' | 'files' | 'terminal'>('context')

  return (
    <Flexbox style={{ height: '100%', overflow: 'hidden' }} gap={0}>
      <div style={{ padding: '8px 8px 4px', flexShrink: 0 }}>
        <Segmented
          block
          size="small"
          value={sidebarTab}
          onChange={(v) => setSidebarTab(v as 'context' | 'files' | 'terminal')}
          options={[
            { label: '上下文', value: 'context', icon: <MessageSquare size={12} /> },
            { label: '文件', value: 'files', icon: <FolderTree size={12} /> },
            { label: '终端', value: 'terminal', icon: <TerminalLucide size={12} /> }
          ]}
        />
      </div>
      <AnimatePresence mode="wait">
        {sidebarTab === 'context' ? (
          <motion.div
            key="context"
            style={{
              flex: 1,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.15 }}
          >
            <AgentRightSidebar
              sending={sending}
              error={error}
              currentSession={currentSession}
              optimisticMessages={optimisticMessages}
              selectedModel={selectedModel}
              onModelChange={onModelChange}
              overviewMode={false}
            />
          </motion.div>
        ) : sidebarTab === 'files' ? (
          <motion.div
            key="files"
            style={{ flex: 1, overflow: 'hidden' }}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.15 }}
          >
            <FileTreePanel
              scope={scope}
              sessionId={currentSession?.id}
              onPreviewFile={onPreviewFile}
            />
          </motion.div>
        ) : (
          <motion.div
            key="terminal"
            style={{ flex: 1, overflow: 'hidden' }}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.15 }}
          >
            <TerminalSidebarTab
              sessionId={currentSession?.id}
              scope={scope}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </Flexbox>
  )
})
