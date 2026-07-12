# Gulberg AI Temp Mail

Free, no-signup disposable email generator: generates a temporary mail.tm address, polls the inbox automatically, and lets users read messages in a modal — all wrapped in a dark glassmorphism UI.

## Run & Operate

- `pnpm --filter @workspace/gulberg-temp-mail run dev` — run the web app (Vite)
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- No secrets/DB required for this app — mail.tm is a free public API.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React + Vite, Tailwind, shadcn/ui primitives (artifact: `gulberg-temp-mail`, path `/`)
- API: Express 5 (artifact: `api-server`, path `/api`)
- DB: PostgreSQL + Drizzle ORM (scaffolded but unused by this app)

## Where things live

- `artifacts/gulberg-temp-mail/src/App.tsx` — the entire temp-mail UI and client logic (single component, ported from an original single-file HTML prototype at the repo root: `gulberg-ai-temp-mail.html`)
- `artifacts/gulberg-temp-mail/src/index.css` — custom glassmorphism styles (orbs, glass cards, buttons, modal) appended after the shadcn theme layer
- `artifacts/api-server/src/routes/tempmail.ts` — `POST /api/tempmail/generate`, creates a mail.tm account server-side and returns `{ email, token }`

## Architecture decisions

- Account creation goes through the Express backend (`/api/tempmail/generate`) instead of the browser, because mail.tm rate-limits/blocks direct browser-side account creation. Once a token is issued, inbox polling (`GET /messages`) happens directly from the browser using that token.
- The original prototype (`gulberg-ai-temp-mail.html`) is left at the repo root for reference; the live app is the React port under `artifacts/gulberg-temp-mail`.

## Product

- Generates a temporary email address on load (via mail.tm), auto-refreshes the inbox every 10s with a visible countdown, lets the user copy the address, generate a new one, and open any message in a modal (sanitized HTML rendering).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- mail.tm occasionally returns 429/502 on account creation under load; the app retries with backoff (3s, 6s, ... capped at 20s) — this is expected, not a bug.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
