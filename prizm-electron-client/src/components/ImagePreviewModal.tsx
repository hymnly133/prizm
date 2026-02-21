/**
 * ImagePreviewModal - 图片查看模态（仅查看，无管理功能）
 * 用于文档/ Markdown 内点击图片放大、或各视图统一图片预览。
 */
import { memo } from 'react'
import { Modal } from 'antd'

export interface ImagePreviewModalProps {
  open: boolean
  /** 图片地址：URL、data URL 或 blob URL */
  src: string | null
  title?: string
  onClose: () => void
}

function ImagePreviewModal({ open, src, title = '图片预览', onClose }: ImagePreviewModalProps) {
  return (
    <Modal
      open={open}
      title={title}
      width={900}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      <div style={{ textAlign: 'center', paddingTop: 8 }}>
        {src && (
          <img
            src={src}
            alt=""
            style={{
              maxWidth: '100%',
              height: 'auto',
              objectFit: 'contain',
              borderRadius: 8
            }}
          />
        )}
      </div>
    </Modal>
  )
}

export default memo(ImagePreviewModal)
