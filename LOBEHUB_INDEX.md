# LobeHub 项目索引与访问指南

> 项目目录 `lobehub` 体积较大（约 7,600+ 文件），AI 工具无法直接访问。本文档提供手动索引与 PowerShell 访问指导。

## 项目概述

**LobeHub**（原 LobeHub/lobe-chat）是一个开源 AI Agent 框架，支持语音合成、多模态、可扩展的 Function Call 插件系统。

- **版本**: 2.1.28
- **仓库**: <https://github.com/lobehub/lobe-chat>
- **包管理**: pnpm workspace
- **技术栈**: Next.js, Vercel AI, React, Electron, Drizzle ORM

---

## 目录结构索引

### 核心应用目录

| 路径 | 说明 |
|------|------|
| `lobehub/apps/desktop` | Electron 桌面应用 |
| `lobehub/src` | 主应用源码（Next.js） |
| `lobehub/packages` | 共享包（monorepo） |

### 顶层目录一览

| 目录/文件 | 类型 | 说明 |
|-----------|------|------|
| `__mocks__` | 目录 | 测试 mock |
| `.agents` | 目录 | Agent 技能 |
| `.claude` | 目录 | Claude 指令与 prompts |
| `.codex` | 目录 | Codex 技能 |
| `.conductor` | 目录 | Conductor 配置 |
| `.cursor` | 目录 | Cursor 文档与技能 |
| `.devcontainer` | 目录 | 开发容器配置 |
| `.github` | 目录 | GitHub Actions、Issue 模板 |
| `.husky` | 目录 | Git hooks |
| `.vscode` | 目录 | VSCode 配置 |
| `apps` | 目录 | 应用入口 |
| `changelog` | 目录 | 变更日志 |
| `docker-compose` | 目录 | Docker 部署配置 |
| `docs` | 目录 | 文档 |
| `e2e` | 目录 | 端到端测试 |
| `locales` | 目录 | 国际化文案 |
| `packages` | 目录 | 共享包 |
| `patches` | 目录 | 依赖补丁 |
| `public` | 目录 | 静态资源 |
| `scripts` | 目录 | 构建/脚本 |
| `src` | 目录 | 主应用源码 |
| `tests` | 目录 | 测试 |

### 主应用源码 `src/`

| 子目录 | 说明 |
|-------|------|
| `app` | Next.js App Router |
| `business` | 业务逻辑 |
| `components` | 通用组件 |
| `config` | 配置 |
| `const` | 常量 |
| `envs` | 环境变量 |
| `features` | 功能模块 |
| `helpers` | 工具函数 |
| `hooks` | React Hooks |
| `layout` | 布局 |

| 子目录 | 说明 |
|-------|------|
| `libs` | 第三方库封装 |
| `locales` | 国际化 |
| `server` | 服务端逻辑 |
| `services` | 服务层 |
| `store` | 状态管理 |
| `styles` | 样式 |
| `tools` | 工具 |
| `types` | 类型定义 |
| `utils` | 工具函数 |

### 共享包 `packages/`

| 包名 | 说明 |
|------|------|
| `agent-runtime` | Agent 运行时 |
| `builtin-agents` | 内置 Agent |
| `builtin-tool-agent-builder` | Agent 构建工具 |
| `builtin-tool-cloud-sandbox` | 云沙箱 |
| `builtin-tool-group-agent-builder` | 群组 Agent 构建 |
| `builtin-tool-group-management` | 群组管理 |
| `builtin-tool-gtd` | GTD 工具 |
| `builtin-tool-knowledge-base` | 知识库 |
| `builtin-tool-local-system` | 本地系统 |
| `builtin-tool-memory` | 记忆 |
| `builtin-tool-notebook` | 笔记本 |
| `builtin-tool-page-agent` | 页面 Agent |
| `builtin-tool-web-browsing` | 网页浏览 |
| `business` | 业务包（config, const, model-runtime） |
| `config` | 配置 |
| `const` | 常量 |
| `context-engine` | 上下文引擎 |
| `conversation-flow` | 对话流 |
| `database` | 数据库 |
| `desktop-bridge` | 桌面桥接 |
| `edge-config` | Edge 配置 |
| `editor-runtime` | 编辑器运行时 |
| `electron-client-ipc` | Electron 客户端 IPC |
| `electron-server-ipc` | Electron 服务端 IPC |
| `fetch-sse` | SSE 请求 |
| `file-loaders` | 文件加载器 |
| `memory-user-memory` | 用户记忆 |
| `model-bank` | 模型库 |
| `model-runtime` | 模型运行时 |
| `observability-otel` | 可观测性 |
| `prompts` | 提示词 |
| `python-interpreter` | Python 解释器 |
| `ssrf-safe-fetch` | 安全请求 |
| `types` | 类型 |
| `utils` | 工具 |
| `web-crawler` | 网页爬虫 |

### 文档 `docs/`

| 子目录 | 说明 |
|-------|------|
| `changelog` | 变更日志 |
| `development` | 开发指南 |
| `self-hosting` | 自托管部署 |
| `usage` | 使用说明 |
| `wiki` |  wiki |

### 脚本 `scripts/`

| 脚本 | 说明 |
|------|------|
| `prebuild.mts` | 预构建 |
| `checkConsoleLog.mts` | 检查 console.log |
| `vercelIgnoredBuildStep.js` | Vercel 构建跳过 |
| `runNextDesktop.mts` | 运行桌面版 |
| `migrate-spa-navigation.ts` | SPA 导航迁移 |
| `replaceComponentImports.ts` | 组件导入替换 |
| `generate-oidc-jwk.mjs` | OIDC JWK 生成 |

### 关键配置文件

| 文件 | 说明 |
|------|------|
| `package.json` | 根依赖与脚本 |
| `pnpm-workspace.yaml` | pnpm workspace 配置 |
| `next.config.ts` | Next.js 配置 |
| `drizzle.config.ts` | Drizzle ORM 配置 |
| `Dockerfile` | Docker 构建 |
| `tsconfig.json` | TypeScript 配置 |
| `eslint.config.mjs` | ESLint |
| `vitest.config.mts` | Vitest |

---

## PowerShell 访问指南

### 1. 进入 lobehub 目录

```powershell
cd d:\prizm\lobehub
```

### 2. 列出目录结构

```powershell
# 顶层目录
Get-ChildItem lobehub

# 递归列出（限制深度）
Get-ChildItem -Path lobehub -Recurse -Depth 2

# 仅目录
Get-ChildItem lobehub -Directory | ForEach-Object { $_.Name }
```

### 3. 读取文件内容

```powershell
# 读取前 50 行
Get-Content d:\prizm\lobehub\package.json | Select-Object -First 50

# 读取 README
Get-Content d:\prizm\lobehub\README.md

# 读取特定文件
Get-Content d:\prizm\lobehub\src\app\layout.tsx
```

### 4. 搜索文件

```powershell
# 按名称查找
Get-ChildItem -Path d:\prizm\lobehub -Recurse -Filter "*.tsx" | Where-Object { $_.Name -like "*Agent*" }

# 按扩展名统计
(Get-ChildItem -Path d:\prizm\lobehub -Recurse -Filter "*.ts").Count
```

### 5. 搜索文件内容

```powershell
# 在文件中搜索包含某字符串的文件
Select-String -Path "d:\prizm\lobehub\src\**\*.ts" -Pattern "useAgent" -List | Select-Object Path
```

### 6. 在 Cursor 中打开

```powershell
# 用 Cursor 打开 lobehub 子目录
cursor d:\prizm\lobehub
```

### 7. 常用开发命令

```powershell
cd d:\prizm\lobehub

# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build

# 桌面应用
pnpm dev:desktop
```

---

## 快速访问路径速查

| 需求 | 路径 |
|------|------|
| 主入口 | `lobehub/src/app/` |
| 组件 | `lobehub/src/components/` |
| Agent 逻辑 | `lobehub/packages/agent-runtime/` |
| 模型运行时 | `lobehub/packages/model-runtime/` |
| 数据库 | `lobehub/packages/database/` |
| 桌面应用 | `lobehub/apps/desktop/` |
| 文档 | `lobehub/docs/` |
| 配置 | `lobehub/next.config.ts`, `drizzle.config.ts` |

---

## 注意事项

- 项目使用 **pnpm**：需先 `pnpm install`
- 构建需较大内存：`NODE_OPTIONS=--max-old-space-size=8192`
- 桌面应用基于 Electron：`apps/desktop`
- 支持 Docker 部署：`docker-compose/` 目录

---

*索引生成于 2025-02-14*
