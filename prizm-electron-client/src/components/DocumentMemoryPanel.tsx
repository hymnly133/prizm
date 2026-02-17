/**
 * DocumentMemoryPanel - 文档记忆面板
 * 展示与当前文档关联的记忆：概述、原子事实、迁移历史
 */
import { useEffect, useCallback } from 'react'
import { Button } from 'antd'
import { Collapse, Flexbox, Markdown, Skeleton } from '@lobehub/ui'
import { Brain, RefreshCw, FileText, Lightbulb, GitBranch } from 'lucide-react'
import { useDocumentMemories } from '../hooks/useDocumentMemories'

interface DocumentMemoryPanelProps {
  documentId: string
  scope?: string
  visible?: boolean
}

export default function DocumentMemoryPanel({
  documentId,
  scope,
  visible = true
}: DocumentMemoryPanelProps) {
  const { memories, loading, error, fetchMemories, refresh } = useDocumentMemories()

  useEffect(() => {
    if (visible && documentId) {
      void fetchMemories(documentId, scope)
    }
  }, [visible, documentId, scope, fetchMemories])

  const handleRefresh = useCallback(() => {
    void refresh()
  }, [refresh])

  if (!visible) return null

  if (loading) {
    return (
      <div className="doc-memory-content">
        <Skeleton active paragraph={{ rows: 4 }} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="doc-memory-content">
        <div className="doc-memory-empty">加载记忆失败: {error}</div>
      </div>
    )
  }

  const hasAny =
    memories.overview.length > 0 ||
    memories.fact.length > 0 ||
    memories.migration.length > 0 ||
    memories.other.length > 0

  return (
    <div className="doc-memory-content">
      <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ant-color-text-secondary)' }}>
          文档记忆
        </span>
        <Button
          type="text"
          size="small"
          icon={<RefreshCw size={12} />}
          onClick={handleRefresh}
          loading={loading}
          title="刷新记忆"
        />
      </Flexbox>

      {!hasAny ? (
        <div className="doc-memory-empty">
          <Brain size={24} style={{ opacity: 0.3, marginBottom: 6 }} />
          <div>暂无关联记忆</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>通过 Agent 对话或自动提取生成文档记忆</div>
        </div>
      ) : (
        <>
          {/* 概述区 */}
          {memories.overview.length > 0 && (
            <div className="doc-memory-section">
              <div className="doc-memory-section-title">
                <FileText size={12} /> 概述
              </div>
              <div className="doc-memory-overview">
                <Markdown>{memories.overview[0].memory}</Markdown>
              </div>
            </div>
          )}

          {/* 原子事实区 */}
          {memories.fact.length > 0 && (
            <div className="doc-memory-section">
              <div className="doc-memory-section-title">
                <Lightbulb size={12} /> 原子事实 ({memories.fact.length})
              </div>
              <Collapse
                items={memories.fact.map((f, i) => ({
                  key: f.id || String(i),
                  label: (
                    <span style={{ fontSize: 12 }}>
                      {f.memory.slice(0, 60)}
                      {f.memory.length > 60 ? '...' : ''}
                    </span>
                  ),
                  children: (
                    <div className="doc-memory-fact">
                      <Markdown>{f.memory}</Markdown>
                    </div>
                  )
                }))}
              />
            </div>
          )}

          {/* 迁移历史 */}
          {memories.migration.length > 0 && (
            <div className="doc-memory-section">
              <div className="doc-memory-section-title">
                <GitBranch size={12} /> 迁移历史 ({memories.migration.length})
              </div>
              {memories.migration.map((m, i) => (
                <div key={m.id || i} className="doc-memory-migration-item">
                  <div className="doc-memory-migration-version">
                    {m.created_at
                      ? new Date(m.created_at).toLocaleString('zh-CN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : `#${i + 1}`}
                  </div>
                  <div className="doc-memory-migration-text">{m.memory}</div>
                </div>
              ))}
            </div>
          )}

          {/* 其他记忆 */}
          {memories.other.length > 0 && (
            <div className="doc-memory-section">
              <div className="doc-memory-section-title">
                <Brain size={12} /> 其他 ({memories.other.length})
              </div>
              {memories.other.map((m, i) => (
                <div key={m.id || i} className="doc-memory-fact">
                  {m.memory}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
