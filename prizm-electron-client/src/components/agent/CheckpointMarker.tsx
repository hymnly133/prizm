/**
 * CheckpointMarker — 消息列表中的 checkpoint 回退标记
 *
 * 在每轮对话的 user 消息前显示一个紧凑的回退点标记，
 * 类似 Cursor 的 checkpoint 设计。
 * hover 时展开操作按钮（回退 / 查看文件变更）。
 */
import { useState, useCallback } from 'react'
import { Tooltip, Popconfirm, Tag, message } from 'antd'
import { Undo2, FileWarning, ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import type { SessionCheckpoint } from '@prizm/client-core'

interface CheckpointMarkerProps {
  checkpoint: SessionCheckpoint
  onRollback: (checkpointId: string, restoreFiles?: boolean) => Promise<unknown>
  disabled?: boolean
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function CheckpointMarker({ checkpoint, onRollback, disabled }: CheckpointMarkerProps) {
  const [hovered, setHovered] = useState(false)
  const [rolling, setRolling] = useState(false)
  const fileCount = checkpoint.fileChanges?.length ?? 0

  const handleRollback = useCallback(
    async (restoreFiles: boolean) => {
      setRolling(true)
      try {
        await onRollback(checkpoint.id, restoreFiles)
        message.success('已回退到此 checkpoint')
      } catch {
        message.error('回退失败')
      } finally {
        setRolling(false)
      }
    },
    [checkpoint.id, onRollback]
  )

  return (
    <div
      className="checkpoint-marker"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="checkpoint-marker-line" />
      <div className="checkpoint-marker-content">
        <div className="checkpoint-marker-dot" />
        <span className="checkpoint-marker-time">{formatTime(checkpoint.createdAt)}</span>

        <AnimatePresence>
          {hovered && (
            <motion.div
              className="checkpoint-marker-actions"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
            >
              {fileCount > 0 && (
                <Tooltip title={`本轮修改了 ${fileCount} 个文件`}>
                  <Tag
                    icon={<FileWarning size={12} />}
                    color="orange"
                    style={{ cursor: 'default', marginRight: 4, fontSize: 11 }}
                  >
                    {fileCount} 文件
                  </Tag>
                </Tooltip>
              )}
              <Popconfirm
                title="回退到此 Checkpoint"
                description={
                  fileCount > 0
                    ? '将撤销后续所有消息，并恢复被修改的文件。'
                    : '将撤销后续所有消息。'
                }
                onConfirm={() => handleRollback(true)}
                okText="确认回退"
                cancelText="取消"
                placement="top"
                okButtonProps={{ danger: true, loading: rolling }}
                disabled={disabled || rolling}
              >
                <Tooltip title="回退到此处">
                  <button
                    className="checkpoint-marker-btn"
                    disabled={disabled || rolling}
                    type="button"
                  >
                    <Undo2 size={13} />
                    <span>回退</span>
                  </button>
                </Tooltip>
              </Popconfirm>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="checkpoint-marker-line" />
    </div>
  )
}
