/**
 * "回到底部" 浮动按钮 — 用户上滑时出现
 */
import { motion, AnimatePresence } from 'motion/react'
import { ArrowDown } from 'lucide-react'
import { EASE_SMOOTH } from '../../theme/motionPresets'

interface ScrollToBottomProps {
  visible: boolean
  onClick: () => void
}

export function ScrollToBottom({ visible, onClick }: ScrollToBottomProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          onClick={onClick}
          initial={{ opacity: 0, y: 10, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.9 }}
          transition={{ duration: 0.2, ease: EASE_SMOOTH }}
          style={{
            position: 'sticky',
            bottom: 8,
            marginInline: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 14px',
            borderRadius: 20,
            border: '1px solid var(--ant-color-border)',
            background: 'var(--ant-color-bg-elevated)',
            color: 'var(--ant-color-text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,.08)',
            zIndex: 10,
            width: 'fit-content'
          }}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
        >
          <ArrowDown size={13} />
          <span>回到底部</span>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
