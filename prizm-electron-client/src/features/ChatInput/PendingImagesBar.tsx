/**
 * 待发送图片栏：显示粘贴或上传的图片缩略图，支持移除
 */
import { memo, useCallback, useRef } from 'react'
import { X, ImagePlus } from 'lucide-react'
import { useChatInputStore } from './store'

const PendingImagesBar = memo(function PendingImagesBar() {
  const pendingImages = useChatInputStore((s) => s.pendingImages)
  const removePendingImage = useChatInputStore((s) => s.removePendingImage)
  const addPendingImage = useChatInputStore((s) => s.addPendingImage)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleRemove = useCallback(
    (index: number) => () => removePendingImage(index),
    [removePendingImage]
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file?.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const comma = dataUrl.indexOf(',')
        const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''
        const mimeMatch = dataUrl.match(/^data:([^;]+)/)
        const mimeType = mimeMatch?.[1] ?? file.type
        addPendingImage({ base64, mimeType })
      }
      reader.readAsDataURL(file)
    },
    [addPendingImage]
  )

  if (pendingImages.length === 0) {
    return (
      <div className="pending-images-bar pending-images-bar--empty">
        <button
          type="button"
          className="pending-images-bar__add"
          onClick={() => inputRef.current?.click()}
          title="添加图片"
          aria-label="添加图片"
        >
          <ImagePlus size={16} />
          <span>图片</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="pending-images-bar__input"
          aria-hidden
          tabIndex={-1}
          onChange={handleFileChange}
        />
      </div>
    )
  }

  return (
    <div className="pending-images-bar">
      <div className="pending-images-bar__list">
        {pendingImages.map((im, i) => (
          <div key={i} className="pending-images-bar__thumb">
            <img
              src={
                im.url ??
                (im.base64 ? `data:${im.mimeType ?? 'image/png'};base64,${im.base64}` : '')
              }
              alt=""
            />
            <button
              type="button"
              className="pending-images-bar__remove"
              onClick={handleRemove(i)}
              title="移除"
              aria-label="移除图片"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="pending-images-bar__add"
        onClick={() => inputRef.current?.click()}
        title="再添加一张"
        aria-label="再添加一张图片"
      >
        <ImagePlus size={14} />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="pending-images-bar__input"
        aria-hidden
        tabIndex={-1}
        onChange={handleFileChange}
      />
    </div>
  )
})

PendingImagesBar.displayName = 'PendingImagesBar'
export default PendingImagesBar
