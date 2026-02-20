/**
 * DocumentEditorView - 现代化文档编辑器视图
 * 三栏布局：ResizableSidebar 左侧栏 | 编辑器主区（居中限宽） | ResizableSidebar 右侧面板
 * 侧边栏折叠按钮和返回按钮通过 HeaderSlotsContext 注册到全局标题栏
 *
 * 数据层通过 DocumentDetailProvider 提供，子组件直接从 Context 读取。
 * CRUD 操作由 useDocumentActions 提供，编辑器模式由 useEditorMode 管理，
 * 编辑器主区渲染由 DocumentEditorZone 封装。
 */
import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { App } from 'antd'
import { ActionIcon, Flexbox } from '@lobehub/ui'
import {
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  FilePlus,
  FileText,
  Clock
} from 'lucide-react'
import { motion } from 'motion/react'
import { DocumentEditorZone } from './editor'
import DocumentSidebar from './DocumentSidebar'
import DocumentOutlinePanel from './DocumentOutlinePanel'
import VersionHistoryDrawer from './VersionHistoryDrawer'
import { ResizableSidebar } from './layout'
import { DocumentDetailProvider, useDocumentDetail } from '../context/DocumentDetailContext'
import { useRegisterHeaderSlots } from '../context/HeaderSlotsContext'
import { useScopeDataStore } from '../store/scopeDataStore'
import { useDocumentActions } from '../hooks/useDocumentActions'
import { useEditorMode } from '../hooks/useEditorMode'
import { createStyles } from 'antd-style'

const useStyles = createStyles(({ css, token }) => ({
  emptyState: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: ${token.colorTextTertiary};
  `,
  emptyIcon: css`
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: ${token.colorFillQuaternary};
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${token.colorTextQuaternary};
  `,
  emptyTitle: css`
    font-size: 18px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  emptyDesc: css`
    font-size: 13px;
    color: ${token.colorTextTertiary};
    max-width: 300px;
    text-align: center;
    line-height: 1.5;
  `,
  emptyActions: css`
    display: flex;
    gap: 8px;
    margin-top: 8px;
  `,
  emptyActionBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid ${token.colorBorder};
    background: ${token.colorBgContainer};
    color: ${token.colorText};
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      border-color: ${token.colorPrimary};
      color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `,
  recentItem: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: ${token.colorTextSecondary};
    transition: all 0.15s;

    &:hover {
      background: ${token.colorFillQuaternary};
      color: ${token.colorText};
    }
  `
}))

export interface DocumentEditorViewProps {
  scope: string
  initialDocId?: string | null
  onBack: () => void
  dirtyRef?: React.MutableRefObject<boolean>
}

export default function DocumentEditorView({
  scope,
  initialDocId,
  onBack,
  dirtyRef
}: DocumentEditorViewProps) {
  const [activeDocId, setActiveDocId] = useState<string | null>(initialDocId ?? null)

  const lastExternalDocRef = useRef<string | null>(null)
  useEffect(() => {
    if (initialDocId && initialDocId !== lastExternalDocRef.current) {
      lastExternalDocRef.current = initialDocId
      setActiveDocId(initialDocId)
    }
  }, [initialDocId])

  return (
    <DocumentDetailProvider documentId={activeDocId} scope={scope}>
      <DocumentEditorViewInner
        scope={scope}
        activeDocId={activeDocId}
        setActiveDocId={setActiveDocId}
        onBack={onBack}
        dirtyRef={dirtyRef}
      />
    </DocumentDetailProvider>
  )
}

interface DocumentEditorViewInnerProps {
  scope: string
  activeDocId: string | null
  setActiveDocId: (id: string | null) => void
  onBack: () => void
  dirtyRef?: React.MutableRefObject<boolean>
}

function DocumentEditorViewInner({
  scope,
  activeDocId,
  setActiveDocId,
  onBack,
  dirtyRef
}: DocumentEditorViewInnerProps) {
  const { modal } = App.useApp()
  const { styles } = useStyles()
  const ctx = useDocumentDetail()

  const documents = useScopeDataStore((s) => s.documents)
  const docListLoading = useScopeDataStore((s) => s.documentsLoading)
  const refreshDocuments = useScopeDataStore((s) => s.refreshDocuments)

  const { editorMode, handleModeChange } = useEditorMode('prizm-doc-editor-mode')
  const actions = useDocumentActions({ scope, activeDocId, setActiveDocId, ctx })

  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)

  useEffect(() => {
    if (dirtyRef) dirtyRef.current = ctx.dirty
  }, [ctx.dirty, dirtyRef])

  const handleBack = useCallback(() => {
    if (ctx.dirty) {
      modal.confirm({
        title: '未保存的更改',
        content: '文档中有未保存的更改，确定离开吗？',
        okText: '离开',
        cancelText: '继续编辑',
        onOk: () => onBack()
      })
    } else {
      onBack()
    }
  }, [ctx.dirty, modal, onBack])

  const recentDocs = useMemo(
    () => [...documents].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5),
    [documents]
  )

  const headerSlots = useMemo(
    () => ({
      left: (
        <Flexbox horizontal align="center" gap={4}>
          <ActionIcon icon={ArrowLeft} size="small" title="返回列表" onClick={handleBack} />
          <ActionIcon
            icon={leftCollapsed ? PanelLeftOpen : PanelLeftClose}
            size="small"
            title={leftCollapsed ? '展开文档列表' : '收起文档列表'}
            onClick={() => setLeftCollapsed((c) => !c)}
          />
        </Flexbox>
      ),
      right: (
        <ActionIcon
          icon={rightCollapsed ? PanelRightOpen : PanelRightClose}
          size="small"
          title={rightCollapsed ? '展开大纲面板' : '收起大纲面板'}
          onClick={() => setRightCollapsed((c) => !c)}
          style={{ marginRight: 4 }}
        />
      )
    }),
    [handleBack, leftCollapsed, rightCollapsed]
  )
  useRegisterHeaderSlots('docs', headerSlots)

  return (
    <section className="doc-editor-page">
      {/* Left sidebar */}
      <ResizableSidebar
        side="left"
        storageKey="doc-sidebar"
        defaultWidth={240}
        collapsed={leftCollapsed}
        onCollapsedChange={setLeftCollapsed}
      >
        <DocumentSidebar
          documents={documents}
          loading={docListLoading}
          activeDocId={activeDocId}
          scope={scope}
          onSelectDoc={actions.handleSelectDoc}
          onCreateDoc={actions.handleCreateDoc}
          onRefresh={refreshDocuments}
          onDeleteDoc={actions.handleSidebarDeleteDoc}
        />
      </ResizableSidebar>

      {/* Center: editor main */}
      <Flexbox flex={1} style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        {activeDocId && (ctx.loading || ctx.document) ? (
          <DocumentEditorZone
            editorMode={editorMode}
            onModeChange={handleModeChange}
            onSave={actions.handleSave}
            onDelete={actions.handleDelete}
            onReloadExternal={actions.handleReloadExternal}
            onOverrideExternal={actions.handleOverrideExternal}
            showToolbar
            contentMaxWidth={760}
            contentPadding="0 48px"
            externalUpdateDesc="其他客户端修改了此文档，您可以重新加载最新内容或覆盖保存。"
            loadingPadding="48px 64px"
          />
        ) : (
          <div className={styles.emptyState}>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.33, 1, 0.68, 1] }}
            >
              <Flexbox align="center" gap={16}>
                <div className={styles.emptyIcon}>
                  <FileText size={28} />
                </div>
                <span className={styles.emptyTitle}>选择或创建文档</span>
                <span className={styles.emptyDesc}>
                  从左侧列表选择一个文档开始编辑，或创建新文档
                </span>
                <div className={styles.emptyActions}>
                  <button
                    type="button"
                    className={styles.emptyActionBtn}
                    onClick={actions.handleCreateDoc}
                  >
                    <FilePlus size={15} />
                    新建文档
                  </button>
                </div>

                {recentDocs.length > 0 && (
                  <Flexbox gap={2} style={{ marginTop: 16, width: 260 }}>
                    <span
                      style={{ fontSize: 11, fontWeight: 600, color: 'var(--ant-color-text-quaternary)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 12px' }}
                    >
                      最近文档
                    </span>
                    {recentDocs.map((doc) => (
                      <div
                        key={doc.id}
                        className={styles.recentItem}
                        onClick={() => actions.handleSelectDoc(doc)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && actions.handleSelectDoc(doc)}
                      >
                        <Clock size={13} style={{ opacity: 0.5, flexShrink: 0 }} />
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {doc.title || '无标题'}
                        </span>
                      </div>
                    ))}
                  </Flexbox>
                )}
              </Flexbox>
            </motion.div>
          </div>
        )}
      </Flexbox>

      {/* Right sidebar — props-free, reads from Context */}
      {activeDocId && ctx.document && (
        <ResizableSidebar
          side="right"
          storageKey="doc-outline"
          defaultWidth={260}
          minWidth={200}
          maxWidth={400}
          collapsed={rightCollapsed}
          onCollapsedChange={setRightCollapsed}
        >
          <DocumentOutlinePanel />
        </ResizableSidebar>
      )}

      {/* Version history — props-free, reads from Context */}
      {activeDocId && <VersionHistoryDrawer />}
    </section>
  )
}
