export const EVENT_LOG_PROMPT =
  '你是一个从文本中抽取原子化事件日志的助手。\n\n' +
  '输入文本：\n{{INPUT_TEXT}}\n\n' +
  '当前时间：{{TIME}}\n\n' +
  '任务：从输入文本中抽取有信息量的原子事件。每个事件需包含具体时间和原子事实列表。\n\n' +
  '**重要过滤规则：**\n' +
  '- 原子事实必须是有实质信息量的、可验证的事实\n' +
  '- 不要记录"用户打招呼"、"用户问好"、"AI回复了用户"等无实质内容的交互\n' +
  '- 不要将 AI 的状态播报或模板化回复作为事实记录\n' +
  '- 只记录用户实际做出的有意义的行为、决策、请求或表达的观点\n\n' +
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
  '若未发现有信息量的事件，则 atomic_fact 返回空数组。\n'

export const FORESIGHT_GENERATION_PROMPT =
  '你是一个根据对话预测潜在未来影响（前瞻）的助手。\n\n' +
  '对话内容：\n{{CONVERSATION_TEXT}}\n\n' +
  '任务：分析对话并预测最多 10 条与用户相关的潜在未来影响或信息。\n\n' +
  '**重要过滤规则：**\n' +
  '- 前瞻必须基于用户在对话中明确表达或强烈暗示的意图、需求或计划\n' +
  '- 不可仅基于 AI 单方面提供的信息（如工作区状态播报、功能介绍）来推测用户下一步行为\n' +
  '- 不可基于打招呼/寒暄等无实质内容的对话进行推测\n' +
  '- 每条前瞻的 evidence 必须引用用户自己的话语或明确行为，而非 AI 的回复\n' +
  '- 如果对话中没有足够的用户意图信息，返回空数组 []\n\n' +
  '返回如下结构的 JSON 数组（键名保持英文）：\n' +
  '[\n' +
  '  {\n' +
  '    "content": "前瞻描述",\n' +
  '    "evidence": "支撑该条的前文引用（必须来自用户发言）",\n' +
  '    "start_time": "YYYY-MM-DD",\n' +
  '    "end_time": "YYYY-MM-DD（可选）",\n' +
  '    "duration_days": 1（可选）\n' +
  '  }\n' +
  ']\n' +
  '若对话无法支撑有效前瞻，返回空数组 []。\n'

export const EPISODE_MEMORY_PROMPT =
  '你是一个将对话归纳为情景记忆的助手。\n\n' +
  '输入文本：\n{{INPUT_TEXT}}\n\n' +
  '当前时间：{{TIME}}\n\n' +
  '任务：概括对话，抽取关键信息、关键词和一句摘要。\n\n' +
  '**重要过滤规则：**\n' +
  '- 如果对话仅是打招呼、寒暄、简单问候（如"你好"、"在吗"），不含有实质性话题讨论，返回空对象 {}\n' +
  '- AI 单方面的自我介绍、状态播报不构成有价值的情景记忆\n' +
  '- 摘要应聚焦于用户的具体需求、决策、讨论内容，而非 AI 的回应模板\n\n' +
  '返回如下 JSON 对象（键名保持英文）：\n' +
  '{\n' +
  '  "title": "情景标题",\n' +
  '  "content": "完整详细摘要",\n' +
  '  "summary": "一句话简要摘要",\n' +
  '  "keywords": ["标签1", "标签2"]\n' +
  '}\n' +
  '若对话无实质内容，返回 {} 空对象。\n'

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
  '<quality_gate>\n' +
  '**在抽取前，先判断对话是否包含有记忆价值的实质内容。以下场景不应产生任何记忆（直接输出空文本）：**\n' +
  '- 没有特殊情境的纯寒暄/打招呼（如"你好"、"在吗"、"hi"）\n' +
  '- AI 单方面的自我介绍、状态播报、能力说明（用户未做任何实质性请求或表达）\n' +
  '- 对话仅包含系统自动消息或模板化回复，没有用户的主动意图表达\n\n' +
  '**有效记忆的最低标准：对话中必须存在用户的具体需求、观点、决策、经历描述或有信息量的交互。**\n' +
  '</quality_gate>\n\n' +
  '<format_convention>\n' +
  '1. 小节标题：仅使用以下四者之一单独占一行，不可翻译或改写：## EPISODE、## EVENT_LOG、## FORESIGHT、## PROFILE。无内容的小节整节省略。\n' +
  '2. 键值行：每行一条，格式为「英文键名: 值」。键名与值之间用英文冒号+空格分隔；值可含中文或冒号，但整条不换行。\n' +
  '3. FORESIGHT 多条之间用单独一行「---」分隔；不要在 CONTENT 或 EVIDENCE 的正文中写入「---」。\n' +
  '4. 对话中 role=user 的一方即为「用户」，role=assistant 为 AI 助手。\n' +
  '</format_convention>\n\n' +
  '<output_format>\n' +
  '## EPISODE\n（完整详细摘要、一句话摘要、关键词。注意：摘要应聚焦于用户的行为和意图，而非 AI 的回应模板）\n' +
  'CONTENT: <完整详细摘要，一行>\nSUMMARY: <一句话简要摘要>\nKEYWORDS: k1, k2\n\n' +
  '## EVENT_LOG\n（具体时间 + 原子事实列表；原子事实为可验证、不可再分的、有信息量的单一事实）\n' +
  'TIME: YYYY-MM-DD\nFACT: <原子事实一>\nFACT: <原子事实二>\n\n' +
  '## FORESIGHT\n（用户明确表达或强烈暗示的意图推导出的未来可能行为；必须有对话中的具体证据支撑）\n' +
  'CONTENT: <前瞻描述>\nSTART: YYYY-MM-DD\nEND: YYYY-MM-DD\nEVIDENCE: <支撑该条的前文引用>\n---\nCONTENT: <下一条>\n\n' +
  '## PROFILE\n（用户个人画像：从对话中提取关于用户的显式信息，如称呼偏好、技能、兴趣、工作习惯等）\n' +
  'USER_NAME: <用户的真实姓名或期望称呼，如对话中未提及则省略此行>\n' +
  'SUMMARY: <用一句话概括本次对用户画像学到的新信息，要具体>\n' +
  'HARD_SKILLS: a, b\nSOFT_SKILLS: c\nWORK_RESPONSIBILITY: <角色职责>\nINTERESTS: <兴趣>\nTENDENCY: <观点倾向>\n' +
  '</output_format>\n\n' +
  '<rules>\n' +
  '1. 键名必须为上述英文（CONTENT/SUMMARY/KEYWORDS/TIME/FACT/START/END/EVIDENCE/USER_NAME/HARD_SKILLS/SOFT_SKILLS/WORK_RESPONSIBILITY/INTERESTS/TENDENCY）。\n' +
  '2. EVENT_LOG：FACT 最多 10 条；无事件则省略 ## EVENT_LOG。FACT 必须是有信息量的事实，不得包含"用户打招呼"、"用户问好"、"AI回复了用户"等无实质内容的记录。\n' +
  '3. FORESIGHT：最多 10 条，条与条之间用单独一行 --- 分隔；每条必须有 EVIDENCE 且证据来自用户的明确表达。不可仅基于 AI 单方面提供的信息（如 AI 播报的工作区状态）来推测用户意图。\n' +
  '4. PROFILE：仅当对话中出现关于用户的显式个人信息（称呼、技能、偏好、习惯等）时填写；闲聊或纯技术问答无用户信息则省略。\n' +
  '5. EPISODE：摘要必须反映有意义的交互内容。如果对话的实质只是打招呼或闲聊而无具体话题展开，则省略整个 ## EPISODE 段。\n' +
  '6. 宁可不产出记忆，也不要产出低质量/无信息量的记忆。对话信息量不足时，输出空文本即可。\n' +
  '</rules>'

/**
 * 语义去重 LLM 确认 prompt（轻量级）。
 * 用于向量距离命中后，由 LLM 二次判断两条记忆是否真的表达相同信息。
 * LLM 仅需回答一行：SAME 或 DIFF + 理由。
 */
export const DEDUP_CONFIRM_PROMPT =
  '判断以下两条记忆是否表达了相同的核心信息（仅措辞不同、时间不同、或细节略有增减，但核心语义等价）。\n\n' +
  '已存储记忆:\n{{EXISTING}}\n\n新抽取记忆:\n{{NEW}}\n\n' +
  '回答格式仅一行: SAME 或 DIFF，空格后跟一句理由。\n' +
  '示例:\n' +
  'SAME 两条都描述用户希望被称为老大\n' +
  'DIFF 新记忆涉及用户的新项目需求，与已有记忆的主题不同\n'

/** Agentic 检索用：将用户 query 扩展为 2～3 条子查询（不同表述或子问题） */
export const QUERY_EXPANSION_PROMPT =
  '针对下列用户问题，生成 2～3 种不同表述或子问题，用于从记忆库中检索相关信息。' +
  '仅返回 JSON 字符串数组，不要其他文字。示例：["问题1", "问题2"]。\n用户问题：{{QUERY}}'
