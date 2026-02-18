/**
 * Global Command Palette (Ctrl+K / Cmd+K)
 * Lightweight implementation without external dependencies.
 */
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { Modal, Input } from 'antd'
import {
  Home,
  LayoutDashboard,
  Bot,
  Columns2,
  User,
  Settings,
  FlaskConical,
  Plus,
  FileText,
  Brain,
  RefreshCw,
  ScrollText
} from 'lucide-react'
import { createStyles } from 'antd-style'

type PageKey = 'home' | 'work' | 'docs' | 'agent' | 'collaboration' | 'user' | 'settings' | 'test'

interface CommandItem {
  id: string
  label: string
  description?: string
  icon: React.ReactNode
  action: () => void
  keywords?: string[]
}

interface CommandPaletteProps {
  onNavigate: (page: PageKey) => void
  onNewChat: () => void
  onOpenLogs: () => void
}

const useStyles = createStyles(({ css, token }) => ({
  input: css`
    font-size: 15px;
  `,
  list: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 320px;
    overflow-y: auto;
    margin-top: 8px;
  `,
  item: css`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: ${token.borderRadius}px;
    cursor: pointer;
    transition: background 0.1s;
    border: none;
    background: transparent;
    width: 100%;
    text-align: left;
    color: ${token.colorText};
    font-size: 13px;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  itemActive: css`
    background: ${token.colorPrimaryBg};
    color: ${token.colorPrimary};

    &:hover {
      background: ${token.colorPrimaryBg};
    }

    .cmd-icon {
      color: ${token.colorPrimary};
    }
  `,
  itemIcon: css`
    color: ${token.colorTextSecondary};
    flex-shrink: 0;
    transition: color 0.15s;
  `,
  itemInfo: css`
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  `,
  itemLabel: css`
    font-weight: 500;
  `,
  itemDesc: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
  `,
  empty: css`
    padding: 24px 12px;
    text-align: center;
    color: ${token.colorTextQuaternary};
    font-size: 13px;
  `,
  hint: css`
    display: flex;
    justify-content: center;
    gap: 16px;
    padding: 6px 0 0;
    font-size: 11px;
    color: ${token.colorTextQuaternary};
  `,
  kbd: css`
    font-family: ui-monospace, monospace;
    font-size: 10px;
    padding: 1px 4px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 3px;
    background: ${token.colorFillQuaternary};
  `
}))

export function CommandPalette({ onNavigate, onNewChat, onOpenLogs }: CommandPaletteProps) {
  const { styles, cx } = useStyles()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<any>(null)

  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: 'nav-home',
        label: '主页',
        description: '回到主页仪表板',
        icon: <Home size={16} />,
        action: () => onNavigate('home'),
        keywords: ['home', 'dashboard']
      },
      {
        id: 'nav-work',
        label: '工作',
        description: '文档和待办管理',
        icon: <LayoutDashboard size={16} />,
        action: () => onNavigate('work'),
        keywords: ['work', 'todo', 'document']
      },

      {
        id: 'nav-agent',
        label: 'Agent',
        description: 'AI 对话',
        icon: <Bot size={16} />,
        action: () => onNavigate('agent'),
        keywords: ['agent', 'chat', 'ai']
      },
      {
        id: 'nav-collaboration',
        label: '协作',
        description: 'Agent + 文档分屏协作',
        icon: <Columns2 size={16} />,
        action: () => onNavigate('collaboration'),
        keywords: ['collaboration', 'split', '协作', '分屏']
      },
      {
        id: 'nav-user',
        label: '用户',
        description: 'Token 用量与记忆管理',
        icon: <User size={16} />,
        action: () => onNavigate('user'),
        keywords: ['user', 'token', 'memory']
      },
      {
        id: 'nav-settings',
        label: '设置',
        description: '应用配置',
        icon: <Settings size={16} />,
        action: () => onNavigate('settings'),
        keywords: ['settings', 'config', 'preferences']
      },
      {
        id: 'nav-devtools',
        label: '开发者工具',
        description: '系统诊断与测试',
        icon: <FlaskConical size={16} />,
        action: () => onNavigate('test'),
        keywords: ['devtools', 'test', 'debug']
      },
      {
        id: 'action-new-chat',
        label: '新建对话',
        description: '创建一个新的 Agent 会话',
        icon: <Plus size={16} />,
        action: onNewChat,
        keywords: ['new', 'chat', 'session', 'create']
      },
      {
        id: 'action-logs',
        label: '查看日志',
        description: '打开日志面板',
        icon: <ScrollText size={16} />,
        action: onOpenLogs,
        keywords: ['logs', 'console']
      }
    ],
    [onNavigate, onNewChat, onOpenLogs]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((cmd) => {
      const haystack = [cmd.label, cmd.description ?? '', ...(cmd.keywords ?? [])]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [commands, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const executeItem = useCallback((item: CommandItem) => {
    setOpen(false)
    setQuery('')
    item.action()
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((prev) => (prev + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[activeIndex]) {
        executeItem(filtered[activeIndex])
      }
    }
  }

  return (
    <Modal
      open={open}
      onCancel={() => {
        setOpen(false)
        setQuery('')
      }}
      footer={null}
      closable={false}
      width={480}
      centered
      styles={{
        body: { padding: '12px 16px' },
        mask: { backdropFilter: 'blur(2px)' }
      }}
    >
      <Input
        ref={inputRef}
        className={styles.input}
        placeholder="输入命令或搜索..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
        allowClear
        variant="borderless"
        size="large"
      />
      <div className={styles.list}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>没有匹配的命令</div>
        ) : (
          filtered.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              className={cx(styles.item, idx === activeIndex && styles.itemActive)}
              onClick={() => executeItem(item)}
              onMouseEnter={() => setActiveIndex(idx)}
            >
              <span className={cx(styles.itemIcon, 'cmd-icon')}>{item.icon}</span>
              <span className={styles.itemInfo}>
                <span className={styles.itemLabel}>{item.label}</span>
                {item.description && <span className={styles.itemDesc}>{item.description}</span>}
              </span>
            </button>
          ))
        )}
      </div>
      <div className={styles.hint}>
        <span>
          <span className={styles.kbd}>↑↓</span> 导航
        </span>
        <span>
          <span className={styles.kbd}>Enter</span> 执行
        </span>
        <span>
          <span className={styles.kbd}>Esc</span> 关闭
        </span>
      </div>
    </Modal>
  )
}
