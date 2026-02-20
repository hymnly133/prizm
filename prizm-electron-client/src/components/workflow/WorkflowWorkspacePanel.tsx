/**
 * WorkflowWorkspacePanel — 双层工作空间文件浏览器 + 预览
 *
 * 持久工作空间（跨 run 共享）和 Run 工作空间（单次 run 独占）
 * 支持：在资源管理器打开、拖拽上传文件
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { Tabs, Tree, Empty, Spin, Button, Typography, Popconfirm, Tag, message } from 'antd'
import {
  FolderOpen, File, Trash2, RefreshCw, Database, Zap,
  ExternalLink, Upload
} from 'lucide-react'
import { Icon } from '@lobehub/ui'
import { useWorkflowStore } from '../../store/workflowStore'
import type { WorkflowFileEntry, WorkflowRunWorkspaceEntry } from '@prizm/client-core'

const { Text } = Typography

interface Props {
  workflowName: string
  activeRunId?: string
}

interface TreeNode {
  title: React.ReactNode
  key: string
  icon?: React.ReactNode
  isLeaf?: boolean
  children?: TreeNode[]
}

function filesToTree(files: WorkflowFileEntry[], prefix: string): TreeNode[] {
  return files.map((f) => ({
    title: (
      <span className="wf-ws-tree-title">
        <span>{f.name}</span>
        {f.type === 'file' && f.size != null && (
          <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
            {f.size < 1024 ? `${f.size}B` : `${(f.size / 1024).toFixed(1)}KB`}
          </Text>
        )}
      </span>
    ),
    key: `${prefix}/${f.name}`,
    icon: f.type === 'directory'
      ? <Icon icon={FolderOpen} size={14} />
      : <Icon icon={File} size={14} />,
    isLeaf: f.type === 'file'
  }))
}

function FilePreview({ content, path }: { content: string; path: string }) {
  const ext = path.split('.').pop()?.toLowerCase()
  const isMarkdown = ext === 'md' || ext === 'markdown'
  const isJson = ext === 'json'

  let displayContent = content
  if (isJson) {
    try {
      displayContent = JSON.stringify(JSON.parse(content), null, 2)
    } catch { /* use raw */ }
  }

  return (
    <div className="wf-ws-preview">
      <div className="wf-ws-preview__header">
        <Text type="secondary" style={{ fontSize: 12 }}>{path}</Text>
        {isMarkdown && <Tag color="blue" style={{ fontSize: 10 }}>Markdown</Tag>}
        {isJson && <Tag color="orange" style={{ fontSize: 10 }}>JSON</Tag>}
      </div>
      <pre className="wf-ws-preview__content">{displayContent}</pre>
    </div>
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

export function WorkflowWorkspacePanel({ workflowName, activeRunId }: Props) {
  const store = useWorkflowStore()

  const [persistentFiles, setPersistentFiles] = useState<WorkflowFileEntry[]>([])
  const [runWorkspaces, setRunWorkspaces] = useState<WorkflowRunWorkspaceEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [activeTab, setActiveTab] = useState<string>(activeRunId ? 'run' : 'persistent')
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
    } finally {
      setLoading(false)
    }
  }, [workflowName, store])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleSelectFile = useCallback(async (filePath: string) => {
    setSelectedFile(filePath)
    setLoadingFile(true)
    try {
      const result = await store.readWorkspaceFile(filePath)
      setFileContent(result?.content ?? null)
    } finally {
      setLoadingFile(false)
    }
  }, [store])

  const handleDeleteFile = useCallback(async (filePath: string) => {
    await store.deleteWorkspaceFile(filePath)
    if (selectedFile === filePath) {
      setSelectedFile(null)
      setFileContent(null)
    }
    void refresh()
  }, [store, selectedFile, refresh])

  const handleOpenInExplorer = useCallback(async (type: 'persistent' | 'run', runId?: string) => {
    const resolved = await store.resolveWorkspacePath(workflowName, type, runId)
    if (!resolved) {
      message.warning('无法解析工作空间路径')
      return
    }
    if (window.prizm?.openInExplorer) {
      await window.prizm.openInExplorer(resolved.absolutePath)
    } else {
      message.info(`路径: ${resolved.absolutePath}`)
    }
  }, [store, workflowName])

  const getUploadTargetDir = useCallback(() => {
    if (activeTab === 'persistent') {
      return `.prizm/workflows/${workflowName}/workspace`
    }
    if (activeRunId) {
      return `.prizm/workflows/${workflowName}/run-workspaces/${activeRunId}`
    }
    return `.prizm/workflows/${workflowName}/workspace`
  }, [activeTab, workflowName, activeRunId])

  const handleUploadFiles = useCallback(async (files: FileList | globalThis.File[]) => {
    const fileArr = Array.from(files)
    if (fileArr.length === 0) return

    const targetDir = getUploadTargetDir()
    setUploading(true)
    let successCount = 0
    try {
      for (const file of fileArr) {
        if (file.size > 10 * 1024 * 1024) {
          message.warning(`文件 ${file.name} 超过 10MB 限制，已跳过`)
          continue
        }
        const base64 = await fileToBase64(file)
        const result = await store.uploadFile(targetDir, file.name, base64)
        if (result?.ok) successCount++
      }
      if (successCount > 0) {
        message.success(`已上传 ${successCount} 个文件`)
        void refresh()
      }
    } catch (err) {
      message.error('上传失败')
    } finally {
      setUploading(false)
    }
  }, [store, getUploadTargetDir, refresh])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCountRef.current++
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
    dragCountRef.current--
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCountRef.current = 0
    setIsDragging(false)

    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      await handleUploadFiles(files)
    }
  }, [handleUploadFiles])

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      void handleUploadFiles(files)
    }
    e.target.value = ''
  }, [handleUploadFiles])

  const fileInputRef = useRef<HTMLInputElement>(null)

  const persistentTree = filesToTree(persistentFiles, '.prizm/workflows/' + workflowName + '/workspace')

  const runTree: TreeNode[] = runWorkspaces.map((rw) => ({
    title: (
      <span className="wf-ws-tree-title">
        <span>{rw.runId}</span>
        <Tag style={{ fontSize: 10, marginLeft: 6 }}>
          {rw.files.length} 文件
        </Tag>
      </span>
    ),
    key: `run:${rw.runId}`,
    icon: <Icon icon={Zap} size={14} />,
    children: filesToTree(rw.files, `.prizm/workflows/${workflowName}/run-workspaces/${rw.runId}`)
  }))

  const renderFileArea = (treeData: TreeNode[], emptyText: string) => {
    if (loading) return <Spin style={{ display: 'block', margin: '32px auto' }} />

    return (
      <div
        className={`wf-ws-body ${isDragging ? 'wf-ws-body--drag-over' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="wf-ws-drop-overlay">
            <Icon icon={Upload} size={32} />
            <Text style={{ color: 'var(--ant-color-primary)', fontWeight: 500 }}>
              松开以上传文件到工作空间
            </Text>
          </div>
        )}
        {treeData.length === 0 && !isDragging ? (
          <div className="wf-ws-empty-drop">
            <Empty description={emptyText} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            <Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
              拖拽文件到此处上传，或点击上方上传按钮
            </Text>
          </div>
        ) : (
          <>
            <div className="wf-ws-tree-col">
              <Tree.DirectoryTree
                treeData={treeData}
                showIcon
                defaultExpandAll={treeData.length < 20}
                defaultExpandedKeys={activeRunId ? [`run:${activeRunId}`] : undefined}
                onSelect={(keys) => {
                  const key = keys[0] as string
                  if (key && !key.startsWith('run:')) {
                    void handleSelectFile(key)
                  }
                }}
              />
            </div>
            <div className="wf-ws-content-col">
              {selectedFile ? (
                loadingFile ? (
                  <Spin style={{ display: 'block', margin: '32px auto' }} />
                ) : fileContent != null ? (
                  <div className="wf-ws-file-wrap">
                    <div className="wf-ws-file-actions">
                      <Popconfirm title="确定删除此文件？" onConfirm={() => handleDeleteFile(selectedFile)}>
                        <Button size="small" danger icon={<Icon icon={Trash2} size={12} />}>
                          删除
                        </Button>
                      </Popconfirm>
                    </div>
                    <FilePreview content={fileContent} path={selectedFile} />
                  </div>
                ) : (
                  <Empty description="无法读取文件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )
              ) : (
                <div className="wf-ws-placeholder">
                  <Icon icon={File} size={32} style={{ opacity: 0.3 }} />
                  <Text type="secondary">选择文件查看内容</Text>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="wf-workspace-panel">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
      <div className="wf-workspace-panel__header">
        <div className="wf-workspace-panel__header-left">
          <Button
            size="small"
            icon={<Icon icon={ExternalLink} size={12} />}
            onClick={() => handleOpenInExplorer(
              activeTab === 'run' ? 'run' : 'persistent',
              activeRunId
            )}
          >
            在资源管理器打开
          </Button>
        </div>
        <div className="wf-workspace-panel__header-right">
          <Button
            size="small"
            icon={<Icon icon={Upload} size={12} />}
            loading={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            上传文件
          </Button>
          <Button
            size="small"
            icon={<Icon icon={RefreshCw} size={12} />}
            onClick={refresh}
            loading={loading}
          >
            刷新
          </Button>
        </div>
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        size="small"
        items={[
          {
            key: 'persistent',
            label: (
              <span>
                <Icon icon={Database} size={13} style={{ marginRight: 4 }} />
                持久工作空间
              </span>
            ),
            children: renderFileArea(persistentTree, '持久工作空间暂无文件')
          },
          {
            key: 'run',
            label: (
              <span>
                <Icon icon={Zap} size={13} style={{ marginRight: 4 }} />
                Run 工作空间
              </span>
            ),
            children: renderFileArea(runTree, '暂无 Run 工作空间数据')
          }
        ]}
      />
    </div>
  )
}
