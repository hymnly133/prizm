# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- BEGIN:PROJECT_STRUCTURE -->

## Project Structure

This is a Yarn workspace monorepo containing the following packages:

1. **`prizm/`** - HTTP API server (`@prizm/server`) with built-in Vue 3 dashboard and MCP server
2. **`prizm-electron-client/`** - Electron 40 desktop client (`@prizm/electron-client`), React 19 + Ant Design
3. **`prizm-client-core/`** - Shared client SDK (`@prizm/client-core`), HTTP/WebSocket client and agent tooling
4. **`prizm-shared/`** - Shared types and constants (`@prizm/shared`), domain models, events, auth types
5. **`packages/evermemos/`** - TypeScript memory system (`@prizm/evermemos`), LanceDB + SQLite storage
6. **`EverMemOS/`** - Python FastAPI long-term memory system (standalone, not in TS workspace)

The server provides an API layer for desktop efficiency tools including sticky notes, todo lists, documents, clipboard history, pomodoro timer, memory management, terminal sessions, and AI agent chat. It can run standalone with default adapters or integrate into larger applications.

<!-- END:PROJECT_STRUCTURE -->

## Development Commands

### Root Workspace

```bash
# Install all workspace dependencies
yarn install

# Build all packages
yarn build

# Build server only
yarn build:server

# Build client only
yarn build:client
```

### Server (`prizm/`)

```bash
cd prizm

# Build everything (server + panel)
yarn build

# TypeScript watch mode
yarn dev

# Production start (after build)
yarn start
# Or with custom port
node cli.js 5000

# Clean build artifacts
yarn clean

# Test with example
yarn test

# Kill process on default port 4127 (Windows PowerShell)
yarn kill-port
```

### Panel (Server Dashboard) (`prizm/panel/`)

The dashboard is a separate Vue 3 + Vite app located in `prizm/panel/`:

```bash
cd prizm

# Panel development with hot-reload
yarn dev:panel

# Build only panel
yarn build:panel
```

### Electron Client (`prizm-electron-client/`)

```bash
cd prizm-electron-client

# Development mode (Electron + Vite hot-reload)
yarn dev

# Build desktop app
yarn build:electron

# Type checking
yarn typecheck
```

### Evermemos (`packages/evermemos/`)

```bash
cd packages/evermemos

# Build (CJS + ESM via tsup)
yarn build

# Run tests (vitest)
yarn test
```

<!-- BEGIN:ENVIRONMENT_VARIABLES -->

### Environment Variables

- `PRIZM_PORT` - Server port (default 4127)
- `PRIZM_HOST` - Listen address (default 127.0.0.1)
- `PRIZM_DATA_DIR` - Data directory (default .prizm-data)
- `PRIZM_AUTH_DISABLED=1` - Disable authentication for local development
- `PRIZM_LOG_LEVEL` - Log level: info / warn / error
- `PRIZM_AGENT_SCOPE_CONTEXT_MAX_CHARS` - Agent scope context max chars (default 4000)

**LLM (Agent)：** 默认优先 MiMo，选择优先级 XIAOMIMIMO > ZHIPU > OPENAI

- `XIAOMIMIMO_API_KEY` - 小米 MiMo（默认优先），可选 `XIAOMIMIMO_MODEL`（默认 mimo-v2-flash）
- `ZHIPU_API_KEY` - 智谱 AI，可选 `ZHIPU_MODEL`（默认 glm-4-flash）
- `OPENAI_API_KEY` - OpenAI 兼容，可选 `OPENAI_API_URL`、`OPENAI_MODEL`（默认 gpt-4o-mini）

**Local Embedding：** 本地向量模型，默认启用

- `PRIZM_EMBEDDING_ENABLED` - 是否启用本地 embedding（默认 true）
- `PRIZM_EMBEDDING_MODEL` - HuggingFace 模型 ID（默认 TaylorAI/bge-micro-v2，384 维）
- `PRIZM_EMBEDDING_CACHE_DIR` - 模型缓存目录（默认 {dataDir}/models）
- `PRIZM_EMBEDDING_MAX_CONCURRENCY` - 最大并发推理数（默认 1）

**Search：**

- `TAVILY_API_KEY` - Tavily 网络搜索 API key（可选，启用 Agent 网络搜索工具）

<!-- END:ENVIRONMENT_VARIABLES -->

<!-- BEGIN:ARCHITECTURE_OVERVIEW -->

## Architecture Overview

### Server Package (`@prizm/server`)

**Core Technologies:**

- Node.js with TypeScript (ESM source, built via tsup)
- Express 5.x HTTP server
- Vue 3 + Vite for built-in management dashboard
- WebSocket for real-time event push (dual path: `/ws` + `/ws/terminal`)
- Domain Event Bus (Emittery) for decoupled module communication

**Port:** Default 4127, configurable via CLI or `createPrizmServer()` options

<!-- BEGIN:ARCHITECTURE_TREE -->

**Key Components:**

```
prizm/src/
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
│   │   ├── handlers/            # Event handlers
│   │   │   ├── auditHandlers.ts     # tool:executed → audit log
│   │   │   ├── lockHandlers.ts      # session.deleted → release locks
│   │   │   ├── memoryHandlers.ts    # document:saved → memory extraction
│   │   │   └── wsBridgeHandlers.ts  # domain events → WebSocket broadcast
│   │   └── index.ts
│   ├── agentAuditLog/           # Agent operation audit trail (SQLite)
│   │   ├── auditManager.ts      # Record / query audit entries
│   │   ├── auditStore.ts        # SQLite storage (.prizm-data/agent_audit.db)
│   │   ├── types.ts             # AuditEntry, AuditAction, filters
│   │   └── index.ts
│   ├── resourceLockManager/     # Resource locking (Fencing Token pattern)
│   │   ├── lockManager.ts       # Acquire / release / validate locks
│   │   ├── lockStore.ts         # SQLite storage (.prizm-data/resource_locks.db)
│   │   ├── types.ts             # ResourceLock, LockableResourceType
│   │   └── index.ts
│   ├── mdStore/                 # Markdown file storage layer (V3)
│   │   ├── fileOps.ts           # File read/write/list/move operations
│   │   ├── documentStore.ts     # Document CRUD
│   │   ├── todoStore.ts         # Todo list CRUD
│   │   ├── clipboardStore.ts    # Clipboard history storage
│   │   ├── sessionStore.ts      # Agent session storage
│   │   ├── tokenUsageStore.ts   # Token usage tracking
│   │   ├── utils.ts             # sanitizeFileName, etc.
│   │   └── index.ts
│   ├── ScopeStore.ts            # Scope-based data isolation
│   ├── ScopeRegistry.ts         # Scope registry
│   ├── PathProvider.ts          # Path provider (scope-level)
│   ├── PathProviderCore.ts      # Core path provider (app-level paths)
│   ├── MetadataCache.ts         # Metadata caching
│   ├── UserStore.ts             # User store
│   ├── documentVersionStore.ts  # Document versioning
│   ├── tokenUsageDb.ts          # Token usage database
│   ├── migrate-scope-v2.ts      # Scope migration V2
│   └── migrate-v3.ts            # Migration V3 (mdStore directory layout)
├── llm/                         # LLM providers and AI services
│   ├── builtinTools/            # Built-in agent tools (modular)
│   │   ├── definitions.ts       # Tool schema definitions (OpenAI function format)
│   │   ├── executor.ts          # Tool execution engine
│   │   ├── types.ts             # Tool executor types
│   │   ├── documentTools.ts     # Document CRUD tools (lock-aware)
│   │   ├── fileTools.ts         # File system tools (event-emitting)
│   │   ├── lockTools.ts         # Resource lock tools (checkout/checkin)
│   │   ├── todoTools.ts         # Todo list tools
│   │   ├── searchTools.ts       # Search tools
│   │   ├── knowledgeTools.ts    # Knowledge base tools
│   │   └── terminalTools.ts     # Terminal execution tools
│   ├── builtinTools.ts          # Built-in tools re-export and registration
│   ├── OpenAILikeProvider.ts    # OpenAI-compatible provider
│   ├── ZhipuProvider.ts         # Zhipu AI provider
│   ├── XiaomiMiMoProvider.ts    # Xiaomi MiMo provider
│   ├── EverMemService.ts        # Memory system integration
│   ├── localEmbedding.ts        # Local embedding model (TaylorAI/bge-micro-v2)
│   ├── systemPrompt.ts          # System prompt builder
│   ├── scopeContext.ts          # Scope context builder (notes/todos/docs injection)
│   ├── conversationSummaryService.ts  # Conversation summarization
│   ├── documentMemoryService.ts # Document memory service
│   ├── contextTracker.ts        # Context window tracking
│   ├── customCommandLoader.ts   # Custom slash command loader
│   ├── skillManager.ts          # Skill management (load/activate skills)
│   ├── agentRulesManager.ts     # Custom agent rules (user-level + scope-level)
│   ├── slashCommandRegistry.ts  # Slash command registry
│   ├── slashCommands.ts         # Slash command implementations
│   ├── rulesLoader.ts           # External rules loader (project auto-discovery)
│   ├── tavilySearch.ts          # Tavily web search integration
│   ├── streamToolCallsReducer.ts # Stream tool calls state machine
│   ├── streamToolsCompatibility.ts # Stream tools compatibility layer
│   ├── toolMetadata.ts          # Tool metadata registry
│   ├── parseUsage.ts            # Token usage parsing
│   ├── interactManager.ts       # User interaction manager (approval flow)
│   ├── workspaceResolver.ts     # Workspace path resolver
│   ├── atReferenceParser.ts     # @reference parser
│   ├── atReferenceRegistry.ts   # @reference registry
│   ├── builtinToolEvents.ts     # Built-in tool event definitions
│   ├── CompositeStorageAdapter.ts # Composite storage adapter
│   ├── scopeInteractionParser.ts  # Scope interaction parser
│   └── scopeItemRegistry.ts     # Scope item registry
├── routes/                      # Express route handlers
│   ├── agent.ts                 # Agent routes entry (assembles sub-modules)
│   ├── agent/                   # Agent route sub-modules
│   │   ├── _shared.ts           # Shared agent utilities
│   │   ├── sessions.ts          # Session CRUD, grant-paths, interact-response
│   │   ├── chat.ts              # Stream chat via SSE
│   │   ├── metadata.ts          # Agent metadata (tools, models)
│   │   └── audit.ts             # Audit log + lock management endpoints
│   ├── auth.ts                  # Client registration, listing, revocation
│   ├── notify.ts                # Notification sending
│   ├── todoList.ts              # Todo list management
│   ├── documents.ts             # Document CRUD
│   ├── clipboard.ts             # Clipboard history
│   ├── memory.ts                # Memory management
│   ├── search.ts                # Unified search across data types
│   ├── files.ts                 # File system operations (workspace files)
│   ├── terminal.ts              # Terminal session management
│   ├── commands.ts              # Custom commands CRUD
│   ├── skills.ts                # Skills management CRUD
│   ├── agentRules.ts            # Agent rules CRUD (user + scope level)
│   ├── settings.ts              # Settings management
│   ├── embedding.ts             # Embedding model status, test, reload
│   └── mcpConfig.ts             # MCP server configuration
├── terminal/                    # Terminal session management
│   ├── TerminalSessionManager.ts # Session lifecycle (create/resize/kill)
│   ├── TerminalWebSocketServer.ts # WebSocket server for terminal I/O
│   ├── ExecWorkerPool.ts        # Worker pool for command execution
│   ├── shellDetector.ts         # Shell detection (PowerShell/bash/zsh)
│   ├── terminalConstants.ts     # Terminal constants
│   ├── terminalLogger.ts        # Terminal logging
│   └── index.ts
├── mcp/                         # MCP (Model Context Protocol) server
│   ├── tools/                   # MCP tool definitions
│   │   ├── clipboardTools.ts
│   │   ├── documentTools.ts
│   │   ├── fileTools.ts
│   │   ├── memoryTools.ts
│   │   ├── notifyTools.ts
│   │   └── todoTools.ts
│   ├── stdio-tools/             # STDIO bridge tool implementations
│   │   ├── clipboardTools.ts
│   │   ├── documentTools.ts
│   │   ├── fetcher.ts
│   │   ├── memoryTools.ts
│   │   ├── noteTools.ts
│   │   ├── notifyTools.ts
│   │   ├── searchTools.ts
│   │   └── todoTools.ts
│   ├── index.ts                 # MCP server creation
│   └── stdio-bridge.ts          # STDIO bridge implementation
├── mcp-client/                  # External MCP server connections
│   ├── McpClientManager.ts      # Connection management
│   ├── mcpConfigImporter.ts     # Config importer (from Claude/Cursor)
│   ├── configStore.ts           # MCP config storage
│   └── types.ts
├── search/                      # Search service
│   ├── searchIndexService.ts    # Search index service (SQLite-backed)
│   ├── miniSearchRunner.ts      # MiniSearch runner
│   ├── keywordSearch.ts         # Keyword search
│   └── ripgrepSearch.ts         # Ripgrep file search
├── settings/                    # Settings management
│   ├── agentToolsStore.ts       # Agent tools configuration store
│   └── types.ts
├── utils/                       # Utility functions
│   └── todoItems.ts             # Todo item utilities
├── websocket/
│   ├── WebSocketServer.ts       # WS server for real-time event push
│   ├── EventRegistry.ts         # Event subscription management
│   ├── WebSocketContext.ts      # Per-connection context
│   ├── types.ts
│   └── index.ts
├── server.ts                    # Express app creation, route mounting, lifecycle
├── index.ts                     # Main exports
├── types.ts                     # TypeScript definitions
├── config.ts                    # Configuration
├── errors.ts                    # Custom error classes
├── id.ts                        # ID generation utilities
├── scopeUtils.ts                # Scope utilities
├── scopes.ts                    # Scope definitions
└── logger.ts                    # Logging

panel/                           # Vue 3 Dashboard (served at /dashboard/)
├── dist/                        # Built static assets
└── ... (Vue components)
```

<!-- END:ARCHITECTURE_TREE -->

### Electron Client Package (`@prizm/electron-client`)

**Core Technologies:**

- Electron 40 with Vite for build tooling
- React 19 + Ant Design for UI
- Zustand for state management
- WebSocket for real-time server connection

**Key components:**

- `electron/main.ts` - Electron main process
- `src/` - React frontend (components, hooks, views, utils)
- IPC bridge between main process and renderer

### Client Core Package (`@prizm/client-core`)

Shared SDK consumed by Electron client:

- `src/http/client.ts` - HTTP client for Prizm Server API
- `src/websocket/connection.ts` - WebSocket connection management
- `src/agent/` - Tool metadata and render registries
- `src/types.ts` - Client-side type definitions

### Shared Package (`@prizm/shared`)

Cross-package type definitions and constants:

- `src/constants.ts` - Shared constants
- `src/domain.ts` - Domain models
- `src/events.ts` - Event type definitions
- `src/auth.ts` - Auth-related types
- `src/websocket.ts` - WebSocket message types

### Evermemos Package (`@prizm/evermemos`)

TypeScript port of the EverMemOS memory system:

- `src/core/MemoryManager.ts` - Memory creation, update, deletion
- `src/core/RetrievalManager.ts` - Memory retrieval with rank fusion
- `src/extractors/` - Memory extractors (Unified, Foresight, Profile, EventLog, Episode)
- `src/storage/` - Storage backends (SQLite for metadata, LanceDB for vector search)
- `src/utils/` - Rank fusion, query expansion, LLM utilities

<!-- END:ARCHITECTURE_OVERVIEW -->

<!-- BEGIN:ADAPTER_PATTERN -->

### Adapter Pattern

The server decouples from underlying services via adapters. When integrating into a larger app, implement these interfaces:

- **INotificationAdapter**: System notifications - single `notify(title, body)` method
- **ITodoListAdapter**: Todo list CRUD operations (lists and items, multi-list per scope)
- **IClipboardAdapter**: Clipboard history - addItem, getHistory, deleteItem (all optional)
- **IDocumentsAdapter**: Document CRUD operations (all methods optional)
- **IAgentAdapter**: Agent/LLM integration - sessions, messages, streaming chat
- **ILLMProvider**: LLM provider interface (pluggable OpenAI/Ollama/etc.)

**Default adapters** (each in `src/adapters/Default*.ts`):

- `DefaultNotificationAdapter` - Console logging
- `DefaultTodoListAdapter` - Markdown file storage via mdStore
- `DefaultClipboardAdapter` - Markdown file storage via mdStore
- `DefaultDocumentsAdapter` - Markdown file storage via mdStore, emits domain events
- `DefaultAgentAdapter` - LLM chat with built-in tool execution, session/message persistence

**Creating custom adapters:**
Implement interfaces from `src/adapters/interfaces.ts` and pass to `createPrizmServer()`.

<!-- END:ADAPTER_PATTERN -->

<!-- BEGIN:EVENT_BUS -->

### Event Bus (Domain Event System)

Type-safe domain event bus (`core/eventBus/`) using Emittery for decoupled inter-module communication.

**Domain Events (`DomainEventMap`):**

| Event | Trigger | Purpose |
|-------|---------|---------|
| `agent:session.created` | Session creation | Lifecycle tracking |
| `agent:session.deleted` | Session deletion | Lock release, memory flush |
| `agent:message.completed` | Chat round complete | Memory extraction |
| `agent:session.compressing` | Context compression | Memory extraction from old rounds |
| `tool:executed` | Tool execution | Audit logging |
| `document:saved` | Document create/update | Memory extraction, WS notification |
| `document:deleted` | Document deletion | Cleanup |
| `resource:lock.changed` | Lock acquire/release | WS notification |
| `file:operation` | File create/move/delete | WS notification |

**Event Handlers** (registered at server startup):

- `auditHandlers` — `tool:executed` → write to audit log
- `lockHandlers` — `agent:session.deleted` → release all locks held by session
- `memoryHandlers` — `document:saved` → trigger memory extraction; `agent:session.deleted` → flush session buffer
- `wsBridgeHandlers` — Bridge domain events → WebSocket broadcast to clients

<!-- END:EVENT_BUS -->

<!-- BEGIN:RESOURCE_LOCK -->

### Resource Lock Manager

Fencing token-based locking (`core/resourceLockManager/`) for documents and todo lists to prevent concurrent edits.

**Supported resource types:** `document`, `todo_list`

**Key features:**

- Fencing tokens — monotonically increasing, prevents stale lock writes
- TTL-based expiration (default 5 min, max 1 hour)
- Heartbeat renewal for long-running operations
- Automatic cleanup of expired locks (60s interval)
- Read history tracking (30-day retention)
- Session-scoped — locks auto-released on session deletion via event bus

**Storage:** SQLite (`.prizm-data/resource_locks.db`) with tables: `resource_locks`, `resource_read_log`, `fence_counter`

**Agent workflow:** `prizm_checkout_document` → edit with lock validation → `prizm_checkin_document`

<!-- END:RESOURCE_LOCK -->

<!-- BEGIN:AUDIT_LOG -->

### Agent Audit Log

Audit trail (`core/agentAuditLog/`) for agent tool executions and resource operations.

**Features:**

- Automatically records tool executions via `tool:executed` event
- Query by session / resource / action / result
- Resource operation history (who read/edited what)
- 90-day retention with automatic pruning

**Storage:** SQLite (`.prizm-data/agent_audit.db`)

<!-- END:AUDIT_LOG -->

<!-- BEGIN:TERMINAL -->

### Terminal Management

Server-side terminal session management (`terminal/`) for running commands.

**Components:**

- `TerminalSessionManager` — Create, resize, kill terminal sessions
- `TerminalWebSocketServer` — Real-time terminal I/O via WebSocket at `/ws/terminal`
- `ExecWorkerPool` — Worker pool for parallel command execution
- `shellDetector` — Auto-detect user's shell (PowerShell, bash, zsh)

**Integration:** Terminal routes (`routes/terminal.ts`) for REST API; WebSocket for interactive I/O.

<!-- END:TERMINAL -->

<!-- BEGIN:CUSTOM_COMMANDS_SKILLS -->

### Custom Commands & Skills

**Custom Commands** (`llm/customCommandLoader.ts`, `routes/commands.ts`):
User-defined slash commands stored as Markdown files, loaded into the agent's command registry.

**Skills** (`llm/skillManager.ts`, `routes/skills.ts`):
Pluggable skill system — load, activate, and inject skill instructions into agent sessions.

**Agent Rules** (`llm/agentRulesManager.ts`, `routes/agentRules.ts`):
User-defined agent behavior rules with two levels: user-level (global, `.prizm-data/rules/`) and scope-level (per workspace, `{scopeRoot}/.prizm/rules/`). Rules are stored as Markdown files with YAML frontmatter and injected into agent system prompts.

<!-- END:CUSTOM_COMMANDS_SKILLS -->

### Scope-Based Data Isolation

All data (notes, todos, documents, clipboard, sessions) is isolated by scope:

- Scope path: `.prizm-data/scopes/{scope}/` 目录下按类型分 .md 单文件（frontmatter 存元数据）
- Default scope: `default`
- Persistence: Markdown files with YAML frontmatter, auto-save on mutations
- Runtime cache: In-memory `Map` in `ScopeStore`

Scope is specified via `X-Prizm-Scope` header or `?scope=` query parameter. Clients register with `requestedScopes` array; `*` grants access to all scopes.

### Authentication & Authorization

**Client registration:** `POST /auth/register` returns `clientId` and `apiKey` (hash-stored in `.prizm-data/clients.json`)

**Three auth methods:**

- `Authorization: Bearer <key>` header
- `X-Prizm-Api-Key` header
- `?apiKey=` query parameter

**Scope validation:** Request scope must be in client's `allowedScopes`

**Bypasses:**

- Dashboard requests: `X-Prizm-Panel: true` header
- Development: `PRIZM_AUTH_DISABLED=1` environment variable

<!-- BEGIN:WEBSOCKET -->

### WebSocket Server

**Dual WebSocket paths:**

| Path | Purpose | Protocol |
|------|---------|----------|
| `/ws` | Real-time event push (notifications, lock changes, etc.) | Event subscription model |
| `/ws/terminal` | Terminal I/O (interactive shell) | Binary/text terminal protocol |

**Event WebSocket (`/ws`):**

- Connection: `ws://{host}:{port}/ws?apiKey={apiKey}`
- Client registers for event types via `register` message
- Server pushes domain events (bridged from EventBus) to subscribed clients
- Heartbeat via `ping`/`pong`

**Terminal WebSocket (`/ws/terminal`):**

- Connection: `ws://{host}:{port}/ws/terminal?apiKey={apiKey}`
- Real-time terminal session I/O

**Server API:** Available via `PrizmServer.websocket`:

- `broadcast(eventType, payload, scope?)` - Send to all subscribers
- `broadcastToClient(clientId, eventType, payload, scope?)` - Send to specific client
- `getConnectedClients()` - Get connection info

<!-- END:WEBSOCKET -->

### Route Organization

Routes are modular, each exporting a factory function that receives a Router instance:

```typescript
export function createNotesRoutes(router: Router, adapter?: IStickyNotesAdapter): void {
  // Route handlers here, all scoped by scope
  // Middleware extracts scope from header/query/params
}
```

Complex route modules (e.g. `agent`) are split into subdirectories with an entry file assembling sub-modules.

Auth routes mounted separately at `/auth/*` to avoid path conflicts with the main router.

<!-- BEGIN:SERVER_LIFECYCLE -->

### Server Lifecycle

`PrizmServer` interface provides:

- `start(): Promise<void>` - Start listening on configured host/port
- `stop(): Promise<void>` - Close HTTP, WebSocket, and Terminal servers
- `isRunning(): boolean` - Check status
- `getAddress(): string | null` - Get server URL

**Startup sequence:**

1. Express app + middleware setup
2. Route mounting (all route modules)
3. HTTP server listen
4. Data migration (`migrateAppLevelStorage`)
5. Service init: `initEverMemService()`, `initTokenUsageDb()`, `lockManager.init()`, `auditManager.init()`
6. EventBus handler registration: audit / lock / memory handlers
7. WebSocket servers: event WS at `/ws`, terminal WS at `/ws/terminal`
8. WS bridge handler registration (domain events → WS broadcast)

**Shutdown sequence:**

1. Terminal WS server destroy + terminal manager shutdown
2. Event WS server destroy
3. EventBus clear + WS bridge detach
4. Token usage DB close
5. Lock manager shutdown + Audit manager shutdown
6. HTTP server close

Server created via `createPrizmServer(adapters, options)` with options for `port`, `host`, `enableCors`, `authEnabled`, `enableWebSocket`, `websocketPath`.

<!-- END:SERVER_LIFECYCLE -->

### Data Persistence

- Client registry: `.prizm-data/clients.json`
- Scope data: `.prizm-data/scopes/{scope}/` 下 notes/、groups/、todo/、documents/、sessions/ 等 .md 单文件
- Markdown with frontmatter: Metadata stored in YAML frontmatter, content in Markdown body
- Auto-save: Mutations trigger immediate disk write via `ScopeStore` / `mdStore`
- Resource locks: `.prizm-data/resource_locks.db` (SQLite)
- Audit log: `.prizm-data/agent_audit.db` (SQLite)
- Token usage: `.prizm-data/token_usage.db` (SQLite)
- Search index: `.prizm-data/search_index.db` (SQLite)

### MCP Server

The server exposes a Model Context Protocol (MCP) server providing tools for:

- Sticky notes management
- Todo list operations
- Document operations
- File operations
- Clipboard history
- Memory management
- Notification sending

Tools are modular — definitions in `mcp/tools/`, implementations in `mcp/stdio-tools/`.
Connected via stdio bridge (`src/mcp/stdio-bridge.ts`).

### MCP Client

`McpClientManager` (`src/mcp-client/`) manages connections to external MCP servers, allowing the agent to use third-party tools. Supports importing config from Claude/Cursor via `mcpConfigImporter`.

<!-- BEGIN:API_ENDPOINTS -->

## API Endpoints

**No auth:**

- `/health` - Health check (includes embedding model status)
- `/auth/*` - Register, list clients, revoke clients, list scopes

**Auth required:**

- `/agent/*` - Agent sessions, stream chat (SSE), metadata
- `/agent/audit` - Audit log query, resource operation history
- `/agent/locks` - Active lock listing, force release
- `/todo/*` - Todo list CRUD (auth + scope)
- `/documents/*` - Document management (auth + scope)
- `/clipboard/*` - Clipboard history (auth + scope)
- `/memory/*` - Memory system operations (auth + scope)
- `/search/*` - Unified search across data types (auth + scope)
- `/files/*` - File system operations (auth + scope)
- `/terminal/*` - Terminal session management (auth)
- `/commands/*` - Custom commands CRUD (auth)
- `/skills/*` - Skills management CRUD (auth)
- `/agent-rules/*` - Agent rules CRUD, user-level + scope-level (auth)
- `/notify` - Send notifications (auth)
- `/settings/*` - Settings management (auth)
- `/embedding/*` - Embedding model status, test, reload (auth)
- `/mcp-config/*` - MCP server configuration (auth)

**WebSocket:**

- `ws://{host}:{port}/ws` - Real-time event push
- `ws://{host}:{port}/ws/terminal` - Terminal I/O

**Dashboard:**

- `/dashboard/*` - Vue 3 SPA (no auth with `X-Prizm-Panel: true`)

<!-- END:API_ENDPOINTS -->

## TypeScript Configuration

**Server (`prizm/`):**

- Target: ES2022
- Module: ESM (built via tsup)
- Strict mode enabled
- Output: `dist/` directory with `.js` and `.d.ts` files

**Electron Client (`prizm-electron-client/`):**

- Vite + TypeScript for React frontend
- Electron 40 for desktop shell
- Ant Design component library
- Zustand for state management

**Shared packages (`prizm-shared/`, `prizm-client-core/`, `packages/evermemos/`):**

- ES modules
- Built with `tsup` (CJS + ESM dual output)

## Network Notes

For WSL/Docker access, server must listen on `0.0.0.0` (via `--host 0.0.0.0` CLI flag or `host` option) and Windows firewall rules may need configuration.

## Testing

- **Server**: `cd prizm && yarn test`
- **Evermemos**: `cd packages/evermemos && yarn test` (vitest)
- Test files are co-located with source: `<SourceFile>.test.ts`

## Git Submodule

The `prizm/` directory is maintained as a Git submodule in some parent projects. Changes here must be committed in this repo separately from parent project.
