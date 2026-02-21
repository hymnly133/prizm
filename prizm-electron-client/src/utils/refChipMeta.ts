/**
 * 资源引用 chip 的类型元数据（label、颜色）。
 * 在 PrizmMarkdown、LivePreviewExtension、BlockInput 等多处共享。
 */
export interface RefChipMeta {
  label: string
  color: string
  bg: string
}

export const REF_CHIP_META: Record<string, RefChipMeta> = {
  doc:      { label: '文档', color: '#1677ff', bg: '#e6f4ff' },
  note:     { label: '便签', color: '#389e0d', bg: '#f6ffed' },
  todo:     { label: '待办', color: '#0958d9', bg: '#e6f4ff' },
  file:     { label: '文件', color: '#d46b08', bg: '#fff7e6' },
  workflow: { label: '工作流', color: '#722ed1', bg: '#f9f0ff' },
  run:      { label: '运行', color: '#13c2c2', bg: '#e6fffb' },
  task:     { label: '任务', color: '#389e0d', bg: '#f6ffed' },
  session:  { label: '会话', color: '#8c8c8c', bg: '#fafafa' },
  schedule: { label: '日程', color: '#eb2f96', bg: '#fff0f6' },
  cron:     { label: '定时', color: '#fa8c16', bg: '#fff7e6' },
  memory:   { label: '记忆', color: '#722ed1', bg: '#f9f0ff' }
}

export const FALLBACK_CHIP_STYLE = { color: '#595959', bg: '#f5f5f5' }
