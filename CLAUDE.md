# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite + Electron desktop window (main workflow)
npm run build        # Compile TypeScript & bundle with Vite
npm run lint         # Run ESLint on all .ts/.tsx files
npm run dist         # Package as Windows installer (electron-builder)
npm run preview      # Web-only preview (no Electron)
```

Build outputs: `dist/` (web bundle), `dist-electron/` (Electron main process), `release/` (packaged app).

## Architecture

This is a Windows-first Electron + React/TypeScript desktop app. It follows the standard **two-process Electron architecture**:

**Main Process** (`electron/`)
- `main.ts` — App lifecycle, BrowserWindow creation, IPC handler registration, and a `snapshotCache` to avoid re-scanning on every load.
- `skills.ts` — All core logic: scanning local skill directories, fetching remote catalogs, installing remote skills, and generating Chinese descriptions locally (no LLM/translation API).
- `preload.ts` — Context bridge that validates all data crossing the IPC boundary and exposes `window.skillsDashboard` to the renderer.

**Renderer Process** (`src/`)
- `App.tsx` — Single large component managing all state. Uses `useDeferredValue` for search. Two top-level panel modes: `'local'` (Local Board) and `'remote'` (Cloud Explore).
- `shared/contracts.ts` — The single source of truth for all IPC types. All communication between main and renderer is typed through `SkillsDashboardApi`.

**Data Sources**

Local (scanned at startup):
- Claude Code: `~/.claude/skills`
- CodeX: `~/.codex/skills` (personal) and `~/.codex/skills/.system` (global)
- OpenClaw: `~/.openclaw/skills`

Remote (fetched on demand):
- Tencent SkillHub — top 50 via `lightmake.site/api/skills/top`
- ClawHub — top 100 via Convex backend
- Anthropic — official GitHub `skills/` directory

**Key IPC Handlers**

| Channel | Purpose |
|---|---|
| `dashboard:get-snapshot` | Initial load (cached) |
| `dashboard:refresh` | Re-scan local + re-fetch remote |
| `dashboard:update-selected-source` | Persist user's local source filter |
| `dashboard:install-remote-skill` | Download and install a remote skill locally |

**Settings** persist to `~/.claude/config.json`. Remote installs write a `.agent-skills-dashboard.json` manifest to track ownership and avoid overwriting unrelated folders. Filename conflicts get a numeric suffix (e.g., `skill-name-1`).

## TypeScript Config

The project has two separate TS configs:
- `tsconfig.app.json` — renderer (`src/`), strict mode, all unused locals/params flagged
- `tsconfig.node.json` — Electron main + preload (`electron/`), strict mode

The `yaml` package is kept external (not bundled) in the Electron main process via `vite.config.ts`.
