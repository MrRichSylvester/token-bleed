# Contributing

Token Bleed is open source and PRs are welcome. Here's how to get running and what makes a good contribution.

## Running locally

```bash
git clone https://github.com/mrrichsylvester/token-bleed
cd token-bleed
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The server watches `~/.claude/projects/` for session data.

To rebuild TypeScript after changes:

```bash
npm run build
```

The frontend is vanilla JS/TS with no framework. Static files in `public/` are served directly — no build step needed for frontend changes.

## Project structure

```
src/
  parser.ts      # reads .jsonl session files, extracts token usage
  aggregator.ts  # rolls up sessions into project/model/daily summaries
  pricing.ts     # model pricing table and cost calculation
  server.ts      # Fastify API routes
  types.ts       # shared types

public/
  index.html     # single-page app shell
  app.js         # all UI logic
  styles.css     # all styles
```

## What makes a good PR

- **Fixes a real bug** with a clear reproduction case
- **Adds a feature** that's broadly useful, not specific to one workflow
- **Keeps the stack simple** — no new frameworks, no new build steps
- **Matches the existing style** — no comments explaining what code does, no abstractions that don't pay for themselves

If you're planning something large, open an issue first so we can align before you build it.

## Pricing data

Model pricing lives in `src/pricing.ts`. If Anthropic updates prices or releases a new model, a PR updating that file with a source link is always welcome.
