/**
 * 将 markdown 文本中的 @(type:id) 替换为行内 HTML chip。
 * 供 PrizmMarkdown 使用，可单独做单元测试。
 */
import { REF_CHIP_META, FALLBACK_CHIP_STYLE } from './refChipMeta'

const AT_REF_REGEX = /@\(([\w\u4e00-\u9fa5]+(?::[\w\u4e00-\u9fa5]+)?):([^)]+)\)/g

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function atRefToHtml(typeKey: string, id: string): string {
  const cfg = REF_CHIP_META[typeKey]
  const c = cfg ?? FALLBACK_CHIP_STYLE
  const shortId = id.length > 12 ? id.slice(0, 12) + '…' : id
  const tagHtml = cfg ? `<span class="prizm-ref-chip__tag">${cfg.label}</span>` : ''
  return (
    `<code class="prizm-ref-chip" style="color:${c.color};background:${c.bg}" title="@(${typeKey}:${escapeHtml(id)})">` +
    tagHtml +
    escapeHtml(shortId) +
    `</code>`
  )
}

/**
 * 预处理 markdown 文本：将 @(type:id) 替换为行内 HTML chip
 */
export function preprocessAtRefs(text: string): string {
  return text.replace(AT_REF_REGEX, (_match, typeOrScope: string, rest: string) => {
    const colonIdx = rest.indexOf(':')
    if (colonIdx > 0) {
      const candidateType = rest.slice(0, colonIdx)
      const candidateId = rest.slice(colonIdx + 1)
      if (REF_CHIP_META[candidateType]) {
        return atRefToHtml(candidateType, candidateId)
      }
    }
    return atRefToHtml(typeOrScope, rest)
  })
}
