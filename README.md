# Token Bleed

**See exactly what Claude Code is costing you.**

Token Bleed is a local dashboard that reads your Claude Code session logs and turns them into a clean cost and usage tracker. No API key. No cloud. No telemetry. Just your data, running locally.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/built_with-TypeScript-3178c6.svg)](https://www.typescriptlang.org/)
[![Fastify](https://img.shields.io/badge/server-Fastify-000000.svg)](https://fastify.dev/)

---

## What it shows

- **Total spend** across all Claude Code sessions, by project and by model
- **Cache hit rate** so you know if prompt caching is actually working
- **Daily activity** with cost and token trends over time
- **Session drill-down** including the first prompt, tool call count, and per-message cost breakdown
- **Model comparison** side-by-side stats across every model you have used
- **Session compare** to diff two sessions directly

All filtered by time period. Light and dark theme included.

---

## How it works

Claude Code writes a `.jsonl` file for every session to `~/.claude/projects/`. Token Bleed reads those files on startup, parses token usage and model info from each assistant turn, and computes cost using Anthropic's published pricing.

No network requests. No accounts. Runs at `localhost:3000`.

---

## Quick start

```bash
git clone https://github.com/mrrichsylvester/burn-rate
cd burn-rate
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Data refreshes from disk every 5 minutes or on demand via the Refresh button.

---

## Production build

```bash
npm run build
npm run build:start
```

Or set `PORT` and `HOST` environment variables to run on a different address.

```bash
PORT=8080 HOST=0.0.0.0 npm start
```

---

## Models supported

Token Bleed includes accurate pricing for:

| Model             | Input | Output | Cache Write | Cache Read |
| ----------------- | ----- | ------ | ----------- | ---------- |
| claude-opus-4-7   | $15   | $75    | $18.75      | $1.50      |
| claude-sonnet-4-6 | $3    | $15    | $3.75       | $0.30      |
| claude-haiku-4-5  | $0.80 | $4     | $1.00       | $0.08      |
| claude-3-5-sonnet | $3    | $15    | $3.75       | $0.30      |
| claude-3-5-haiku  | $0.80 | $4     | $1.00       | $0.08      |
| claude-3-opus     | $15   | $75    | $18.75      | $1.50      |
| claude-3-haiku    | $0.25 | $1.25  | $0.30       | $0.03      |

Prices per million tokens. Prefix matching handles future versioned model IDs automatically.

Local/custom models show usage data but report $0 cost.

---

## Known quirks with local models

Token Bleed works with any model Claude Code talks to, including local models running via Ollama or similar. Two things to be aware of when reading token counts for those sessions.

**Local models report cumulative input tokens.** The Anthropic API reports incremental input tokens per turn, with cached context tracked separately in `cache_read_input_tokens`. Local model servers (Ollama, etc.) do not implement prompt caching, so they report the full conversation context as `input_tokens` on every turn. Turn 3 includes the full prompt from turns 1 and 2. This means input token totals for local model sessions will be significantly higher than equivalent Claude sessions and are not directly comparable. The session compare and model compare views flag this with a note when a local model is present.

---

## Stack

- **Runtime:** Node.js with [tsx](https://github.com/privatenumber/tsx)
- **Server:** [Fastify](https://fastify.dev/)
- **Frontend:** Vanilla TypeScript, no framework
- **Fonts:** Figtree, JetBrains Mono, Outfit

No build step required for the frontend. Static files are served directly from `public/`.

---

## API

The server exposes a REST API if you want to build on top of it.

| Method | Path                         | Description                                             |
| ------ | ---------------------------- | ------------------------------------------------------- |
| GET    | `/api/stats`                 | Global totals and summary                               |
| GET    | `/api/projects`              | Per-project cost and usage                              |
| GET    | `/api/sessions`              | Paginated session list (filterable by project, model)   |
| GET    | `/api/sessions/:id`          | Single session detail                                   |
| GET    | `/api/sessions/:id/messages` | Per-message breakdown for a session                     |
| GET    | `/api/models`                | Per-model aggregated stats                              |
| GET    | `/api/models/comparison`     | Side-by-side stats for two models                       |
| GET    | `/api/daily`                 | Daily cost and activity over time                       |
| GET    | `/api/meta`                  | Date range and cleanup period from your Claude settings |
| GET    | `/api/refresh`               | Invalidate the in-memory cache                          |
| POST   | `/api/settings`              | Update `cleanupPeriodDays` in `~/.claude/settings.json` |

All list endpoints accept a `?since=YYYY-MM-DD` query param to filter by date.

---

## License

MIT. Build with it, fork it, ship it.

---

Built by [Richard Sylvester](https://youtube.com/@MrRichSylvester) · [AI Revenue Club](https://airevenueclub.com)
