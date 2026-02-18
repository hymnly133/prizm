/**
 * DocumentOutlinePanel - 文档大纲面板（右侧面板）
 * 三个标签：大纲 / 信息 / 记忆
 * 信息面板含 Markdown 统计卡片（阅读时间、图片数、链接数、代码块数等）
 */
import { useCallback, useState, useMemo, useEffect, useRef } from 'react'
import { Button, Flexbox, Tooltip } from '@lobehub/ui'
import { Segmented } from './ui/Segmented'
import { createStyles } from 'antd-style'
import {
  List as ListIcon,
  Info,
  History,
  Brain,
  Lock,
  ExternalLink,
  FileText,
  Hash,
  Image,
  Link2,
  Code2,
  Clock,
  AlignLeft,
  Type
} from 'lucide-react'
import OutlineTree, { parseHeadings } from './ui/OutlineTree'
import DocumentMemoryPanel from './DocumentMemoryPanel'
import { useDocumentDetailSafe } from '../context/DocumentDetailContext'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import type { ResourceLockInfo } from '@prizm/client-core'

const useStyles = createStyles(({ css, token }) => ({
  infoGrid: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: 4px 0;
  `,
  infoCard: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: ${token.borderRadius}px;
    background: ${token.colorFillQuaternary};
    transition: background 0.15s;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  infoCardIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: ${token.colorBgContainer};
    color: ${token.colorTextTertiary};
    flex-shrink: 0;
  `,
  infoCardContent: css`
    display: flex;
    flex-direction: column;
    min-width: 0;
  `,
  infoCardValue: css`
    font-size: 14px;
    font-weight: 600;
    color: ${token.colorText};
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  `,
  infoCardLabel: css`
    font-size: 10px;
    color: ${token.colorTextQuaternary};
    line-height: 1.3;
  `,
  infoCardWide: css`
    grid-column: 1 / -1;
  `,
  lockSection: css`
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px solid ${token.colorBorderSecondary};
  `,
  lockBadge: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 6px;
    background: ${token.colorWarningBg};
    border: 1px solid ${token.colorWarningBorder};
    color: ${token.colorWarningText};
    font-size: 11px;
  `,
  lockSession: css`
    cursor: pointer;
    color: ${token.colorPrimary};
    font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
    font-size: 11px;
    &:hover {
      text-decoration: underline;
    }
  `
}))

interface DocumentOutlinePanelProps {
  content?: string
  editorRef?: React.MutableRefObject<ReactCodeMirrorRef | null>
  charCount?: number
  wordCount?: number
  versionCount?: number
  onShowVersions?: () => void
  documentId?: string
  scope?: string
  lockInfo?: ResourceLockInfo | null
  onNavigateToSession?: (sessionId: string) => void
}

type PanelTab = 'outline' | 'info' | 'memory'

interface MarkdownStats {
  imageCount: number
  linkCount: number
  codeBlockCount: number
  lineCount: number
  readingTime: string
}

function computeMarkdownStats(content: string, wordCount: number): MarkdownStats {
  const imageCount = (content.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length
  const linkCount = (content.match(/(?<!!)\[[^\]]*\]\([^)]+\)/g) || []).length
  const codeBlockCount = (content.match(/^```/gm) || []).length / 2
  const lineCount = content ? content.split('\n').length : 0
  const minutes = Math.ceil(wordCount / 250)
  const readingTime = minutes < 1 ? '< 1 分钟' : `${minutes} 分钟`

  return {
    imageCount,
    linkCount,
    codeBlockCount: Math.max(0, Math.floor(codeBlockCount)),
    lineCount,
    readingTime
  }
}

const EMPTY_EDITOR_REF = { current: null }

export default function DocumentOutlinePanel(props: DocumentOutlinePanelProps) {
  const ctx = useDocumentDetailSafe()

  const content = props.content ?? ctx?.content ?? ''
  const editorRef = props.editorRef ?? ctx?.editorRef ?? EMPTY_EDITOR_REF
  const charCount = props.charCount ?? ctx?.charCount ?? 0
  const wordCount = props.wordCount ?? ctx?.wordCount ?? 0
  const versionCount = props.versionCount ?? ctx?.versionCount
  const onShowVersions = props.onShowVersions ?? ctx?.showVersions
  const documentId = props.documentId ?? ctx?.documentId ?? undefined
  const scope = props.scope ?? ctx?.scope
  const lockInfo = props.lockInfo !== undefined ? props.lockInfo : ctx?.lockInfo ?? null
  const onNavigateToSession = props.onNavigateToSession ?? ctx?.navigateToSession
  const { styles, cx } = useStyles()
  const [activeTab, setActiveTab] = useState<PanelTab>('outline')
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
  const mdStats = useMemo(() => computeMarkdownStats(content, wordCount), [content, wordCount])

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

  return (
    <Flexbox style={{ height: '100%', overflow: 'hidden' }} gap={0}>
      <div style={{ padding: '8px 8px 4px', flexShrink: 0 }}>
        <Segmented
          block
          size="small"
          value={activeTab}
          onChange={(v) => setActiveTab(v as PanelTab)}
          options={[
            { label: '大纲', value: 'outline', icon: <ListIcon size={12} /> },
            { label: '信息', value: 'info', icon: <Info size={12} /> },
            { label: '记忆', value: 'memory', icon: <Brain size={12} /> }
          ]}
        />
      </div>

      <Flexbox flex={1} style={{ overflow: 'auto', minHeight: 0, padding: '4px 8px' }}>
        {activeTab === 'outline' && (
          <div className="doc-outline-content">
            <OutlineTree
              content={content}
              onNavigate={handleNavigate}
              activeHeading={activeHeadingLine}
            />
          </div>
        )}

        {activeTab === 'info' && (
          <Flexbox gap={8} style={{ padding: '4px 0' }}>
            <div className={styles.infoGrid}>
              <InfoCard
                icon={Type}
                label="字符"
                value={charCount.toLocaleString()}
                styles={styles}
              />
              <InfoCard
                icon={AlignLeft}
                label="词数"
                value={wordCount.toLocaleString()}
                styles={styles}
              />
              <InfoCard icon={Clock} label="阅读" value={mdStats.readingTime} styles={styles} />
              <InfoCard icon={Hash} label="标题" value={String(headingCount)} styles={styles} />
              <InfoCard
                icon={FileText}
                label="行数"
                value={mdStats.lineCount.toLocaleString()}
                styles={styles}
              />
              <InfoCard
                icon={Image}
                label="图片"
                value={String(mdStats.imageCount)}
                styles={styles}
              />
              <InfoCard
                icon={Link2}
                label="链接"
                value={String(mdStats.linkCount)}
                styles={styles}
              />
              <InfoCard
                icon={Code2}
                label="代码块"
                value={String(mdStats.codeBlockCount)}
                styles={styles}
              />
            </div>

            {versionCount !== undefined && (
              <InfoCard
                icon={History}
                label="版本"
                value={String(versionCount)}
                styles={styles}
                wide
                action={
                  onShowVersions && (
                    <Button
                      size="small"
                      icon={<History size={11} />}
                      onClick={onShowVersions}
                      style={{ marginLeft: 'auto' }}
                    >
                      查看
                    </Button>
                  )
                }
              />
            )}

            {lockInfo && (
              <div className={styles.lockSection}>
                <span className={styles.lockBadge}>
                  <Lock size={11} />
                  <span>签出 — </span>
                  <Tooltip title={`会话 ${lockInfo.sessionId}`}>
                    <span
                      className={styles.lockSession}
                      onClick={() => onNavigateToSession?.(lockInfo.sessionId)}
                      role={onNavigateToSession ? 'button' : undefined}
                      tabIndex={onNavigateToSession ? 0 : undefined}
                    >
                      {lockInfo.sessionId.slice(0, 8)}…
                      {onNavigateToSession && (
                        <ExternalLink size={9} style={{ marginLeft: 2, verticalAlign: -1 }} />
                      )}
                    </span>
                  </Tooltip>
                </span>
              </div>
            )}
          </Flexbox>
        )}

        {activeTab === 'memory' &&
          (documentId ? (
            <DocumentMemoryPanel
              documentId={documentId}
              scope={scope}
              visible={activeTab === 'memory'}
            />
          ) : (
            <div
              style={{
                textAlign: 'center',
                padding: '24px 0',
                color: 'var(--ant-color-text-quaternary)',
                fontSize: 12
              }}
            >
              请先选择文档
            </div>
          ))}
      </Flexbox>
    </Flexbox>
  )
}

function InfoCard({
  icon: Icon,
  label,
  value,
  styles,
  wide,
  action
}: {
  icon: React.ComponentType<{ size?: number }>
  label: string
  value: string
  styles: ReturnType<typeof useStyles>['styles']
  wide?: boolean
  action?: React.ReactNode
}) {
  return (
    <div className={`${styles.infoCard} ${wide ? styles.infoCardWide : ''}`}>
      <div className={styles.infoCardIcon}>
        <Icon size={14} />
      </div>
      <div className={styles.infoCardContent}>
        <span className={styles.infoCardValue}>{value}</span>
        <span className={styles.infoCardLabel}>{label}</span>
      </div>
      {action}
    </div>
  )
}
