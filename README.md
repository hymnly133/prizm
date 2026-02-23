<div align="center">

# Prizm: Agent Collaborative Environment

**让 Agent 真正 *与你协作***。

[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[**English**](docs/README-EN.md) · [**文档/Docs**](docs/USER_GUIDE.md) · [**发现 Bug ?**](https://github.com/hymnly133/prizm/issues) · [**特性建议**](https://github.com/hymnly133/prizm/issues)

</div>

---

## 📖 目录

- [为什么是 Prizm？](#-为什么是-prizm)
- [核心特性概览](#-核心特性概览)
  - [面向用户的体验特性](#-面向用户的体验特性)
  - [面向开发者的技术细节](#-面向开发者的技术细节)
- [快速开始](#-快速开始)
- [生态接入 (MCP)](#-生态接入-mcp)
- [项目结构](#-项目结构)
- [技术栈](#-技术栈)
- [文档与指引](#-文档与指引)
- [开发与贡献](#-参与贡献)
- [许可证](#-许可证)

---

## 🤔 为什么是 Prizm？

**Prizm** 是一套面向桌面的 **Agent 协作环境（Agent Collaborative Environment）** 与知识管理平台。它的核心理念是填补传统效率工具与 AI 自动化能力之间的空隙：

* 🧠 **Agent 版 Obsidian**：让 Agent 以协作者身份共同管理私人的知识库（文档、待办、便签、剪贴板等），真正实现 *与你协作*。
* 🛠️ **通用个人 AI 工作台**：不再局限于辅助编写代码，而是广泛覆盖日常效率任务、文档重构、记忆回溯与工作自动化。
* 🔄 **知识闭环的自动化管道**：通过事件驱动机制，将「保存文档」「网页操作」「完成待办」等原子动作串联成高可复用的 Agent 自动化工作流。

**对你**：仅需一个统一的桌面入口，即可完成资料整理汇编、任务拆解规划，并定制灵活流畅的工作流。
**对 Agent**：提供高度集成的上下文环境——本机文档、待办、剪贴板、系统资源、终端、浏览器等一应俱全，赋予大模型真正精准的行动与服务能力。

---

## ✨ 核心特性概览

本平台采用的核心设计原则为 **本地优先**、**高可扩展**、**生产可用**。我们将特性分为使用体验（For Users）和技术细节（For Developers）两部分，以便不同人群快速了解。

### 🌟 面向用户的体验特性

| 特性分类 | 功能亮点说明 |
| :--- | :--- |
| 🛡️ **本地安全与数据主权** | 数据绝对优先落地至本机隐藏目录 `.prizm-data`，所有属于你的数字资产都能断网可用。支持一键离线备份配置和文档空间。 |
| 🧠 **全智能三层记忆架构** | 抛弃僵硬的上下文丢包问题。你的偏好、知识脉络被智能分层为 `工作短期上下文` / `项目中长期语义流` / `全局持久化属性库`，让智能体越用越懂你。 |
| 💬 **无缝沟通与全域能力** | 与各家最强最新模型聊天时，它们能够「动起来」。查阅实时网络、读写本地私密文档、自动分解待办事项、甚至直接操纵自动化剪贴板。 |
| ⚡ **可视化无代码流编排** | 如果你有一个重复一万遍的整理归档任务，可以利用桌面端提供的直观可视化工具拖拽，配置全天无休的「数字雇员」为你完成定时审查与自动化处理。 |
| 🔎 **雷达式闪电跨文档搜索** | 基于优化的本地轻量级向量检索引库，即使模糊表述也能跨越庞大项目和漫长的过往碎片笔记，“秒级”匹配到你需要的确切记忆点片断。 |

### 🛠️ 面向开发者的技术细节

| 技术模块 | 架构与实现明细 |
| :--- | :--- |
| 🔌 **协议网关 MCP (Model Context Protocol)** | 零成本集成。平台的数据底座提供高度成熟的 MCP 标准 Bridge。无论你在 Cursor 编写代码还是切换 LobeChat 界面，均可通过标准网络套接字随时读取 Prizm 梳理的底层知识。 |
| 🏢 **Scope 级租户隔离与乐观锁** | 引入企业级的 `Scope` 隔离态机制。工作、私人、在线三个维度的数据做到硬盘与内存强隔离。文档与状态流转依靠乐观资源锁保证了数据一致性避免碰撞态。 |
| 🌐 **WebSocket 高性能全双工终端** | 内置深度 I/O 穿透的终端执行子模块基于双工 WebSocket 连接。允许你的指令集对主机控制台拥有无延迟打洞般的实时指令流投递与执行回显监控。 |
| 🧩 **多态 Adapter 与事件总线 (EventBus)** | 松耦合的基石。核心动作拆解封装于轻量化总线总线，允许未来平行扩展新存储引擎（非强制 SQLite）甚至外拓的 AI SDK Providers 容器，保证平滑过渡。 |
| 📈 **高度精细的审计与 Token 用量基线** | 面向生产可运营。精确记录每一次操作落石：工具发起的行为回退 Checkpoint，跨模型流 Token 的统一精准计量面板，提供数据安全和开销的极度透明掌控。 |

---

## 🚀 快速开始

### 1. 环境准备与安装

请确保本地开发环境已包含 Node.js (>= 20) 版本与 Yarn。

```bash
# 1. 克隆代码仓库
git clone https://github.com/hymnly133/prizm.git
cd prizm

# 2. 安装全部依赖
yarn install

# 3. (可选) 配置环境变量
cp prizm/.env.example prizm/.env
# 根据需要修改 .env 中的服务端口、持久化存储路径及核心密钥凭据
```

### 2. 运行服务端（Web 管理面板）

对只需要借助浏览器对知识库、文档与历史剪贴板进行便捷治理的用户，无需加载完备的客户端：

```bash
yarn dev:server
```

> **访问方式**：服务正常启动后，默认可通过 [http://127.0.0.1:4127/dashboard/](http://127.0.0.1:4127/dashboard/) 查阅 Web 仪表盘。（极简模式初次体验可不再强绑定 `.env` 文件）。

### 3. 运行桌面客户端（推荐！完整能力）

为了获取无可妥协的一线效率体验（囊括全局 Agent 流式对话指导、工作流定制配置向导、实时全局消息系统派发、Token 监控看板等）：

```bash
yarn dev:electron
```

> ⚠️ **温馨提示**：在开始体验智能化特性的 **Agent 对话** 与流程规划之前，务必要前往控制中心或客户端系统设置中，启用并配置至少一种 **LLM （语言大模型）模型设定**（即输入 API Key 加配套 Base URL 项）。

---

## 🔌 生态接入 (MCP)

Prizm 不自闭门槛，以开放接入构建个人枢纽。允许直接将本体数据和内置指令上下文视作 **MCP (Model Context Protocol)** 源赋能市面领先的各家 AI 工具端，确保安全授权下的数据打通机制。

*   **Cursor**：依赖标准管道通讯挂载。进入 Cursor 选项指定挂载命令为 `node [具体工程绝对路径]/prizm/dist/mcp/stdio-bridge.js` ，顺延输入必选环境变量 （对应 `PRIZM_URL` 等）。具体规约详阅 [这里](prizm/MCP-CONFIG.md)。
*   **LobeChat/通用 SSE 支持网络集成端**：直接填入服务端地址暴露协议接口 `http://127.0.0.1:4127/mcp` （通过 Url Query 参数传递隔离域身份，如附加 `?scope=example` 等特征串区分独立的工作流与上下文资源库）；带有鉴权服务要求则进一步走 Header Token 传参接入。

---

## 📁 项目结构

项目基于 Yarn Workspace 实现为一套松散耦合但高度协同的 **Monorepo** ：

```text
prizm/
├── prizm/                       # @prizm/server — HTTP/WS 核心进程服务端
│   ├── src/                     # 服务端关键逻辑（路由 / MCP枢纽 / 任务流核心引擎 / 向量检索层实现）
│   └── panel/                   # Dashboard Web 独立面板界面层 （基于 Vue 3）
├── prizm-shared/                # @prizm/shared — 横跨各组件层的抽象定义（领域对象类型、共识接口与公用枚举字典）
├── prizm-client-core/           # @prizm/client-core — 环境无状态的客户端 SDK 业务流，聚焦 HTTP / WebSocket 协议交互包装
├── prizm-electron-client/       # @prizm/electron-client — 高聚合桌面应用前端侧端倪 (Electron 驱动 + React 构建引擎)
├── packages/
│   ├── evermemos/               # @prizm/evermemos — 大幅调优后的自适应记忆存储引擎模块 (混合 LanceDB 向量 + SQLite 本地结构化持久库方案)
│   └── prizm-stagehand/         # @prizm/stagehand — 特殊剥离出来的智能网页控制系统，赋能基于 Playwright 的自动化浏览指令
├── website/                     # Prizm 生态的介绍站及官方落地页发布体 (Vite 架设)
└── docs/                        # 所有规范性说明、最佳实践指北及底层设计图文详述中心
```

---

## 🛠️ 技术栈重点梳理

不设限地采用现代开发基准，确保持续演进能力与性能：

*   **服务端架构网络**： Node.js / Express 5 / WebSocket 协议底层控制 / 全盘 TypeScript 类型校验
*   **前端工程与桌面融合端**： Electron 40 / React 19 / Ant Design / Vite 构建体系 / Zustand 驱动的状态拓扑网络 
*   **数据平面组织**： LanceDB 支撑高性能向量运算与比对 / SQLite 进行高速轻量关系持久 / 本地真实 File System 同步映射
*   **系统架构设计骨架**： 高维度 Scope 多重租户业务隔离 / 规整 Adapter 各类中间代理模式 / 聚合 EventBus 的核心通讯解耦桥接网络 

---

## 📖 文档与指引

如果渴望深度控制乃至自建平台组件，以下文档将会极为关键：

| 模块分类 | 文档快捷链接 |
| :--- | :--- |
| **上手与运行** | [系统用户手册](docs/USER_GUIDE.md) · [环境变量与配置设定概览](docs/configuration.md) |
| **底层核心功能设计** | [Workflow 引擎概念](docs/workflow-system.md) · [Embedding 离线配置实践](docs/local-embedding.md) · [底层记忆反馈架构](docs/feedback-system.md) · [自动化网页控制器参数](docs/browser-control-options.md) |
| **二次开发与协议深入** | [开发者需知事项 (CLAUDE.md)](CLAUDE.md) · [架构级纵览大图](docs/ARCHITECTURE.md) · [全域名词解释术语簿](docs/glossary.md) |
| **多语言支撑** | [README 文档的英语版本](docs/README-EN.md) |

---

## 🤝 参与贡献

**感谢您对 Prizm 的关注，我们极其期望与您共建这个强大的混合工作域！**
- 如果在日常运行中碰撞出异常或者意外表现，欢迎抛出您发现的问题至 [Issue Trackers](https://github.com/hymnly133/prizm/issues)。
- 有大胆超前的发展构想期冀实现？在提起 PR 代码合并请求之前，还请预留片刻详阅项目的 [开发者规范协议](CLAUDE.md)，它囊括了如何进行标准构建、质量控制检测的关键须知。

---

## 📄 许可证

本项目所开源附带的所有逻辑内容默认遵从 **[PolyForm Noncommercial 1.0.0](LICENSE)** 许可条款声明。
这意味着整套解决方案的源文乃至延伸产物将开放且仅供所有独立的个人研究、测试评估验证以及进行绝不涉及商业销售获利的独立应用。**当您或者团体涉及到闭源化、进行分发牟利或包装作为商业变现的服务一环时，请提前联系主作者团队洽谈并确认授权形式**。
