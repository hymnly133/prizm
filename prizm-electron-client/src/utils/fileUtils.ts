/** 常见图片扩展名（小写），用于判断是否以图片方式预览 */
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp'
])

/**
 * 根据文件名判断是否为图片，用于在各视图中决定是否使用图片查看
 */
export function isImageFileName(fileName: string): boolean {
  if (!fileName || !fileName.includes('.')) return false
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}
