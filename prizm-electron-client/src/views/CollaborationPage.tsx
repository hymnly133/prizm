/**
 * CollaborationPage — 开创性的分屏协作页面
 * 左右平分：Agent 会话 + 文档编辑器，支持拖拽调整比例、调换方向
 *
 * 使用自定义 SplitPane 而非 react-resizable-panels，确保方向切换时
 * 通过 CSS order 交换面板视觉位置，两个面板始终保持挂载不重建，
 * 避免切换时丢失聊天/编辑器状态。
 */
import { ActionIcon, Flexbox } from '@lobehub/ui'
import { ArrowLeftRight, GripVertical } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRegisterHeaderSlots } from '../context/HeaderSlotsContext'
import { useDocumentNavigation, WorkNavigationOverrideProvider } from '../context/NavigationContext'
import type { FileKind } from '../hooks/useFileList'
import { AgentPane } from '../components/collaboration'
import { DocumentPane } from '../components/collaboration'

const DIRECTION_KEY = 'prizm-collab-direction'
const SPLIT_KEY = 'prizm-collab-split'

type PaneDirection = 'agent-left' | 'agent-right'

function loadDirection(): PaneDirection {
  try {
    const stored = localStorage.getItem(DIRECTION_KEY)
    if (stored === 'agent-left' || stored === 'agent-right') return stored
  } catch {
    /* ignore */
  }
  return 'agent-left'
}

function persistDirection(dir: PaneDirection) {
  try {
    localStorage.setItem(DIRECTION_KEY, dir)
  } catch {
    /* ignore */
  }
}

function loadSplit(): number {
  try {
    const stored = localStorage.getItem(SPLIT_KEY)
    if (stored) {
      const n = parseFloat(stored)
      if (n >= 20 && n <= 80) return n
    }
  } catch {
    /* ignore */
  }
  return 50
}

function persistSplit(pct: number) {
  try {
    localStorage.setItem(SPLIT_KEY, String(pct))
  } catch {
    /* ignore */
  }
}

interface CollaborationPageProps {
  onNavigateToAgent?: () => void
  onNavigateToDocs?: () => void
}

function CollaborationPage({ onNavigateToAgent, onNavigateToDocs }: CollaborationPageProps) {
  const [direction, setDirection] = useState<PaneDirection>(loadDirection)
  const [splitPct, setSplitPct] = useState(loadSplit)
  const { navigateToDocs } = useDocumentNavigation()
  const docDirtyRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const rafRef = useRef<number | null>(null)

  const [collabDocId, setCollabDocId] = useState<string | null>(null)

  const workNavOverride = useMemo(
    () => ({
      openFileAtWork: (kind: FileKind, id: string) => {
        if (kind === 'document') {
          setCollabDocId(id)
        }
      },
      pendingWorkFile: null,
      consumePendingWorkFile: () => {}
    }),
    []
  )

  const toggleDirection = useCallback(() => {
    setDirection((prev) => {
      const next = prev === 'agent-left' ? 'agent-right' : 'agent-left'
      persistDirection(next)
      return next
    })
  }, [])

  const handleOpenAgentFullPage = useCallback(() => {
    onNavigateToAgent?.()
  }, [onNavigateToAgent])

  const handleOpenDocFullPage = useCallback(
    (docId?: string) => {
      if (docId) {
        navigateToDocs(docId)
      }
      onNavigateToDocs?.()
    },
    [onNavigateToDocs, navigateToDocs]
  )

  const headerSlots = useMemo(
    () => ({
      left: (
        <Flexbox horizontal align="center" gap={4}>
          <ActionIcon
            icon={ArrowLeftRight}
            size="small"
            title={
              direction === 'agent-left'
                ? '当前：左 Agent / 右 文档 — 点击调换'
                : '当前：左 文档 / 右 Agent — 点击调换'
            }
            onClick={toggleDirection}
          />
        </Flexbox>
      )
    }),
    [direction, toggleDirection]
  )
  useRegisterHeaderSlots('collaboration', headerSlots)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    draggingRef.current = true
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current || !containerRef.current) return
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const rect = containerRef.current!.getBoundingClientRect()
        const x = e.clientX - rect.left
        const pct = Math.min(80, Math.max(20, (x / rect.width) * 100))
        setSplitPct(pct)
      })
    }
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      setSplitPct((cur) => {
        persistSplit(cur)
        return cur
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const isAgentLeft = direction === 'agent-left'

  return (
    <section className="collab-page" data-direction={direction}>
      <div className="collab-split-container" ref={containerRef}>
        {/* Agent 面板 — 始终挂载，通过 CSS order 控制左右位置 */}
        <div
          className="collab-split-pane"
          style={{
            width: `calc(${isAgentLeft ? splitPct : 100 - splitPct}% - 4px)`,
            order: isAgentLeft ? 0 : 2
          }}
        >
          <WorkNavigationOverrideProvider value={workNavOverride}>
            <AgentPane
              onOpenFullPage={handleOpenAgentFullPage}
              sidebarSide={isAgentLeft ? 'left' : 'right'}
            />
          </WorkNavigationOverrideProvider>
        </div>

        {/* 拖拽分割线 */}
        <div
          className="collab-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(splitPct)}
          onPointerDown={handlePointerDown}
          style={{ order: 1 }}
        >
          <div className="collab-resize-handle-bar">
            <GripVertical size={12} />
          </div>
        </div>

        {/* 文档面板 — 始终挂载，通过 CSS order 控制左右位置 */}
        <div
          className="collab-split-pane"
          style={{
            width: `calc(${isAgentLeft ? 100 - splitPct : splitPct}% - 4px)`,
            order: isAgentLeft ? 2 : 0
          }}
        >
          <DocumentPane
            onOpenFullPage={handleOpenDocFullPage}
            dirtyRef={docDirtyRef}
            sidebarSide={isAgentLeft ? 'right' : 'left'}
            activeDocId={collabDocId}
            onActiveDocIdChange={setCollabDocId}
          />
        </div>
      </div>
    </section>
  )
}

export default memo(CollaborationPage)
