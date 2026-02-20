/**
 * ExecutionResultView — 结构化结果展示组件
 *
 * 展示 output 文本 + structuredData JSON + artifacts 文件列表。
 */

import { Typography, Collapse, Tag, Space } from 'antd'
import { FileTextOutlined, DatabaseOutlined, PaperClipOutlined } from '@ant-design/icons'

const { Text, Paragraph } = Typography

export interface ExecutionResultViewProps {
  output?: string
  structuredData?: string
  artifacts?: string[]
  error?: string
}

export function ExecutionResultView({
  output,
  structuredData,
  artifacts,
  error
}: ExecutionResultViewProps) {
  if (!output && !structuredData && !artifacts?.length && !error) {
    return <Text type="secondary">(无输出)</Text>
  }

  const items = []

  if (error) {
    items.push({
      key: 'error',
      label: (
        <Space size={6}>
          <Tag color="error">错误</Tag>
          <Text type="danger" style={{ fontSize: 12 }}>{error.slice(0, 80)}</Text>
        </Space>
      ),
      children: (
        <Paragraph className="exec-result__output" style={{ color: 'var(--ant-color-error)' }}>
          {error}
        </Paragraph>
      )
    })
  }

  if (output) {
    items.push({
      key: 'output',
      label: (
        <Space size={6}>
          <FileTextOutlined />
          <span>输出 ({output.length} 字符)</span>
        </Space>
      ),
      children: (
        <Paragraph className="exec-result__output" style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}>
          {output}
        </Paragraph>
      )
    })
  }

  if (structuredData) {
    let formatted = structuredData
    try { formatted = JSON.stringify(JSON.parse(structuredData), null, 2) } catch { /* keep raw */ }
    items.push({
      key: 'structured',
      label: (
        <Space size={6}>
          <DatabaseOutlined />
          <span>结构化数据</span>
        </Space>
      ),
      children: (
        <pre className="exec-result__structured">
          {formatted}
        </pre>
      )
    })
  }

  if (artifacts?.length) {
    items.push({
      key: 'artifacts',
      label: (
        <Space size={6}>
          <PaperClipOutlined />
          <span>产出文件 ({artifacts.length})</span>
        </Space>
      ),
      children: (
        <ul className="exec-result__artifacts">
          {artifacts.map((f, i) => (
            <li key={i}><Text code>{f}</Text></li>
          ))}
        </ul>
      )
    })
  }

  return (
    <div className="exec-result">
      <Collapse items={items} defaultActiveKey={items.map((i) => i.key)} size="small" />
    </div>
  )
}
