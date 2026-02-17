/**
 * 空对话引导界面 — 居中引导区 + 快捷 prompt 模板
 */
import { motion } from 'motion/react'
import { MessageSquare, Sparkles, FileSearch, Lightbulb } from 'lucide-react'
import { fadeUp, STAGGER_DELAY } from '../../theme/motionPresets'

interface EmptyConversationProps {
  onSendPrompt?: (text: string) => void
  loading?: boolean
}

const QUICK_PROMPTS = [
  { icon: Sparkles, text: '帮我整理今天的工作内容', label: '工作整理' },
  { icon: FileSearch, text: '搜索并总结相关文档', label: '文档搜索' },
  { icon: Lightbulb, text: '基于我的笔记给出建议', label: '智能建议' }
]

export function EmptyConversation({ onSendPrompt, loading }: EmptyConversationProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 48,
        gap: 24
      }}
    >
      <motion.div {...fadeUp(0)} style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: 'var(--ant-color-primary-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px'
          }}
        >
          <MessageSquare size={28} style={{ color: 'var(--ant-color-primary)' }} />
        </div>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: 'var(--ant-color-text)',
            margin: '0 0 6px'
          }}
        >
          开始新对话
        </h2>
        <p
          style={{
            fontSize: 14,
            color: 'var(--ant-color-text-tertiary)',
            margin: 0
          }}
        >
          {loading ? '加载中...' : '在下方输入开始对话，会话将自动创建'}
        </p>
      </motion.div>

      {onSendPrompt && !loading && (
        <motion.div
          {...fadeUp(STAGGER_DELAY * 2)}
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            justifyContent: 'center'
          }}
        >
          {QUICK_PROMPTS.map(({ icon: Icon, text, label }, i) => (
            <motion.button
              key={label}
              type="button"
              onClick={() => onSendPrompt(text)}
              {...fadeUp(STAGGER_DELAY * (3 + i))}
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.97 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                borderRadius: 12,
                border: '1px solid var(--ant-color-border)',
                background: 'var(--ant-color-bg-container)',
                color: 'var(--ant-color-text-secondary)',
                fontSize: 13,
                cursor: 'pointer',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,.04)'
              }}
            >
              <Icon size={15} />
              <span>{label}</span>
            </motion.button>
          ))}
        </motion.div>
      )}
    </div>
  )
}
