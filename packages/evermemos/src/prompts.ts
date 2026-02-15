export const EVENT_LOG_PROMPT =
  '你是一个从文本中抽取原子化事件日志的助手。\n\n' +
  '输入文本：\n{{INPUT_TEXT}}\n\n' +
  '当前时间：{{TIME}}\n\n' +
  '任务：从输入文本中抽取原子事件。每个事件需包含具体时间和原子事实列表。\n' +
  '返回如下结构的 JSON 对象（键名保持英文）：\n' +
  '{\n' +
  '  "event_log": {\n' +
  '    "time": "YYYY-MM-DD",\n' +
  '    "atomic_fact": [\n' +
  '      "事实1",\n' +
  '      "事实2"\n' +
  '    ]\n' +
  '  }\n' +
  '}\n' +
  '若未发现事件，则 atomic_fact 返回空数组。\n'

export const FORESIGHT_GENERATION_PROMPT =
  '你是一个根据对话预测潜在未来影响（前瞻）的助手。\n\n' +
  '用户 ID：{{USER_ID}}\n' +
  '用户名称：{{USER_NAME}}\n\n' +
  '对话内容：\n{{CONVERSATION_TEXT}}\n\n' +
  '任务：分析对话并预测最多 10 条与用户相关的潜在未来影响或信息。\n' +
  '返回如下结构的 JSON 数组（键名保持英文）：\n' +
  '[\n' +
  '  {\n' +
  '    "content": "前瞻描述",\n' +
  '    "evidence": "支撑该条的前文引用",\n' +
  '    "start_time": "YYYY-MM-DD",\n' +
  '    "end_time": "YYYY-MM-DD（可选）",\n' +
  '    "duration_days": 1（可选）\n' +
  '  }\n' +
  ']\n'

export const EPISODE_MEMORY_PROMPT =
  '你是一个将对话归纳为情景记忆的助手。\n\n' +
  '输入文本：\n{{INPUT_TEXT}}\n\n' +
  '当前时间：{{TIME}}\n\n' +
  '任务：概括对话，抽取关键信息、关键词和一句摘要。\n' +
  '返回如下 JSON 对象（键名保持英文）：\n' +
  '{\n' +
  '  "title": "情景标题",\n' +
  '  "content": "完整详细摘要",\n' +
  '  "summary": "一句话简要摘要",\n' +
  '  "keywords": ["标签1", "标签2"]\n' +
  '}\n'

export const PROFILE_PART1_PROMPT =
  '你是个人画像抽取专家。\n\n' +
  '<input>\n' +
  '- 对话内容 conversation_transcript：\n{{CONVERSATION_TEXT}}\n' +
  '- 参与者当前画像 participants_current_profiles：{{EXISTING_PROFILES}}\n' +
  '</input>\n\n' +
  '<output_format>\n' +
  '你必须输出单个 JSON 对象，顶层键为 "user_profiles"。键名保持英文。\n\n' +
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
  '规则：1. 仅抽取显式信息。2. 除非被推翻否则保留现有画像。3. 输出合法 JSON。\n'

export const PROFILE_PART2_PROMPT =
  '你是项目经历抽取专家。\n\n' +
  '<input>\n' +
  '- 对话内容 conversation_transcript：\n{{CONVERSATION_TEXT}}\n' +
  '- 参与者当前画像 participants_current_profiles：{{EXISTING_PROFILES}}\n' +
  '</input>\n\n' +
  '<output_format>\n' +
  '你必须输出单个 JSON 对象，顶层键为 "user_profiles"。键名保持英文。\n\n' +
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
  '你是专注深层心理特质与扩展属性的个人画像抽取专家。\n\n' +
  '<input>\n' +
  '- 对话内容 conversation_transcript：\n{{CONVERSATION_TEXT}}\n' +
  '- 参与者当前画像 participants_current_profiles：{{EXISTING_PROFILES}}\n' +
  '</input>\n\n' +
  '<output_format>\n' +
  '你必须输出单个 JSON 对象，顶层键为 "user_profiles"。键名保持英文。\n\n' +
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

/** 单次调用完成 episode / event_log / foresight / profile 抽取，使用分段文本格式（非 JSON）。与分类型抽取语义等价；小节标题与键名必须保持英文以便解析。 */
export const UNIFIED_MEMORY_EXTRACTION_PROMPT =
  '你是记忆抽取专家，从对话中一次性完成四类抽取：情景记忆、事件日志、前瞻、用户画像。当前时间：{{TIME}}\n\n' +
  '<input>\n对话内容：\n{{INPUT_TEXT}}\n</input>\n\n' +
  '<format_convention>\n' +
  '1. 小节标题：仅使用以下四者之一单独占一行，不可翻译或改写：## EPISODE、## EVENT_LOG、## FORESIGHT、## PROFILE。无内容的小节整节省略。\n' +
  '2. 键值行：每行一条，格式为「英文键名: 值」。键名与值之间用英文冒号+空格分隔；值可含中文或冒号，但整条不换行。\n' +
  '3. FORESIGHT 多条之间用单独一行「---」分隔；不要在 CONTENT 或 EVIDENCE 的正文中写入「---」。\n' +
  '</format_convention>\n\n' +
  '<output_format>\n' +
  '## EPISODE\n（与情景记忆抽取一致：完整详细摘要、一句话摘要、关键词）\n' +
  'CONTENT: <完整详细摘要，一行>\nSUMMARY: <一句话简要摘要>\nKEYWORDS: k1, k2\n\n' +
  '## EVENT_LOG\n（与事件日志抽取一致：具体时间 + 原子事实列表；原子事实为可验证、不可再分的单一事实）\n' +
  'TIME: YYYY-MM-DD\nFACT: <原子事实一>\nFACT: <原子事实二>\n\n' +
  '## FORESIGHT\n（与前瞻抽取一致：潜在未来影响或与用户相关的预测；每条含描述与证据）\n' +
  'CONTENT: <前瞻描述>\nSTART: YYYY-MM-DD\nEND: YYYY-MM-DD\nEVIDENCE: <支撑该条的前文引用>\n---\nCONTENT: <下一条>\n\n' +
  '## PROFILE\n（与个人画像抽取一致：仅显式信息；核心字段与分类型 Part1/2 等价）\n' +
  'USER_ID: <id>\nUSER_NAME: <name>\nHARD_SKILLS: a, b\nSOFT_SKILLS: c\nOUTPUT_REASONING: <本段画像抽取理由>\nWORK_RESPONSIBILITY: <角色职责>\nINTERESTS: <兴趣>\nTENDENCY: <观点倾向>\n' +
  '</output_format>\n\n' +
  '<rules>\n' +
  '1. 键名必须为上述英文（CONTENT/SUMMARY/KEYWORDS/TIME/FACT/START/END/EVIDENCE/USER_ID/USER_NAME/HARD_SKILLS/SOFT_SKILLS/OUTPUT_REASONING/WORK_RESPONSIBILITY/INTERESTS/TENDENCY）。\n' +
  '2. EVENT_LOG：FACT 最多 10 条；无事件则省略 ## EVENT_LOG。\n' +
  '3. FORESIGHT：最多 10 条，条与条之间用单独一行 --- 分隔；每条尽量写 EVIDENCE。\n' +
  '4. PROFILE：仅当有明确用户身份、技能、偏好等显式信息时填写；无则省略。\n' +
  '</rules>'

/** Agentic 检索用：将用户 query 扩展为 2～3 条子查询（不同表述或子问题） */
export const QUERY_EXPANSION_PROMPT =
  '针对下列用户问题，生成 2～3 种不同表述或子问题，用于从记忆库中检索相关信息。' +
  '仅返回 JSON 字符串数组，不要其他文字。示例：["问题1", "问题2"]。\n用户问题：{{QUERY}}'
