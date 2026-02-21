/**
 * PrizmMarkdown — 封装 @lobehub/ui Markdown，自动将 @(type:id) 引用渲染为行内彩色 chip。
 * 可选：点击图片放大（onImageClick）。
 */
import { Markdown } from '@lobehub/ui'
import type { ComponentProps } from 'react'
import { memo, useMemo } from 'react'
import { preprocessAtRefs } from '../../utils/atRefPreprocess'

type MarkdownProps = ComponentProps<typeof Markdown>

export interface PrizmMarkdownProps extends MarkdownProps {
  /** 点击图片时回调，用于各视图中打开图片预览 */
  onImageClick?: (src: string) => void
}

const PrizmMarkdown = memo(({ children, onImageClick, components: propComponents, ...props }: PrizmMarkdownProps) => {
  const processed = useMemo(() => {
    if (typeof children !== 'string') return children
    return preprocessAtRefs(children)
  }, [children])

  const components = useMemo(() => {
    if (!onImageClick) return propComponents
    const clickableImg = ({ src, alt, ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) => (
      <img
        {...rest}
        src={src}
        alt={alt ?? ''}
        role="button"
        tabIndex={0}
        style={{ cursor: 'pointer', maxWidth: '100%', height: 'auto' }}
        onClick={() => src && onImageClick(src)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && src) onImageClick(src)
        }}
      />
    )
    return { ...propComponents, img: clickableImg }
  }, [onImageClick, propComponents])

  return (
    <Markdown {...props} allowHtml components={components}>
      {processed as string}
    </Markdown>
  )
})

PrizmMarkdown.displayName = 'PrizmMarkdown'

export { PrizmMarkdown }
export default PrizmMarkdown
