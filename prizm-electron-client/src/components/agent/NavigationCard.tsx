/**
 * NavigationCard — 通用导航卡片，用于 prizm_navigate 工具结果
 *
 * 展示标题、描述与可选 initialPrompt，点击按钮跳转到工作流页并创建/打开工作流创建会话。
 */
import { memo, useMemo } from 'react'
import { Button } from 'antd'
import { ArrowRightCircle } from 'lucide-react'
import { createStyles } from 'antd-style'
import { registerToolRender } from '@prizm/client-core'
import type { ToolCallRecord } from '@prizm/client-core'
import { useNavigation } from '../../context/NavigationContext'

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 10px;
    overflow: hidden;
    background: ${token.colorBgContainer};
    padding: 14px 16px;
  `,
  title: css`
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 6px;
  `,
  desc: css`
    font-size: 13px;
    color: ${token.colorTextSecondary};
    margin-bottom: 10px;
    line-height: 1.5;
  `,
  prompt: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
    background: ${token.colorFillQuaternary};
    padding: 8px 10px;
    border-radius: 6px;
    margin-bottom: 12px;
    line-height: 1.4;
  `,
  actions: css`
    display: flex;
    justify-content: flex-end;
  `
}))

export interface NavigationPayload {
  navigation: {
    target: string
    initialPrompt?: string
    title?: string
    description?: string
  }
}

function parsePayload(tc: ToolCallRecord): NavigationPayload | null {
  const text = tc.result ?? (tc as { output?: string }).output
  if (!text || typeof text !== 'string') return null
  try {
    const data = JSON.parse(text) as unknown
    if (data && typeof data === 'object' && 'navigation' in data) {
      return data as NavigationPayload
    }
  } catch {
    /* ignore */
  }
  return null
}

function NavigationCardInner({ tc }: { tc: ToolCallRecord }) {
  const { styles } = useStyles()
  const { navigateToWorkflowCreate } = useNavigation()
  const payload = useMemo(() => parsePayload(tc), [tc.result, (tc as { output?: string }).output])

  if (!payload?.navigation) {
    return (
      <div className={styles.card}>
        <span className={styles.desc}>导航参数无效</span>
      </div>
    )
  }

  const { target, initialPrompt, title, description } = payload.navigation
  const isWorkflowCreate = target === 'workflow-create'

  const handleGo = () => {
    if (isWorkflowCreate) {
      navigateToWorkflowCreate({ initialPrompt })
    }
  }

  return (
    <div className={styles.card}>
      {title && <div className={styles.title}>{title}</div>}
      {description && <div className={styles.desc}>{description}</div>}
      {initialPrompt && (
        <div className={styles.prompt} title={initialPrompt}>
          {initialPrompt.length > 120 ? `${initialPrompt.slice(0, 120)}…` : initialPrompt}
        </div>
      )}
      <div className={styles.actions}>
        {isWorkflowCreate && (
          <Button type="primary" icon={<ArrowRightCircle size={16} />} onClick={handleGo}>
            去工作流创建会话
          </Button>
        )}
      </div>
    </div>
  )
}

const NavigationCardInnerMemo = memo(NavigationCardInner)

export function NavigationCard({ tc }: { tc: ToolCallRecord }) {
  return <NavigationCardInnerMemo tc={tc} />
}

registerToolRender('prizm_navigate', (props) => <NavigationCard tc={props.tc} />)
