/**
 * DocumentPane — 协作页文档半屏面板
 * 精简版文档编辑器：文档列表侧边栏 + 现代化编辑器主区 + 可折叠详情面板
 * 通过 DocumentDetailProvider 提供文档数据，子组件自动从 Context 读取。
 * 模式切换（Live/源码/预览/分栏）集成在面板标题栏内
 *
 * CRUD 操作由 useDocumentActions 提供，编辑器模式由 useEditorMode 管理，
 * 编辑器主区渲染由 DocumentEditorZone 封装。
 */
import { useState, useCallback, useEffect, memo } from 'react'
import { ActionIcon, Flexbox } from '@lobehub/ui'
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
import { DocumentEditorZone } from '../editor'
import type { EditorMode } from '../editor'
import { Segmented } from '../ui/Segmented'
import DocumentSidebar from '../DocumentSidebar'
import DocumentOutlinePanel from '../DocumentOutlinePanel'
import VersionHistoryDrawer from '../VersionHistoryDrawer'
import { ResizableSidebar } from '../layout'
import { DocumentDetailProvider, useDocumentDetail } from '../../context/DocumentDetailContext'
import { useScope } from '../../hooks/useScope'
import { useDocumentActions } from '../../hooks/useDocumentActions'
import { useEditorMode } from '../../hooks/useEditorMode'
import { useScopeDataStore } from '../../store/scopeDataStore'

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
  const { currentScope } = useScope()
  const { styles } = useStyles()
  const ctx = useDocumentDetail()

  const documents = useScopeDataStore((s) => s.documents)
  const docListLoading = useScopeDataStore((s) => s.documentsLoading)
  const refreshDocuments = useScopeDataStore((s) => s.refreshDocuments)

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [detailCollapsed, setDetailCollapsed] = useState(true)

  const { editorMode, handleModeChange } = useEditorMode('prizm-collab-doc-editor-mode')
  const actions = useDocumentActions({
    scope: currentScope,
    activeDocId,
    setActiveDocId,
    ctx
  })

  useEffect(() => {
    if (dirtyRef) dirtyRef.current = ctx.dirty
  }, [ctx.dirty, dirtyRef])

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
          <ActionIcon icon={Plus} title="新建文档" size="small" onClick={actions.handleCreateDoc} />
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
            onSelectDoc={actions.handleSelectDoc}
            onCreateDoc={actions.handleCreateDoc}
            onRefresh={refreshDocuments}
            onDeleteDoc={actions.handleSidebarDeleteDoc}
          />
        </ResizableSidebar>

        {/* Editor main area */}
        <Flexbox flex={1} style={{ order: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          {activeDocId && (ctx.loading || ctx.document) ? (
            <DocumentEditorZone
              editorMode={editorMode}
              onModeChange={handleModeChange}
              onSave={actions.handleSave}
              onDelete={actions.handleDelete}
              onReloadExternal={actions.handleReloadExternal}
              onOverrideExternal={actions.handleOverrideExternal}
              contentMaxWidth={680}
              contentPadding="0 32px"
              externalUpdateDesc="其他客户端修改了此文档。"
              loadingPadding="32px 48px"
            />
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
                  <button type="button" className={styles.emptyActionBtn} onClick={actions.handleCreateDoc}>
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
