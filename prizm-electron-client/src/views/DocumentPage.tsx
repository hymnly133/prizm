/**
 * DocumentPage - 全页面文档编辑视图
 * 三栏布局：文档侧边栏 | 编辑器主区 | 右侧信息面板
 */
import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { App, Modal } from 'antd'
import { Alert, DraggablePanel, Empty, Flexbox, Skeleton, toast } from '@lobehub/ui'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import type { Document as PrizmDocument } from '@prizm/client-core'
import { MarkdownEditor, EditorToolbar, SplitEditor } from '../components/editor'
import type { EditorMode } from '../components/editor'
import DocumentSidebar from '../components/DocumentSidebar'
import DocumentHeader from '../components/DocumentHeader'
import DocumentOutlinePanel from '../components/DocumentOutlinePanel'
import VersionHistoryDrawer from '../components/VersionHistoryDrawer'
import { useDocument } from '../hooks/useDocument'
import { useDocumentVersions } from '../hooks/useDocumentVersions'
import { useScope } from '../hooks/useScope'
import { usePrizmContext } from '../context/PrizmContext'
import { useDocumentNavigation } from '../context/DocumentNavigationContext'
import { subscribeSyncEvents } from '../events/syncEventEmitter'

const EDITOR_MODE_KEY = 'prizm-doc-editor-mode'
const PANEL_VISIBLE_KEY = 'prizm-doc-panel-visible'

/** 字数统计（中文按字计、英文按词计） */
function countWords(text: string): number {
  if (!text) return 0
  const chinese = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  const english = text
    .replace(/[\u4e00-\u9fff]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0).length
  return chinese + english
}

interface DocumentPageProps {
  dirtyRef?: React.MutableRefObject<boolean>
}

export default function DocumentPage({ dirtyRef }: DocumentPageProps = {}) {
  const { modal } = App.useApp()
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const { consumePendingDoc, pendingDocId } = useDocumentNavigation()
  const editorRef = useRef<ReactCodeMirrorRef | null>(null)

  // 文档列表
  const [documents, setDocuments] = useState<PrizmDocument[]>([])
  const [docListLoading, setDocListLoading] = useState(false)
  const [activeDocId, setActiveDocId] = useState<string | null>(null)

  // 编辑器状态
  const [editorMode, setEditorMode] = useState<EditorMode>(() => {
    try {
      return (localStorage.getItem(EDITOR_MODE_KEY) as EditorMode) || 'source'
    } catch {
      return 'source'
    }
  })
  const [rightPanelVisible, setRightPanelVisible] = useState(() => {
    try {
      return localStorage.getItem(PANEL_VISIBLE_KEY) !== 'false'
    } catch {
      return true
    }
  })

  const {
    document: currentDoc,
    loading: docLoading,
    saving,
    error: docError,
    dirty,
    externalUpdate,
    content,
    title,
    tags,
    setContent,
    setTitle,
    setTags,
    save,
    reload,
    loadDocument,
    clearExternalUpdate
  } = useDocument({ scope: currentScope, autoSaveMs: 8000 })

  const { versions, fetchVersions } = useDocumentVersions()
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false)

  // 文档列表加载
  const refreshDocuments = useCallback(async () => {
    if (!manager) return
    setDocListLoading(true)
    try {
      const client = manager.getHttpClient()
      const docs = await client.listDocuments({ scope: currentScope })
      setDocuments(docs)
    } catch (e) {
      toast.error(`加载文档列表失败: ${String(e)}`)
    } finally {
      setDocListLoading(false)
    }
  }, [manager, currentScope])

  useEffect(() => {
    void refreshDocuments()
  }, [refreshDocuments])

  // 同步 dirty 状态到外部 ref（用于离开保护）
  useEffect(() => {
    if (dirtyRef) dirtyRef.current = dirty
  }, [dirty, dirtyRef])

  // 消费来自其他页面的导航请求
  useEffect(() => {
    if (pendingDocId) {
      const docId = consumePendingDoc()
      if (docId) {
        setActiveDocId(docId)
        void loadDocument(docId)
        void fetchVersions(docId, currentScope)
      }
    }
  }, [pendingDocId, consumePendingDoc, loadDocument, fetchVersions, currentScope])

  // WebSocket: 监听文档列表变更事件，自动刷新
  useEffect(() => {
    const unsub = subscribeSyncEvents((eventType) => {
      if (
        eventType === 'document:created' ||
        eventType === 'document:updated' ||
        eventType === 'document:deleted'
      ) {
        void refreshDocuments()
      }
    })
    return unsub
  }, [refreshDocuments])

  // 选择文档
  const handleSelectDoc = useCallback(
    (doc: PrizmDocument) => {
      setActiveDocId(doc.id)
      void loadDocument(doc.id)
      void fetchVersions(doc.id, currentScope)
    },
    [loadDocument, fetchVersions, currentScope]
  )

  // 创建文档
  const handleCreateDoc = useCallback(async () => {
    if (!manager) return
    try {
      const client = manager.getHttpClient()
      const doc = await client.createDocument({ title: '新文档', content: '' }, currentScope)
      await refreshDocuments()
      handleSelectDoc(doc)
      toast.success('文档已创建')
    } catch (e) {
      toast.error(`创建文档失败: ${String(e)}`)
    }
  }, [manager, currentScope, refreshDocuments, handleSelectDoc])

  // 保存文档
  const handleSave = useCallback(async () => {
    const ok = await save()
    if (ok) {
      toast.success('已保存')
      void refreshDocuments()
    } else {
      toast.error('保存失败，请重试')
    }
  }, [save, refreshDocuments])

  // 删除文档
  const handleDelete = useCallback(() => {
    if (!currentDoc || !manager) return
    modal.confirm({
      title: '确认删除',
      content: `确定要删除文档「${currentDoc.title}」吗？此操作不可撤销。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const client = manager.getHttpClient()
          await client.deleteDocument(currentDoc.id, currentScope)
          setActiveDocId(null)
          await refreshDocuments()
          toast.success('文档已删除')
        } catch (e) {
          toast.error(`删除失败: ${String(e)}`)
        }
      }
    })
  }, [currentDoc, manager, currentScope, modal, refreshDocuments])

  // 模式切换
  const handleModeChange = useCallback((mode: EditorMode) => {
    setEditorMode(mode)
    try {
      localStorage.setItem(EDITOR_MODE_KEY, mode)
    } catch {
      /* ignore */
    }
  }, [])

  // 处理外部冲突
  const handleReloadExternal = useCallback(() => {
    clearExternalUpdate()
    void reload()
  }, [clearExternalUpdate, reload])

  const handleOverrideExternal = useCallback(() => {
    clearExternalUpdate()
  }, [clearExternalUpdate])

  // 字数统计
  const charCount = content.length
  const wordCount = useMemo(() => countWords(content), [content])

  return (
    <div className="doc-page">
      {/* 左侧：文档侧边栏 */}
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
            content: `确定要删除文档「${doc.title}」吗？此操作不可撤销。`,
            okText: '删除',
            okType: 'danger',
            cancelText: '取消',
            onOk: async () => {
              try {
                const client = manager!.getHttpClient()
                await client.deleteDocument(doc.id, currentScope)
                if (activeDocId === doc.id) setActiveDocId(null)
                await refreshDocuments()
                toast.success('文档已删除')
              } catch (e) {
                toast.error(`删除失败: ${String(e)}`)
              }
            }
          })
        }}
      />

      {/* 中间：编辑器主区 */}
      <div className="doc-page-main">
        {activeDocId && docLoading ? (
          <div style={{ padding: 24 }}>
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        ) : activeDocId && currentDoc ? (
          <>
            {/* 外部冲突提示 */}
            {externalUpdate && (
              <Alert
                type="warning"
                banner
                showIcon
                message="文档已被外部修改"
                description="其他客户端修改了此文档，您可以重新加载最新内容或覆盖保存。"
                extra={
                  <Flexbox horizontal gap={8} style={{ marginTop: 8 }}>
                    <button
                      className="editor-toolbar-btn"
                      onClick={handleReloadExternal}
                      style={{ padding: '4px 12px', width: 'auto', height: 'auto', fontSize: 12 }}
                    >
                      重新加载
                    </button>
                    <button
                      className="editor-toolbar-btn"
                      onClick={handleOverrideExternal}
                      style={{ padding: '4px 12px', width: 'auto', height: 'auto', fontSize: 12 }}
                    >
                      忽略
                    </button>
                  </Flexbox>
                }
              />
            )}

            {/* 错误提示 */}
            {docError && <Alert type="error" banner showIcon closable message={docError} />}

            <DocumentHeader
              title={title}
              tags={tags}
              content={content}
              updatedAt={currentDoc.updatedAt}
              dirty={dirty}
              saving={saving}
              onTitleChange={setTitle}
              onTagsChange={setTags}
              onSave={handleSave}
              onDelete={handleDelete}
              onShowVersions={() => {
                void fetchVersions(currentDoc.id, currentScope)
                setVersionDrawerOpen(true)
              }}
            />
            <EditorToolbar
              mode={editorMode}
              onModeChange={handleModeChange}
              editorRef={editorRef}
              wordCount={wordCount}
              charCount={charCount}
              readOnly={false}
            />
            <div className="doc-page-editor">
              {editorMode === 'split' ? (
                <SplitEditor
                  value={content}
                  onChange={setContent}
                  onSave={handleSave}
                  editorRef={editorRef}
                />
              ) : (
                <MarkdownEditor
                  value={content}
                  onChange={setContent}
                  mode={editorMode}
                  onSave={handleSave}
                  editorRef={editorRef}
                />
              )}
            </div>
          </>
        ) : (
          <Flexbox align="center" justify="center" style={{ height: '100%', opacity: 0.6 }}>
            <Empty
              title="选择或创建文档"
              description="从左侧列表选择一个文档开始编辑，或点击 + 创建新文档"
            />
          </Flexbox>
        )}
      </div>

      {/* 右侧：大纲/信息面板 (DraggablePanel) */}
      {activeDocId && currentDoc && (
        <DraggablePanel
          placement="right"
          defaultSize={{ width: 260 }}
          minWidth={200}
          maxWidth={400}
          expand={rightPanelVisible}
          expandable
          onExpandChange={(expand) => {
            setRightPanelVisible(expand)
            try {
              localStorage.setItem(PANEL_VISIBLE_KEY, String(expand))
            } catch {
              /* ignore */
            }
          }}
          showHandleWideArea
        >
          <DocumentOutlinePanel
            content={content}
            editorRef={editorRef}
            charCount={charCount}
            wordCount={wordCount}
            versionCount={versions.length}
            onShowVersions={() => setVersionDrawerOpen(true)}
            documentId={activeDocId ?? undefined}
            scope={currentScope}
          />
        </DraggablePanel>
      )}

      {/* 版本历史抽屉 */}
      {activeDocId && (
        <VersionHistoryDrawer
          open={versionDrawerOpen}
          onClose={() => setVersionDrawerOpen(false)}
          documentId={activeDocId}
          onRestore={() => void reload()}
        />
      )}
    </div>
  )
}
