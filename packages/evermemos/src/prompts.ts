export const EVENT_LOG_PROMPT =
  'You are an AI assistant that extracts atomic event logs from text.\n' +
  'Input Text:\n' +
  '{{INPUT_TEXT}}\n\n' +
  'Current Time: {{TIME}}\n\n' +
  'Task:\n' +
  'Extract atomic events from the input text. Each event should have a specific time and a list of atomic facts.\n' +
  'Return a JSON object with the following structure:\n' +
  '{\n' +
  '  "event_log": {\n' +
  '    "time": "YYYY-MM-DD string",\n' +
  '    "atomic_fact": [\n' +
  '      "fact 1",\n' +
  '      "fact 2"\n' +
  '    ]\n' +
  '  }\n' +
  '}\n' +
  'If no events are found, return empty atomic_fact list.\n'

export const FORESIGHT_GENERATION_PROMPT =
  'You are an AI assistant that predicts potential future impacts (foresights) based on a conversation.\n' +
  'User ID: {{USER_ID}}\n' +
  'User Name: {{USER_NAME}}\n\n' +
  'Conversation:\n' +
  '{{CONVERSATION_TEXT}}\n\n' +
  'Task:\n' +
  'Analyze the conversation and predict up to 10 potential future impacts or relevant information for the user.\n' +
  'Return a JSON array of objects with the following structure:\n' +
  '[\n' +
  '  {\n' +
  '    "content": "Description of the foresight",\n' +
  '    "evidence": "Quote from conversation supporting this",\n' +
  '    "start_time": "YYYY-MM-DD",\n' +
  '    "end_time": "YYYY-MM-DD (optional)",\n' +
  '    "duration_days": 1 (optional)\n' +
  '  }\n' +
  ']\n'

export const EPISODE_MEMORY_PROMPT =
  'You are an AI assistant that summarizes a conversation into an episodic memory.\n' +
  'Input Text:\n' +
  '{{INPUT_TEXT}}\n\n' +
  'Current Time: {{TIME}}\n\n' +
  'Task:\n' +
  'Summarize the conversation, extracting key information, keywords, and a concise summary.\n' +
  'Return a JSON object:\n' +
  '{\n' +
  '  "title": "Episode Title",\n' +
  '  "content": "Full detailed summary",\n' +
  '  "summary": "Brief summary (one sentence)",\n' +
  '  "keywords": ["tag1", "tag2"]\n' +
  '}\n'

export const PROFILE_PART1_PROMPT =
  'You are a personal profile extraction expert.\n\n' +
  '<input>\n' +
  '- conversation_transcript:\n' +
  '{{CONVERSATION_TEXT}}\n' +
  '- participants_current_profiles: {{EXISTING_PROFILES}}\n' +
  '</input>\n\n' +
  '<output_format>\n' +
  'You MUST output a single JSON object with the top-level key "user_profiles".\n\n' +
  '```json\n' +
  '{\n' +
  '  "user_profiles": [\n' +
  '    {\n' +
  '      "user_id": "",\n' +
  '      "user_name": "",\n' +
  '      "output_reasoning": "",\n' +
  '      "working_habit_preference": [\n' +
  '        {"value": "", "evidences": ["conversation_id"]}\n' +
  '      ],\n' +
  '      "hard_skills": [\n' +
  '        {"value": "", "level": "", "evidences": ["conversation_id"]}\n' +
  '      ],\n' +
  '      "soft_skills": [\n' +
  '        {"value": "", "level": "", "evidences": ["conversation_id"]}\n' +
  '      ],\n' +
  '      "personality": [\n' +
  '        {"value": "Extraversion", "evidences": ["conversation_id"]}\n' +
  '      ],\n' +
  '      "way_of_decision_making": [\n' +
  '        {"value": "SystematicThinking", "evidences": ["conversation_id"]}\n' +
  '      ]\n' +
  '    }\n' +
  '  ]\n' +
  '}\n' +
  '```\n' +
  '</output_format>\n\n' +
  'Rules:\n' +
  '1. Only extract explicit information.\n' +
  '2. Maintain existing profile data unless contradicted.\n' +
  '3. Output valid JSON.\n'

export const PROFILE_PART2_PROMPT =
  'You are a project experience extraction expert.\n\n' +
  '<input>\n' +
  '- conversation_transcript:\n' +
  '{{CONVERSATION_TEXT}}\n' +
  '- participants_current_profiles: {{EXISTING_PROFILES}}\n' +
  '</input>\n\n' +
  '<output_format>\n' +
  'You MUST output a single JSON object with the top-level key "user_profiles".\n\n' +
  '```json\n' +
  '{\n' +
  '  "user_profiles": [\n' +
  '    {\n' +
  '      "user_id": "",\n' +
  '      "user_name": "",\n' +
  '      "role_responsibility": [\n' +
  '        {"value": "", "evidences": ["conversation_id"]}\n' +
  '      ],\n' +
  '      "opinion_tendency":[\n' +
  '        {"value": "", "evidences": ["conversation_id"], "type":""}\n' +
  '      ],      \n' +
  '      "projects_participated": [\n' +
  '        {\n' +
  '          "project_id": "",\n' +
  '          "project_name": "",\n' +
  '          "subtasks": [\n' +
  '            {"value": "", "evidences": ["conversation_id"], "type":""}\n' +
  '          ],\n' +
  '          "user_objective": [\n' +
  '            {"value": "", "evidences": ["conversation_id"]}\n' +
  '          ],\n' +
  '          "contributions": [\n' +
  '            {"value": "", "evidences": ["conversation_id"], "type":""}                          \n' +
  '          ],\n' +
  '          "user_concerns": [\n' +
  '            {"value": "", "evidences": ["conversation_id"]}\n' +
  '          ],\n' +
  '          "entry_date": "YYYY-MM-DD"\n' +
  '        }\n' +
  '      ]\n' +
  '    }\n' +
  '  ]\n' +
  '}\n' +
  '```\n' +
  '</output_format>\n'

export const PROFILE_PART3_PROMPT =
  'You are a personal profile extraction expert focused on deep psychological traits and extended attributes.\n' +
  '<input>\n' +
  '- conversation_transcript:\n' +
  '{{CONVERSATION_TEXT}}\n' +
  '- participants_current_profiles: {{EXISTING_PROFILES}}\n' +
  '</input>\n\n' +
  '<output_format>\n' +
  'You MUST output a single JSON object with the top-level key "user_profiles".\n\n' +
  '```json\n' +
  '{\n' +
  '  "user_profiles": [\n' +
  '    {\n' +
  '      "user_id": "",\n' +
  '      "user_name": "",\n' +
  '      "sensory_preference": [\n' +
  '         {"value": "", "evidences": ["conversation_id"]}\n' +
  '      ],\n' +
  '      "interest_preference": [\n' +
  '         {"value": "", "evidences": ["conversation_id"]}\n' +
  '      ],\n' +
  '      "social_interaction_preference": [\n' +
  '         {"value": "", "evidences": ["conversation_id"]}\n' +
  '      ],\n' +
  '      "activity_time_preference": [\n' +
  '         {"value": "", "evidences": ["conversation_id"]}\n' +
  '      ],\n' +
  '      "consumption_preference": [\n' +
  '         {"value": "", "evidences": ["conversation_id"]}\n' +
  '      ],\n' +
  '      "health_status": [\n' +
  '         {"value": "", "evidences": ["conversation_id"]}\n' +
  '      ],\n' +
  '      "education_experience": [\n' +
  '         {"value": "", "evidences": ["conversation_id"]}\n' +
  '      ],\n' +
  '      "career_trajectory": [\n' +
  '         {"value": "", "evidences": ["conversation_id"]}\n' +
  '      ]\n' +
  '    }\n' +
  '  ]\n' +
  '}\n' +
  '```\n' +
  '</output_format>\n'

/** 单次调用完成 episode / event_log / foresight / profile 抽取，使用分段文本格式（非 JSON） */
export const UNIFIED_MEMORY_EXTRACTION_PROMPT =
  'Extract memory from the conversation. Current time: {{TIME}}\n\nConversation:\n{{INPUT_TEXT}}\n\n' +
  'Output in the following format. Use only these section headers and key prefixes. Skip a section if nothing to extract.\n\n' +
  '## EPISODE\nCONTENT: <full summary in one line>\nSUMMARY: <one sentence>\nKEYWORDS: k1, k2\n\n' +
  '## EVENT_LOG\nTIME: YYYY-MM-DD\nFACT: <atomic fact one>\nFACT: <atomic fact two>\n\n' +
  '## FORESIGHT\nCONTENT: <item description>\nSTART: YYYY-MM-DD\nEND: YYYY-MM-DD\n---\nCONTENT: <next item>\n\n' +
  '## PROFILE\nUSER_ID: <id>\nUSER_NAME: <name>\nHARD_SKILLS: a, b\nSOFT_SKILLS: c\n\n' +
  'Rules: One line per CONTENT/SUMMARY/FACT. At most 10 FACT lines, 5 FORESIGHT items (separate with ---). Profile only if user traits appear.'

/** Agentic 检索用：将用户 query 扩展为 2～3 条子查询（不同表述或子问题） */
export const QUERY_EXPANSION_PROMPT =
  'Given the following user question, generate 2 to 3 alternative phrasings or sub-questions that could help retrieve relevant information from a memory store. ' +
  'Return ONLY a JSON array of strings, no other text. Example: ["question 1", "question 2"].\nUser question: {{QUERY}}'
