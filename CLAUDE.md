# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a monorepo containing two main packages:

1. **`prizm/`** - HTTP API server (`@prizm/server`) with built-in Vue 3 dashboard
2. **`prizm-tauri-client/`** - Tauri 2.x desktop WebSocket client

The server provides an API layer for desktop efficiency tools including sticky notes and system notifications. It can run standalone with default adapters or integrate into larger applications.

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

### Tauri Client (`prizm-tauri-client/`)

```bash
cd prizm-tauri-client

# Development mode (Tauri + frontend hot-reload)
yarn tauri:dev

# Build desktop app
yarn tauri:build

# Frontend-only dev
yarn dev

# Type checking
yarn typecheck
```

### Environment Variables

- `PRIZM_PORT` - Server port (default 4127)
- `PRIZM_HOST` - Listen address (default 127.0.0.1)
- `PRIZM_DATA_DIR` - Data directory (default .prizm-data)
- `PRIZM_AUTH_DISABLED=1` - Disable authentication for local development
- `PRIZM_LOG_LEVEL` - Log level: info / warn / error

**LLM (Agent)：** 选择优先级 ZHIPU > XIAOMIMIMO > OPENAI

- `ZHIPU_API_KEY` - 智谱 AI，可选 `ZHIPU_MODEL`（默认 glm-4-flash）
- `XIAOMIMIMO_API_KEY` - 小米 MiMo，可选 `XIAOMIMIMO_MODEL`（默认 mimo-v2-flash）
- `OPENAI_API_KEY` - OpenAI 兼容，可选 `OPENAI_API_URL`、`OPENAI_MODEL`（默认 gpt-4o-mini）

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
├── llm/               # LLM providers (Zhipu, XiaomiMiMo, OpenAILike)
├── routes/            # Express route handlers
│   ├── auth.ts        # Client registration, listing, revocation
│   ├── agent.ts       # Agent sessions, stream chat
│   ├── notes.ts       # Sticky notes CRUD with groups
│   └── notify.ts      # Notification sending
├── auth/
│   ├── ClientRegistry.ts   # API key management, persistence
│   └── authMiddleware.ts   # JWT-like auth, scope validation
├── core/
│   └── ScopeStore.ts  # Scope-based data isolation (JSON file storage)
├── websocket/
│   ├── WebSocketServer.ts  # WS server for real-time event push
│   ├── EventRegistry.ts    # Event subscription management
│   └── WebSocketContext.ts # Per-connection context
├── server.ts          # Express app creation
├── index.ts           # Main exports
└── types.ts           # TypeScript definitions

panel/                  # Vue 3 Dashboard (served at /dashboard/)
├── dist/              # Built static assets
└── ... (Vue components)
```

### Adapter Pattern

The server decouples from underlying services via adapters. When integrating into a larger app, implement these interfaces:

- **IStickyNotesAdapter**: Sticky notes CRUD operations (notes and groups) - all methods optional
- **INotificationAdapter**: System notifications - single `notify(title, body)` method

**Default adapters** (`src/adapters/default.ts`):

- `DefaultStickyNotesAdapter` - In-memory storage
- `DefaultNotificationAdapter` - Console logging

**Creating custom adapters:**
Implement interfaces from `src/adapters/interfaces.ts` and pass to `createPrizmServer()`.

### Scope-Based Data Isolation

All data (notes, groups) is isolated by scope:

- Scope path: `.prizm-data/scopes/{scope}.json`
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

### Data Persistence

- Client registry: `.prizm-data/clients.json`
- Scope data: `.prizm-data/scopes/{scope}.json` (notes + groups arrays)
- Auto-save: Mutations trigger immediate disk write via `ScopeStore.saveScope()`

### Server Lifecycle

`PrizmServer` interface provides:

- `start(): Promise<void>` - Start listening on configured host/port
- `stop(): Promise<void>` - Close HTTP and WebSocket servers
- `isRunning(): boolean` - Check status
- `getAddress(): string | null` - Get server URL

Server created via `createPrizmServer(adapters, options)` with options for `port`, `host`, `enableCors`, `authEnabled`, `enableWebSocket`, `websocketPath`.

### Tauri Client

**Purpose:** Desktop application that connects to Prizm Server via WebSocket for real-time notifications

**Key components:**

- `src/websocket/connection.ts` - `PrizmWebSocketClient` class for WS connection management
- `src/notification/handler.ts` - Tauri notification integration
- Auto-reconnect on disconnect (5s delay)
- Auto-registers for `notification` event on connect

## API Endpoints

- `/health` - Health check (no auth)
- `/auth/*` - Register, list clients, revoke clients, list scopes (no auth)
- `/notes` - CRUD for notes and groups (auth + scope)
- `/notify` - Send notifications (auth, scope not applicable)
- `/agent/*` - Agent sessions and stream chat (auth + scope)
- `/dashboard/*` - Vue 3 SPA (no auth with `X-Prizm-Panel: true`)

## TypeScript Configuration

**Server:**

- Target: ES2022
- Module: CommonJS
- Strict mode enabled
- Output: `dist/` directory with `.js` and `.d.ts` files

**Tauri Client:**

- ES modules
- Vite + TypeScript for frontend
- Tauri 2.x for native desktop

## Network Notes

For WSL/Docker access, server must listen on `0.0.0.0` (via `--host 0.0.0.0` CLI flag or `host` option) and Windows firewall rules may need configuration.

## Git Submodule

The `prizm/` directory is maintained as a Git submodule in some parent projects. Changes here must be committed in this repo separately from parent project.
