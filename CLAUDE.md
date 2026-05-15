# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See [AGENTS.md](AGENTS.md) for full architecture, data flow, and constraints — that file applies to all AI agents including Claude.

## Commands

```bash
npm install          # install dependencies
npm run dev          # run with hot reload — use this during development
npm run build        # compile TypeScript to dist/
npm run build:start  # run compiled output
```

Dev server runs at `http://localhost:3000`.

## Quick orientation

- Backend: TypeScript in `src/`, compiled to `dist/` via `tsc`. ESM throughout.
- Frontend: Vanilla JS in `public/`. No build step. Files are served directly by Fastify.
- Entry point for end users: `bin/cli.js` (plain JS, imports `dist/server.js`).
- All Fastify routes live in `src/server.ts`.
- All UI logic lives in `public/app.js` (plus `public/promptCompare.js` for Prompt Compare).
- Model pricing lives in `src/pricing.ts` — update this when Anthropic releases new models or changes rates.
