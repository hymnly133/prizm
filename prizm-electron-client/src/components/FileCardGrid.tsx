/**
 * FileCardGrid - 工作页平铺视图：待办与文档卡片网格，含加载/空状态
 *
 * 卡片操作按钮（编辑、聊天、删除）内置于 DataCard，通过 CSS hover 显示。
 */
import { memo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Empty, Skeleton } from '@lobehub/ui'
import DataCard from './DataCard'
import type { FileItem } from '../hooks/useFileList'

export type FileCardGridVariants = {
  [key: string]: { opacity: number; scale: number; y?: number; transition?: object }
}

export interface FileCardGridProps {
  loading: boolean
  fileListLength: number
  todoItems: FileItem[]
  docItems: FileItem[]
  currentScope: string
  onSelectFile: (payload: { kind: FileItem['kind']; id: string }) => void
  onDeleteFile: (file: FileItem) => void
  /** 编辑文档（直接进入编辑器） */
  onEditDoc?: (docId: string) => void
  /** 聊聊他 */
  onChatFile?: (file: FileItem) => void
  cardVariants: FileCardGridVariants
  onAddDocument: () => void
  onAddTodo: () => void
}

function FileCardGrid({
  loading,
  fileListLength,
  todoItems,
  docItems,
  currentScope,
  onSelectFile,
  onDeleteFile,
  onEditDoc,
  onChatFile,
  cardVariants,
  onAddDocument,
  onAddTodo
}: FileCardGridProps) {
  const filteredLength = todoItems.length + docItems.length

  if (loading) {
    return (
      <div className="work-page__cards-grid work-page__cards-grid--variable">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="work-page__card-item work-page__card-item--skeleton">
            <div className="data-card data-card--skeleton">
              <Skeleton active paragraph={{ rows: 4 }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (filteredLength === 0) {
    return (
      <div className="work-page__empty">
        <Empty
          description={
            fileListLength === 0
              ? '暂无内容，创建文档或待办开始工作'
              : '没有符合条件的项，勾选上方类别筛选'
          }
          imageSize={80}
          action={
            fileListLength === 0 ? (
              <div className="work-page__empty-actions">
                <Button type="primary" onClick={onAddDocument}>
                  新建文档
                </Button>
                <Button onClick={onAddTodo}>新建待办</Button>
              </div>
            ) : undefined
          }
        />
      </div>
    )
  }

  return (
    <>
      <div className="work-page__cards-grid work-page__cards-grid--variable">
        <AnimatePresence initial={false}>
          {todoItems.map((file) => (
            <motion.div
              key={`${file.kind}-${file.id}`}
              className={`work-page__card-item work-page__card-item--${file.kind}`}
              variants={cardVariants}
              initial="enter"
              animate="animate"
              exit="exit"
            >
              <DataCard
                file={file}
                onClick={() => onSelectFile({ kind: file.kind, id: file.id })}
                onDelete={() => onDeleteFile(file)}
                onChat={onChatFile ? () => onChatFile(file) : undefined}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {todoItems.length > 0 && docItems.length > 0 && (
          <motion.div
            key="section-divider"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.18 } }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
          >
            <div className="work-page__section-divider" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="work-page__cards-grid work-page__cards-grid--variable">
        <AnimatePresence initial={false}>
          {docItems.map((file) => (
            <motion.div
              key={`${file.kind}-${file.id}`}
              className={`work-page__card-item work-page__card-item--${file.kind}`}
              variants={cardVariants}
              initial="enter"
              animate="animate"
              exit="exit"
            >
              <DataCard
                file={file}
                onClick={() => onSelectFile({ kind: file.kind, id: file.id })}
                onDelete={() => onDeleteFile(file)}
                onEdit={
                  file.kind === 'document' && onEditDoc ? () => onEditDoc(file.id) : undefined
                }
                onChat={onChatFile ? () => onChatFile(file) : undefined}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  )
}

export default memo(FileCardGrid)
