/**
 * VersionHistoryDrawer - 版本历史侧边抽屉
 * 版本时间线列表、Diff 展示、版本恢复
 */
import { useState, useCallback, useEffect } from 'react'
import { Button, Modal, Timeline } from 'antd'
import { CodeDiff, Drawer, Flexbox, Skeleton, toast } from '@lobehub/ui'
import { History, RotateCcw, GitCompare } from 'lucide-react'
import { useDocumentVersions } from '../hooks/useDocumentVersions'
import { useScope } from '../hooks/useScope'

interface VersionHistoryDrawerProps {
  open: boolean
  onClose: () => void
  documentId: string
  /** 恢复后的回调 */
  onRestore?: () => void
}

export default function VersionHistoryDrawer({
  open,
  onClose,
  documentId,
  onRestore
}: VersionHistoryDrawerProps) {
  const { currentScope } = useScope()
  const {
    versions,
    loading: versionsLoading,
    fetchVersions,
    fetchDiff,
    restoreVersion
  } = useDocumentVersions()

  const [selectedVersions, setSelectedVersions] = useState<[number, number] | null>(null)
  const [diffText, setDiffText] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)

  // 打开时加载版本列表
  useEffect(() => {
    if (open && documentId) {
      void fetchVersions(documentId, currentScope)
      setSelectedVersions(null)
      setDiffText(null)
    }
  }, [open, documentId, currentScope, fetchVersions])

  // 对比两个版本
  const handleCompare = useCallback(
    async (from: number, to: number) => {
      setDiffLoading(true)
      setSelectedVersions([from, to])
      const diff = await fetchDiff(documentId, from, to, currentScope)
      setDiffText(diff)
      setDiffLoading(false)
    },
    [documentId, currentScope, fetchDiff]
  )

  // 恢复版本
  const handleRestore = useCallback(
    (version: number) => {
      Modal.confirm({
        title: '确认恢复',
        content: `确定要恢复到版本 ${version} 吗？当前内容将被替换。`,
        okText: '恢复',
        cancelText: '取消',
        onOk: async () => {
          setRestoring(true)
          const ok = await restoreVersion(documentId, version, currentScope)
          setRestoring(false)
          if (ok) {
            toast.success(`已恢复到版本 ${version}`)
            onRestore?.()
            onClose()
          } else {
            toast.error('恢复失败')
          }
        }
      })
    },
    [documentId, currentScope, restoreVersion, onRestore, onClose]
  )

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <Flexbox horizontal align="center" gap={8}>
          <History size={16} />
          <span>版本历史</span>
        </Flexbox>
      }
      width={560}
    >
      <div className="version-drawer-body">
        {versionsLoading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : versions.length === 0 ? (
          <div className="version-empty">
            <History size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
            <p>暂无版本记录</p>
            <p style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
              保存文档后会自动创建版本快照
            </p>
          </div>
        ) : (
          <>
            <Timeline
              items={versions
                .slice()
                .reverse()
                .map((v, idx) => {
                  const isLatest = idx === 0
                  return {
                    color: isLatest ? 'blue' : 'gray',
                    children: (
                      <div className="version-item">
                        <Flexbox horizontal align="center" justify="space-between">
                          <div>
                            <span className="version-item-number">v{v.version}</span>
                            <span className="version-item-title">{v.title}</span>
                          </div>
                          <Flexbox horizontal gap={4}>
                            {!isLatest && versions.length > 1 && (
                              <>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<GitCompare size={12} />}
                                  onClick={() =>
                                    handleCompare(v.version, versions[versions.length - 1].version)
                                  }
                                  title="与最新版本对比"
                                >
                                  对比
                                </Button>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<RotateCcw size={12} />}
                                  onClick={() => handleRestore(v.version)}
                                  loading={restoring}
                                  title="恢复到此版本"
                                >
                                  恢复
                                </Button>
                              </>
                            )}
                            {isLatest && <span className="version-item-badge">当前</span>}
                          </Flexbox>
                        </Flexbox>
                        <div className="version-item-time">
                          {new Date(v.timestamp).toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </div>
                    )
                  }
                })}
            />

            {/* Diff 展示区 */}
            {selectedVersions && (
              <div className="version-diff-section">
                <Flexbox horizontal align="center" gap={8} style={{ marginBottom: 12 }}>
                  <GitCompare size={14} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    v{selectedVersions[0]} → v{selectedVersions[1]} 变更对比
                  </span>
                </Flexbox>
                {diffLoading ? (
                  <Skeleton active paragraph={{ rows: 4 }} />
                ) : diffText ? (
                  <div className="version-diff-viewer">
                    <CodeDiff
                      oldContent={diffText.split('\n---DIFF-SEPARATOR---\n')[0] ?? ''}
                      newContent={diffText.split('\n---DIFF-SEPARATOR---\n')[1] ?? diffText}
                      language="markdown"
                      fileName="document.md"
                      viewMode="unified"
                    />
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: 'var(--ant-color-text-tertiary)' }}>
                    无差异或加载失败
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>
  )
}
