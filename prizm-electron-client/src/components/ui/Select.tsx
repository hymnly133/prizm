/**
 * 统一 Select 组件 - 包装 @lobehub/ui 的 Select（基于 antd + Lobe 样式），修复下拉定位问题
 * 下拉框阻挡视野、锚点宽度异常等，通过 placement + popupMatchSelectWidth 解决
 */
import { Select as LobeSelect } from '@lobehub/ui'
import type { SelectProps } from 'antd'

const FIX_PROPS = {
  placement: 'bottomRight' as const,
  popupMatchSelectWidth: true
}

export function Select(props: SelectProps) {
  return <LobeSelect {...FIX_PROPS} {...props} />
}
