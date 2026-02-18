/**
 * OutlineTree - Markdown 文档大纲树组件
 * 从 Markdown 内容解析标题层级，生成可点击导航大纲
 * 紧凑排版，最小化间距
 */
import { useMemo, useCallback } from 'react'
import { Tree } from 'antd'
import type { DataNode } from 'antd/es/tree'

export interface HeadingItem {
  level: number
  text: string
  line: number
}

interface OutlineTreeProps {
  content: string
  onNavigate?: (line: number) => void
  activeHeading?: number
}

/** 从 Markdown 内容解析标题 */
export function parseHeadings(content: string): HeadingItem[] {
  if (!content) return []
  const lines = content.split('\n')
  const headings: HeadingItem[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].replace(/[*_`~[\]]/g, '').trim(),
        line: i + 1
      })
    }
  }

  return headings
}

/** 将扁平标题列表转换为 Ant Design Tree 数据结构 */
function headingsToTreeData(headings: HeadingItem[]): DataNode[] {
  if (headings.length === 0) return []

  const root: DataNode[] = []
  const stack: Array<{ node: DataNode; level: number }> = []

  for (const h of headings) {
    const node: DataNode = {
      key: `heading-${h.line}`,
      title: <span className="outline-tree-text">{h.text}</span>,
      isLeaf: true
    }

    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
      stack.pop()
    }

    if (stack.length === 0) {
      root.push(node)
    } else {
      const parent = stack[stack.length - 1].node
      if (!parent.children) parent.children = []
      parent.children.push(node)
      parent.isLeaf = false
    }

    stack.push({ node, level: h.level })
  }

  return root
}

export default function OutlineTree({ content, onNavigate, activeHeading }: OutlineTreeProps) {
  const headings = useMemo(() => parseHeadings(content), [content])
  const treeData = useMemo(() => headingsToTreeData(headings), [headings])

  const handleSelect = useCallback(
    (keys: React.Key[]) => {
      if (keys.length === 0 || !onNavigate) return
      const key = String(keys[0])
      const lineStr = key.replace('heading-', '')
      const line = parseInt(lineStr, 10)
      if (!isNaN(line)) onNavigate(line)
    },
    [onNavigate]
  )

  if (headings.length === 0) {
    return (
      <div style={{ padding: '16px 12px', opacity: 0.5, fontSize: 12, textAlign: 'center' }}>
        暂无标题
      </div>
    )
  }

  return (
    <Tree
      className="outline-tree"
      treeData={treeData}
      defaultExpandAll
      blockNode
      showIcon={false}
      showLine={false}
      selectedKeys={activeHeading ? [`heading-${activeHeading}`] : []}
      onSelect={handleSelect}
    />
  )
}
