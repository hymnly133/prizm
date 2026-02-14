# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prizm Server is a Node.js HTTP API server (`@prizm/server`) that provides an API layer for desktop efficiency tools including sticky notes and system notifications. It uses TypeScript (compiled to CommonJS), Express 4.x, and includes a Vue 3 dashboard (`panel/`).

The server can run standalone with default adapters or be integrated into a larger Electron/Node application with custom adapters. It's maintained as a Git submodule and workspace dependency.

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

### Environment Variables

- `PRIZM_AUTH_DISABLED=1` - Disable authentication for local development

## Architecture

### High-Level Structure

```
src/
├── adapters/          # Adapter pattern implementations
│   ├── interfaces.ts  # IStickyNotesAdapter, INotificationAdapter
│   └── default.ts     # In-memory/Console implementations
├── routes/            # Express route handlers
│   ├── auth.ts        # Client registration, listing, revocation
│   ├── notes.ts       # Sticky notes CRUD with groups
│   └── notify.ts      # Notification sending
├── auth/
│   ├── ClientRegistry.ts   # API key management, persistence
│   └── authMiddleware.ts   # JWT-like auth, scope validation
├── core/
│   └── ScopeStore.ts  # Scope-based data isolation (JSON file storage)
├── server.ts          # Express app creation, middleware setup
├── index.ts           # Main exports
└── types.ts           # TypeScript definitions

panel/                  # Vue 3 Dashboard (separate Vite app)
├── dist/              # Built static assets (served at /dashboard/)
└── ... (Vue components)
```

### Adapter Pattern

The server decouples from underlying services via adapters:

- **IStickyNotesAdapter**: Sticky notes CRUD operations (notes and groups) - all methods optional
- **INotificationAdapter**: System notifications - single `notify(title, body)` method

**Creating custom adapters**: Implement interfaces from `src/adapters/interfaces.ts` and pass to `createPrizmServer()`. See `src/adapters/default.ts` for example implementations.

### Scope-Based Data Isolation

All data (notes, groups) is isolated by scope:

- Scope path: `.prizm-data/scopes/{scope}/` 目录下按类型分 .md 单文件（frontmatter 存元数据）
- Default scope: `default`
- Persistence: JSON files with auto-save on mutations
- Runtime cache: In-memory `Map` in `ScopeStore`

Scope is specified via `X-Prizm-Scope` header or `?scope=` query parameter. Clients register with `requestedScopes` array; `*` grants access to all scopes.

### Authentication & Authorization

- Client registration: `POST /auth/register` returns `clientId` and `apiKey` (hash-stored)
- Three auth methods: `Authorization: Bearer <key>`, `X-Prizm-Api-Key` header, or `?apiKey=` query param
- Scope validation: Request scope must be in client's `allowedScopes`
- Dashboard exemption: `X-Prizm-Panel: true` header bypasses auth
- Environment bypass: `PRIZM_AUTH_DISABLED=1`

Client registry stored at `.prizm-data/clients.json`. `ClientRegistry.ts` manages persistence and revocation.

### Route Organization

Routes are modular, each exporting a factory function:

```typescript
// Example from src/routes/notes.ts
export function createNotesRoutes(router: Router, adapter?: IStickyNotesAdapter): void {
  // Route handlers here, all scoped by scope
  // Middleware extracts scope from header/query/params
}
```

Auth routes mounted separately at `/auth/*` to avoid path conflicts with the main router.

### Server Lifecycle

`PrizmServer` interface provides:

- `start(): Promise<void>` - Start listening on configured host/port
- `stop(): Promise<void>` - Close HTTP server
- `isRunning(): boolean` - Check status
- `getAddress(): string | null` - Get server URL

Server created via `createPrizmServer(adapters, options)` with options for `port`, `host`, `enableCors`, `authEnabled`.

## Key Features

### API Endpoints

- `/health` - Health check (no auth)
- `/auth/*` - Register, list clients, revoke clients, list scopes (no auth)
- `/notes` - CRUD for notes and groups (auth + scope)
- `/notify` - Send notifications (auth, scope not applicable)
- `/dashboard/*` - Vue 3 SPA (no auth with `X-Prizm-Panel: true`)

### Data Persistence

- Client registry: `.prizm-data/clients.json`
- Scope data: `.prizm-data/scopes/{scope}/` 下 notes/、groups/、todo/、documents/ 等 .md 单文件
- Auto-save: Mutations trigger immediate disk write via `ScopeStore.saveScope()`

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
- Module: CommonJS
- Strict mode enabled
- Output: `dist/` directory with `.js` and `.d.ts` files

## Git Submodule

This is maintained as a Git submodule. Changes here must be committed in this repo separately from parent project.

## Network Notes

For WSL/Docker access, server must listen on `0.0.0.0` and Windows firewall rules may need configuration. See `USAGE.md` for detailed WSL networking guide (Mirrored mode vs NAT mode).
