# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a Yarn workspace monorepo containing the following packages:

1. **`prizm/`** - HTTP API server (`@prizm/server`) with built-in Vue 3 dashboard and MCP server
2. **`prizm-electron-client/`** - Electron 40 desktop client (`@prizm/electron-client`), React 19 + Ant Design
3. **`prizm-client-core/`** - Shared client SDK (`@prizm/client-core`), HTTP/WebSocket client and agent tooling
4. **`prizm-shared/`** - Shared types and constants (`@prizm/shared`), domain models, events, auth types
5. **`packages/evermemos/`** - TypeScript memory system (`@prizm/evermemos`), LanceDB + SQLite storage
6. **`EverMemOS/`** - Python FastAPI long-term memory system (standalone, not in TS workspace)

The server provides an API layer for desktop efficiency tools including sticky notes, todo lists, documents, clipboard history, pomodoro timer, memory management, and AI agent chat. It can run standalone with default adapters or integrate into larger applications.

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

### Environment Variables

- `PRIZM_PORT` - Server port (default 4127)
- `PRIZM_HOST` - Listen address (default 127.0.0.1)
- `PRIZM_DATA_DIR` - Data directory (default .prizm-data)
- `PRIZM_AUTH_DISABLED=1` - Disable authentication for local development
- `PRIZM_LOG_LEVEL` - Log level: info / warn / error

**LLM (Agent)：** 默认优先 MiMo，选择优先级 XIAOMIMIMO > ZHIPU > OPENAI

- `XIAOMIMIMO_API_KEY` - 小米 MiMo（默认优先），可选 `XIAOMIMIMO_MODEL`（默认 mimo-v2-flash）
- `ZHIPU_API_KEY` - 智谱 AI，可选 `ZHIPU_MODEL`（默认 glm-4-flash）
- `OPENAI_API_KEY` - OpenAI 兼容，可选 `OPENAI_API_URL`、`OPENAI_MODEL`（默认 gpt-4o-mini）

**Local Embedding：** 本地向量模型，默认启用

- `PRIZM_EMBEDDING_ENABLED` - 是否启用本地 embedding（默认 true）
- `PRIZM_EMBEDDING_MODEL` - HuggingFace 模型 ID（默认 TaylorAI/bge-micro-v2，384 维）
- `PRIZM_EMBEDDING_CACHE_DIR` - 模型缓存目录（默认 {dataDir}/models）
- `PRIZM_EMBEDDING_MAX_CONCURRENCY` - 最大并发推理数（默认 1）

## Architecture Overview

### Server Package (`@prizm/server`)

**Core Technologies:**

- Node.js with TypeScript (compiled to CommonJS)
- Express 4.x HTTP server
- Vue 3 + Vite for built-in management dashboard
- WebSocket for real-time event push

**Port:** Default 4127, configurable via CLI or `createPrizmServer()` options

**Key Components:**

```
prizm/src/
├── adapters/          # Adapter pattern implementations
│   ├── interfaces.ts  # IStickyNotesAdapter, INotificationAdapter, IAgentAdapter
│   └── default.ts     # In-memory/Console implementations
├── llm/               # LLM providers and AI services
│   ├── EverMemService.ts          # Memory system integration
│   ├── localEmbedding.ts          # Local embedding model (TaylorAI/bge-micro-v2)
│   ├── OpenAILikeProvider.ts      # OpenAI-compatible provider
│   ├── ZhipuProvider.ts           # Zhipu AI provider
│   ├── XiaomiMiMoProvider.ts      # Xiaomi MiMo provider
│   ├── builtinTools.ts            # Built-in agent tools
│   ├── conversationSummaryService.ts
│   └── documentSummaryService.ts
├── routes/            # Express route handlers
│   ├── auth.ts        # Client registration, listing, revocation
│   ├── agent.ts       # Agent sessions, stream chat (SSE)
│   ├── notes.ts       # Sticky notes CRUD with groups
│   ├── notify.ts      # Notification sending
│   ├── todoList.ts    # Todo list management
│   ├── documents.ts   # Document CRUD
│   ├── memory.ts      # Memory management
│   ├── clipboard.ts   # Clipboard history
│   ├── pomodoro.ts    # Pomodoro timer
│   ├── search.ts      # Unified search across data types
│   ├── settings.ts    # Settings management
│   ├── embedding.ts   # Embedding model status, test, reload
│   └── mcpConfig.ts   # MCP server configuration
├── auth/
│   ├── ClientRegistry.ts   # API key management, persistence
│   └── authMiddleware.ts   # JWT-like auth, scope validation
├── core/
│   ├── ScopeStore.ts  # Scope-based data isolation (Markdown file storage)
│   ├── mdStore.ts     # Markdown file read/write with frontmatter
│   ├── PathProvider.ts
│   ├── UserStore.ts
│   ├── MetadataCache.ts
│   └── ScopeRegistry.ts
├── mcp/               # MCP (Model Context Protocol) server
│   ├── index.ts       # MCP tool definitions (notes, todos, docs, clipboard, memories)
│   └── stdio-bridge.ts
├── mcp-client/        # External MCP server connections
│   ├── McpClientManager.ts  # Connection management
│   ├── configStore.ts
│   └── types.ts
├── search/            # Search service
│   ├── searchIndexService.ts
│   ├── miniSearchRunner.ts
│   └── keywordSearch.ts
├── settings/          # Agent tools configuration
├── websocket/
│   ├── WebSocketServer.ts  # WS server for real-time event push
│   ├── EventRegistry.ts    # Event subscription management
│   └── WebSocketContext.ts # Per-connection context
├── server.ts          # Express app creation
├── index.ts           # Main exports
├── types.ts           # TypeScript definitions
├── config.ts          # Configuration
└── logger.ts          # Logging

panel/                  # Vue 3 Dashboard (served at /dashboard/)
├── dist/              # Built static assets
└── ... (Vue components)
```

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

### Adapter Pattern

The server decouples from underlying services via adapters. When integrating into a larger app, implement these interfaces:

- **IStickyNotesAdapter**: Sticky notes CRUD operations (notes and groups) - all methods optional
- **INotificationAdapter**: System notifications - single `notify(title, body)` method
- **IAgentAdapter**: Agent/LLM integration

**Default adapters** (`src/adapters/default.ts`):

- `DefaultStickyNotesAdapter` - In-memory storage
- `DefaultNotificationAdapter` - Console logging

**Creating custom adapters:**
Implement interfaces from `src/adapters/interfaces.ts` and pass to `createPrizmServer()`.

### Scope-Based Data Isolation

All data (notes, groups) is isolated by scope:

- Scope path: `.prizm-data/scopes/{scope}/` 目录下按类型分 .md 单文件（frontmatter 存元数据）
- Default scope: `default`
- Persistence: JSON files with auto-save on mutations
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

### WebSocket Server

**Purpose:** Real-time event push to connected clients (e.g., notifications)

**Connection:** `ws://{host}:{port}/ws?apiKey={apiKey}`

**Message flow:**

1. Client connects with API key
2. Client registers for event types via `register` message
3. Server pushes events via `event` messages to subscribed clients
4. Client can unregister via `unregister` message
5. Heartbeat via `ping`/`pong`

**Server API:** Available via `PrizmServer.websocket`:

- `broadcast(eventType, payload, scope?)` - Send to all subscribers
- `broadcastToClient(clientId, eventType, payload, scope?)` - Send to specific client
- `getConnectedClients()` - Get connection info

### Route Organization

Routes are modular, each exporting a factory function that receives a Router instance:

```typescript
export function createNotesRoutes(router: Router, adapter?: IStickyNotesAdapter): void {
  // Route handlers here, all scoped by scope
  // Middleware extracts scope from header/query/params
}
```

Auth routes mounted separately at `/auth/*` to avoid path conflicts with the main router.

### Server Lifecycle

`PrizmServer` interface provides:

- `start(): Promise<void>` - Start listening on configured host/port
- `stop(): Promise<void>` - Close HTTP and WebSocket servers
- `isRunning(): boolean` - Check status
- `getAddress(): string | null` - Get server URL

Server created via `createPrizmServer(adapters, options)` with options for `port`, `host`, `enableCors`, `authEnabled`, `enableWebSocket`, `websocketPath`.

### Data Persistence

- Client registry: `.prizm-data/clients.json`
- Scope data: `.prizm-data/scopes/{scope}/` 下 notes/、groups/、todo/、documents/ 等 .md 单文件
- Markdown with frontmatter: Metadata stored in YAML frontmatter, content in Markdown body
- Auto-save: Mutations trigger immediate disk write via `ScopeStore` / `mdStore`

### MCP Server

The server exposes a Model Context Protocol (MCP) server providing tools for:

- Sticky notes management
- Todo list operations
- Document operations
- Clipboard history
- Memory management

Connected via stdio bridge (`src/mcp/stdio-bridge.ts`).

### MCP Client

`McpClientManager` (`src/mcp-client/`) manages connections to external MCP servers, allowing the agent to use third-party tools.

## API Endpoints

- `/health` - Health check (no auth)
- `/auth/*` - Register, list clients, revoke clients, list scopes (no auth)
- `/notes` - CRUD for notes and groups (auth + scope)
- `/notify` - Send notifications (auth, scope not applicable)
- `/agent/*` - Agent sessions and stream chat via SSE (auth + scope)
- `/todo/*` - Todo list CRUD (auth + scope)
- `/documents/*` - Document management (auth + scope)
- `/memory/*` - Memory system operations (auth + scope)
- `/clipboard/*` - Clipboard history (auth + scope)
- `/pomodoro/*` - Pomodoro timer (auth + scope)
- `/search/*` - Unified search across data types (auth + scope)
- `/settings/*` - Settings management (auth)
- `/embedding/*` - Embedding model status, test, reload (auth)
- `/mcp-config/*` - MCP server configuration (auth)
- `/dashboard/*` - Vue 3 SPA (no auth with `X-Prizm-Panel: true`)

## TypeScript Configuration

**Server (`prizm/`):**

- Target: ES2022
- Module: CommonJS
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
