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

/** Agentic 检索：LLM 判断检索结果是否充分回答用户查询 */
export const SUFFICIENCY_CHECK_PROMPT =
  '你是一个记忆检索评估专家。请判断当前检索到的记忆是否足以回答用户的查询。\n\n' +
  '用户查询：\n{{QUERY}}\n\n' +
  '检索到的记忆：\n{{RETRIEVED_DOCS}}\n\n' +
  '请判断这些记忆是否足以回答用户的查询。\n\n' +
  '输出 JSON 格式：\n' +
  '{\n' +
  '  "is_sufficient": true/false,\n' +
  '  "reasoning": "你的判断理由",\n' +
  '  "missing_information": ["缺失信息1", "缺失信息2"]\n' +
  '}\n\n' +
  '要求：\n' +
  '1. 如果记忆包含回答查询所需的关键信息，判断为 sufficient (true)\n' +
  '2. 如果缺少关键信息，判断为 insufficient (false)，并列出缺失的信息\n' +
  '3. reasoning 应简明扼要\n' +
  '4. missing_information 仅在 insufficient 时填写，otherwise 空数组\n'

/** Agentic 检索：基于缺失信息生成 2-3 条补充查询 */
export const REFINED_QUERY_PROMPT =
  '你是一个查询优化专家。用户的原始查询未能检索到足够的信息，请生成多条互补的改进查询。\n\n' +
  '原始查询：\n{{ORIGINAL_QUERY}}\n\n' +
  '当前检索到的记忆：\n{{RETRIEVED_DOCS}}\n\n' +
  '缺失的信息：\n{{MISSING_INFO}}\n\n' +
  '请生成 2-3 条互补查询来帮助找到缺失的信息。这些查询应当：\n' +
  '1. 针对不同的缺失信息点\n' +
  '2. 使用不同的表述方式\n' +
  '3. 避免与原始查询完全相同\n' +
  '4. 保持简洁明确\n\n' +
  '输出 JSON 格式：\n' +
  '{\n' +
  '  "queries": ["改进查询1", "改进查询2", "改进查询3"],\n' +
  '  "reasoning": "查询生成策略说明"\n' +
  '}\n'

/**
 * 文档记忆抽取 prompt（文档创建/更新时使用）。
 * 输出两段：OVERVIEW（总览记忆，仅 1 条）+ FACTS（原子事实记忆，多条）。
 * 针对低维向量模型（<400 维）优化：每条记忆独立可检索，不依赖上下文。
 */
export const DOCUMENT_MEMORY_EXTRACTION_PROMPT =
  '你是文档记忆抽取专家，从文档内容中提取结构化记忆条目。当前时间：{{TIME}}\n\n' +
  '<input>\n文档标题：{{TITLE}}\n\n文档内容：\n{{INPUT_TEXT}}\n</input>\n\n' +
  '<format_convention>\n' +
  '1. 小节标题：仅使用 ## OVERVIEW 或 ## FACTS，单独占一行，不可翻译或改写。无内容的小节整节省略。\n' +
  '2. 键值行：每行一条，格式为「英文键名: 值」。键名与值之间用英文冒号+空格分隔。\n' +
  '</format_convention>\n\n' +
  '<output_format>\n' +
  '## OVERVIEW\n' +
  '（文档总览：一段 200-400 字的详细摘要，涵盖文档主题、结构、核心论点和关键结论。' +
  '应当让读者无需阅读原文即可了解文档全貌。）\n' +
  'CONTENT: <文档总览，一行，200-400 字>\n\n' +
  '## FACTS\n' +
  '（从文档中提取的原子事实列表。每条事实必须：' +
  '1）独立可理解，不依赖上下文；' +
  '2）包含足够的主语和限定词，如「文档《X》中提到 Y」；' +
  '3）不超过 80 字。）\n' +
  'FACT: <原子事实一>\n' +
  'FACT: <原子事实二>\n' +
  '</output_format>\n\n' +
  '<rules>\n' +
  '1. 键名必须为英文：CONTENT、FACT。\n' +
  '2. OVERVIEW 必须输出且仅 1 条 CONTENT。总览应准确反映文档核心内容，不可遗漏重要信息。\n' +
  '3. FACTS 中的 FACT 最多 20 条。提取文档中的关键事实、数据、定义、结论、要点。\n' +
  '4. 每条 FACT 必须是原子的（不可再分的单一事实），包含足够的上下文使其可被独立检索和理解。\n' +
  '5. 避免提取过于宽泛或无信息量的内容（如"文档讨论了某个话题"）。\n' +
  '6. 文档内容过短或无实质信息时，OVERVIEW 简短概括即可，FACTS 可省略。\n' +
  '</rules>'

/**
 * 文档迁移记忆抽取 prompt（文档更新时使用）。
 * 从文本 diff 中提取语义层面的变更条目。
 */
export const DOCUMENT_MIGRATION_PROMPT =
  '你是文档变更分析专家，从文档更新的 diff 中提取有意义的语义变更记录。当前时间：{{TIME}}\n\n' +
  '<input>\n文档标题：{{TITLE}}\n\n' +
  '{{OLD_OVERVIEW_SECTION}}' +
  '本次更新的文本差异：\n{{DIFF_TEXT}}\n</input>\n\n' +
  '<output_format>\n' +
  '## MIGRATION\n' +
  '（本次更新的语义变更列表。每条 CHANGE 描述一个有意义的变更，如新增了什么内容、修改了什么定义、删除了什么章节。）\n' +
  'CHANGE: <语义变更描述一>\n' +
  'CHANGE: <语义变更描述二>\n' +
  '</output_format>\n\n' +
  '<rules>\n' +
  '1. 键名必须为英文：CHANGE。\n' +
  '2. 每条 CHANGE 不超过 100 字，应当包含文档标题引用和具体变更内容。\n' +
  '3. CHANGE 最多 10 条。聚焦于有实质意义的变更，忽略格式调整、拼写修正等琐碎改动。\n' +
  '4. 变更描述应当独立可理解，如「文档《X》新增了关于 Y 的结论」而非「新增了一段内容」。\n' +
  '5. 若 diff 中无有意义的语义变更（如仅格式调整），输出空文本即可。\n' +
  '</rules>'

/**
 * 共享 PROFILE 抽取指令：维度列表 + 反面示例 + 噪音过滤规则。
 * P1/P2 均使用此常量避免冗余。
 */
const PROFILE_SECTION_RULES =
  '## PROFILE\n（用户持久画像——仅跨会话复用的、反映"用户是谁"的个性化信息）\n' +
  '已有画像：{{EXISTING_PROFILE}}\n' +
  '**仅从用户自述中提取已有画像尚未包含的新增事实。严禁从 AI 回复推断用户特征。每条 ITEM 一个原子事实。**\n' +
  '参考维度：称呼 · 硬技能 · 软技能 · 性格 · 决策风格 · 职业角色 · 目标动机 · 兴趣爱好 · 工作习惯 · 价值观 · 顾虑\n' +
  '❌ 操作请求 · 工具使用 · AI推断 · 通用描述 · 已有重复  ✅ 用户自述的独有持久特征\n' +
  'ITEM: <如"用户希望被称为老大">\nITEM: <如"用户偏好函数式风格">\n' +
  '（"帮我写段代码"→无PROFILE；"我是后端工程师"→ITEM: 用户是后端工程师）\n'

const PROFILE_RULES_TEXT =
  'PROFILE（高门槛+增量）：**仅从用户自述**提取持久特征的**新增**信息。' +
  '❌ AI回复推断→严禁 ❌ 操作请求→EVENT_LOG ❌ 工具使用→行为日志 ❌ 通用描述 ❌ 已有重复→过滤。' +
  '可有多条 ITEM，每条必须原子化（一条一事实，禁止逗号/"并且"合并），无新增时整段省略。'

/**
 * Pipeline 1：每轮轻量抽取 prompt（event_log / profile / foresight，不含 narrative）。
 * 用于每轮对话完成后立即提取，量级较轻。
 */
export const PER_ROUND_EXTRACTION_PROMPT =
  '从单轮对话中提取记忆（事件日志/用户画像/前瞻）。当前时间：{{TIME}}\n' +
  '对话无实质内容（纯寒暄/AI自我介绍/模板回复）→ 直接输出空文本。\n\n' +
  '<input>\n{{INPUT_TEXT}}\n</input>\n\n' +
  '<output_format>\n' +
  '小节标题仅用 ## EVENT_LOG / ## FORESIGHT / ## PROFILE，无内容则整段省略。禁止输出 ## NARRATIVE。\n' +
  '格式：英文键名: 值，一行一条，不换行。role=user 为用户，role=assistant 为 AI。\n\n' +
  '## EVENT_LOG（最多 5 条，须有信息量，禁止"用户打招呼""AI回复了用户"等无实质记录）\n' +
  'FACT: <原子事实一>\nFACT: <原子事实二>\n\n' +
  '## FORESIGHT（最多 3 条，须有用户明确表达的证据，禁止仅基于 AI 回复推测。多条用 --- 分隔）\n' +
  'CONTENT: <前瞻描述>\nEVIDENCE: <证据引用>\n\n' +
  PROFILE_SECTION_RULES +
  '</output_format>\n\n' +
  '<rules>\n' +
  '键名仅限 FACT/CONTENT/EVIDENCE/ITEM。' +
  PROFILE_RULES_TEXT +
  ' 宁缺毋滥——不产出低质量记忆。\n' +
  '</rules>'

/**
 * Pipeline 2：阈值触发的叙述性批量抽取 prompt（narrative / foresight / profile）。
 * 将多轮累积的对话一次性提取，可产出多个 narrative 话题段。
 * 传入 Pipeline 1 已提取的记忆摘要以避免重复。
 */
export const NARRATIVE_BATCH_EXTRACTION_PROMPT =
  '你是记忆抽取专家，从多轮累积对话中提取深度记忆：叙事记忆、前瞻、用户画像。当前时间：{{TIME}}\n\n' +
  '<input>\n对话内容（多轮累积）：\n{{INPUT_TEXT}}\n</input>\n\n' +
  '<already_extracted>\n' +
  '以下是每轮对话已经提取过的记忆（避免重复）：\n{{ALREADY_EXTRACTED}}\n' +
  '</already_extracted>\n\n' +
  '<quality_gate>\n' +
  '**在抽取前，先判断累积的对话是否包含足够的信息量来生成有价值的叙述性记忆。**\n' +
  '**如果多轮对话的实质只是零散的寒暄或简单问答，不构成连贯的话题叙述，则省略 ## NARRATIVE 段。**\n' +
  '**有效记忆的最低标准：对话中必须存在用户的具体需求、观点、决策、经历描述或有信息量的交互。**\n' +
  '</quality_gate>\n\n' +
  '<format_convention>\n' +
  '1. 小节标题：仅使用 ## NARRATIVE、## FORESIGHT、## PROFILE，单独占一行，不可翻译或改写。无内容的小节整节省略。\n' +
  '2. 键值行：每行一条，格式为「英文键名: 值」。键名与值之间用英文冒号+空格分隔；值可含中文或冒号，但整条不换行。\n' +
  '3. **NARRATIVE 可包含多个话题段**，每段之间用单独一行「---」分隔。每段各自有 CONTENT/SUMMARY。\n' +
  '4. FORESIGHT 多条之间也用单独一行「---」分隔。\n' +
  '5. 对话中 role=user 的一方即为「用户」，role=assistant 为 AI 助手。\n' +
  '6. **不要输出 ## EVENT_LOG 段**——事件日志已在每轮流水线中提取。\n' +
  '</format_convention>\n\n' +
  '<output_format>\n' +
  '## NARRATIVE\n（对多轮对话的叙述性摘要。如果对话涵盖多个不同话题，请为每个话题生成独立的一段；' +
  '如果是同一话题的持续讨论，则只生成一段。每段代表一个话题的完整故事线。）\n' +
  'CONTENT: <话题一的完整详细摘要，一行>\nSUMMARY: <一句话简要摘要>\n---\n' +
  'CONTENT: <话题二的完整详细摘要，一行>\nSUMMARY: <一句话简要摘要>\n\n' +
  '## FORESIGHT\n（基于多轮对话全局视角的、更深层的前瞻预测；不要重复 <already_extracted> 中已有的前瞻）\n' +
  'CONTENT: <前瞻描述>\nEVIDENCE: <支撑该条的前文引用>\n---\nCONTENT: <下一条>\nEVIDENCE: <引用>\n\n' +
  PROFILE_SECTION_RULES +
  '</output_format>\n\n' +
  '<rules>\n' +
  '1. 键名必须为上述英文（CONTENT/SUMMARY/EVIDENCE/ITEM），不要输出 USER_NAME 等未列出的键。\n' +
  '2. NARRATIVE：每段必须有 CONTENT，可选 SUMMARY。多段用 --- 分隔。聚焦于有意义的交互。叙述性记忆是本流水线的核心产出——用高质量、详细、有上下文的叙述来记录用户的交互故事线。\n' +
  '3. FORESIGHT：最多 10 条；不要重复 <already_extracted> 中已有的前瞻。每条必须有 EVIDENCE。\n' +
  '4. ' +
  PROFILE_RULES_TEXT +
  '\n' +
  '5. 宁可不产出记忆，也不要产出低质量/无信息量的记忆。\n' +
  '</rules>'

/**
 * Profile 增量合并 prompt：LLM 智能合并新旧画像。
 *
 * 输入/输出格式均为：
 *   { "items": ["原子事实1", "原子事实2"] }
 *
 * LLM 负责：items 语义去重、冲突解决。
 */
export const PROFILE_MERGE_PROMPT =
  '将新抽取的用户画像增量合并到已有画像中。\n\n' +
  '已有画像：\n{{EXISTING_PROFILE}}\n\n新抽取画像：\n{{INCOMING_PROFILE}}\n\n' +
  '合并规则：\n' +
  '1. 语义等价（如「喜欢 TS」≈「喜欢 TypeScript」）→ 保留信息更丰富的一条\n' +
  '2. 互补信息 → 全部保留；矛盾 → 优先新信息（用户最新表达）\n' +
  '3. 仅措辞不同而语义相同 → 不更新（避免无意义变更）\n' +
  '4. 不丢失任何已有有效信息\n\n' +
  '输出严格 JSON：\n' +
  '{ "merged_profile": { "items": ["原子事实1", ...] }, "changes_summary": "一句话描述" }\n'
