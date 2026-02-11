# Prizm 目标用户画像

## 用户画像：全栈开发者

### 基本信息

- 职业：全栈开发工程师 / 技术负责人
- 技术水平：高级，精通多个编程语言和框架
- 设备：macOS/Ubuntu 双系统，配置高
- 工具数量：20-30 个工具（编辑器、IDE、终端、数据库客户端、API 工具、CI/CD、监控等）

### 典型一天

- **上午（9:00-12:00）**：启动 VS Code/Cursor，打开多个终端窗口，检查 Jira/Trello 任务，查看 Slack 团队消息，切换到浏览器查看文档和 Stack Overflow，运行测试并查看结果
- **下午（13:00-18:00）**：代码审查（GitHub/GitLab PR），切换到数据库客户端查询数据，使用 Postman 测试 API，查看 Datadog 监控，参与代码评审会议，部署代码
- **晚上（19:00-21:00）**：处理紧急问题，回复邮件，学习新技术

**工具切换频率**：每天 50-100+ 次应用切换，频繁在编辑器、终端、浏览器、即时通讯工具之间跳转

### 痛点清单（按严重程度排序）

1. **上下文切换成本高** - 每天数十次 - 认知疲劳显著，深度工作被打断
   - 来源：<https://conclude.io/blog/context-switching-is-killing-your-productivity/>
2. **工具碎片化严重** - 持续 - 学习成本高，信息分散
   - 来源：<https://develocity.io/10-developer-pain-points-that-kill-productivity/>
3. **AI 工具隐私担忧** - 经常 - 代码可能泄露，不符合企业安全要求
   - 来源：<https://news.stanford.edu/stories/2025/10/ai-chatbot-privacy-concerns-risks-research>
   - 来源：<https://www.securityjourney.com/post/5-types-of-data-you-should-never-share-with-ai>
4. **重复性任务过多** - 每日 - 手动测试、部署、配置等浪费时间
   - 来源：<https://dev.to/gerimate/5-developer-pain-points-solved-by-internal-developer-platforms-1bd6>
5. **AI 工具破坏代码结构** - 偶尔但影响大 - Cursor/GitHub Copilot 有时会删除或破坏现有代码
   - 来源：<https://forum.cursor.com/t/cursor-ai-user-feedback-improvement-requests-challenges-and-development-process-insights/36712>

### 价值主张

"如果 Prizm 能在一个统一的界面中整合我的开发环境，自动处理重复任务，保证数据隐私，并智能理解项目上下文来提供准确的代码建议，我会愿意每月支付 15-25 美元"

**AI 介入价值**：非常高（82% 开发者每天或每周使用 AI 编码助手）

- 来源：<https://www.qodo.ai/reports/state-of-ai-code-quality/>

---

## 用户画像：产品经理 / 知识工作者

### 基本信息

- 职业：产品经理 / 运营 / 内容创作者
- 技术水平：中等，熟悉数字化工具但非技术专家
- 设备：MacBook + iPad + iPhone 生态
- 工具数量：15-25 个工具（Notion、Slack、Email、Jira、Figma、Zoom、Google Docs 等）

### 典型一天

- **上午（9:00-12:00）**：查看邮件和 Slack 消息，在 Notion 中规划今天任务，参加团队会议，在 Jira 中更新需求状态，切换到 Figma 查看设计稿
- **下午（13:00-18:00）**：撰写 PRD 文档（Google Docs/Notion），与设计团队同步，在 Airtable 中管理数据，准备演示文稿，回复客户反馈
- **晚上（19:00-21:00）**：整理笔记，跟进未完成任务，处理突发事项

**工具切换频率**：每天 40-60 次应用切换，在通讯工具、文档工具、项目管理工具之间频繁跳转

### 痛点清单（按严重程度排序）

1. **应用切换疲劳** - 持续 - 注意力分散，效率降低
   - 来源：<https://uk.finance.yahoo.com/news/app-fatigue-workplace-communication-050056883.html>
   - 来源：<https://conclude.io/blog/context-switching-is-killing-your-productivity/>
2. **通知过载** - 持续 - 无法专注，错过重要信息
   - 来源：<https://medium.com/@jin.empire001/app-fatigue-a-modern-day-problem-heres-the-solution-c1581fa979d0>
3. **数据孤岛** - 每日 - 信息分散在多个工具，难以整合和检索
   - 来源：<https://www.zenventory.com/blog/app-switching-fatigue-and-how-to-regain-four-hours-a-week>
4. **重复性信息整理** - 每日 - 会议纪要、任务同步、状态更新浪费时间
5. **跨平台同步问题** - 经常 - 移动端和桌面端数据不一致

### 价值主张

"如果 Prizm 能让我在一个地方查看所有工作信息，智能整理会议纪要和任务，自动同步状态，减少通知干扰并帮助我专注于重要事项，我会愿意每月支付 10-15 美元"

**AI 介入价值**：中等偏上（对于知识管理和自动化任务接受度高）

---

## 用户画像：效率工具重度用户

### 基本信息

- 职业：自由职业者 / 数字游民 / 技术爱好者
- 技术水平：高，熟练使用各种效率工具和自动化脚本
- 设备：macOS（Raycast、Keyboard Maestro），可能还有 uTools、Quicker
- 工具数量：30-50 个工具（但通过启动器和自动化整合）

### 典型一天

- **上午（8:00-12:00）**：通过 Raycast 启动所有应用，使用自定义脚本自动化日常任务（打开浏览器、配置开发环境、启动服务），在 Obsidian 中管理知识库，使用 Keyboard Maestro 自动化重复操作
- **下午（13:00-18:00）**：使用 Alfred/Alfred Powerpack 执行复杂工作流，通过 API 集成多个工具（Notion、Google Calendar、Slack），编写自定义脚本优化工作流程，测试新工具和自动化方案
- **晚上（19:00-22:00）**：整理知识库，优化自动化脚本，探索新工具

**工具切换频率**：通过启动器和自动化，实际应用切换减少到每天 20-30 次，但维护和配置工具的时间较多

### 痛点清单（按严重程度排序）

1. **工具维护成本高** - 持续 - 需要不断更新和调试自定义脚本
   - 来源：<https://github.blog/developer-skills/github/5-automations-every-developer-should-be-running/>
2. **工具生态碎片化** - 持续 - 不同工具之间缺乏深度集成
   - 来源：<https://www.reddit.com/r/raycastapp/comments/1k4b6y7/to_designersmarketers_who_use_raycast_whats_your/>
3. **学习新工具的时间成本** - 经常 - 每个新工具都需要学习和配置
   - 来源：<https://medium.com/productivity-matters/raycast-pro-is-cheaper-than-chatgpt-b57e4a3e30af>
4. **API 限制和集成困难** - 经常 - 很多工具不支持自动化或 API 限制严格
5. **跨工具数据同步** - 每日 - 需要手动在 Notion、Obsidian、Raycast 等工具间同步数据
   - 来源：<https://www.noratemplate.com/post/journey-to-becoming-a-notion-power-user-tips-and-tricks>

### 价值主张

"如果 Prizm 能提供一个统一的自动化平台，深度集成我现有的所有工具，提供强大的 API 和脚本能力，同时保持 Raycast/Alfred 那样的快捷体验，并且支持本地 AI 保证隐私，我会愿意每月支付 20-30 美元"

**AI 介入价值**：高（对 AI 预设和命令有强烈需求）

- 来源：<https://www.reddit.com/r/raycastapp/comments/1k4b6y7/to_designersmarketers_who_use_raycast_whats_your/>

---

## 用户画像：初级开发者 / 学生

### 基本信息

- 职业：初级开发工程师 / 计算机系学生
- 技术水平：初级，正在学习和成长
- 设备：中端配置的笔记本电脑（MacBook 或 Windows）
- 工具数量：10-15 个工具（VS Code、Git、简单的数据库工具、ChatGPT 等）

### 典型一天

- **上午（9:00-12:00）**：在 VS Code 中编写代码，频繁切换到浏览器搜索错误信息和教程，使用 ChatGPT/GitHub Copilot 获取代码帮助，查看文档
- **下午（13:00-18:00）**：学习新技术（视频教程、在线课程），练习编程项目，在 Stack Overflow 上提问，阅读技术博客
- **晚上（19:00-21:00）**：复习今天学的内容，整理笔记，准备第二天的任务

**工具切换频率**：每天 30-40 次应用切换，频繁在编辑器、浏览器和 AI 工具之间跳转

### 痛点清单（按严重程度排序）

1. **信息过载和选择困难** - 持续 - 太多工具和资源，不知道如何选择
   - 来源：<https://medium.com/@jin.empire001/app-fatigue-a-modern-day-day-problem-heres-the-solution-c1581fa979d0>
2. **学习曲线陡峭** - 持续 - 每个工具都需要时间学习，效率低
3. **AI 工具依赖性强** - 每日 - 过度依赖 AI 而不理解底层原理
   - 来源：<https://www.index.dev/blog/ai-assistant-statistics>
4. **缺少统一的开发环境** - 每日 - 工具之间没有良好集成
5. **预算有限** - 持续 - 不愿意为多个工具付费

### 价值主张

"如果 Prizm 能提供一个集成的学习环境，智能推荐学习资源，在同一个界面中整合代码编辑、AI 辅助和文档查询，并且价格合理（学生优惠），我会愿意每月支付 5-8 美元"

**AI 介入价值**：高（年轻开发者对 AI 工具接受度高）

- 来源：<https://www.secondtalent.com/resources/ai-coding-assistant-statistics/>
- 来源：<https://survey.stackoverflow.co/2025/ai>

---

## 总结：AI 介入价值和用户接受度

### AI 工具采用率

- **82%** 的开发者每天或每周使用 AI 编码助手
  - 来源：<https://www.qodo.ai/reports/state-of-ai-code-quality/>
- **ChatGPT (82%) 和 GitHub Copilot (68%)** 是市场领导者
  - 来源：<https://survey.stackoverflow.co/2025/ai>
- 全栈开发者采用率最高（32.1%），其次是前端开发者（22.1%）
  - 来源：<https://www.secondtalent.com/resources/ai-coding-assistant-statistics/>
- 18-34 岁的年轻开发者使用 AI 工具的可能性是年长开发者的两倍
  - 来源：<https://www.secondtalent.com/resources/ai-coding-assistant-statistics/>

### 用户对 AI 工具的期望

1. **上下文感知** - 希望 AI 能理解整个项目和代码库，而不仅仅是当前文件
2. **数据隐私** - 强烈关注本地 AI 选项，担心代码和数据泄露
   - 来源：<https://news.stanford.edu/stories/2025/10/ai-chatbot-privacy-concerns-risks-research>
3. **自动化能力** - 希望 AI 能自动化重复性任务（测试、部署、文档生成等）
4. **集成性** - 希望能与现有工具无缝集成
5. **准确性** - 对 AI 生成代码的准确性和安全性有高要求

### 支付意愿区间

- **初级开发者/学生**：$5-8/月（需要学生优惠）
- **知识工作者**：$10-15/月
- **高级开发者**：$15-25/月
- **效率工具重度用户**：$20-30/月（甚至更高，如果功能足够强大）

### 核心痛点优先级

1. 上下文切换成本和注意力分散
2. 工具碎片化和数据孤岛
3. 重复性任务和手动操作
4. AI 工具的隐私和安全问题
5. 工具之间缺乏深度集成
