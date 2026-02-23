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

type TestAction =
  | 'goto'
  | 'snapshot'
  | 'click'
  | 'fill'
  | 'select_option'
  | 'get_text'
  | 'close'

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

  const [gotoUrl, setGotoUrl] = useState('https://example.com')
  const [clickRef, setClickRef] = useState(0)
  const [fillRef, setFillRef] = useState(0)
  const [fillValue, setFillValue] = useState('')
  const [selectRef, setSelectRef] = useState(0)
  const [selectValue, setSelectValue] = useState('')

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
    async (action: TestAction, payload: Record<string, string | number | undefined>) => {
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
      key: 'goto',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Globe size={14} /> Goto 导航
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            导航到指定 URL。
          </Text>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input
              size="small"
              placeholder="https://example.com"
              value={gotoUrl}
              onChange={(e) => setGotoUrl(e.target.value)}
              style={{ flex: 1 }}
            />
            <Button
              size="small"
              type="primary"
              loading={runningAction === 'goto'}
              disabled={disabled || !gotoUrl.trim()}
              onClick={() => runTest('goto', { url: gotoUrl })}
            >
              执行
            </Button>
          </div>
        </div>
      )
    },
    {
      key: 'snapshot',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Eye size={14} /> Snapshot 快照
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            返回当前页可操作元素列表（ref, role, name），供 click/fill/select_option 使用 ref。
          </Text>
          <Button
            size="small"
            type="primary"
            loading={runningAction === 'snapshot'}
            disabled={disabled}
            onClick={() => runTest('snapshot', {})}
          >
            执行
          </Button>
        </div>
      )
    },
    {
      key: 'click',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MousePointerClick size={14} /> Click 点击
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            按 snapshot 返回的 ref（下标）点击元素。
          </Text>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input
              size="small"
              type="number"
              min={0}
              placeholder="ref"
              value={clickRef}
              onChange={(e) => setClickRef(Number(e.target.value) || 0)}
              style={{ width: 80 }}
            />
            <Button
              size="small"
              type="primary"
              loading={runningAction === 'click'}
              disabled={disabled}
              onClick={() => runTest('click', { ref: clickRef })}
            >
              执行
            </Button>
          </div>
        </div>
      )
    },
    {
      key: 'fill',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileSearch size={14} /> Fill 填写
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            按 ref 填写输入框。
          </Text>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input
              size="small"
              type="number"
              min={0}
              placeholder="ref"
              value={fillRef}
              onChange={(e) => setFillRef(Number(e.target.value) || 0)}
              style={{ width: 80 }}
            />
            <Input
              size="small"
              placeholder="value"
              value={fillValue}
              onChange={(e) => setFillValue(e.target.value)}
              style={{ width: 120 }}
            />
            <Button
              size="small"
              type="primary"
              loading={runningAction === 'fill'}
              disabled={disabled}
              onClick={() => runTest('fill', { ref: fillRef, value: fillValue })}
            >
              执行
            </Button>
          </div>
        </div>
      )
    },
    {
      key: 'select_option',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileSearch size={14} /> Select 选择
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            按 ref 选择下拉项（value 为选项 value 或 label）。
          </Text>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input
              size="small"
              type="number"
              min={0}
              placeholder="ref"
              value={selectRef}
              onChange={(e) => setSelectRef(Number(e.target.value) || 0)}
              style={{ width: 80 }}
            />
            <Input
              size="small"
              placeholder="value"
              value={selectValue}
              onChange={(e) => setSelectValue(e.target.value)}
              style={{ width: 120 }}
            />
            <Button
              size="small"
              type="primary"
              loading={runningAction === 'select_option'}
              disabled={disabled}
              onClick={() => runTest('select_option', { ref: selectRef, value: selectValue })}
            >
              执行
            </Button>
          </div>
        </div>
      )
    },
    {
      key: 'get_text',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileSearch size={14} /> Get text 取文本
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            返回当前页可见文本。
          </Text>
          <Button
            size="small"
            type="primary"
            loading={runningAction === 'get_text'}
            disabled={disabled}
            onClick={() => runTest('get_text', {})}
          >
            执行
          </Button>
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
            关闭 Playground 的浏览器会话（释放服务端资源）。不会关闭浏览器进程本身。
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
        Playwright 直接代理：goto / snapshot / click / fill / select_option / get_text / close。先 snapshot 取元素列表，再按 ref 操作。
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
        defaultActiveKey={['goto']}
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
