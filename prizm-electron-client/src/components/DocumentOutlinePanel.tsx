/**
 * DocumentOutlinePanel - 文档大纲面板（右侧面板）
 * 三个标签：大纲 / 信息 / 记忆
 * 支持滚动高亮当前所在标题
 */
import { useCallback, useState, useMemo, useEffect, useRef } from 'react'
import { Button, Tabs } from 'antd'
import { List as ListIcon, Info, History, Brain } from 'lucide-react'
import OutlineTree, { parseHeadings } from './ui/OutlineTree'
import DocumentMemoryPanel from './DocumentMemoryPanel'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'

interface DocumentOutlinePanelProps {
  content: string
  editorRef: React.MutableRefObject<ReactCodeMirrorRef | null>
  charCount: number
  wordCount: number
  versionCount?: number
  onShowVersions?: () => void
  documentId?: string
  scope?: string
}

export default function DocumentOutlinePanel({
  content,
  editorRef,
  charCount,
  wordCount,
  versionCount,
  onShowVersions,
  documentId,
  scope
}: DocumentOutlinePanelProps) {
  const [activeTab, setActiveTab] = useState('outline')
  const [activeHeadingLine, setActiveHeadingLine] = useState<number | undefined>(undefined)
  const rafRef = useRef<number>(0)

  const handleNavigate = useCallback(
    (line: number) => {
      const view = editorRef.current?.view
      if (!view) return

      const docLine = view.state.doc.line(Math.min(line, view.state.doc.lines))
      view.dispatch({
        selection: { anchor: docLine.from },
        scrollIntoView: true,
        effects: []
      })
      view.focus()
    },
    [editorRef]
  )

  const headings = useMemo(() => parseHeadings(content), [content])
  const headingCount = headings.length

  // 根据编辑器滚动位置高亮当前标题
  useEffect(() => {
    const view = editorRef.current?.view
    if (!view || headings.length === 0) return

    const scrollDOM = view.scrollDOM

    const updateActiveHeading = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const editorView = editorRef.current?.view
        if (!editorView) return

        const scrollTop = editorView.scrollDOM.scrollTop
        const lineBlock = editorView.lineBlockAtHeight(scrollTop + 20)
        const lineNumber = editorView.state.doc.lineAt(lineBlock.from).number

        let activeLine: number | undefined
        for (let i = headings.length - 1; i >= 0; i--) {
          if (headings[i].line <= lineNumber) {
            activeLine = headings[i].line
            break
          }
        }
        setActiveHeadingLine(activeLine)
      })
    }

    scrollDOM.addEventListener('scroll', updateActiveHeading, { passive: true })
    updateActiveHeading()

    return () => {
      scrollDOM.removeEventListener('scroll', updateActiveHeading)
      cancelAnimationFrame(rafRef.current)
    }
  }, [editorRef, headings])

  const items = [
    {
      key: 'outline',
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ListIcon size={13} /> 大纲
        </span>
      ),
      children: (
        <div className="doc-outline-content">
          <OutlineTree
            content={content}
            onNavigate={handleNavigate}
            activeHeading={activeHeadingLine}
          />
        </div>
      )
    },
    {
      key: 'info',
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Info size={13} /> 信息
        </span>
      ),
      children: (
        <div className="doc-info-content">
          <InfoRow label="字符数" value={charCount.toLocaleString()} />
          <InfoRow label="词数" value={wordCount.toLocaleString()} />
          <InfoRow label="标题数" value={String(headingCount)} />
          <InfoRow label="行数" value={content ? String(content.split('\n').length) : '0'} />
          {versionCount !== undefined && <InfoRow label="版本数" value={String(versionCount)} />}
          {onShowVersions && (
            <Button
              type="link"
              size="small"
              icon={<History size={12} />}
              onClick={onShowVersions}
              style={{ padding: '4px 0', marginTop: 8, fontSize: 12 }}
            >
              查看版本历史
            </Button>
          )}
        </div>
      )
    },
    {
      key: 'memory',
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Brain size={13} /> 记忆
        </span>
      ),
      children: documentId ? (
        <DocumentMemoryPanel
          documentId={documentId}
          scope={scope}
          visible={activeTab === 'memory'}
        />
      ) : (
        <div className="doc-memory-empty">请先选择文档</div>
      )
    }
  ]

  return (
    <div className="doc-outline-panel">
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={items}
        size="small"
        style={{ height: '100%' }}
      />
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="doc-info-row">
      <span className="doc-info-label">{label}</span>
      <span className="doc-info-value">{value}</span>
    </div>
  )
}
