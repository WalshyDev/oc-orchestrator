# OC Orchestrator

Desktop app for running and supervising 10+ concurrent [OpenCode](https://github.com/nichochar/opencode) agents across multiple local projects.

![Fleet overview](.github/screenshot.png)

## Features

- **Fleet table** — see all agents at a glance with status, task, branch, model, and activity
- **Detail drawer** — messages, tool calls, file changes, and event log for each agent
- **Permission handling** — approve or deny tool calls across all agents from one place
- **Question handling** — respond to agent questions and input requests inline
- **Worktree isolation** — each agent gets its own git worktree so work runs in parallel without branch conflicts
- **Labels & workflow tags** — mark agents as In Review, Blocked, Done, or Draft to track progress
- **Filter & search** — filter by status, label, or project; search by name or task; state persists across restarts
- **Interrupt banner** — blocked and errored agents surface at the top for quick triage
- **Session browser** — browse and resume previous sessions per project
- **Model picker** — switch models on the fly per agent with provider selection
- **MCP management** — view, connect, and disconnect MCP servers per agent
- **`/new`** — reset an agent's conversation and branch without leaving the fleet table
- **`/model`** — switch models on the fly per agent
- **Auto PR** — one-click PR creation with editable PR links
- **Image attachments** — attach images to agent messages
- **Command palette** — quick access to all actions via `Cmd+K`
- **Desktop notifications** — configurable alerts for blocked, errored, and completed agents
- **Auto-update** — notifies when a new version is available on npm

## Install

```bash
npm install -g oc-orchestrator
```

Requires [OpenCode](https://github.com/nichochar/opencode) to be installed and available in your PATH (or set `OPENCODE_PATH`).

## Run

```bash
oc-orchestrator
```

## Development

```bash
git clone https://github.com/WalshyDev/oc-orchestrator.git
cd oc-orchestrator
npm install
npm run dev
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Electron dev server with hot reload |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Type check both main and renderer |
| `npm test` | Run unit tests |

### Releases

Release scripts now prepare the version bump locally and publishing happens automatically from GitHub Actions when that version lands on `main`.

```bash
npm run release        # patch
npm run release:minor  # minor
npm run release:major  # major
git push origin <branch>
```

Each release script requires a clean git working tree, runs typecheck and tests, updates the version files, and creates the release commit locally without creating a git tag on your branch.

Open a PR and merge it into `main` to publish that version to npm. The publish workflow runs only after the change lands on `main`, not on the PR itself. It publishes when the current `main` version is not yet on npm, so a failed publish can be retried by merging a follow-up fix without bumping the version again.

After a successful publish, GitHub Actions creates the matching `vX.Y.Z` tag on the resulting `main` commit. This works with rebase merges because the tag is created after the rewritten commit exists on `main`.

Configure a trusted publisher for this package on npm using repository `WalshyDev/oc-orchestrator` and workflow filename `publish.yml`. No `NPM_TOKEN` secret is needed for publishing.

This repo currently installs dependencies with `legacy-peer-deps=true` via `.npmrc` because `@typescript-eslint/parser@8.57.2` does not accept TypeScript 6 peer ranges yet.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_PATH` | system PATH | Path to opencode binary |
| `OC_ORCHESTRATOR_DB_PATH` | `~/.oc-orchestrator/data.db` | SQLite database location |
| `OC_ORCHESTRATOR_WORKTREE_ROOT` | `~/.oc-orchestrator/worktrees` | Worktree root directory |
| `OC_ORCHESTRATOR_LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |
| `OC_ORCHESTRATOR_DEMO_MODE` | — | Enable demo mode with mock data (for screenshots) |
| `OC_ORCHESTRATOR_RUNTIME_IDLE_TIMEOUT_MS` | `300000` | Idle timeout before stopping unused runtimes |

## Architecture

Electron + React + TypeScript. SQLite for local persistence. Communicates with OpenCode servers via the `@opencode-ai/sdk`.

- **Main process** — runtime management, agent controller, event bridge, database
- **Renderer** — React 19 with TailwindCSS 4, central state via `useSyncExternalStore`

## License

MIT
