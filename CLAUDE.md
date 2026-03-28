# AGENTS.md

This file provides guidance to AI Agents when working with code in this repository.

## Project Overview

OC Orchestrator is an Electron + React + TypeScript desktop app for running and supervising 10+ concurrent OpenCode agents across multiple local projects. It uses SQLite (better-sqlite3) for local persistence and the `@opencode-ai/sdk` for communicating with OpenCode servers.

## Commands

```bash
npm install               # Install deps + rebuild native modules (better-sqlite3)
npm run dev               # Start Electron dev server with hot reload
npm run build             # Production build via electron-vite
npm run lint              # ESLint
npm run typecheck         # Type check both node and web targets
npm run typecheck:node    # Type check Electron main + preload only
npm run typecheck:web     # Type check React frontend only
npm test                  # Run all unit tests (Vitest)
npm run test:integration  # Integration tests (requires OPENCODE_INTEGRATION=1)
```

Run a single test file: `npx vitest run src/__tests__/database.test.ts`

## Architecture

### Process Model

**Main process** (`src/main/`) — Electron backend with five service singletons:

- **RuntimeManager** — spawns one `opencode serve` process per project directory, maintains SDK client connections, health checks every 30s with exponential backoff reconnection
- **AgentController** — manages agent sessions (launch, send message, respond to permission, abort)
- **EventBridge** — bridges SSE events from OpenCode servers to the renderer via `opencode:event` IPC
- **Database** — SQLite with prepared statements; tables: projects, workspaces, runtimes, sessions, events, rule_sets, preferences. Migrations run in constructor
- **WorkspaceManager** — creates git worktrees (`oco-{hash}`) stored in `~/.oc-orchestrator/worktrees` by default

**Preload** (`src/preload/`) — context bridge exposing `window.api` to renderer.

**Renderer** (`src/renderer/`) — React 19 frontend with TailwindCSS 4:

- **useAgentStore** — central state via `useSyncExternalStore`, processes OpenCode events, derives agent statuses
- **FleetTable** — main agent grid with sorting/filtering
- **DetailDrawer** — side panel showing messages, tool calls, file changes, events for selected agent
- **LaunchModal / CommandPalette / SettingsModal** — overlay dialogs

### IPC Communication

- **Invoke** (request-response): `{resource}:{action}` pattern (e.g. `agent:launch`, `workspace:create`)
- **On** (broadcast): `opencode:event`, `agent:launched`, reconnection status

### Data Flow

1. User launches agent → `AgentController` ensures runtime via `RuntimeManager` → creates OpenCode session
2. OpenCode server emits SSE events → `EventBridge` forwards via IPC → `useAgentStore` updates state → React re-renders
3. Permission requests surface as `needs_approval` status → user approves/denies → `AgentController` responds → session resumes

### Agent Status States

`starting`, `running`, `idle`, `completed`, `errored`, `disconnected`, `stopping`, `needs_input`, `needs_approval` (blocked states sort to top)

## Code Style

- ESLint enforces single quotes and warns on unused vars/console
- TypeScript strict mode enabled
- Path alias: `@` → `src/renderer/src` (web config only)
- Services are module-level singletons
- Prepared statements prefixed with `stmt`

## Environment Variables

- `OPENCODE_PATH` — path to opencode binary (defaults to system PATH)
- `OC_ORCHESTRATOR_DB_PATH` — SQLite location (defaults to `~/.oc-orchestrator/data.db`)
- `OC_ORCHESTRATOR_WORKTREE_ROOT` — worktree root (defaults to `~/.oc-orchestrator/worktrees`)
- `OC_ORCHESTRATOR_LOG_LEVEL` — debug, info, warn, error (default: info)
