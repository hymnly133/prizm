import { useState, useCallback } from 'react'
import { Button, Input } from '@lobehub/ui'
import { message, Collapse, Tag, Typography } from 'antd'
import {
  Globe,
  MousePointerClick,
  FileSearch,
  Eye,
  XCircle,
  Wifi
} from 'lucide-react'

export interface BrowserPlaygroundProps {
  baseUrl: string
  apiKey: string
  isNodeRunning?: boolean
}

type TestAction = 'navigate' | 'act' | 'extract' | 'observe' | 'close'

interface TestResult {
  action: TestAction
  success: boolean
  message: string
  durationMs: number
}

const { Text } = Typography

export function BrowserPlayground({ baseUrl, apiKey, isNodeRunning }: BrowserPlaygroundProps) {
  const [testingRelay, setTestingRelay] = useState(false)
  const [relayStatus, setRelayStatus] = useState<boolean | null>(null)
  const [runningAction, setRunningAction] = useState<TestAction | null>(null)
  const [results, setResults] = useState<TestResult[]>([])

  const [navigateUrl, setNavigateUrl] = useState('https://example.com')
  const [actInstruction, setActInstruction] = useState('')
  const [extractInstruction, setExtractInstruction] = useState('')
  const [observeInstruction, setObserveInstruction] = useState('')

  const headers: Record<string, string> = {}
  if (apiKey) {
    headers['X-Prizm-Api-Key'] = apiKey
  }

  const testRelayConnection = async () => {
    setTestingRelay(true)
    setRelayStatus(null)
    try {
      const res = await fetch(`${baseUrl}/api/v1/browser/relay/status`, { headers })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        message.error(data?.error ?? `请求失败: ${res.status}`)
        return
      }
      const connected = !!data.providerConnected
      setRelayStatus(connected)
      if (connected) {
        message.success('Relay 已连接')
      } else {
        message.warning('Relay 未连接：请先启动浏览器节点')
      }
    } catch (e) {
      message.error(`测试失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setTestingRelay(false)
    }
  }

  const runTest = useCallback(
    async (action: TestAction, payload: Record<string, string | undefined>) => {
      setRunningAction(action)
      const start = Date.now()
      try {
        const res = await fetch(`${baseUrl}/api/v1/browser/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ action, ...payload })
        })
        const data = await res.json().catch(() => ({}))
        const durationMs = Date.now() - start
        const result: TestResult = {
          action,
          success: res.ok && data.success !== false,
          message: data.message ?? data.error ?? `HTTP ${res.status}`,
          durationMs
        }
        setResults((prev) => [result, ...prev].slice(0, 20))
        if (result.success) {
          message.success(`${action} 成功 (${durationMs}ms)`)
        } else {
          message.error(`${action} 失败: ${result.message}`)
        }
      } catch (e) {
        const durationMs = Date.now() - start
        const msg = e instanceof Error ? e.message : String(e)
        setResults((prev) =>
          [{ action, success: false, message: msg, durationMs }, ...prev].slice(0, 20)
        )
        message.error(`请求失败: ${msg}`)
      } finally {
        setRunningAction(null)
      }
    },
    [baseUrl, headers]
  )

  const disabled = !apiKey || !isNodeRunning

  const testItems = [
    {
      key: 'navigate',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Globe size={14} /> Navigate 导航
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            导航到指定 URL。Agent 通过此操作打开目标网页。
          </Text>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input
              size="small"
              placeholder="https://example.com"
              value={navigateUrl}
              onChange={(e) => setNavigateUrl(e.target.value)}
              style={{ flex: 1 }}
            />
            <Button
              size="small"
              type="primary"
              loading={runningAction === 'navigate'}
              disabled={disabled || !navigateUrl.trim()}
              onClick={() => runTest('navigate', { url: navigateUrl })}
            >
              执行
            </Button>
          </div>
        </div>
      )
    },
    {
      key: 'extract',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileSearch size={14} /> Extract 提取信息
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            从当前页面提取结构化信息（需先 navigate 到目标页面）。Agent
            用此操作获取页面内容、价格、列表等。
          </Text>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input
              size="small"
              placeholder="例：提取页面标题和主要内容"
              value={extractInstruction}
              onChange={(e) => setExtractInstruction(e.target.value)}
              style={{ flex: 1 }}
            />
            <Button
              size="small"
              type="primary"
              loading={runningAction === 'extract'}
              disabled={disabled || !extractInstruction.trim()}
              onClick={() => runTest('extract', { instruction: extractInstruction })}
            >
              执行
            </Button>
          </div>
        </div>
      )
    },
    {
      key: 'observe',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Eye size={14} /> Observe 观察元素
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            观察当前页面上的可交互元素（按钮、链接、输入框等）。Agent
            用此操作了解页面结构后再执行操作。
          </Text>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input
              size="small"
              placeholder="例：找到页面上的搜索框和提交按钮"
              value={observeInstruction}
              onChange={(e) => setObserveInstruction(e.target.value)}
              style={{ flex: 1 }}
            />
            <Button
              size="small"
              type="primary"
              loading={runningAction === 'observe'}
              disabled={disabled || !observeInstruction.trim()}
              onClick={() => runTest('observe', { instruction: observeInstruction })}
            >
              执行
            </Button>
          </div>
        </div>
      )
    },
    {
      key: 'act',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MousePointerClick size={14} /> Act 执行操作
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            在当前页面执行交互操作（点击、输入、滚动等）。Agent
            用此操作与页面元素交互，如填写表单、点击按钮。
          </Text>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input
              size="small"
              placeholder='例：在搜索框中输入 "hello" 并点击搜索按钮'
              value={actInstruction}
              onChange={(e) => setActInstruction(e.target.value)}
              style={{ flex: 1 }}
            />
            <Button
              size="small"
              type="primary"
              loading={runningAction === 'act'}
              disabled={disabled || !actInstruction.trim()}
              onClick={() => runTest('act', { instruction: actInstruction })}
            >
              执行
            </Button>
          </div>
        </div>
      )
    },
    {
      key: 'close',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <XCircle size={14} /> Close 关闭会话
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            关闭 Playground 的 Stagehand 会话（释放服务端资源）。不会关闭浏览器进程本身。
          </Text>
          <Button
            size="small"
            danger
            loading={runningAction === 'close'}
            disabled={!apiKey}
            onClick={() => runTest('close', {})}
          >
            关闭会话
          </Button>
        </div>
      )
    }
  ]

  return (
    <div className="browser-playground" style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Playground</h3>
      <p style={{ color: 'var(--colorTextSecondary)', fontSize: 12, marginBottom: 12 }}>
        启动浏览器节点后，可在此测试 Agent 的全部浏览器操作能力。建议按 Navigate → Extract/Observe →
        Act 的顺序测试。
      </p>

      {/* Relay status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Button
          size="small"
          icon={<Wifi size={14} />}
          loading={testingRelay}
          onClick={testRelayConnection}
          disabled={!apiKey}
        >
          检测 Relay 连接
        </Button>
        {relayStatus !== null && (
          <Tag color={relayStatus ? 'success' : 'warning'}>
            {relayStatus ? '已连接' : '未连接'}
          </Tag>
        )}
      </div>

      {/* Action tests */}
      <Collapse
        size="small"
        items={testItems}
        defaultActiveKey={['navigate']}
        style={{ marginBottom: 12 }}
      />

      {/* Results log */}
      {results.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text strong style={{ fontSize: 12 }}>
            测试记录
          </Text>
          <div
            style={{
              maxHeight: 200,
              overflowY: 'auto',
              marginTop: 4,
              border: '1px solid var(--colorBorderSecondary)',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 12,
              fontFamily: 'monospace'
            }}
          >
            {results.map((r, i) => (
              <div
                key={i}
                style={{
                  padding: '3px 0',
                  borderBottom:
                    i < results.length - 1 ? '1px solid var(--colorBorderSecondary)' : undefined,
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start'
                }}
              >
                <Tag
                  color={r.success ? 'success' : 'error'}
                  style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}
                >
                  {r.action}
                </Tag>
                <span style={{ flex: 1, wordBreak: 'break-all', color: 'var(--colorText)' }}>
                  {r.message}
                </span>
                <span style={{ color: 'var(--colorTextQuaternary)', whiteSpace: 'nowrap' }}>
                  {r.durationMs}ms
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isNodeRunning && (
        <div style={{ fontSize: 12, color: 'var(--colorTextSecondary)', marginTop: 8 }}>
          请先启动浏览器节点后再执行测试。
        </div>
      )}
    </div>
  )
}
