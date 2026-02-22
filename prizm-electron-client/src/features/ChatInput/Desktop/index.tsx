import { ChatInput, ChatInputActionBar } from '@lobehub/editor/react'
import { Flexbox } from '@lobehub/ui'
import { createStaticStyles, cx } from 'antd-style'
import type { ReactNode } from 'react'
import { memo, useCallback, useEffect } from 'react'

import { useChatInputStore, useStoreApi } from '../store'
import ActionBar from '../ActionBar'
import BlockInput from '../BlockInput'
import MentionSlashOverlay from '../MentionSlashOverlay'
import RefChipsBar from '../RefChipsBar'
import PendingImagesBar from '../PendingImagesBar'
import SendArea from '../SendArea'

const styles = createStaticStyles(({ css }) => ({
  container: css`
    .show-on-hover {
      opacity: 0;
    }

    &:hover {
      .show-on-hover {
        opacity: 1;
      }
    }
  `,
  fullscreen: css`
    position: absolute;
    z-index: 100;
    inset: 0;
    width: 100%;
    height: 100%;
    margin-block-start: 0;
  `,
  inputFullscreen: css`
    border: none;
    border-radius: 0 !important;
  `
}))

interface DesktopChatInputProps {
  extenHeaderContent?: ReactNode
  inputContainerProps?: React.ComponentProps<typeof ChatInput>
  onClear?: () => void | Promise<void>
}

const DesktopChatInput = memo<DesktopChatInputProps>(
  ({ inputContainerProps, extenHeaderContent, onClear }) => {
    const storeApi = useStoreApi()
    const [slashMenuRef, expand, editor, leftActions] = useChatInputStore((s) => [
      s.slashMenuRef,
      s.expand,
      s.editor,
      s.leftActions
    ])

    useEffect(() => {
      if (editor) editor.focus()
    }, [editor])

    const handleKeyDownCapture = useCallback(
      (e: React.KeyboardEvent) => {
        const fn = storeApi.getState().overlayKeyHandler
        if (fn) fn(e.nativeEvent)
      },
      [storeApi]
    )

    return (
      <Flexbox
        className={cx(styles.container, expand && styles.fullscreen)}
        gap={8}
        paddingBlock="0 16px"
      >
        <div
          style={{ position: 'relative', width: '100%' }}
          onKeyDownCapture={handleKeyDownCapture}
        >
          <ChatInput
            data-testid="chat-input"
            defaultHeight={88}
            fullscreen={expand}
            maxHeight={320}
            minHeight={36}
            resize
            slashMenuRef={slashMenuRef}
            footer={
              <ChatInputActionBar
                right={<SendArea />}
                style={{ paddingRight: 8 }}
                left={<ActionBar leftActions={leftActions} onClear={onClear} />}
              />
            }
            header={
              <Flexbox gap={0}>
                {extenHeaderContent}
                <RefChipsBar />
                <PendingImagesBar />
              </Flexbox>
            }
            {...inputContainerProps}
            className={cx(expand && styles.inputFullscreen, inputContainerProps?.className)}
          >
            <BlockInput />
          </ChatInput>
          <MentionSlashOverlay />
        </div>
      </Flexbox>
    )
  }
)

DesktopChatInput.displayName = 'DesktopChatInput'

export default DesktopChatInput
