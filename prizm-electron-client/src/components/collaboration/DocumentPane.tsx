/**
 * DocumentPane — 协作页文档半屏面板
 * 精简版文档编辑器：文档列表侧边栏 + 现代化编辑器主区 + 可折叠详情面板
 * 通过 DocumentDetailProvider 提供文档数据，子组件自动从 Context 读取。
 * 模式切换（Live/源码/预览/分栏）集成在面板标题栏内
 */
import { useState, useCallback, useEffect, useMemo, memo } from 'react'
import { App } from 'antd'
import { ActionIcon, Alert, Button, Flexbox, Markdown, Skeleton, toast } from '@lobehub/ui'
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Maximize2,
  Plus,
  FileText,
  FilePlus,
  BookOpen,
  Code2,
  Eye,
  Columns2,
  PanelRight,
  PanelRightDashed
} from 'lucide-react'
import { createStyles } from 'antd-style'
import { motion } from 'motion/react'
import type { EnrichedDocument } from '@prizm/client-core'
import { MarkdownEditor, SplitEditor, EditorStatusBar } from '../editor'
import type { EditorMode } from '../editor'
import { Segmented } from '../ui/Segmented'
import DocumentSidebar from '../DocumentSidebar'
import DocumentHeader from '../DocumentHeader'
import DocumentOutlinePanel from '../DocumentOutlinePanel'
import VersionHistoryDrawer from '../VersionHistoryDrawer'
import { ResizableSidebar } from '../layout'
import { DocumentDetailProvider, useDocumentDetail } from '../../context/DocumentDetailContext'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'
import { useScopeDataStore } from '../../store/scopeDataStore'

const EDITOR_MODE_KEY = 'prizm-collab-doc-editor-mode'

const MODE_OPTIONS: Array<{ label: React.ReactNode; value: EditorMode }> = [
  {
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <BookOpen size={11} /> Live
      </span>
    ),
    value: 'live'
  },
  {
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <Code2 size={11} /> 源码
      </span>
    ),
    value: 'source'
  },
  {
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <Eye size={11} /> 预览
      </span>
    ),
    value: 'preview'
  },
  {
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <Columns2 size={11} /> 分栏
      </span>
    ),
    value: 'split'
  }
]

const useStyles = createStyles(({ css, token }) => ({
  editorMain: css`
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `,
  modeSegmented: css`
    &.ant-segmented {
      background-color: ${token.colorFillQuaternary};
      height: 24px;
      min-height: 24px;
    }
    .ant-segmented-item {
      padding: 0 6px;
      font-size: 11px;
      line-height: 22px;
    }
    .ant-segmented-item-label {
      min-height: 22px;
      line-height: 22px;
      padding: 0 2px;
    }
  `,
  editorScrollArea: css`
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `,
  centeredContent: css`
    max-width: 680px;
    width: 100%;
    margin: 0 auto;
    padding: 0 32px;
    flex-shrink: 0;
  `,
  emptyState: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: ${token.colorTextTertiary};
  `,
  emptyIcon: css`
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: ${token.colorFillQuaternary};
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${token.colorTextQuaternary};
  `,
  emptyTitle: css`
    font-size: 15px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  emptyDesc: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
    text-align: center;
    line-height: 1.5;
  `,
  emptyActionBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid ${token.colorBorder};
    background: ${token.colorBgContainer};
    color: ${token.colorText};
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      border-color: ${token.colorPrimary};
      color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `
}))

export interface DocumentPaneProps {
  onOpenFullPage?: (docId?: string) => void
  dirtyRef?: React.MutableRefObject<boolean>
  sidebarSide?: 'left' | 'right'
  /** Controlled: external active document ID */
  activeDocId?: string | null
  /** Controlled: callback when active document changes */
  onActiveDocIdChange?: (id: string | null) => void
}

function DocumentPane({
  onOpenFullPage,
  dirtyRef,
  sidebarSide = 'left',
  activeDocId: controlledDocId,
  onActiveDocIdChange
}: DocumentPaneProps) {
  const { currentScope } = useScope()
  const [internalDocId, setInternalDocId] = useState<string | null>(null)

  const isControlled = controlledDocId !== undefined
  const activeDocId = isControlled ? controlledDocId : internalDocId
  const setActiveDocId = useCallback(
    (id: string | null) => {
      if (isControlled) {
        onActiveDocIdChange?.(id)
      } else {
        setInternalDocId(id)
      }
    },
    [isControlled, onActiveDocIdChange]
  )

  return (
    <DocumentDetailProvider documentId={activeDocId} scope={currentScope}>
      <DocumentPaneInner
        activeDocId={activeDocId}
        setActiveDocId={setActiveDocId}
        onOpenFullPage={onOpenFullPage}
        dirtyRef={dirtyRef}
        sidebarSide={sidebarSide}
      />
    </DocumentDetailProvider>
  )
}

interface DocumentPaneInnerProps {
  activeDocId: string | null
  setActiveDocId: (id: string | null) => void
  onOpenFullPage?: (docId?: string) => void
  dirtyRef?: React.MutableRefObject<boolean>
  sidebarSide: 'left' | 'right'
}

function DocumentPaneInner({
  activeDocId,
  setActiveDocId,
  onOpenFullPage,
  dirtyRef,
  sidebarSide
}: DocumentPaneInnerProps) {
  const { modal } = App.useApp()
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const { styles } = useStyles()
  const ctx = useDocumentDetail()

  const documents = useScopeDataStore((s) => s.documents)
  const docListLoading = useScopeDataStore((s) => s.documentsLoading)
  const refreshDocuments = useScopeDataStore((s) => s.refreshDocuments)

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [detailCollapsed, setDetailCollapsed] = useState(true)

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
      const doc = await client.createDocument({ title: '新文档', content: '' }, currentScope)
      useScopeDataStore.getState().upsertDocument(doc)
      setActiveDocId(doc.id)
      void ctx.loadDocument(doc.id)
      toast.success('文档已创建')
    } catch (e) {
      toast.error(`创建文档失败: ${String(e)}`)
    }
  }, [manager, currentScope, setActiveDocId, ctx.loadDocument])

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
          await client.deleteDocument(ctx.document!.id, currentScope)
          setActiveDocId(null)
          useScopeDataStore.getState().removeDocument(ctx.document!.id)
          toast.success('文档已删除')
        } catch (e) {
          toast.error(`删除失败: ${String(e)}`)
        }
      }
    })
  }, [ctx.document, manager, currentScope, modal, setActiveDocId])

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

  const headerElement = ctx.document ? (
    <div className={styles.centeredContent}>
      <DocumentHeader onSave={handleSave} onDelete={handleDelete} />
    </div>
  ) : null

  return (
    <section className="collab-doc-pane">
      {/* Panel header with integrated mode switcher */}
      <div className="collab-pane-header">
        <Flexbox horizontal align="center" gap={4}>
          {sidebarSide === 'left' && (
            <ActionIcon
              icon={sidebarCollapsed ? PanelLeftOpen : PanelLeftClose}
              size="small"
              title={sidebarCollapsed ? '展开文档列表' : '收起文档列表'}
              onClick={() => setSidebarCollapsed((c) => !c)}
            />
          )}
          <span className="collab-pane-title">文档</span>
        </Flexbox>

        {activeDocId && ctx.document && (
          <Segmented
            className={styles.modeSegmented}
            size="small"
            value={editorMode}
            onChange={(v) => handleModeChange(v as EditorMode)}
            options={MODE_OPTIONS}
          />
        )}

        <Flexbox horizontal align="center" gap={2}>
          <ActionIcon icon={Plus} title="新建文档" size="small" onClick={handleCreateDoc} />
          <ActionIcon
            icon={detailCollapsed ? PanelRightDashed : PanelRight}
            size="small"
            title={detailCollapsed ? '展开详情面板' : '收起详情面板'}
            onClick={() => setDetailCollapsed((c) => !c)}
          />
          {onOpenFullPage && (
            <ActionIcon
              icon={Maximize2}
              title="在完整页面中打开"
              size="small"
              onClick={() => onOpenFullPage(activeDocId ?? undefined)}
            />
          )}
          {sidebarSide === 'right' && (
            <ActionIcon
              icon={sidebarCollapsed ? PanelRightOpen : PanelRightClose}
              size="small"
              title={sidebarCollapsed ? '展开文档列表' : '收起文档列表'}
              onClick={() => setSidebarCollapsed((c) => !c)}
            />
          )}
        </Flexbox>
      </div>

      <div className="collab-pane-body">
        {/* Document list sidebar */}
        <ResizableSidebar
          side={sidebarSide}
          storageKey={`collab-doc-sidebar-${sidebarSide}`}
          defaultWidth={180}
          minWidth={140}
          maxWidth={300}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          style={{ order: sidebarSide === 'left' ? 0 : 2 }}
        >
          <DocumentSidebar
            documents={documents}
            loading={docListLoading}
            activeDocId={activeDocId}
            scope={currentScope}
            onSelectDoc={handleSelectDoc}
            onCreateDoc={handleCreateDoc}
            onRefresh={refreshDocuments}
            onDeleteDoc={(doc) => {
              modal.confirm({
                title: '确认删除',
                content: `确定要删除文档「${doc.title}」吗？`,
                okText: '删除',
                okType: 'danger',
                cancelText: '取消',
                onOk: async () => {
                  try {
                    const client = manager!.getHttpClient()
                    await client.deleteDocument(doc.id, currentScope)
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

        {/* Editor main area */}
        <Flexbox flex={1} style={{ order: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          {activeDocId && ctx.loading ? (
            <div style={{ padding: '32px 48px' }}>
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
                  description="其他客户端修改了此文档。"
                  extra={
                    <Flexbox horizontal gap={8} style={{ marginTop: 4 }}>
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
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: [0.33, 1, 0.68, 1] }}
              >
                <Flexbox align="center" gap={12}>
                  <div className={styles.emptyIcon}>
                    <FileText size={22} />
                  </div>
                  <span className={styles.emptyTitle}>选择或创建文档</span>
                  <span className={styles.emptyDesc}>从侧栏选择文档开始编辑</span>
                  <button type="button" className={styles.emptyActionBtn} onClick={handleCreateDoc}>
                    <FilePlus size={13} />
                    新建文档
                  </button>
                </Flexbox>
              </motion.div>
            </div>
          )}
        </Flexbox>

        {/* Detail panel — reads from Context, no props needed */}
        <ResizableSidebar
          side="right"
          storageKey="collab-doc-detail"
          defaultWidth={220}
          minWidth={180}
          maxWidth={360}
          collapsed={detailCollapsed}
          onCollapsedChange={setDetailCollapsed}
          style={{ order: 3 }}
        >
          <DocumentOutlinePanel />
        </ResizableSidebar>
      </div>

      {/* Version history — reads from Context */}
      {activeDocId && <VersionHistoryDrawer />}
    </section>
  )
}

export default memo(DocumentPane)
