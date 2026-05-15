# AGENTS.md

Guidance for AI coding agents (Codex, Gemini, etc.) working in this repository.

## What this project is

Token Bleed is a local cost dashboard for Claude Code and Codex sessions. It reads `.jsonl` log files from `~/.claude/projects/` and `~/.codex/sessions/`, computes token costs, and serves a web dashboard. No cloud, no telemetry, no accounts.

## Commands

```bash
npm install          # install dependencies
npm run dev          # run with hot reload (tsx watch) — for development
npm run build        # compile TypeScript to dist/
npm run build:start  # run compiled output
```

Dev server runs at `http://localhost:3000`. The production CLI (`npx token-bleed`) runs at port 3847.

## Architecture

The backend is TypeScript compiled to ESM (`dist/`). The frontend is vanilla JS served as static files from `public/` — no build step, no framework.

### Data flow

```
~/.claude/projects/**/*.jsonl  →  parser.ts  →  aggregator.ts  →  server.ts  →  API
~/.codex/sessions/**/*.jsonl   →  codexParser.ts  ↗
```

- `parser.ts` reads Claude Code `.jsonl` files, extracts per-turn token usage from `message.usage`, resolves model names, and computes per-turn cost.
- `codexParser.ts` does the same for Codex rollout logs.
- `aggregator.ts` rolls parsed sessions into project, model, and daily summaries. All filtering by date/source happens here.
- `pricing.ts` holds the model pricing table. Custom pricing set via Settings UI is merged in at runtime and persisted to `~/.burn-rate-settings.json`.
- `providers.ts` manages the model bridge feature: storing API keys (base64 in `~/.token-bleed/providers.json`), spawning LiteLLM proxy processes, and tracking their PIDs.
- `server.ts` is the Fastify app. All routes are in this one file. In-memory cache is invalidated on `/api/refresh` or every 5 minutes.

### Frontend

`public/app.js` contains all UI logic as one file. Page views are rendered by functions (`renderOverview`, `renderSessions`, etc.) that fetch from the API and write into `#content`. State is a single top-level `state` object. Persistent UI state (hidden cards, view mode, column order) lives in `localStorage`.

`public/promptCompare.js` handles Prompt Compare — it is imported by `app.js` and shares the same `state` object.

### Settings files

| File | Purpose |
|------|---------|
| `~/.claude/settings.json` | Claude Code settings (we read/write `cleanupPeriodDays`) |
| `~/.burn-rate-settings.json` | App settings: plan, custom pricing, duration mode |
| `~/.token-bleed/providers.json` | Model bridge provider config and encoded API keys |
| `~/.token-bleed/pids/` | PID files for running LiteLLM proxy processes |

## Key constraints

- **No new dependencies without a strong reason.** The frontend has zero dependencies. The backend depends only on Fastify and `open`.
- **No frontend build step.** Files in `public/` are served directly. Vanilla JS only.
- **TypeScript source is in `src/`, compiled output goes to `dist/`.** Never edit `dist/` directly.
- **The CLI entry point is `bin/cli.js`** — plain JS, not TypeScript. It handles subcommands (`install`, `uninstall`, `fix-retention`) and then imports `dist/server.js`.
- **Port 3847** is the production CLI port. Port 3000 is used during `npm run dev`.
