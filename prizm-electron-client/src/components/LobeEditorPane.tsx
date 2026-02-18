/**
 * LobeEditorPane - Lobe Editor (Lexical) 封装
 * 独立文件以支持懒加载，避免 @lobehub/editor 导入问题影响整个页面
 */
import { Component, memo, type ReactNode } from 'react'
import {
  ReactCodeblockPlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactHRPlugin
} from '@lobehub/editor'
import { Editor, useEditor } from '@lobehub/editor/react'

/* ── 错误边界：捕获 Lobe Editor 渲染错误并显示详细信息 ── */

interface ErrorBoundaryState {
  error: Error | null
}

class LobeEditorErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            color: '#cf1322',
            fontSize: 13,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: '#fff2f0',
            borderRadius: 8,
            border: '1px solid #ffccc7'
          }}
        >
          <strong>Lobe Editor 渲染出错</strong>
          <br />
          <br />
          {this.state.error.message}
          <br />
          <br />
          <details>
            <summary>堆栈详情</summary>
            <pre style={{ fontSize: 11, marginTop: 8 }}>{this.state.error.stack}</pre>
          </details>
        </div>
      )
    }
    return this.props.children
  }
}

/* ── 编辑器组件 ── */

interface LobeEditorPaneProps {
  initialMarkdown: string
}

function LobeEditorInner({ initialMarkdown }: LobeEditorPaneProps) {
  const editor = useEditor()

  return (
    <div style={{ display: 'block', height: '100%' }}>
      <Editor
        editor={editor}
        type="markdown"
        content={initialMarkdown}
        plugins={[ReactCodeblockPlugin, ReactListPlugin, ReactLinkPlugin, ReactHRPlugin]}
      />
    </div>
  )
}

function LobeEditorPane({ initialMarkdown }: LobeEditorPaneProps) {
  return (
    <LobeEditorErrorBoundary>
      <LobeEditorInner initialMarkdown={initialMarkdown} />
    </LobeEditorErrorBoundary>
  )
}

export default memo(LobeEditorPane)
