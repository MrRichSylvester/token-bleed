# Token Bleed

**See exactly what Claude Code, Codex, and OpenCode are costing you. Per session. Per project. Per prompt.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/built_with-TypeScript-3178c6.svg)](https://www.typescriptlang.org/)

---

### Quick start (recommended)
```bash
npx token-bleed
```

---

![Dashboard Overview](images/dashboard.png)

---

## Installation

### Install permanently
```bash
npm install -g token-bleed
token-bleed
```

### Run on login (Mac)
```bash
npm install -g token-bleed
token-bleed install
# Token Bleed now starts automatically.
# Open http://localhost:3847 anytime.
```

### Fix log retention (do this once)
```bash
token-bleed fix-retention
```

---

## The problem

Claude Code, Codex, and OpenCode are productive. They're also expensive when you're not watching.

They manage context automatically, fire tool calls in the background, and read files you didn't ask them to read. By the time your bill lands, you have no idea which project burned $40 or which prompt pattern is costing you three times what it should.

Token Bleed fixes that. It reads your local Claude Code, Codex, and OpenCode session data and turns it into a real cost dashboard. No API key, no cloud, no telemetry. Your data never leaves your machine.

---

## What it does

### Cost visibility, not estimates

Total spend, daily trends, average session cost, and per-message breakdowns. Filtered by time period. Accurate to Anthropic's published pricing including cache write and cache read rates.

### When you shipped

Your coding-agent sessions rendered as a contribution-style heatmap, with colors blending by agent based on your daily usage. See your build cadence at a glance, not just what you spent.

![Activity Heatmap](images/activity.png)

### Project, session and prompt breakdown

See which projects are burning the most and which models you're actually using. Drill down from project to session to individual message. Every number is traceable.


![Project Hierarchy](images/project-hierarchy.png)

### Session Compare

Pick any two sessions and diff them side by side. Token counts, cost, cache behavior, tool call volume. Useful when you're testing prompt strategies and want to know which approach is actually cheaper, not just which feels faster.

![Session Comparison](images/session-compare.png)

### Model Compare

Compare two models across the same workload. Input tokens, output tokens, cache hit rate, total cost. Makes the Opus vs Sonnet decision data instead of instinct.

### Cache hit rate tracking

Prompt caching is the biggest lever most builders aren't using correctly. Token Bleed tracks your cache hit rate so you can see whether your workflow is actually taking advantage of it, and by how much.

### Optimization signals

Surfaces patterns in your usage: sessions with no cache hits, high tool call counts, models you're paying Opus prices for on tasks that don't need it.

![Optimization Tips](images/tips.png)

### Connect any model to Claude Code

Token Bleed isn't just a dashboard—it helps you connect Claude Code to non-Anthropic models. Use the built-in model bridge to run Claude Code against OpenAI, Gemini, or local models via Ollama and LiteLLM, and track their costs in one place.

---

## How it works

Claude Code writes a `.jsonl` file for every session to `~/.claude/projects/`. Codex writes rollout logs to `~/.codex/sessions/`. OpenCode stores session data in `~/.local/share/opencode/opencode.db`. Token Bleed reads those local sources on startup, parses token usage and model info, and computes cost using built-in model pricing or OpenCode's recorded cost where available.

No network requests. No accounts. Runs at `localhost:3847`.

Data refreshes from disk every 5 minutes or on demand via the Refresh button. When an OpenCode server is reachable, Token Bleed also listens for OpenCode events and refreshes live as sessions change.

---

## Models supported

Built-in pricing for Claude and Codex models. OpenCode sessions use the costs recorded by OpenCode when available. Prefix matching handles future versioned IDs automatically.

### Claude (Claude Code)

| Model             | Input | Output | Cache Write | Cache Read |
| ----------------- | ----- | ------ | ----------- | ---------- |
| claude-opus-4-7   | $15   | $75    | $18.75      | $1.50      |
| claude-sonnet-4-6 | $3    | $15    | $3.75       | $0.30      |
| claude-haiku-4-5  | $0.80 | $4     | $1.00       | $0.08      |
| claude-3-5-sonnet | $3    | $15    | $3.75       | $0.30      |
| claude-3-5-haiku  | $0.80 | $4     | $1.00       | $0.08      |
| claude-3-opus     | $15   | $75    | $18.75      | $1.50      |
| claude-3-haiku    | $0.25 | $1.25  | $0.30       | $0.03      |

### OpenAI (Codex)

| Model        | Input | Output | Cache Read |
| ------------ | ----- | ------ | ---------- |
| gpt-5.5      | $5    | $30    | $0.50      |
| gpt-5.4      | $2.50 | $15    | $0.25      |
| gpt-5.4-mini | $0.75 | $4.50  | $0.075     |

### Custom Models & Pricing

You can **add your own pricing for any custom model** in the Settings tab. This allows you to track costs for Gemini, local models, or any other provider with the same precision as built-in models.

By default, local and custom models show usage data but report $0 cost until their pricing is configured.

---

## Local model quirks

Token Bleed works with any model Claude Code, Codex, or OpenCode connects to, including local models via Ollama or similar.

One thing to know: local model servers do not implement prompt caching, so they report the full conversation context as `input_tokens` on every turn instead of incremental deltas. This means input token totals for local model sessions will be significantly higher than equivalent Claude sessions and are not directly comparable. Session Compare and Model Compare flag this when a local model is present.

---

## API

The server exposes a REST API if you want to build on top of it.

| Method | Path                         | Description                                                   |
| ------ | ---------------------------- | ------------------------------------------------------------- |
| GET    | `/api/stats`                 | Global totals and summary                                     |
| GET    | `/api/projects`              | Per-project cost and usage                                    |
| GET    | `/api/sessions`              | Paginated session list (filterable by source, project, model) |
| GET    | `/api/sessions/:id`          | Single session detail                                         |
| GET    | `/api/sessions/:id/messages` | Per-message breakdown for a session                           |
| GET    | `/api/models`                | Per-model aggregated stats                                    |
| GET    | `/api/models/comparison`     | Side-by-side stats for two models                             |
| GET    | `/api/daily`                 | Daily cost and activity over time                             |
| GET    | `/api/meta`                  | Date range and cleanup period from your Claude settings       |
| GET    | `/api/refresh`               | Invalidate the in-memory cache                                |
| POST   | `/api/settings`              | Update `cleanupPeriodDays` in `~/.claude/settings.json`       |

All list endpoints accept a `?since=YYYY-MM-DD` query param to filter by date.

---

## Stack

- **Runtime:** Node.js 18+
- **Server:** [Fastify](https://fastify.dev/)
- **Frontend:** Vanilla TypeScript, no framework

---

## License

MIT. Build with it, fork it, ship it.

---

Built by [Richard Sylvester](https://youtube.com/@MrRichSylvester) · [AI Revenue Club](https://airevenueclub.com)
