/**
 * 可复用的「提供商 + 模型」下拉选项构建
 * 用于设置页、侧栏等处的统一模型选择 UI（按提供商分组）
 */

/** 与 GET /settings/agent-models 返回的 entries 项一致 */
export interface ModelEntryLike {
  configId: string
  configName: string
  modelId: string
  label: string
}

/** 可用于 antd Select options 的单项或分组 */
export type ModelSelectOption =
  | { label: string; value: string }
  | { label: string; options: Array<{ label: string; value: string }> }

/** 第一项「未设置/系统默认」的配置 */
export interface EmptyOption {
  label: string
  value: string
}

/**
 * 从接口返回的 entries（configId/configName/modelId/label）构建按配置名分组的 Select 选项
 */
export function buildModelSelectOptionsFromEntries(
  entries: ModelEntryLike[],
  emptyOption: EmptyOption = { label: '未设置', value: '' }
): ModelSelectOption[] {
  const byConfig = entries.reduce<Record<string, ModelEntryLike[]>>((acc, e) => {
    const name = e.configName || e.configId
    if (!acc[name]) acc[name] = []
    acc[name].push(e)
    return acc
  }, {})
  return [
    emptyOption,
    ...Object.entries(byConfig).map(([configName, list]) => ({
      label: configName,
      options: list.map((e) => ({
        label: e.label,
        value: `${e.configId}:${e.modelId}`
      }))
    }))
  ]
}

/** AvailableModel 形状（id, label, provider） */
export interface AvailableModelLike {
  id: string
  label: string
  provider: string
}

/**
 * 从 AvailableModel[] 构建按 provider 分组的 Select 选项
 */
export function buildModelSelectOptionsFromAvailable(
  models: AvailableModelLike[],
  emptyOption: EmptyOption = { label: '系统默认', value: '' }
): ModelSelectOption[] {
  const byProvider = models.reduce<Record<string, Array<{ label: string; value: string }>>>(
    (acc, m) => {
      const p = m.provider || '其他'
      if (!acc[p]) acc[p] = []
      acc[p].push({ label: m.label, value: m.id })
      return acc
    },
    {}
  )
  return [
    emptyOption,
    ...Object.entries(byProvider).map(([name, list]) => ({ label: name, options: list }))
  ]
}
