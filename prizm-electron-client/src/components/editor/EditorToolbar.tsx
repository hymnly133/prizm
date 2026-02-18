/**
 * EditorToolbar - 精简工具栏
 * 仅保留：模式切换（Live Preview / 源码 / 预览 / 分栏） + 撤销/重做
 * 格式化操作已移至 FloatingToolbar（选中文本时弹出）
 */
import { useMemo } from 'react'
import { ActionIcon, Flexbox } from '@lobehub/ui'
import { Segmented } from '../ui/Segmented'
import { createStyles } from 'antd-style'
import { Tooltip } from 'antd'
import { Undo2, Redo2, Eye, Code2, Columns2, BookOpen } from 'lucide-react'
import { undo, redo } from '@codemirror/commands'
import type { EditorMode } from './MarkdownEditor'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'

interface EditorToolbarProps {
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
  editorRef: React.MutableRefObject<ReactCodeMirrorRef | null>
  readOnly?: boolean
}

const useStyles = createStyles(({ css, token }) => ({
  toolbar: css`
    padding: 4px 12px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    flex-shrink: 0;
    background: ${token.colorBgContainer};
    min-height: 36px;
  `,
  segmented: css`
    &.ant-segmented {
      background-color: ${token.colorFillQuaternary};
    }
  `,
  undoRedo: css`
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 2px;
  `
}))

export default function EditorToolbar({
  mode,
  onModeChange,
  editorRef,
  readOnly = false
}: EditorToolbarProps) {
  const { styles } = useStyles()

  const modeOptions = useMemo(
    () => [
      {
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <BookOpen size={13} /> Live
          </span>
        ),
        value: 'live' as EditorMode
      },
      {
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Code2 size={13} /> 源码
          </span>
        ),
        value: 'source' as EditorMode
      },
      {
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Eye size={13} /> 预览
          </span>
        ),
        value: 'preview' as EditorMode
      },
      {
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Columns2 size={13} /> 分栏
          </span>
        ),
        value: 'split' as EditorMode
      }
    ],
    []
  )

  const handleUndo = () => {
    const view = editorRef.current?.view
    if (!view) return
    undo(view)
  }

  const handleRedo = () => {
    const view = editorRef.current?.view
    if (!view) return
    redo(view)
  }

  return (
    <Flexbox className={styles.toolbar} horizontal align="center" gap={8}>
      <Segmented
        className={styles.segmented}
        size="small"
        value={mode}
        onChange={(v) => onModeChange(v as EditorMode)}
        options={modeOptions}
      />

      <div className={styles.undoRedo}>
        <Tooltip title="撤销 (Ctrl+Z)" placement="bottom">
          <div>
            <ActionIcon
              icon={Undo2}
              onClick={handleUndo}
              disabled={readOnly}
              size="small"
            />
          </div>
        </Tooltip>
        <Tooltip title="重做 (Ctrl+Shift+Z)" placement="bottom">
          <div>
            <ActionIcon
              icon={Redo2}
              onClick={handleRedo}
              disabled={readOnly}
              size="small"
            />
          </div>
        </Tooltip>
      </div>
    </Flexbox>
  )
}
