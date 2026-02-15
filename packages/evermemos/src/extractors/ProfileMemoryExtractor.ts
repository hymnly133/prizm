import { BaseExtractor } from './BaseExtractor.js'
import {
  MemCell,
  BaseMemory,
  MemoryType,
  ProfileMemory,
  ProfileMemorySchema,
  ProjectInfo
} from '../types.js'
import { ICompletionProvider, CompletionRequest, parseJSON } from '../utils/llm.js'
import { PROFILE_PART1_PROMPT, PROFILE_PART2_PROMPT, PROFILE_PART3_PROMPT } from '../prompts.js'
import { v4 as uuidv4 } from 'uuid'

export class ProfileMemoryExtractor extends BaseExtractor {
  private llmProvider: ICompletionProvider

  constructor(llmProvider: ICompletionProvider) {
    super()
    this.llmProvider = llmProvider
  }

  async extract<T extends BaseMemory>(memcell: MemCell): Promise<T[] | null> {
    const inputText = this.formatInputText(memcell)
    if (!inputText) return null

    // We accept that we are extracting a "Delta" profile here.
    // The Python logic has elaborate merging with old memories.
    // Here we focus on extracting new info from the current memcell.
    const existingProfiles = '[]'

    const part1Prompt = PROFILE_PART1_PROMPT.replace('{{CONVERSATION_TEXT}}', inputText).replace(
      '{{EXISTING_PROFILES}}',
      existingProfiles
    )

    const part2Prompt = PROFILE_PART2_PROMPT.replace('{{CONVERSATION_TEXT}}', inputText).replace(
      '{{EXISTING_PROFILES}}',
      existingProfiles
    )

    const part3Prompt = PROFILE_PART3_PROMPT.replace('{{CONVERSATION_TEXT}}', inputText).replace(
      '{{EXISTING_PROFILES}}',
      existingProfiles
    )

    try {
      // Parallel execution of all 3 parts
      const [part1Response, part2Response, part3Response] = await Promise.all([
        this.llmProvider.generate({
          prompt: part1Prompt,
          temperature: 0.1,
          json: true,
          scope: 'memory'
        }),
        this.llmProvider.generate({
          prompt: part2Prompt,
          temperature: 0.1,
          json: true,
          scope: 'memory'
        }),
        this.llmProvider.generate({
          prompt: part3Prompt,
          temperature: 0.1,
          json: true,
          scope: 'memory'
        })
      ])

      const part1Data = parseJSON(part1Response)
      const part2Data = parseJSON(part2Response)
      const part3Data = parseJSON(part3Response)

      // 单用户：所有 Part 的结果合并到同一份 profile
      const merged: Partial<ProfileMemory> = { user_id: memcell.user_id }

      const mergeProfile = (p: any) => {
        if (p.user_name) merged.user_name = p.user_name
        if (p.output_reasoning) merged.output_reasoning = p.output_reasoning

        if (p.working_habit_preference) merged.working_habit_preference = p.working_habit_preference
        if (p.hard_skills) merged.hard_skills = p.hard_skills
        if (p.soft_skills) merged.soft_skills = p.soft_skills
        if (p.personality) merged.personality = p.personality
        if (p.way_of_decision_making) merged.way_of_decision_making = p.way_of_decision_making

        if (p.role_responsibility) merged.work_responsibility = p.role_responsibility
        if (p.projects_participated) merged.projects_participated = p.projects_participated
        if (p.opinion_tendency) merged.tendency = p.opinion_tendency

        if (p.interests) merged.interests = p.interests
        if (p.tendency) merged.tendency = p.tendency
        if (p.motivation_system) merged.motivation_system = p.motivation_system
        if (p.fear_system) merged.fear_system = p.fear_system
        if (p.value_system) merged.value_system = p.value_system
        if (p.humor_use) merged.humor_use = p.humor_use
        if (p.colloquialism) merged.colloquialism = p.colloquialism
      }

      // 合并三个 Part 的抽取结果
      for (const data of [part1Data, part2Data, part3Data]) {
        if (data?.user_profiles && Array.isArray(data.user_profiles)) {
          data.user_profiles.forEach(mergeProfile)
        }
      }

      // 至少有一个有效字段才产出结果
      const hasContent = Object.entries(merged).some(
        ([k, v]) => k !== 'user_id' && v !== undefined && v !== null
      )
      if (!hasContent) return null

      const timestamp = memcell.timestamp || new Date().toISOString()
      const content = merged.output_reasoning
        ? String(merged.output_reasoning)
        : merged.user_name
        ? `用户称呼: ${merged.user_name}`
        : '用户画像更新'

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
        user_name: merged.user_name,
        hard_skills: merged.hard_skills,
        soft_skills: merged.soft_skills,
        output_reasoning: merged.output_reasoning,
        way_of_decision_making: merged.way_of_decision_making,
        personality: merged.personality,
        projects_participated: merged.projects_participated as ProjectInfo[],
        user_goal: merged.user_goal,
        work_responsibility: merged.work_responsibility,
        working_habit_preference: merged.working_habit_preference,
        interests: merged.interests,
        tendency: merged.tendency,
        motivation_system: merged.motivation_system,
        fear_system: merged.fear_system,
        value_system: merged.value_system,
        humor_use: merged.humor_use,
        colloquialism: merged.colloquialism
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
