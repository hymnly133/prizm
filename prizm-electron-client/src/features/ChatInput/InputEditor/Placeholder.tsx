import { Flexbox } from '@lobehub/ui'
import { memo } from 'react'

/** 占位符：参照 LobeUI/IDE 的输入提示，@ 引用、/ 命令、快捷键 */
const Placeholder = memo(() => {
  return (
    <Flexbox
      horizontal
      align="center"
      as="span"
      gap={6}
      wrap="wrap"
      className="chat-input-placeholder"
    >
      <span>从任何想法开始</span>
      <span className="chat-input-placeholder-sep">·</span>
      <span>
        <code>@</code> 引用文档/待办
      </span>
      <span className="chat-input-placeholder-sep">·</span>
      <span>
        <code>/</code> 命令（docs、todos、help…）
      </span>
      <span className="chat-input-placeholder-sep">·</span>
      <span>Enter 发送，Shift+Enter 换行</span>
    </Flexbox>
  )
})

Placeholder.displayName = 'Placeholder'

export default Placeholder
