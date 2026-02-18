/**
 * WorkPage - 统一内容管理页：卡片网格浏览（文档编辑已拆分至独立 DocumentEditorPage）
 */
import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react'
import { useReducedMotion } from 'motion/react'
import { Button, Flexbox, Markdown, Modal, toast } from '@lobehub/ui'
import { App } from 'antd'
import FileDetailView from '../components/FileDetailView'
import DocumentPreviewModal from '../components/DocumentPreviewModal'
import WorkPageToolbar from '../components/WorkPageToolbar'
import FileCardGrid from '../components/FileCardGrid'
import { useScope } from '../hooks/useScope'
import { useFileList, docToFileItem, todoToFileItem } from '../hooks/useFileList'
import { usePrizmContext } from '../context/PrizmContext'
import { useLogsContext } from '../context/LogsContext'
import { useWorkNavigation } from '../context/WorkNavigationContext'
import { useDocumentNavigation, useChatWithFile } from '../context/NavigationContext'
import type { FileKind, FileItem } from '../hooks/useFileList'
import type { TodoItemStatus } from '@prizm/client-core'
import type { SavePayload } from '../components/FileDetailView'
import { getKindLabel, STATUS_LABELS } from '../constants/todo'
import { WorkFolderView } from '../components/WorkFolderView'
import { WorkspaceFoldersSection } from '../components/WorkspaceFoldersSection'
import { useImportContext } from '../context/ImportContext'
import type { TreeNode } from '../hooks/useFileTree'

const VIEW_MODE_KEY = 'prizm-work-view-mode'

const EASE_SMOOTH = [0.33, 1, 0.68, 1] as const
const EASE_OUT_SMOOTH = [0.16, 1, 0.3, 1] as const

function WorkPage() {
  const { modal } = App.useApp()
  const { manager } = usePrizmContext()
  const { addLog } = useLogsContext()
  const { currentScope } = useScope()
  const { fileList, fileListLoading, refreshFileList, optimisticAdd, optimisticRemove } =
    useFileList(currentScope)
  const { pendingWorkFile, consumePendingWorkFile } = useWorkNavigation()
  const { navigateToDocs } = useDocumentNavigation()
  const { chatWith } = useChatWithFile()
  const { startImportFromFileDialog } = useImportContext()

  const [activeTab, setActiveTab] = useState('files')
  const [viewMode, setViewMode] = useState<'flat' | 'folder'>(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_KEY)
      return saved === 'folder' ? 'folder' : 'flat'
    } catch {
      return 'flat'
    }
  })
  const [categoryFilter, setCategoryFilter] = useState<Record<FileKind, boolean>>({
    note: true,
    todoList: true,
    document: true
  })
  const [selectedFile, setSelectedFile] = useState<{
    kind: FileKind
    id: string
  } | null>(null)
  const [genericFilePreview, setGenericFilePreview] = useState<{
    path: string
    name: string
    content?: string
    loading?: boolean
  } | null>(null)
  const filePreviewFetchingRef = useRef<string | null>(null)
  useEffect(() => {
    setSelectedFile(null)
    setGenericFilePreview(null)
  }, [currentScope])

  useEffect(() => {
    if (!genericFilePreview || genericFilePreview.content !== undefined) return
    if (filePreviewFetchingRef.current === genericFilePreview.path) return
    const http = manager?.getHttpClient()
    if (!http) return
    const targetPath = genericFilePreview.path
    filePreviewFetchingRef.current = targetPath
    setGenericFilePreview((prev) => prev && { ...prev, loading: true })
    http
      .fileRead(targetPath, currentScope)
      .then((result) => {
        setGenericFilePreview((prev) =>
          prev && prev.path === targetPath
            ? { ...prev, content: result.content, loading: false }
            : prev
        )
      })
      .catch(() => {
        setGenericFilePreview((prev) =>
          prev && prev.path === targetPath
            ? { ...prev, content: '(无法读取文件内容)', loading: false }
            : prev
        )
      })
      .finally(() => {
        if (filePreviewFetchingRef.current === targetPath) {
          filePreviewFetchingRef.current = null
        }
      })
  }, [genericFilePreview, manager, currentScope])

  useEffect(() => {
    if (!pendingWorkFile) return
    const { kind, id } = pendingWorkFile
    consumePendingWorkFile()
    // document 类型已由 NavigationContext.openFileAtWork 重定向到 docs 页
    if (kind === 'document') return
    const exists = fileList.some((f) => f.kind === kind && f.id === id)
    if (exists) {
      setSelectedFile(pendingWorkFile)
    } else {
      refreshFileList(currentScope, { silent: true }).then(() => {
        setSelectedFile(pendingWorkFile)
      })
    }
  }, [pendingWorkFile, consumePendingWorkFile, fileList, currentScope, refreshFileList])

  const filteredFileList = useMemo(() => {
    return fileList.filter((f) => categoryFilter[f.kind])
  }, [fileList, categoryFilter])

  const todoItems = useMemo(
    () => filteredFileList.filter((f) => f.kind === 'todoList'),
    [filteredFileList]
  )
  const docItems = useMemo(
    () => filteredFileList.filter((f) => f.kind !== 'todoList'),
    [filteredFileList]
  )

  const selectedFileData = useMemo(() => {
    if (!selectedFile) return null
    const { kind, id } = selectedFile
    return fileList.find((f) => f.kind === kind && f.id === id) ?? null
  }, [selectedFile, fileList])

  function onSelectFile(payload: { kind: FileKind; id: string }) {
    setSelectedFile(payload)
  }

  const handleEditDoc = useCallback(
    (docId: string) => {
      navigateToDocs(docId)
    },
    [navigateToDocs]
  )

  const handleChatFile = useCallback(
    (file: FileItem) => {
      chatWith({ files: [{ kind: file.kind, id: file.id, title: file.title }] })
    },
    [chatWith]
  )

  async function onAddDocument() {
    const http = manager?.getHttpClient()
    if (!http) return
    try {
      const doc = await http.createDocument({ title: '未命名文档', content: '' }, currentScope)
      optimisticAdd(docToFileItem(doc))
      navigateToDocs(doc.id)
      addLog('已创建文档', 'success')
    } catch (e) {
      addLog(`创建文档失败: ${String(e)}`, 'error')
    }
  }

  async function onAddTodo() {
    const http = manager?.getHttpClient()
    if (!http) return
    try {
      const todoList = await http.createTodoList(currentScope, { title: '待办' })
      optimisticAdd(todoToFileItem(todoList))
      setSelectedFile({ kind: 'todoList', id: todoList.id })
      addLog('已新建待办列表', 'success')
    } catch (e) {
      addLog(`创建待办失败: ${String(e)}`, 'error')
    }
  }

  async function onSaveFile(payload: SavePayload) {
    const f = selectedFileData
    const http = manager?.getHttpClient()
    if (!http || !f) return
    try {
      if (payload.kind === 'document') {
        await http.updateDocument(
          f.id,
          { title: payload.title, content: payload.content },
          currentScope
        )
      } else if (payload.kind === 'todoList') {
        await http.updateTodoListTitle(currentScope, f.id, payload.title)
        await http.replaceTodoItems(currentScope, f.id, payload.items)
      }
      addLog('已保存', 'success')
    } catch (e) {
      addLog(`保存失败: ${String(e)}`, 'error')
      throw e
    }
  }

  async function doDeleteFile(file: FileItem) {
    if (!manager) return
    const http = manager.getHttpClient()
    // 乐观删除：立即从 UI 移除
    optimisticRemove(file.kind, file.id)
    if (selectedFile?.kind === file.kind && selectedFile?.id === file.id) {
      setSelectedFile(null)
    }
    try {
      if (file.kind === 'todoList') {
        await http.deleteTodoList(currentScope, file.id)
      } else {
        await http.deleteDocument(file.id, currentScope)
      }
      addLog('已删除', 'success')
    } catch (e) {
      // 删除失败时恢复
      optimisticAdd(file)
      throw e
    }
  }

  async function onDeleteFile() {
    const f = selectedFileData
    if (!f) return
    try {
      await doDeleteFile(f)
    } catch (e) {
      addLog(`删除失败: ${String(e)}`, 'error')
    }
  }

  function handleDeleteFile(file: FileItem) {
    modal.confirm({
      title: '确认删除',
      content: `确定要删除「${file.title}」吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await doDeleteFile(file)
        } catch (e) {
          addLog(`删除失败: ${String(e)}`, 'error')
        }
      }
    })
  }

  function closePreview() {
    setSelectedFile(null)
  }

  const handleViewModeChange = useCallback((mode: 'flat' | 'folder') => {
    setViewMode(mode)
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode)
    } catch {
      // ignore
    }
  }, [])

  const handleCategoryFilterChange = useCallback((kind: FileKind, checked: boolean) => {
    setCategoryFilter((f) => ({ ...f, [kind]: checked }))
  }, [])

  const handleFolderNodeClick = useCallback((node: TreeNode) => {
    if (node.prizmId && node.prizmType) {
      const kind: FileKind = node.prizmType === 'document' ? 'document' : 'todoList'
      setSelectedFile({ kind, id: node.prizmId })
    } else {
      setGenericFilePreview({ path: node.id, name: node.name })
    }
  }, [])

  const handleNavigateToFolder = useCallback(() => {
    handleViewModeChange('folder')
  }, [handleViewModeChange])

  const refreshScope = useCallback(
    () => refreshFileList(currentScope),
    [currentScope, refreshFileList]
  )
  const shouldReduceMotion = useReducedMotion()

  async function onTodoItemStatus(itemId: string, status: string) {
    if (!manager || !['todo', 'doing', 'done'].includes(status)) return
    try {
      await manager
        .getHttpClient()
        .updateTodoItem(itemId, { status: status as TodoItemStatus }, currentScope)
      toast.success(`已设为 ${STATUS_LABELS[status as TodoItemStatus] ?? status}`)
      addLog('已更新 TODO 状态', 'success')
    } catch (e) {
      toast.error('更新失败')
      addLog(`更新失败: ${String(e)}`, 'error')
    }
  }

  const cardVariants = useMemo(
    () => ({
      enter: {
        opacity: 0,
        scale: 0.95,
        ...(shouldReduceMotion ? {} : { y: 6 })
      },
      animate: {
        opacity: 1,
        scale: 1,
        y: 0,
        transition: {
          duration: shouldReduceMotion ? 0.1 : 0.22,
          ease: EASE_SMOOTH
        }
      },
      exit: {
        opacity: 0,
        scale: 0.95,
        transition: {
          duration: shouldReduceMotion ? 0.05 : 0.2,
          ease: EASE_OUT_SMOOTH
        }
      }
    }),
    [shouldReduceMotion]
  )

  return (
    <section className="work-page work-page--cards">
      <WorkPageToolbar
        categoryFilter={categoryFilter}
        onCategoryFilterChange={handleCategoryFilterChange}
        currentScope={currentScope}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        onRefreshScope={refreshScope}
        onSelectFile={onSelectFile}
        onAddTodo={onAddTodo}
        onAddDocument={onAddDocument}
        onImport={() => void startImportFromFileDialog()}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
      />

      <div className="work-page__content">
        {viewMode === 'flat' ? (
          <>
            <FileCardGrid
              loading={fileListLoading}
              fileListLength={fileList.length}
              todoItems={todoItems}
              docItems={docItems}
              currentScope={currentScope}
              onSelectFile={onSelectFile}
              onDeleteFile={handleDeleteFile}
              onEditDoc={handleEditDoc}
              onChatFile={handleChatFile}
              cardVariants={cardVariants}
              onAddDocument={onAddDocument}
              onAddTodo={onAddTodo}
            />
            <WorkspaceFoldersSection
              scope={currentScope}
              onNavigateToFolder={handleNavigateToFolder}
            />
          </>
        ) : (
          <WorkFolderView scope={currentScope} onSelectFile={handleFolderNodeClick} />
        )}
      </div>

      {/* 文档预览模态 */}
      <DocumentPreviewModal
        open={!!selectedFile && selectedFile.kind === 'document'}
        documentId={selectedFile?.kind === 'document' ? selectedFile.id : null}
        scope={currentScope}
        onClose={closePreview}
        onEdit={handleEditDoc}
      />

      {/* Todo 列表仍使用 Modal 编辑 */}
      <Modal
        destroyOnHidden
        open={!!selectedFile && selectedFile.kind !== 'document'}
        title={selectedFileData ? getKindLabel(selectedFileData.kind) : ''}
        width={800}
        onCancel={closePreview}
        footer={
          <Flexbox horizontal justify="flex-end">
            <Button type="primary" onClick={closePreview}>
              关闭
            </Button>
          </Flexbox>
        }
      >
        {selectedFileData && selectedFileData.kind !== 'document' && (
          <div style={{ paddingTop: 16, maxHeight: '80vh', overflowY: 'auto' }}>
            <FileDetailView
              file={selectedFileData}
              onDelete={onDeleteFile}
              onDone={() => {}}
              onSave={onSaveFile}
              onTodoItemStatus={selectedFileData.kind === 'todoList' ? onTodoItemStatus : undefined}
            />
          </div>
        )}
      </Modal>

      <Modal
        destroyOnHidden
        open={!!genericFilePreview}
        title={genericFilePreview?.name ?? '文件预览'}
        width={800}
        onCancel={() => setGenericFilePreview(null)}
        footer={
          <Flexbox horizontal justify="flex-end">
            <Button type="primary" onClick={() => setGenericFilePreview(null)}>
              关闭
            </Button>
          </Flexbox>
        }
      >
        {genericFilePreview && (
          <div style={{ paddingTop: 16, maxHeight: '80vh', overflowY: 'auto' }}>
            {genericFilePreview.loading ? (
              <div style={{ padding: 24, textAlign: 'center', opacity: 0.5 }}>加载中…</div>
            ) : genericFilePreview.name.endsWith('.md') ? (
              <Markdown>{genericFilePreview.content ?? '(空)'}</Markdown>
            ) : (
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: 13,
                  lineHeight: 1.6,
                  padding: 8,
                  background: 'var(--ant-color-fill-quaternary)',
                  borderRadius: 8
                }}
              >
                {genericFilePreview.content ?? '(空)'}
              </pre>
            )}
          </div>
        )}
      </Modal>
    </section>
  )
}

export default memo(WorkPage)
