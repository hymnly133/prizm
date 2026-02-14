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

      const profilesMap = new Map<string, Partial<ProfileMemory>>()

      // Helper to merge data
      const mergeProfile = (p: any) => {
        if (!p.user_id) return
        if (!profilesMap.has(p.user_id)) profilesMap.set(p.user_id, { user_id: p.user_id })
        const profile = profilesMap.get(p.user_id)!

        // Merge simple fields
        if (p.user_name) profile.user_name = p.user_name
        if (p.output_reasoning) profile.output_reasoning = p.output_reasoning

        // Merge arrays / complex fields
        if (p.working_habit_preference)
          profile.working_habit_preference = p.working_habit_preference
        if (p.hard_skills) profile.hard_skills = p.hard_skills
        if (p.soft_skills) profile.soft_skills = p.soft_skills
        if (p.personality) profile.personality = p.personality
        if (p.way_of_decision_making) profile.way_of_decision_making = p.way_of_decision_making

        // Part 2 fields
        if (p.role_responsibility) profile.work_responsibility = p.role_responsibility
        if (p.projects_participated) profile.projects_participated = p.projects_participated
        if (p.opinion_tendency) profile.tendency = p.opinion_tendency

        // Part 3 fields
        if (p.interests) profile.interests = p.interests
        if (p.tendency) profile.tendency = p.tendency // Overwrite or merge? Usually overwrite latest is fine for delta
        if (p.motivation_system) profile.motivation_system = p.motivation_system
        if (p.fear_system) profile.fear_system = p.fear_system
        if (p.value_system) profile.value_system = p.value_system
        if (p.humor_use) profile.humor_use = p.humor_use
        if (p.colloquialism) profile.colloquialism = p.colloquialism
      }

      // Process Part 1
      if (part1Data && Array.isArray(part1Data.user_profiles)) {
        part1Data.user_profiles.forEach(mergeProfile)
      }

      // Process Part 2
      if (part2Data && Array.isArray(part2Data.user_profiles)) {
        part2Data.user_profiles.forEach(mergeProfile)
      }

      // Process Part 3
      if (part3Data && Array.isArray(part3Data.user_profiles)) {
        part3Data.user_profiles.forEach(mergeProfile)
      }

      const results: ProfileMemory[] = []
      const timestamp = memcell.timestamp || new Date().toISOString()

      for (const profilePartial of profilesMap.values()) {
        if (!profilePartial.user_id) continue

        const profile: ProfileMemory = {
          id: uuidv4(),
          memory_type: MemoryType.PROFILE,
          user_id: profilePartial.user_id,
          group_id: memcell.group_id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          timestamp: timestamp,
          deleted: false,
          content: 'Profile update for ' + (profilePartial.user_name || profilePartial.user_id),

          user_name: profilePartial.user_name,
          hard_skills: profilePartial.hard_skills,
          soft_skills: profilePartial.soft_skills,
          output_reasoning: profilePartial.output_reasoning,
          way_of_decision_making: profilePartial.way_of_decision_making,
          personality: profilePartial.personality,
          projects_participated: profilePartial.projects_participated as ProjectInfo[],
          user_goal: profilePartial.user_goal,
          work_responsibility: profilePartial.work_responsibility,
          working_habit_preference: profilePartial.working_habit_preference,
          interests: profilePartial.interests,
          tendency: profilePartial.tendency,
          motivation_system: profilePartial.motivation_system,
          fear_system: profilePartial.fear_system,
          value_system: profilePartial.value_system,
          humor_use: profilePartial.humor_use,
          colloquialism: profilePartial.colloquialism
        }
        results.push(profile)
      }

      return results as unknown as T[]
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
