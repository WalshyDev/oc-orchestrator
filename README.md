# OC Orchestrator

A desktop app for running and supervising 10+ concurrent [OpenCode](https://github.com/nicholasgriffintn/opencode) agents across multiple local projects. Built for rapid oversight and intervention — surface blocked agents immediately, approve or reply in one click, and keep every session visible from a single fleet board.

![OC Orchestrator Fleet Board](.github/screenshot.png)

## Features

- **Fleet board** — dense, sortable table of all active agents with real-time status updates via SSE
- **Interrupt queue** — blocked agents (needs approval, needs input, errored) surface at the top with a banner showing what's waiting
- **Agent detail drawer** — continue any session directly: send messages, approve/deny permissions, view transcript, file changes, and tool usage
- **One-click launch** — pick a project directory, write an optional prompt, and start a new agent in an isolated git worktree
- **Keyboard-driven** — `J`/`K` navigate, `N` jumps to next urgent, `A` approves, `D` denies, `Cmd+K` opens command palette
- **Git isolation** — each agent gets its own worktree and branch to avoid filesystem collisions
- **Desktop notifications** — get alerted when agents need attention

## Tech Stack

Electron + React 19 + TypeScript, TailwindCSS 4, SQLite (better-sqlite3), OpenCode JS/TS SDK.

## Prerequisites

- [Node.js](https://nodejs.org/) 24.14.0+
- [OpenCode](https://github.com/nicholasgriffintn/opencode) installed and available on your PATH (or set `OPENCODE_PATH`)

## Setup

```bash
# Clone the repo
git clone https://github.com/nicholasgriffintn/oc-orchestrator.git
cd oc-orchestrator

# Install dependencies (also rebuilds native modules)
npm install

# Copy environment config (optional)
cp .env.example .env

# Start the dev server
npm run dev
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OPENCODE_PATH` | System PATH | Path to the `opencode` binary |
| `OC_ORCHESTRATOR_DB_PATH` | `~/.oc-orchestrator/data.db` | SQLite database location |
| `OC_ORCHESTRATOR_WORKTREE_ROOT` | `~/.oc-orchestrator/worktrees` | Root directory for git worktrees |
| `OC_ORCHESTRATOR_LOG_LEVEL` | `info` | Log level (`debug`, `info`, `warn`, `error`) |

## Usage

1. Launch the app with `npm run dev`
2. Click **Launch Agent** (or press `L`)
3. Select a project directory and optionally enter an initial prompt
4. The agent appears in the fleet table — monitor its progress, approve permissions, or send follow-up messages from the detail drawer
5. Use filters and search to manage agents across multiple projects

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Electron dev server with hot reload |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Type check all targets |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:integration` | Integration tests (requires `OPENCODE_INTEGRATION=1`) |

## Contributing

### Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Ensure everything passes:

```bash
npm run lint
npm run typecheck
npm test
```

5. Commit your changes and open a pull request

### Code Style

- Single quotes for strings (enforced by ESLint)
- `const`/`let` only, no `var`
- TypeScript strict mode
- No single-character variable names (except loop counters)

### Project Structure

```
src/
├── main/              # Electron main process
│   ├── index.ts       # App init, window creation
│   ├── ipc.ts         # IPC handler registration
│   └── services/      # RuntimeManager, AgentController, Database, EventBridge, WorkspaceManager
├── renderer/src/      # React frontend
│   ├── App.tsx        # Main container
│   ├── components/    # FleetTable, DetailDrawer, LaunchModal, FilterBar, etc.
│   ├── hooks/         # useAgentStore (central state via useSyncExternalStore)
│   └── types/         # Core types and IPC API definitions
└── preload/           # Context bridge (window.api)
```

### Architecture

The main process manages a fleet of OpenCode server processes. Each agent maps to one runtime (spawned via `opencode serve`), one workspace (git worktree), and one session. The renderer subscribes to SSE events bridged over IPC and maintains client-side state in a React external store.

Key data flow: **Agent launch** -> **RuntimeManager** spawns OpenCode server -> **EventBridge** subscribes to SSE -> events forwarded via IPC -> **useAgentStore** updates state -> React re-renders.

### Running a Single Test

```bash
npx vitest run src/__tests__/database.test.ts
```
