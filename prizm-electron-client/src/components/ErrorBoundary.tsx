import { Component, type ReactNode, type ErrorInfo } from 'react'
import { createClientLogger } from '@prizm/client-core'

const log = createClientLogger('ErrorBoundary')

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('React render error:', error.message, error.stack)
    if (info.componentStack) {
      log.error('Component stack:', info.componentStack)
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            minHeight: 200,
            padding: 32,
            gap: 16,
            color: 'var(--ant-color-text-secondary, #666)'
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--ant-color-error, #ff4d4f)' }}>
            页面渲染出错
          </div>
          <div style={{ fontSize: 13, maxWidth: 500, textAlign: 'center', opacity: 0.7 }}>
            {this.state.error?.message || '未知错误'}
          </div>
          <button
            onClick={this.handleRetry}
            style={{
              marginTop: 8,
              padding: '6px 20px',
              border: '1px solid var(--ant-color-border, #d9d9d9)',
              borderRadius: 6,
              background: 'var(--ant-color-bg-container, #fff)',
              color: 'var(--ant-color-text, #333)',
              cursor: 'pointer',
              fontSize: 13
            }}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
