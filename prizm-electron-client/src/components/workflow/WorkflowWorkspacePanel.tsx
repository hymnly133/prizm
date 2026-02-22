/**
 * WorkflowWorkspacePanel — 工作空间文件列表 + 预览（纯 LobeUI 版）
 *
 * 完全使用 @lobehub/ui 组件，无自写 CSS。以列表形式展示工作流持久空间与 Run 空间文件。
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Button, Flexbox, Icon, Skeleton, Tag, Text, toast } from '@lobehub/ui'
import { Popconfirm } from 'antd'
import type { ListItemProps } from '@lobehub/ui'
import {
  FolderOpen,
  File,
  Trash2,
  Upload,
  FolderGit2,
  Zap,
  ExternalLink,
  FileText
} from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import type { WorkflowFileEntry, WorkflowRunWorkspaceEntry } from '@prizm/client-core'
import type { WorkflowRun } from '@prizm/shared'
import { Segmented } from '../ui/Segmented'
import { Select } from '../ui/Select'
import { EmptyState } from '../ui/EmptyState'
import { RefreshIconButton } from '../ui/RefreshIconButton'
import { AccentList } from '../ui/AccentList'

export type WorkflowWorkspacePanelMode = 'overview' | 'run-detail'

interface Props {
  workflowName: string
  mode?: WorkflowWorkspacePanelMode
  activeRunId?: string
  runsForWorkflow?: WorkflowRun[]
  onSelectRun?: (runId: string) => void
  onCancelRun?: (runId: string) => void
}

function formatSize(size?: number): string {
  if (size == null) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(ms?: number): string {
  if (ms == null) return '—'
  const d = new Date(ms)
  return d.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function FilePreview({ content, path }: { content: string; path: string }) {
  const ext = path.split('.').pop()?.toLowerCase()
  const isMarkdown = ext === 'md' || ext === 'markdown'
  const isJson = ext === 'json'

  let displayContent = content
  if (isJson) {
    try {
      displayContent = JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      /* use raw */
    }
  }

  return (
    <Flexbox direction="vertical" gap={8}>
      <Flexbox align="center" distribution="space-between" horizontal>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {path}
        </Text>
        <Flexbox gap={4} horizontal>
          {isMarkdown && <Tag color="blue">Markdown</Tag>}
          {isJson && <Tag color="orange">JSON</Tag>}
        </Flexbox>
      </Flexbox>
      <pre
        style={{
          margin: 0,
          padding: 12,
          fontSize: 12,
          fontFamily: 'Fira Code, Cascadia Code, monospace',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 320,
          overflow: 'auto',
          background: 'var(--ant-color-fill-quaternary)',
          border: '1px solid var(--ant-color-border)',
          borderRadius: 8
        }}
      >
        {displayContent}
      </pre>
    </Flexbox>
  )
}

function fileToBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1] ?? ''
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function WorkflowWorkspacePanel({
  workflowName,
  mode = 'overview',
  activeRunId,
  runsForWorkflow = [],
  onSelectRun,
  onCancelRun
}: Props) {
  const store = useWorkflowStore()

  const [persistentFiles, setPersistentFiles] = useState<WorkflowFileEntry[]>([])
  const [runWorkspaces, setRunWorkspaces] = useState<WorkflowRunWorkspaceEntry[]>([])
  const [currentRunFiles, setCurrentRunFiles] = useState<WorkflowFileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [segment, setSegment] = useState<string>(mode === 'run-detail' ? 'run' : 'persistent')
  const [selectedRunIdForFiles, setSelectedRunIdForFiles] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const dragCountRef = useRef(0)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [pFiles, rws] = await Promise.all([
        store.getWorkspaceFiles(workflowName),
        store.getRunWorkspaces(workflowName)
      ])
      setPersistentFiles(pFiles)
      setRunWorkspaces(rws)
      if (activeRunId) {
        const runFiles = await store.getRunWorkspaceFiles(activeRunId)
        setCurrentRunFiles(runFiles)
      } else {
        setCurrentRunFiles([])
      }
    } finally {
      setLoading(false)
    }
  }, [workflowName, activeRunId, store])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleSelectFile = useCallback(
    async (filePath: string) => {
      setSelectedFile(filePath)
      setLoadingFile(true)
      try {
        const result = await store.readWorkspaceFile(filePath)
        setFileContent(result?.content ?? null)
      } finally {
        setLoadingFile(false)
      }
    },
    [store]
  )

  const handleDeleteFile = useCallback(
    async (filePath: string) => {
      await store.deleteWorkspaceFile(filePath)
      if (selectedFile === filePath) {
        setSelectedFile(null)
        setFileContent(null)
      }
      void refresh()
      toast.success('已删除')
    },
    [store, selectedFile, refresh]
  )

  const handleOpenInExplorer = useCallback(
    async (type: 'persistent' | 'run', runId?: string) => {
      const resolved = await store.resolveWorkspacePath(workflowName, type, runId)
      if (!resolved) {
        toast.warning('无法解析工作空间路径')
        return
      }
      if (window.prizm?.openInExplorer) {
        await window.prizm.openInExplorer(resolved.absolutePath)
      } else {
        toast.info(`路径: ${resolved.absolutePath}`)
      }
    },
    [store, workflowName]
  )

  const getUploadTargetDir = useCallback(() => {
    if (segment === 'persistent') {
      return `.prizm/workflows/${workflowName}/workspace`
    }
    if (segment === 'run' && activeRunId) {
      return `.prizm/workflows/${workflowName}/run-workspaces/${activeRunId}`
    }
    if (segment === 'runs' && selectedRunIdForFiles) {
      return `.prizm/workflows/${workflowName}/run-workspaces/${selectedRunIdForFiles}`
    }
    return `.prizm/workflows/${workflowName}/workspace`
  }, [segment, workflowName, activeRunId, selectedRunIdForFiles])

  const handleUploadFiles = useCallback(
    async (files: FileList | globalThis.File[]) => {
      const fileArr = Array.from(files)
      if (fileArr.length === 0) return

      const targetDir = getUploadTargetDir()
      setUploading(true)
      let successCount = 0
      try {
        for (const file of fileArr) {
          if (file.size > 10 * 1024 * 1024) {
            toast.warning(`文件 ${file.name} 超过 10MB 限制，已跳过`)
            continue
          }
          const base64 = await fileToBase64(file)
          const result = await store.uploadFile(targetDir, file.name, base64)
          if (result?.ok) successCount++
        }
        if (successCount > 0) {
          toast.success(`已上传 ${successCount} 个文件`)
          void refresh()
        }
      } catch {
        toast.error('上传失败')
      } finally {
        setUploading(false)
      }
    },
    [store, getUploadTargetDir, refresh]
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCountRef.current += 1
    if (dragCountRef.current === 1) setIsDragging(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCountRef.current -= 1
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCountRef.current = 0
      setIsDragging(false)
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        await handleUploadFiles(files)
      }
    },
    [handleUploadFiles]
  )

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        void handleUploadFiles(files)
      }
      e.target.value = ''
    },
    [handleUploadFiles]
  )

  const fileInputRef = useRef<HTMLInputElement>(null)

  const { filesForList, pathPrefixForList } = useMemo(() => {
    if (segment === 'persistent') {
      return {
        filesForList: persistentFiles,
        pathPrefixForList: `.prizm/workflows/${workflowName}/workspace`
      }
    }
    if (segment === 'run' && mode === 'run-detail' && activeRunId) {
      return {
        filesForList: currentRunFiles,
        pathPrefixForList: `.prizm/workflows/${workflowName}/run-workspaces/${activeRunId}`
      }
    }
    if (segment === 'runs' && selectedRunIdForFiles) {
      const entry = runWorkspaces.find((r) => r.runId === selectedRunIdForFiles)
      return {
        filesForList: entry?.files ?? [],
        pathPrefixForList: `.prizm/workflows/${workflowName}/run-workspaces/${selectedRunIdForFiles}`
      }
    }
    return { filesForList: [] as WorkflowFileEntry[], pathPrefixForList: '' }
  }, [
    segment,
    mode,
    activeRunId,
    workflowName,
    selectedRunIdForFiles,
    persistentFiles,
    currentRunFiles,
    runWorkspaces
  ])

  const runListSegmentOptions =
    mode === 'overview'
      ? [
          { value: 'persistent', label: '工作流空间' },
          { value: 'runs', label: 'Run 空间' }
        ]
      : [
          { value: 'persistent', label: '工作流空间' },
          { value: 'run', label: '当前 Run 空间' }
        ]

  const listItems: ListItemProps[] = useMemo(() => {
    return filesForList.map((f) => {
      const path = pathPrefixForList ? `${pathPrefixForList}/${f.name}` : f.name
      const isFile = f.type === 'file'
      return {
        key: path,
        avatar: <Icon icon={f.type === 'directory' ? FolderOpen : File} size={14} />,
        title: f.name,
        description: `${f.type === 'directory' ? '文件夹' : '文件'} · ${formatSize(
          f.size
        )} · ${formatTime(f.modifiedAt)}`,
        onClick: isFile ? () => void handleSelectFile(path) : undefined,
        actions: isFile ? (
          <Flexbox gap={4} horizontal onClick={(e) => e.stopPropagation()}>
            <Button
              size="small"
              type="link"
              icon={<Icon icon={FileText} size={12} />}
              onClick={() => void handleSelectFile(path)}
            >
              预览
            </Button>
            <Popconfirm
              title="确定删除此文件？"
              onConfirm={() => void handleDeleteFile(path)}
              okText="删除"
              cancelText="取消"
            >
              <Button size="small" type="link" danger icon={<Icon icon={Trash2} size={12} />}>
                删除
              </Button>
            </Popconfirm>
          </Flexbox>
        ) : undefined
      }
    })
  }, [filesForList, pathPrefixForList, handleSelectFile, handleDeleteFile])

  const renderFileListArea = (
    openInExplorerType: 'persistent' | 'run',
    emptyLabel: string,
    openInExplorerRunId?: string
  ) => {
    if (loading) {
      return (
        <Flexbox padding={24}>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Flexbox>
      )
    }

    return (
      <Flexbox
        direction="vertical"
        gap={16}
        style={{
          minHeight: 320,
          position: 'relative',
          border: isDragging ? '2px dashed var(--ant-color-primary)' : '2px dashed transparent',
          borderRadius: 10,
          padding: 16,
          background: isDragging
            ? 'color-mix(in srgb, var(--ant-color-primary) 4%, transparent)'
            : undefined
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <Flexbox
            align="center"
            justify="center"
            direction="vertical"
            gap={10}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 10,
              background: 'color-mix(in srgb, var(--ant-color-bg-container) 85%, transparent)',
              borderRadius: 8,
              pointerEvents: 'none'
            }}
            aria-hidden
          >
            <Icon icon={Upload} size={32} />
            <Text style={{ color: 'var(--ant-color-primary)', fontWeight: 500 }}>
              松开以上传文件到工作空间
            </Text>
          </Flexbox>
        )}
        {listItems.length === 0 && !isDragging ? (
          <Flexbox
            align="center"
            direction="vertical"
            gap={8}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <EmptyState description={emptyLabel} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              拖拽文件到此处上传，或点击上方「上传文件」
            </Text>
          </Flexbox>
        ) : (
          <Flexbox gap={16} horizontal style={{ minHeight: 300 }}>
            <Flexbox flex={1} style={{ minWidth: 0, maxWidth: '55%' }}>
              <div
                style={{
                  maxHeight: 320,
                  overflow: 'auto',
                  border: '1px solid var(--ant-color-border)',
                  borderRadius: 8
                }}
              >
                <AccentList activeKey={selectedFile ?? undefined} items={listItems} />
              </div>
            </Flexbox>
            <Flexbox flex={1} style={{ minWidth: 0 }}>
              {selectedFile ? (
                loadingFile ? (
                  <Skeleton active paragraph={{ rows: 8 }} />
                ) : fileContent != null ? (
                  <Flexbox direction="vertical" gap={8}>
                    <Flexbox justify="flex-end">
                      <Popconfirm
                        title="确定删除此文件？"
                        onConfirm={() => void handleDeleteFile(selectedFile)}
                        okText="删除"
                        cancelText="取消"
                      >
                        <Button size="small" danger icon={<Icon icon={Trash2} size={12} />}>
                          删除
                        </Button>
                      </Popconfirm>
                    </Flexbox>
                    <FilePreview content={fileContent} path={selectedFile} />
                  </Flexbox>
                ) : (
                  <EmptyState description="无法读取文件" />
                )
              ) : (
                <Flexbox
                  align="center"
                  justify="center"
                  direction="vertical"
                  gap={8}
                  style={{ height: 200 }}
                >
                  <Icon icon={File} size={32} style={{ opacity: 0.3 }} />
                  <Text type="secondary">在左侧点击文件查看内容</Text>
                </Flexbox>
              )}
            </Flexbox>
          </Flexbox>
        )}
      </Flexbox>
    )
  }

  return (
    <Flexbox direction="vertical" gap={12}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
        aria-hidden
      />
      <Flexbox align="center" distribution="space-between" horizontal wrap="wrap" gap={8}>
        <Button
          size="small"
          icon={<Icon icon={ExternalLink} size={12} />}
          disabled={segment === 'runs' && !selectedRunIdForFiles}
          onClick={() =>
            handleOpenInExplorer(
              segment === 'run' || segment === 'runs' ? 'run' : 'persistent',
              segment === 'run'
                ? activeRunId
                : segment === 'runs'
                ? selectedRunIdForFiles ?? undefined
                : undefined
            )
          }
        >
          在资源管理器打开
        </Button>
        <Flexbox gap={8} horizontal>
          {(segment === 'persistent' ||
            segment === 'run' ||
            (segment === 'runs' && selectedRunIdForFiles)) && (
            <>
              <Button
                size="small"
                icon={<Icon icon={Upload} size={12} />}
                loading={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                上传文件
              </Button>
              <RefreshIconButton onClick={refresh} disabled={loading} title="刷新文件列表" />
            </>
          )}
          {segment === 'runs' && !selectedRunIdForFiles && (
            <RefreshIconButton onClick={refresh} disabled={loading} title="刷新 Run 列表" />
          )}
        </Flexbox>
      </Flexbox>

      <Segmented
        value={segment}
        onChange={(v) => setSegment(v as string)}
        options={runListSegmentOptions.map((o) => ({
          value: o.value,
          label: (
            <Flexbox align="center" gap={6} horizontal>
              {o.value === 'persistent' && <Icon icon={FolderGit2} size={14} />}
              {(o.value === 'run' || o.value === 'runs') && <Icon icon={Zap} size={14} />}
              <span>{o.label}</span>
            </Flexbox>
          )
        }))}
      />

      {segment === 'persistent' && (
        <Flexbox
          direction="vertical"
          gap={8}
          padding={12}
          style={{ background: 'var(--ant-color-fill-quaternary)', borderRadius: 8 }}
        >
          <Flexbox align="center" gap={8} horizontal>
            <Icon icon={FolderGit2} size={16} />
            <Text strong>工作流持久空间</Text>
            <Tag>{persistentFiles.length}</Tag>
          </Flexbox>
          {renderFileListArea('persistent', '工作流持久空间暂无文件')}
        </Flexbox>
      )}

      {segment === 'run' && mode === 'run-detail' && (
        <Flexbox
          direction="vertical"
          gap={8}
          padding={12}
          style={{ background: 'var(--ant-color-fill-quaternary)', borderRadius: 8 }}
        >
          <Flexbox align="center" gap={8} horizontal>
            <Icon icon={Zap} size={16} />
            <Text strong>当前 Run 空间</Text>
            <Tag>{currentRunFiles.length}</Tag>
          </Flexbox>
          {renderFileListArea('run', '当前运行暂无产出文件', activeRunId)}
        </Flexbox>
      )}

      {segment === 'runs' && mode === 'overview' && (
        <Flexbox
          direction="vertical"
          gap={12}
          padding={12}
          style={{ background: 'var(--ant-color-fill-quaternary)', borderRadius: 8 }}
        >
          <Flexbox align="center" gap={8} horizontal>
            <Icon icon={Zap} size={16} />
            <Text strong>Run 空间</Text>
            <Tag>{runWorkspaces.length}</Tag>
          </Flexbox>
          {runWorkspaces.length === 0 ? (
            <EmptyState description="该工作流暂无 Run 空间（无运行记录或运行尚未产生工作区）" />
          ) : (
            <>
              <Flexbox align="center" gap={8} horizontal wrap="wrap">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  选择 Run 查看其工作空间文件：
                </Text>
                <Select
                  size="small"
                  placeholder="选择 Run"
                  allowClear
                  style={{ minWidth: 220 }}
                  value={selectedRunIdForFiles ?? undefined}
                  onChange={(v) => setSelectedRunIdForFiles(v ?? null)}
                  options={runWorkspaces.map((r) => ({
                    value: r.runId,
                    label: `Run ${r.runId.slice(0, 8)}… (${r.files.length} 个文件)`
                  }))}
                />
              </Flexbox>
              {selectedRunIdForFiles ? (
                renderFileListArea('run', '该 Run 工作空间暂无文件', selectedRunIdForFiles)
              ) : (
                <Flexbox
                  align="center"
                  justify="center"
                  direction="vertical"
                  gap={8}
                  style={{ minHeight: 160 }}
                >
                  <Icon icon={FolderOpen} size={24} style={{ opacity: 0.4 }} />
                  <Text type="secondary">请在上方选择一个 Run 查看其工作空间文件列表</Text>
                </Flexbox>
              )}
            </>
          )}
        </Flexbox>
      )}
    </Flexbox>
  )
}
