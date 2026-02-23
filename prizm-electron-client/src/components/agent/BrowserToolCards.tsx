/**
 * 浏览器工具卡片：与 Playwright 浏览器工具返回格式对齐的展示
 * 解析 success/message、elements、pageText、extraction 等并友好展示
 */
import { memo } from 'react'
import { Tag, Typography } from 'antd'
import { Globe } from 'lucide-react'
import type { ToolCallRecord } from '@prizm/client-core'
import { getToolDisplayName, registerToolRender } from '@prizm/client-core'

const { Text } = Typography

function parseArgs(argsStr: string): Record<string, unknown> {
  try {
    return JSON.parse(argsStr || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

/** 从 start 起找到与 open 匹配的括号结束位置 */
function findMatchingEnd(raw: string, start: number, open: string, close: string): number {
  let depth = 0
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === open) depth++
    else if (raw[i] === close) {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return raw.length
}

/** 解析服务端返回的原生对齐格式：多行 key: value（value 可能为单行或 JSON 多行） */
function parseNativeResult(resultStr: string): Array<{ key: string; value: string }> {
  const lines: Array<{ key: string; value: string }> = []
  const raw = resultStr?.trim() ?? ''
  if (!raw) return lines
  let i = 0
  while (i < raw.length) {
    const colon = raw.indexOf(': ', i)
    if (colon === -1) break
    const key = raw.slice(i, colon).trim()
    let valueStart = colon + 2
    let valueEnd: number
    const rest = raw.slice(valueStart)
    const first = rest[0]
    if (first === '[' || first === '{') {
      valueEnd = valueStart + findMatchingEnd(rest, 0, first === '[' ? '[' : '{', first === '[' ? ']' : '}')
    } else {
      const nextLine = raw.indexOf('\n', valueStart)
      valueEnd = nextLine === -1 ? raw.length : nextLine
    }
    let value = raw.slice(valueStart, valueEnd).trim()
    if ((key === 'actions' || key === 'elements') && (value.startsWith('[') || value.startsWith('{'))) {
      try {
        const parsed = JSON.parse(value) as unknown
        value = JSON.stringify(parsed, null, 2)
      } catch {
        /* keep raw */
      }
    }
    lines.push({ key, value })
    i = valueEnd + (raw[valueEnd] === '\n' ? 1 : 0)
  }
  return lines
}

function BrowserToolCardInner({ tc }: { tc: ToolCallRecord }) {
  const args = parseArgs(tc.arguments)
  const action = (args.action as string) ?? ''
  const displayName = getToolDisplayName(tc.name, tc.arguments)
  const isError = !!tc.isError
  const resultLines = parseNativeResult(tc.result ?? '')

  const successLine = resultLines.find((l) => l.key === 'success')
  const messageLine = resultLines.find((l) => l.key === 'message')
  const elementsLine = resultLines.find((l) => l.key === 'elements')
  const actionsLine = resultLines.find((l) => l.key === 'actions')
  const pageTextLine = resultLines.find((l) => l.key === 'pageText')
  const extractionLine = resultLines.find((l) => l.key === 'extraction')

  return (
    <div className="tool-card tool-card--browser" data-action={action}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Globe size={14} style={{ color: 'var(--ant-color-primary)' }} />
        <Tag color={action === 'close' ? 'default' : 'blue'}>{displayName}</Tag>
        {successLine && (
          <Tag color={successLine.value === 'true' && !isError ? 'success' : 'error'}>
            {successLine.value === 'true' ? '成功' : '失败'}
          </Tag>
        )}
      </div>
      {messageLine && messageLine.value && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
          {messageLine.value}
        </Text>
      )}
      {elementsLine && elementsLine.value && (
        <div style={{ marginTop: 6 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>可交互元素</Text>
          <pre
            style={{
              margin: '4px 0 0',
              padding: 8,
              background: 'var(--colorFillQuaternary)',
              borderRadius: 6,
              fontSize: 11,
              maxHeight: 160,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {elementsLine.value}
          </pre>
        </div>
      )}
      {actionsLine && actionsLine.value && (
        <div style={{ marginTop: 6 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>执行步骤</Text>
          <pre
            style={{
              margin: '4px 0 0',
              padding: 8,
              background: 'var(--colorFillQuaternary)',
              borderRadius: 6,
              fontSize: 11,
              maxHeight: 120,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {actionsLine.value}
          </pre>
        </div>
      )}
      {(pageTextLine || extractionLine) && (
        <div style={{ marginTop: 6 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {pageTextLine ? '整页文本' : '抽取内容'}
          </Text>
          <pre
            style={{
              margin: '4px 0 0',
              padding: 8,
              background: 'var(--colorFillQuaternary)',
              borderRadius: 6,
              fontSize: 11,
              maxHeight: 200,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {(pageTextLine || extractionLine)?.value ?? ''}
          </pre>
        </div>
      )}
      {isError && tc.result && !resultLines.length && (
        <pre
          style={{
            marginTop: 6,
            padding: 8,
            background: 'var(--colorErrorBg)',
            borderRadius: 6,
            fontSize: 11,
            color: 'var(--ant-color-error)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all'
          }}
        >
          {tc.result}
        </pre>
      )}
    </div>
  )
}

const BrowserToolCard = memo(function BrowserToolCard({ tc }: { tc: ToolCallRecord }) {
  return <BrowserToolCardInner tc={tc} />
})

registerToolRender('prizm_browser', (props) => <BrowserToolCard tc={props.tc} />)
