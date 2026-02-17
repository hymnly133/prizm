import { BaseExtractor } from './BaseExtractor.js'
import { MemCell, BaseMemory, MemoryType, ProfileMemory } from '../types.js'
import { ICompletionProvider, parseJSON } from '../utils/llm.js'
import { v4 as uuidv4 } from 'uuid'

/**
 * 独立 Profile 抽取器（旧路径，现已被 UnifiedExtractor 取代）。
 * 保留以兼容 extractors 注册逻辑，但实际业务应使用 UnifiedExtractor。
 * 输出格式：items: string[]（原子事实列表）。
 */
export class ProfileMemoryExtractor extends BaseExtractor {
  private llmProvider: ICompletionProvider

  constructor(llmProvider: ICompletionProvider) {
    super()
    this.llmProvider = llmProvider
  }

  async extract<T extends BaseMemory>(memcell: MemCell): Promise<T[] | null> {
    const inputText = this.formatInputText(memcell)
    if (!inputText) return null

    const prompt =
      '从以下对话中提取用户的持久性个人画像信息。\n' +
      '仅输出反映用户长期特征的原子事实（一条一事实），如称呼偏好、技能、兴趣、性格等。\n' +
      '输出严格 JSON 格式：{ "items": ["事实1", "事实2", ...] }\n' +
      '如无有效画像信息，输出 { "items": [] }\n\n' +
      '对话内容：\n' +
      inputText

    try {
      const response = await this.llmProvider.generate({
        prompt,
        temperature: 0.1,
        json: true,
        operationTag: 'memory:conversation_extract'
      })

      const data = parseJSON(response)
      const items: string[] = Array.isArray(data?.items)
        ? data.items.filter((s: unknown) => typeof s === 'string' && (s as string).trim())
        : []

      if (items.length === 0) return null

      const timestamp = memcell.timestamp || new Date().toISOString()
      const content = items.join('\n')

      const profile: ProfileMemory = {
        id: uuidv4(),
        memory_type: MemoryType.PROFILE,
        user_id: memcell.user_id,
        group_id: memcell.group_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        timestamp,
        deleted: false,
        content,
        items
      }

      return [profile] as unknown as T[]
    } catch (e) {
      console.error('Error extracting profile:', e)
      return null
    }
  }

  private formatInputText(memcell: MemCell): string {
    if (memcell.text) return memcell.text
    if (Array.isArray(memcell.original_data)) {
      return memcell.original_data
        .map(
          (m: any) =>
            '[' + (m.timestamp || '') + '] ' + (m.role || m.speaker || 'User') + ': ' + m.content
        )
        .join('\n')
    }
    return ''
  }
}
