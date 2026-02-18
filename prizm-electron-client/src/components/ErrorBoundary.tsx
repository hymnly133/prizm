import { Component, type ReactNode, type ErrorInfo, useState as _useState } from 'react'
import { createClientLogger } from '@prizm/client-core'

const log = createClientLogger('ErrorBoundary')

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  componentStack: string | null
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = _useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button onClick={handleCopy} style={styles.copyBtn}>
      {copied ? '✓ 已复制' : '复制全部'}
    </button>
  )
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('React render error:', error.message, error.stack)
    if (info.componentStack) {
      log.error('Component stack:', info.componentStack)
      this.setState({ componentStack: info.componentStack })
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, componentStack: null })
  }

  private buildFullReport(): string {
    const { error, componentStack } = this.state
    const lines: string[] = [
      `Error: ${error?.message ?? 'Unknown'}`,
      '',
      '--- Stack Trace ---',
      error?.stack ?? '(no stack)',
    ]
    if (componentStack) {
      lines.push('', '--- Component Stack ---', componentStack)
    }
    return lines.join('\n')
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      const { error, componentStack } = this.state

      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <div style={styles.header}>
              <span style={styles.icon}>⚠</span>
              <span style={styles.title}>页面渲染出错</span>
            </div>

            <div style={styles.message}>
              {error?.message || '未知错误'}
            </div>

            <div style={styles.section}>
              <div style={styles.sectionLabel}>错误堆栈</div>
              <pre style={styles.stackPre}>{error?.stack || '(无堆栈信息)'}</pre>
            </div>

            {componentStack && (
              <div style={styles.section}>
                <div style={styles.sectionLabel}>组件栈</div>
                <pre style={styles.stackPre}>{componentStack}</pre>
              </div>
            )}

            <div style={styles.actions}>
              <CopyButton text={this.buildFullReport()} />
              <button onClick={this.handleRetry} style={styles.retryBtn}>
                重试
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: 240,
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 720,
    borderRadius: 10,
    border: '1px solid var(--ant-color-error-border, #ffccc7)',
    background: 'var(--ant-color-error-bg, #fff2f0)',
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  icon: {
    fontSize: 20,
    color: 'var(--ant-color-error, #ff4d4f)',
    lineHeight: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--ant-color-error, #ff4d4f)',
  },
  message: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--ant-color-text, #333)',
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: 'var(--ant-color-text-tertiary, #999)',
  },
  stackPre: {
    margin: 0,
    padding: 12,
    fontSize: 11,
    lineHeight: 1.6,
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
    background: 'var(--ant-color-bg-container, #fff)',
    border: '1px solid var(--ant-color-border, #d9d9d9)',
    borderRadius: 6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: 240,
    overflowY: 'auto',
    color: 'var(--ant-color-text, #333)',
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 4,
  },
  copyBtn: {
    padding: '5px 14px',
    fontSize: 12,
    border: '1px solid var(--ant-color-border, #d9d9d9)',
    borderRadius: 6,
    background: 'var(--ant-color-bg-container, #fff)',
    color: 'var(--ant-color-text, #333)',
    cursor: 'pointer',
  },
  retryBtn: {
    padding: '5px 14px',
    fontSize: 12,
    border: '1px solid var(--ant-color-error-border, #ffccc7)',
    borderRadius: 6,
    background: 'var(--ant-color-error, #ff4d4f)',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 500,
  },
}
