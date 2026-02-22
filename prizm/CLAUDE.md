# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- BEGIN:PROJECT_OVERVIEW -->

## Project Overview

Prizm Server is a Node.js HTTP API server (`@prizm/server`) that provides an API layer for desktop efficiency tools including todo lists, documents (including legacy sticky-note style content), clipboard history, terminal sessions, memory management, and AI agent chat. It uses TypeScript (ESM source, built via tsup), Express 5.x, and includes a Vue 3 dashboard (`panel/`).

The server can run standalone with default adapters or be integrated into a larger Electron/Node application with custom adapters. It's maintained as a Git submodule and workspace dependency.

<!-- END:PROJECT_OVERVIEW -->

## Development Commands

### Server Development

```bash
# Build everything (server + panel)
yarn build

# TypeScript watch mode
yarn dev

# Production start (after build)
yarn start
# Or with custom port
node cli.js 5000

# Kill process on default port (Windows PowerShell)
yarn kill-port

# Clean build artifacts
yarn clean

# Test with example
yarn test
```

### Panel (Dashboard) Development

Located in `panel/` - a separate Vue 3 + Vite app:

```bash
# Panel development
yarn dev:panel

# Build only panel
yarn build:panel
```

<!-- BEGIN:ENVIRONMENT_VARIABLES -->

### Environment Variables

- `PRIZM_PORT` - Server port (default 4127)
- `PRIZM_HOST` - Listen address (default 127.0.0.1)
- `PRIZM_DATA_DIR` - Data directory (default .prizm-data)
- `PRIZM_AUTH_DISABLED=1` - Disable authentication for local development
- `PRIZM_LOG_LEVEL` - Log level: info / warn / error
- `PRIZM_AGENT_SCOPE_CONTEXT_MAX_CHARS` - Agent scope context max chars (default 4000)

**LLM (Agent)：** 由服务端设置中的「LLM 配置」管理，支持多套配置（OpenAI 兼容 / Anthropic / Google），在设置页或 Panel 中配置，不再通过环境变量覆盖。

**Local Embedding：** 本地向量模型，默认启用

- `PRIZM_EMBEDDING_ENABLED` - 是否启用本地 embedding（默认 true）
- `PRIZM_EMBEDDING_MODEL` - HuggingFace 模型 ID（默认 TaylorAI/bge-micro-v2，384 维）
- `PRIZM_EMBEDDING_CACHE_DIR` - 模型缓存目录（默认 {dataDir}/models）
- `PRIZM_EMBEDDING_MAX_CONCURRENCY` - 最大并发推理数（默认 1）

**Search：**

- `TAVILY_API_KEY` - Tavily 网络搜索 API key（可选，启用 Agent 网络搜索工具）

<!-- END:ENVIRONMENT_VARIABLES -->

<!-- BEGIN:ARCHITECTURE -->

## Architecture

### High-Level Structure

```
src/
├── adapters/                    # Adapter pattern implementations
│   ├── interfaces.ts            # INotificationAdapter, ITodoListAdapter, IClipboardAdapter,
│   │                            #   IDocumentsAdapter, IAgentAdapter, ILLMProvider
│   ├── default.ts               # Default adapters factory (createDefaultAdapters)
│   ├── DefaultAgentAdapter.ts   # Default agent adapter (LLM chat, sessions, messages)
│   ├── DefaultDocumentsAdapter.ts # Default documents adapter (md file storage)
│   ├── DefaultTodoListAdapter.ts  # Default todo list adapter
│   ├── DefaultClipboardAdapter.ts # Default clipboard adapter
│   └── DefaultNotificationAdapter.ts # Console logging notification
├── auth/
│   ├── ClientRegistry.ts        # API key management, persistence
│   └── authMiddleware.ts        # JWT-like auth, scope validation
├── core/
│   ├── eventBus/                # Domain event bus system (Emittery)
│   │   ├── eventBus.ts          # Core bus: emit / subscribe / subscribeOnce / subscribeAny
│   │   ├── types.ts             # DomainEventMap — all domain event types
│   │   └── handlers/            # auditHandlers / lockHandlers / memoryHandlers / wsBridgeHandlers
│   ├── agentAuditLog/           # Agent operation audit trail (SQLite)
│   │   ├── auditManager.ts      # Record / query audit entries
│   │   └── auditStore.ts        # SQLite storage (.prizm-data/agent_audit.db)
│   ├── resourceLockManager/     # Resource locking (Fencing Token pattern)
│   │   ├── lockManager.ts       # Acquire / release / validate locks
│   │   └── lockStore.ts         # SQLite storage (.prizm-data/resource_locks.db)
│   ├── mdStore/                 # Markdown file storage layer (V3)
│   │   ├── fileOps.ts           # File read/write/list/move operations
│   │   ├── documentStore.ts     # Document CRUD
│   │   ├── todoStore.ts         # Todo list CRUD
│   │   ├── clipboardStore.ts    # Clipboard history storage
│   │   ├── sessionStore.ts      # Agent session storage
│   │   └── tokenUsageStore.ts   # Token usage tracking
│   ├── ScopeStore.ts            # Scope-based data isolation
│   ├── ScopeRegistry.ts         # Scope registry
│   ├── PathProvider.ts          # Path provider (scope-level)
│   ├── PathProviderCore.ts      # Core path provider (app-level paths)
│   ├── MetadataCache.ts         # Metadata caching
│   ├── documentVersionStore.ts  # Document versioning
│   ├── tokenUsageDb.ts          # Token usage database
│   ├── backgroundSession/       # Background session manager
│   ├── cronScheduler/          # Cron scheduler
│   ├── feedback/               # Feedback system (SQLite, feedback.db)
│   │   ├── types.ts            # FeedbackRecord / Filter / Stats types
│   │   ├── feedbackStore.ts    # SQLite storage layer
│   │   ├── feedbackManager.ts  # CRUD + aggregation + lifecycle
│   │   └── index.ts
│   ├── workflowEngine/         # Workflow definition and execution
│   ├── scheduleReminder/       # Schedule reminder service
│   └── toolPermission/          # Tool permission cleanup
├── llm/                         # LLM providers and AI services
│   ├── builtinTools/            # Built-in agent tools (modular)
│   │   ├── definitions.ts       # Tool schema definitions (OpenAI function format)
│   │   ├── executor.ts          # Tool execution engine
│   │   ├── documentTools.ts     # Document CRUD (lock-aware)
│   │   ├── fileTools.ts         # File system operations (event-emitting)
│   │   ├── lockTools.ts         # Resource lock tools (checkout/checkin)
│   │   ├── todoTools.ts         # Todo list tools
│   │   ├── searchTools.ts       # Search tools
│   │   ├── knowledgeTools.ts    # Knowledge base tools
│   │   └── terminalTools.ts     # Terminal execution tools
│   ├── aiSdkBridge/             # LLM provider bridge (OpenAI/Anthropic/Google via server config)
│   ├── modelLists.ts           # Model list definitions
│   ├── prizmLLMAdapter.ts      # LLM adapter used by DefaultAgentAdapter
│   ├── EverMemService.ts        # Memory system integration
│   ├── localEmbedding.ts        # Local embedding model
│   ├── systemPrompt.ts          # System prompt builder
│   ├── scopeContext.ts          # Scope context builder
│   ├── contextTracker.ts        # Context window tracking
│   ├── customCommandLoader.ts   # Custom slash command loader
│   ├── skillManager.ts          # Skill management
│   ├── slashCommandRegistry.ts  # Slash command registry
│   ├── rulesLoader.ts           # External rules loader (project auto-discovery)
│   ├── agentRulesManager.ts     # Custom agent rules (user-level + scope-level)
│   ├── tavilySearch.ts          # Tavily web search integration
│   ├── streamToolCallsReducer.ts # Stream tool calls state machine
│   ├── interactManager.ts       # User interaction manager (approval flow)
│   └── ...                      # Other LLM utilities
├── routes/                      # Express route handlers
│   ├── agent.ts                 # Agent routes entry (assembles sub-modules)
│   ├── agent/                   # Agent route sub-modules
│   │   ├── sessions.ts          # Session CRUD, grant-paths, interact-response
│   │   ├── chat.ts              # Stream chat via SSE
│   │   ├── metadata.ts          # Agent metadata (tools, models)
│   │   └── audit.ts             # Audit log + lock management endpoints
│   ├── auth.ts                  # Client registration, listing, revocation
│   ├── todoList.ts              # Todo list management
│   ├── documents.ts             # Document CRUD
│   ├── clipboard.ts             # Clipboard history
│   ├── memory.ts                # Memory management
│   ├── search.ts                # Unified search
│   ├── files.ts                 # File system operations
│   ├── terminal.ts              # Terminal session management
│   ├── commands.ts              # Custom commands CRUD
│   ├── skills.ts                # Skills management CRUD
│   ├── agentRules.ts            # Agent rules CRUD (user + scope level)
│   ├── notify.ts                # Notification sending
│   ├── settings.ts              # Settings management
│   ├── embedding.ts             # Embedding model management
│   ├── workflow.ts              # Workflow definitions and runs
│   ├── task.ts                  # Background task runs
│   ├── schedule.ts              # Schedule/reminder
│   ├── cron.ts                  # Cron configuration
│   ├── feedback.ts              # Feedback CRUD + stats (auth + scope)
│   └── mcpConfig.ts             # MCP server configuration
├── terminal/                    # Terminal session management
│   ├── TerminalSessionManager.ts # Session lifecycle
│   ├── TerminalWebSocketServer.ts # WebSocket for terminal I/O
│   ├── ExecWorkerPool.ts        # Worker pool for execution
│   └── shellDetector.ts         # Shell auto-detection
├── mcp/                         # MCP server (tools/ + stdio-tools/)
├── mcp-client/                  # External MCP server connections
├── search/                      # Search service (MiniSearch + ripgrep)
├── settings/                    # Agent tools + server config (LLM configs via serverConfigStore)
├── websocket/                   # WebSocket event push server
├── server.ts                    # Express app creation, route mounting, lifecycle
├── index.ts                     # Main exports
├── types.ts                     # TypeScript definitions
├── config.ts                    # Configuration
├── errors.ts                    # Custom error classes
└── logger.ts                    # Logging

panel/                           # Vue 3 Dashboard (served at /dashboard/)
```

<!-- END:ARCHITECTURE -->

<!-- BEGIN:KEY_MODULES -->

### Adapter Pattern

The server decouples from underlying services via adapters:

- **INotificationAdapter**: System notifications - single `notify(title, body)` method
- **ITodoListAdapter**: Todo list CRUD (lists and items, multi-list per scope)
- **IClipboardAdapter**: Clipboard history (all methods optional)
- **IDocumentsAdapter**: Document CRUD (all methods optional)
- **IAgentAdapter**: Agent sessions, messages, streaming chat with tool execution
- **ILLMProvider**: Pluggable LLM provider (OpenAI/Ollama compatible)

**Creating custom adapters**: Implement interfaces from `src/adapters/interfaces.ts` and pass to `createPrizmServer()`.

### Event Bus

Type-safe domain event bus (`core/eventBus/`) using Emittery. Decouples:

- Tool execution → audit logging
- Session deletion → lock release + memory flush
- Document save → memory extraction + WS notification
- All resource changes → WebSocket broadcast

### Resource Lock Manager

Fencing token-based locking (`core/resourceLockManager/`) for `document` and `todo_list` resources. Features: TTL expiration, heartbeat renewal, auto-cleanup, session-scoped release.

### Agent Audit Log

SQLite-based audit trail (`core/agentAuditLog/`) recording all agent tool executions. 90-day retention with auto-pruning.

### Terminal Management

Server-side terminal sessions (`terminal/`) with `TerminalSessionManager` for lifecycle, `ExecWorkerPool` for parallel execution, and `TerminalWebSocketServer` for real-time I/O at `/ws/terminal`.

### Custom Commands & Skills

- Custom slash commands: user-defined Markdown files loaded via `customCommandLoader.ts`
- Skills: pluggable instructions injected into agent sessions via `skillManager.ts`

### Agent Rules

User-defined agent behavior rules (`llm/agentRulesManager.ts`, `routes/agentRules.ts`) with two levels:

- **User-level** (global): stored in `.prizm-data/rules/{id}.md`, shared across all scopes
- **Scope-level** (per workspace): stored in `{scopeRoot}/.prizm/rules/{id}.md`, scope-isolated

Rules are Markdown files with YAML frontmatter (id, title, enabled, alwaysApply, globs). Enabled + alwaysApply rules are automatically injected into the agent system prompt on each conversation turn. Injection priority: project rules (auto-discovered) > scope rules > user rules.

<!-- END:KEY_MODULES -->

### Scope-Based Data Isolation

All data isolated by scope:

- Scope path: `.prizm-data/scopes/{scope}/` 目录下按类型分 .md 单文件（frontmatter 存元数据）
- Default scope: `default`
- Persistence: Markdown with YAML frontmatter, auto-save on mutations
- Runtime cache: In-memory `Map` in `ScopeStore`

Scope specified via `X-Prizm-Scope` header or `?scope=` query parameter.

### Authentication & Authorization

- Client registration: `POST /auth/register` returns `clientId` and `apiKey` (hash-stored)
- Three auth methods: `Authorization: Bearer <key>`, `X-Prizm-Api-Key` header, or `?apiKey=` query param
- Scope validation: Request scope must be in client's `allowedScopes`
- Dashboard exemption: `X-Prizm-Panel: true` header bypasses auth
- Environment bypass: `PRIZM_AUTH_DISABLED=1`

### WebSocket (Dual Path)

| Path | Purpose |
|------|---------|
| `/ws` | Real-time event push (domain events bridged from EventBus) |
| `/ws/terminal` | Interactive terminal I/O |

### Route Organization

Routes are modular, each exporting a factory function. Complex modules (e.g. `agent`) split into subdirectories:

```typescript
export function createAgentRoutes(router: Router, adapter?: IAgentAdapter): void {
  registerMetadataRoutes(router)
  registerSessionRoutes(router, adapter)
  registerChatRoutes(router, adapter)
  registerAuditRoutes(router)
}
```

Auth routes mounted separately at `/auth/*` to avoid path conflicts.

<!-- BEGIN:SERVER_LIFECYCLE -->

### Server Lifecycle

**Startup:** HTTP listen → service init (EverMem, TokenUsage, LockManager, AuditManager) → workflow/task engine (bgSessionManager, cronManager, workflow recovery, reminder service) → EventBus handler registration (audit, lock, memory, bgSession, schedule, search) → WebSocket servers (event + terminal) → WS bridge handlers

**Shutdown:** Terminal WS → Terminal manager → Event WS → EventBus clear → TokenUsage DB → Lock manager → Audit manager → HTTP close

Server created via `createPrizmServer(adapters, options)` with options for `port`, `host`, `enableCors`, `authEnabled`, `enableWebSocket`, `websocketPath`.

<!-- END:SERVER_LIFECYCLE -->

<!-- BEGIN:API_ENDPOINTS -->

## API Endpoints

- `/health` - Health check with embedding status (no auth)
- `/auth/*` - Register, list clients, revoke, list scopes (no auth)
- `/agent/*` - Sessions, stream chat (SSE), metadata (auth + scope)
- `/agent/audit` - Audit log query, resource history (auth)
- `/agent/locks` - Lock listing, force release (auth)
- `/todo/*` - Todo list CRUD (auth + scope)
- `/documents/*` - Document management (auth + scope)
- `/clipboard/*` - Clipboard history (auth + scope)
- `/memory/*` - Memory operations (auth + scope)
- `/search/*` - Unified search (auth + scope)
- `/files/*` - File system operations (auth + scope)
- `/terminal/*` - Terminal sessions (auth)
- `/commands/*` - Custom commands CRUD (auth)
- `/skills/*` - Skills management (auth)
- `/agent-rules/*` - Agent rules CRUD, user-level + scope-level (auth)
- `/workflow/*` - Workflow definitions and runs (auth + scope)
- `/task/*` - Background task runs (auth + scope)
- `/schedule/*` - Schedule/reminder (auth)
- `/cron/*` - Cron configuration (auth)
- `/feedback/*` - User feedback CRUD + stats (auth + scope)
- `/notify` - Notifications (auth)
- `/settings/*` - Settings (auth)
- `/embedding/*` - Embedding model management (auth)
- `/mcp-config/*` - MCP configuration (auth)
- `/dashboard/*` - Vue 3 SPA (panel auth bypass)

<!-- END:API_ENDPOINTS -->

### Data Persistence

- Client registry: `.prizm-data/clients.json`
- Scope data: `.prizm-data/scopes/{scope}/` 下按类型分 documents、todo、clipboard、sessions 等 .md 单文件
- Resource locks: `.prizm-data/resource_locks.db` (SQLite)
- Audit log: `.prizm-data/agent_audit.db` (SQLite)
- Token usage: `.prizm-data/token_usage.db` (SQLite)
- Search index: `.prizm-data/search_index.db` (SQLite)
- Feedback: `.prizm-data/feedback.db` (SQLite)

## Integration Notes

### As Workspace Dependency

Import from parent project:

```typescript
import { createPrizmServer, createDefaultAdapters } from '@prizm/server'
```

### CLI Entry Point

Bin command `prizm-server` at `cli.js` supports:

- Default port 4127, host 127.0.0.1
- Custom port via argument: `prizm-server 5000`
- Custom host: `--host 0.0.0.0`

### Panel Integration

Panel static files served from `panel/dist/` at `/dashboard/`:

- SPA fallback for all `/dashboard/*` routes to `index.html`
- Development: Run `yarn dev:panel` for hot-reload
- Production: Build with `yarn build:panel`, served by Express static middleware

### CORS

Enabled by default for standalone usage. Can be disabled via `enableCors: false` option when embedding in larger app.

## TypeScript Configuration

- Target: ES2022
- Module: ESM (built via tsup)
- Strict mode enabled
- Output: `dist/` directory with `.js` and `.d.ts` files

## Git Submodule

This is maintained as a Git submodule. Changes here must be committed in this repo separately from parent project.

## Network Notes

For WSL/Docker access, server must listen on `0.0.0.0` and Windows firewall rules may need configuration. See `USAGE.md` for detailed WSL networking guide (Mirrored mode vs NAT mode).
