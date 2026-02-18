/**
 * DocumentEditorView - 现代化文档编辑器视图
 * 三栏布局：ResizableSidebar 左侧栏 | 编辑器主区（居中限宽） | ResizableSidebar 右侧面板
 * 侧边栏折叠按钮和返回按钮通过 HeaderSlotsContext 注册到全局标题栏
 *
 * 数据层通过 DocumentDetailProvider 提供，子组件直接从 Context 读取。
 */
import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { App } from 'antd'
import { ActionIcon, Alert, Button, Flexbox, Markdown, Skeleton, toast } from '@lobehub/ui'
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
import type { EnrichedDocument } from '@prizm/client-core'
import { MarkdownEditor, EditorToolbar, SplitEditor, EditorStatusBar } from './editor'
import type { EditorMode } from './editor'
import DocumentSidebar from './DocumentSidebar'
import DocumentHeader from './DocumentHeader'
import DocumentOutlinePanel from './DocumentOutlinePanel'
import VersionHistoryDrawer from './VersionHistoryDrawer'
import { ResizableSidebar } from './layout'
import { DocumentDetailProvider, useDocumentDetail } from '../context/DocumentDetailContext'
import { usePrizmContext } from '../context/PrizmContext'
import { useRegisterHeaderSlots } from '../context/HeaderSlotsContext'
import { useScopeDataStore } from '../store/scopeDataStore'
import { createStyles } from 'antd-style'

const EDITOR_MODE_KEY = 'prizm-doc-editor-mode'

const useStyles = createStyles(({ css, token }) => ({
  editorMain: css`
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `,
  editorScrollArea: css`
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `,
  centeredContent: css`
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
    padding: 0 48px;
    flex-shrink: 0;
  `,
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
  const { manager } = usePrizmContext()
  const { styles } = useStyles()
  const ctx = useDocumentDetail()

  const documents = useScopeDataStore((s) => s.documents)
  const docListLoading = useScopeDataStore((s) => s.documentsLoading)
  const refreshDocuments = useScopeDataStore((s) => s.refreshDocuments)

  const [editorMode, setEditorMode] = useState<EditorMode>(() => {
    try {
      const stored = localStorage.getItem(EDITOR_MODE_KEY) as EditorMode | null
      if (stored === 'source' || stored === 'preview' || stored === 'split' || stored === 'live')
        return stored
      return 'live'
    } catch {
      return 'live'
    }
  })

  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)

  useEffect(() => {
    if (dirtyRef) dirtyRef.current = ctx.dirty
  }, [ctx.dirty, dirtyRef])

  const handleSelectDoc = useCallback(
    (doc: EnrichedDocument) => {
      if (doc.id === activeDocId) return
      setActiveDocId(doc.id)
      void ctx.loadDocument(doc.id)
    },
    [activeDocId, setActiveDocId, ctx.loadDocument]
  )

  const handleCreateDoc = useCallback(async () => {
    if (!manager) return
    try {
      const client = manager.getHttpClient()
      const doc = await client.createDocument({ title: '新文档', content: '' }, scope)
      useScopeDataStore.getState().upsertDocument(doc)
      setActiveDocId(doc.id)
      void ctx.loadDocument(doc.id)
      toast.success('文档已创建')
    } catch (e) {
      toast.error(`创建文档失败: ${String(e)}`)
    }
  }, [manager, scope, setActiveDocId, ctx.loadDocument])

  const handleSave = useCallback(async () => {
    const ok = await ctx.save()
    if (ok) {
      toast.success('已保存')
    } else {
      toast.error('保存失败，请重试')
    }
  }, [ctx.save])

  const handleDelete = useCallback(() => {
    if (!ctx.document || !manager) return
    modal.confirm({
      title: '确认删除',
      content: `确定要删除文档「${ctx.document.title}」吗？此操作不可撤销。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const client = manager.getHttpClient()
          await client.deleteDocument(ctx.document!.id, scope)
          setActiveDocId(null)
          useScopeDataStore.getState().removeDocument(ctx.document!.id)
          toast.success('文档已删除')
        } catch (e) {
          toast.error(`删除失败: ${String(e)}`)
        }
      }
    })
  }, [ctx.document, manager, scope, modal, setActiveDocId])

  const handleModeChange = useCallback((mode: EditorMode) => {
    setEditorMode(mode)
    try {
      localStorage.setItem(EDITOR_MODE_KEY, mode)
    } catch {
      /* ignore */
    }
  }, [])

  const handleReloadExternal = useCallback(() => {
    ctx.clearExternalUpdate()
    void ctx.reload()
  }, [ctx.clearExternalUpdate, ctx.reload])

  const handleOverrideExternal = useCallback(() => {
    ctx.clearExternalUpdate()
  }, [ctx.clearExternalUpdate])

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

  const headerElement = ctx.document ? (
    <div className={styles.centeredContent}>
      <DocumentHeader onSave={handleSave} onDelete={handleDelete} />
    </div>
  ) : null

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
          onSelectDoc={handleSelectDoc}
          onCreateDoc={handleCreateDoc}
          onRefresh={refreshDocuments}
          onDeleteDoc={(doc) => {
            modal.confirm({
              title: '确认删除',
              content: `确定要删除文档「${doc.title}」吗？此操作不可撤销。`,
              okText: '删除',
              okType: 'danger',
              cancelText: '取消',
              onOk: async () => {
                try {
                  const client = manager!.getHttpClient()
                  await client.deleteDocument(doc.id, scope)
                  if (activeDocId === doc.id) setActiveDocId(null)
                  useScopeDataStore.getState().removeDocument(doc.id)
                  toast.success('文档已删除')
                } catch (e) {
                  toast.error(`删除失败: ${String(e)}`)
                }
              }
            })
          }}
        />
      </ResizableSidebar>

      {/* Center: editor main */}
      <Flexbox flex={1} style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        {activeDocId && ctx.loading ? (
          <div style={{ padding: '48px 64px' }}>
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        ) : activeDocId && ctx.document ? (
          <div className={styles.editorMain}>
            {ctx.externalUpdate && (
              <Alert
                type="warning"
                banner
                showIcon
                message="文档已被外部修改"
                description="其他客户端修改了此文档，您可以重新加载最新内容或覆盖保存。"
                extra={
                  <Flexbox horizontal gap={8} style={{ marginTop: 8 }}>
                    <Button size="small" onClick={handleReloadExternal}>
                      重新加载
                    </Button>
                    <Button size="small" onClick={handleOverrideExternal}>
                      忽略
                    </Button>
                  </Flexbox>
                }
              />
            )}

            {ctx.error && <Alert type="error" banner showIcon closable message={ctx.error} />}

            <EditorToolbar
              mode={editorMode}
              onModeChange={handleModeChange}
              editorRef={ctx.editorRef}
              readOnly={false}
            />

            <div className={styles.editorScrollArea}>
              {editorMode === 'preview' ? (
                <div className="doc-preview-pane">
                  <div className={styles.centeredContent}>
                    {headerElement}
                    <Markdown>{ctx.content || ' '}</Markdown>
                  </div>
                </div>
              ) : editorMode === 'split' ? (
                <SplitEditor
                  value={ctx.content}
                  onChange={ctx.setContent}
                  onSave={handleSave}
                  editorRef={ctx.editorRef}
                  header={headerElement}
                />
              ) : (
                <div className="doc-page-editor">
                  {headerElement}
                  <MarkdownEditor
                    value={ctx.content}
                    onChange={ctx.setContent}
                    mode={editorMode}
                    onSave={handleSave}
                    editorRef={ctx.editorRef}
                  />
                </div>
              )}
            </div>

            <EditorStatusBar
              dirty={ctx.dirty}
              saving={ctx.saving}
              charCount={ctx.charCount}
              wordCount={ctx.wordCount}
              editorRef={ctx.editorRef}
            />
          </div>
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
                    onClick={handleCreateDoc}
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
                        onClick={() => handleSelectDoc(doc)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && handleSelectDoc(doc)}
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
