/**
 * WorkPage - 工作页：中间大卡片展示便签/任务/文档，现代交互
 */
import { useState, useMemo, useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ActionIcon, Button, Checkbox, Drawer, Empty, Skeleton, toast } from '@lobehub/ui'
import { App } from 'antd'
import ScopeSidebar from '../components/ui/ScopeSidebar'
import SearchSection from '../components/SearchSection'
import FileDetailView from '../components/FileDetailView'
import DataCard from '../components/DataCard'
import { useScope } from '../hooks/useScope'
import { useFileList } from '../hooks/useFileList'
import { usePrizmContext } from '../context/PrizmContext'
import { useLogsContext } from '../context/LogsContext'
import type { FileKind, FileItem } from '../hooks/useFileList'
import type { TodoItemStatus } from '@prizm/client-core'
import { FileText, StickyNote } from 'lucide-react'

export default function WorkPage() {
  const { modal } = App.useApp()
  const { manager } = usePrizmContext()
  const { addLog } = useLogsContext()
  const { currentScope, scopes, scopesLoading, getScopeLabel, setScope } = useScope()
  const { fileList, fileListLoading, refreshFileList } = useFileList(currentScope)

  const [activeTab, setActiveTab] = useState('notes')
  const [categoryFilter, setCategoryFilter] = useState<Record<FileKind, boolean>>({
    note: true,
    todoList: true,
    document: true
  })
  const [selectedFile, setSelectedFile] = useState<{
    kind: FileKind
    id: string
  } | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    setSelectedFile(null)
    setDrawerOpen(false)
  }, [currentScope])

  useEffect(() => {
    setDrawerOpen(!!selectedFile)
  }, [selectedFile])

  const filteredFileList = useMemo(() => {
    return fileList.filter((f) => categoryFilter[f.kind])
  }, [fileList, categoryFilter])

  const selectedFileData = useMemo(() => {
    if (!selectedFile) return null
    const { kind, id } = selectedFile
    return fileList.find((f) => f.kind === kind && f.id === id) ?? null
  }, [selectedFile, fileList])

  function onSelectFile(payload: { kind: FileKind; id: string }) {
    setSelectedFile(payload)
  }

  async function onAddNote() {
    const http = manager?.getHttpClient()
    if (!http) return
    try {
      const note = await http.createNote({ content: '' }, currentScope)
      await refreshFileList(currentScope, { silent: true })
      setSelectedFile({ kind: 'note', id: note.id })
      addLog('已创建便签', 'success')
    } catch (e) {
      addLog(`创建便签失败: ${String(e)}`, 'error')
    }
  }

  async function onAddDocument() {
    const http = manager?.getHttpClient()
    if (!http) return
    try {
      const doc = await http.createDocument({ title: '未命名文档', content: '' }, currentScope)
      await refreshFileList(currentScope, { silent: true })
      setSelectedFile({ kind: 'document', id: doc.id })
      addLog('已创建文档', 'success')
    } catch (e) {
      addLog(`创建文档失败: ${String(e)}`, 'error')
    }
  }

  async function onDeleteFile() {
    const f = selectedFileData
    if (!f || !manager) return
    const http = manager.getHttpClient()
    try {
      if (f.kind === 'note') {
        await http.deleteNote(f.id, currentScope)
      } else if (f.kind === 'todoList') {
        await http.updateTodoList({ items: [] }, currentScope)
      } else {
        await http.deleteDocument(f.id, currentScope)
      }
      setSelectedFile(null)
      setDrawerOpen(false)
      await refreshFileList(currentScope, { silent: true })
      addLog('已删除', 'success')
    } catch (e) {
      addLog(`删除失败: ${String(e)}`, 'error')
    }
  }

  async function handleDeleteFile(file: FileItem) {
    modal.confirm({
      title: '确认删除',
      content: `确定要删除「${file.title}」吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        if (!manager) return
        const http = manager.getHttpClient()
        try {
          if (file.kind === 'note') {
            await http.deleteNote(file.id, currentScope)
          } else if (file.kind === 'todoList') {
            await http.updateTodoList({ items: [] }, currentScope)
          } else {
            await http.deleteDocument(file.id, currentScope)
          }
          if (selectedFile?.kind === file.kind && selectedFile?.id === file.id) {
            setSelectedFile(null)
            setDrawerOpen(false)
          }
          await refreshFileList(currentScope, { silent: true })
          addLog('已删除', 'success')
        } catch (e) {
          addLog(`删除失败: ${String(e)}`, 'error')
        }
      }
    })
  }

  const refreshScope = () => refreshFileList(currentScope)
  const shouldReduceMotion = useReducedMotion()

  async function onTodoItemStatus(itemId: string, status: string) {
    if (!manager || !['todo', 'doing', 'done'].includes(status)) return
    const labels: Record<string, string> = { todo: '待办', doing: '进行中', done: '已完成' }
    try {
      await manager
        .getHttpClient()
        .updateTodoItem(itemId, { status: status as TodoItemStatus }, currentScope)
      await refreshFileList(currentScope, { silent: true })
      toast.success(`已设为 ${labels[status] ?? status}`)
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
        scale: 0.96,
        ...(shouldReduceMotion ? {} : { y: 8 })
      },
      animate: {
        opacity: 1,
        scale: 1,
        y: 0,
        transition: {
          duration: shouldReduceMotion ? 0.1 : 0.25,
          ease: 'easeOut' as const
        }
      },
      exit: {
        opacity: 0,
        scale: 0.96,
        ...(shouldReduceMotion ? {} : { y: -8 }),
        transition: {
          duration: shouldReduceMotion ? 0.05 : 0.2,
          ease: 'easeIn' as const
        }
      }
    }),
    [shouldReduceMotion]
  )

  const layoutTransition = useMemo(
    () =>
      shouldReduceMotion
        ? { layout: { duration: 0 } }
        : { layout: { duration: 0.25, ease: 'easeOut' as const } },
    [shouldReduceMotion]
  )

  return (
    <section className="work-page work-page--cards">
      <div className="work-page__toolbar">
        <div className="work-page__toolbar-left">
          <div className="work-page__category-filter">
            <Checkbox
              checked={categoryFilter.note}
              onChange={(checked) => setCategoryFilter((f) => ({ ...f, note: checked }))}
            >
              便签
            </Checkbox>
            <Checkbox
              checked={categoryFilter.todoList}
              onChange={(checked) => setCategoryFilter((f) => ({ ...f, todoList: checked }))}
            >
              TODO
            </Checkbox>
            <Checkbox
              checked={categoryFilter.document}
              onChange={(checked) => setCategoryFilter((f) => ({ ...f, document: checked }))}
            >
              文档
            </Checkbox>
          </div>
          <ScopeSidebar
            scopes={scopes}
            getScopeLabel={getScopeLabel}
            scopesLoading={scopesLoading}
            currentScope={currentScope}
            onSelect={setScope}
          />
          <SearchSection
            activeTab={activeTab}
            scope={currentScope}
            onActiveTabChange={setActiveTab}
            onRefreshNotes={refreshScope}
            onRefreshTasks={refreshScope}
            onRefreshClipboard={() => {}}
            onSelectFile={onSelectFile}
          />
        </div>
        <div className="work-page__toolbar-actions">
          <ActionIcon icon={StickyNote} title="新建便签" onClick={onAddNote} size="large" />
          <ActionIcon icon={FileText} title="新建文档" onClick={onAddDocument} size="large" />
        </div>
      </div>

      <div className="work-page__content">
        {fileListLoading ? (
          <div className="work-page__cards-grid">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="data-card data-card--skeleton">
                <Skeleton active paragraph={{ rows: 4 }} />
              </div>
            ))}
          </div>
        ) : filteredFileList.length === 0 ? (
          <div className="work-page__empty">
            <Empty
              description={
                fileList.length === 0
                  ? '暂无内容，创建便签或文档开始工作'
                  : '没有符合条件的项，勾选上方类别筛选'
              }
              imageSize={80}
              action={
                fileList.length === 0 ? (
                  <div className="work-page__empty-actions">
                    <Button type="primary" onClick={onAddNote}>
                      新建便签
                    </Button>
                    <Button onClick={onAddDocument}>新建文档</Button>
                  </div>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="work-page__cards-grid">
            <AnimatePresence mode="popLayout" initial={false}>
              {filteredFileList.map((file) => (
                <motion.div
                  key={`${file.kind}-${file.id}`}
                  layout
                  transition={layoutTransition}
                  variants={cardVariants}
                  initial="enter"
                  animate="animate"
                  exit="exit"
                  style={{ position: 'relative' }}
                >
                  <DataCard
                    file={file}
                    onClick={() => onSelectFile({ kind: file.kind, id: file.id })}
                    onDelete={() => handleDeleteFile(file)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <Drawer
        title={
          selectedFileData
            ? selectedFileData.kind === 'todoList'
              ? 'TODO'
              : selectedFileData.kind === 'note'
              ? '便签'
              : '文档'
            : ''
        }
        placement="right"
        open={drawerOpen}
        onClose={() => {
          setSelectedFile(null)
          setDrawerOpen(false)
        }}
        width={420}
        styles={{ body: { paddingTop: 12 } }}
      >
        {selectedFileData && (
          <FileDetailView
            file={selectedFileData}
            onDelete={onDeleteFile}
            onDone={() => {}}
            onTodoItemStatus={selectedFileData.kind === 'todoList' ? onTodoItemStatus : undefined}
          />
        )}
      </Drawer>
    </section>
  )
}
