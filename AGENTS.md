# wacrm — Agent Guide

This file is written for AI coding agents. The reader is assumed to know nothing about the project.

## Project overview

**wacrm** is a self-hostable CRM template for WhatsApp. It is a Next.js 16 web application (React 19, TypeScript, Tailwind CSS v4) backed by Supabase (Postgres + Auth + Storage + Row-Level Security). It talks to Meta's official WhatsApp Business API (Cloud API) for messaging.

Core modules:

- Shared inbox with conversation assignment, status, notes, and voice-note recording.
- Contacts + tags + custom fields, CSV import, deduplication.
- Sales pipelines (Kanban) with deals linked to conversations.
- Broadcasts using Meta-approved templates with delivery/read tracking.
- No-code automations with triggers, conditions, waits, tags, and webhooks.
- Flows — a visual bot-builder with interactive button/list replies.
- AI reply assistant (bring-your-own OpenAI/Anthropic key) with optional auto-reply bot and knowledge base.
- Real-time dashboard with activity feed.
- Team accounts with role-based access (owner / admin / agent / viewer) and invite-by-link.
- Public REST API (`/api/v1`) with scoped, revocable API keys.
- MCP server (`mcp-server/`) that exposes the public API as Model Context Protocol tools.

This is a **template repository**, not a collaborative SaaS product. The expected workflow is: fork → customize → deploy. Upstream prefers bug/security fixes; feature PRs usually belong in your fork.

- Marketing/docs site: https://wacrm.tech (source: `ArnasDon/wacrm-site`)
- Repo: https://github.com/ArnasDon/wacrm
- License: MIT

## Technology stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16.2.12 (App Router, server actions, `output: 'standalone'`) |
| React | 19.2.4 |
| Language | TypeScript 6.x |
| Styling | Tailwind CSS v4, `tw-animate-css`, CSS variables for theming |
| UI components | shadcn/ui (base-nova style), `@base-ui/react`, `lucide-react` |
| State / data | Supabase SSR client (`@supabase/ssr`), React context for themes |
| Charts | `recharts` |
| Drag-and-drop | `@dnd-kit/*` |
| Automation graph | `@xyflow/react` + `@dagrejs/dagre` |
| i18n | `next-intl` with static locale from env (`NEXT_PUBLIC_APP_LOCALE`) |
| Testing | Vitest 4.x, Node environment |
| Lint | ESLint 9 with `eslint-config-next` (core-web-vitals + typescript) |
| Format | Prettier 3.x with `prettier-plugin-tailwindcss` |
| Package manager | npm 10.9.9 (lockfile: `package-lock.json`) |
| Node engine | `>=20.0.0` |

## Project structure

```
.
├── src/
│   ├── app/              # Next.js App Router routes
│   │   ├── (auth)/       # Login, signup, forgot-password route group
│   │   ├── (dashboard)/  # Authenticated app pages (inbox, contacts, pipelines, ...)
│   │   ├── api/          # API routes (internal + public /api/v1)
│   │   ├── join/         # Invitation accept pages
│   │   ├── layout.tsx    # Root layout with theme boot + next-intl
│   │   └── page.tsx      # Redirects / to /dashboard
│   ├── components/       # React components by feature + shared UI
│   │   ├── ui/           # shadcn primitives
│   │   └── <feature>/    # inbox, contacts, pipelines, flows, automations, ...
│   ├── hooks/            # Client hooks (theme, etc.)
│   ├── i18n/             # next-intl request config
│   ├── lib/              # Business logic, data access, utilities
│   │   ├── auth/         # Account context, roles, invitations
│   │   ├── ai/           # AI assistant: generate, knowledge, embeddings, auto-reply
│   │   ├── api/          # Public API helpers + /api/v1 responders
│   │   ├── api-keys/     # Public API key hashing, scopes
│   │   ├── automations/  # Automation engine + cron
│   │   ├── contacts/     # Contacts, tags, CSV import, dedupe
│   │   ├── conversations/# Conversation helpers
│   │   ├── dashboard/    # Dashboard queries
│   │   ├── flows/        # Visual flow engine (bot builder)
│   │   ├── inbox/        # Inbox data helpers
│   │   ├── media/        # Media download, gallery, blob cache
│   │   ├── supabase/     # Browser + SSR Supabase clients
│   │   ├── webhooks/     # Outbound public API webhooks (delivery, signing, SSRF guard)
│   │   └── whatsapp/     # Meta API client, send core, broadcast, templates, webhook processing
│   ├── types/            # Shared TypeScript types
│   ├── middleware.ts     # Auth redirect + Supabase session refresh
│   └── middleware.test.ts
├── messages/             # Translation dictionaries (en.json, ko.json)
├── supabase/
│   ├── migrations/       # 39 numbered SQL migrations
│   ├── ci/verify-schema.sql
│   └── config.toml       # Supabase CLI config for CI only
├── mcp-server/           # Standalone MCP server (separate package.json)
├── docs/                 # docker.md, mcp.md, public-api.md
├── public/opus/          # Vendored opus-recorder encoder worker
└── Configuration files: package.json, next.config.ts, tsconfig.json,
   vitest.config.ts, eslint.config.mjs, .prettierrc, postcss.config.mjs,
   components.json, Dockerfile, docker-compose.yml
```

## Build, dev, and test commands

All commands run from the project root unless noted.

```bash
# Install dependencies
npm install

# Dev server (Turbopack) on http://localhost:3000
npm run dev

# Production build (also typechecks through Next.js)
npm run build

# Start production server
npm run start

# TypeScript only
npm run typecheck

# Lint
npm run lint

# Format
npm run format
npm run format:check

# Tests (Vitest, Node env)
npm test
npm run test:watch
```

The MCP server has its own package under `mcp-server/`:

```bash
cd mcp-server
npm install
npm run typecheck
npm run build     # compiles to mcp-server/dist/
npm start
```

## Code style guidelines

- **Formatter**: Prettier. Config in `.prettierrc`:
  - `semi: true`
  - `singleQuote: true`
  - `trailingComma: "es5"`
  - `printWidth: 80`
  - `tabWidth: 2`
  - `arrowParens: "always"`
  - `endOfLine: "lf"`
  - Tailwind class sorting via `prettier-plugin-tailwindcss`
- **Linter**: ESLint 9 flat config using `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`. See `eslint.config.mjs`.
- **Imports**: Use the TypeScript path alias `@/` for everything under `src/`. Examples: `@/lib/supabase/server`, `@/components/ui/button`.
- **String quotes**: Single quotes in TypeScript/TSX; double quotes in JSON.
- **File naming**: kebab-case for utility files (`send-message.ts`), PascalCase for components (`Sidebar.tsx`), lowercase for App Router segments.
- **Comments**: The codebase uses extensive block comments explaining *why* decisions were made. Keep that style for non-obvious logic.
- **Server/client boundaries**:
  - `src/lib/supabase/server.ts` imports `next/headers` and is server-only.
  - `src/lib/supabase/client.ts` is browser-only and cached as a singleton.
  - Do not import server-only modules into client components.

## Testing instructions

- Test runner: **Vitest**, Node environment.
- Test files: `src/**/*.test.ts` and `src/**/*.test.tsx`. There are ~79 test files.
- Config: `vitest.config.ts`.
- Tests rely on dummy env vars loaded by Vitest:
  - `ENCRYPTION_KEY=0000…` (64 hex chars)
  - `META_APP_SECRET=test-meta-app-secret`
- These are placeholders; tests do not call real Meta or Supabase services.
- Run the full suite: `npm test`
- Watch mode: `npm run test:watch`

## Environment and configuration

Copy `.env.local.example` to `.env.local` and fill it in. Required variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; bypasses RLS)
- `ENCRYPTION_KEY` (64 hex chars, AES-256-GCM key for WhatsApp tokens and AI keys)
- `META_APP_SECRET` (for HMAC webhook verification)

Important optional variables:

- `NEXT_PUBLIC_SITE_URL` — canonical public URL
- `NEXT_PUBLIC_DEFAULT_LOCALE` — default locale for new visitors (`en`); supports `en`, `es`, `ko`
- `NEXT_PUBLIC_APP_LOCALE` — upstream legacy fallback locale (`en`)
- `ALLOWED_INVITE_HOSTS` — hostname allow-list for invite URLs
- `AUTOMATION_CRON_SECRET` — secret for `GET /api/automations/cron`
- `META_APP_ID` — needed for image-header template submission
- `WHATSAPP_TEMPLATES_DRY_RUN=true` — skip Meta calls in template UI (use in dev/CI only)
- `AI_REQUEST_TIMEOUT_MS`, `AI_CONTEXT_MESSAGE_LIMIT` — AI tuning

For Docker, `NEXT_PUBLIC_*` vars are build args forwarded from `.env.local`; server-only secrets are runtime env vars and are not baked into the image.

## Security considerations

This project handles real customer conversations and WhatsApp credentials. Treat it accordingly.

- **Encryption**: WhatsApp access tokens, verify tokens, and AI provider keys are encrypted with AES-256-GCM (`src/lib/whatsapp/encryption.ts`). `ENCRYPTION_KEY` must be a 64-character hex string. Rotating it orphans previously encrypted tokens.
- **Webhook verification**: Meta webhook POSTs are verified with HMAC-SHA256 using `META_APP_SECRET`. `META_APP_SECRET` is required; if missing, every webhook is rejected.
- **Row-Level Security (RLS)**: All Supabase tables have RLS enabled. The dashboard uses the SSR client (RLS-scoped to the signed-in user). Server routes that need to bypass RLS (webhook processing, automation cron, public API key lookup) use the service-role client.
- **Service-role key**: Keep `SUPABASE_SERVICE_ROLE_KEY` secret and never expose it to the browser. It is used only in server-side route handlers.
- **Public API keys**: Stored as SHA-256 hashes; the cleartext is shown once. Each key is account-scoped and limited to declared scopes (`messages:send`, `contacts:read`, etc.). Rate limited per key (120 req/min default).
- **Rate limiting**: In-memory fixed-window counters in `src/lib/rate-limit.ts`. Works for single-instance deploys; swap to Redis/Upstash if you scale horizontally.
- **CSP / headers**: `next.config.ts` applies HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and a report-only Content-Security-Policy. It also sets a deliberate `Cache-Control` policy to avoid Hostinger CDN chunk-hash drift.
- **SSRF guard**: Outbound webhook deliveries (`src/lib/webhooks/ssrf.ts`) refuse private, link-local, and metadata IP ranges.
- **Invitations**: Configure `ALLOWED_INVITE_HOSTS` or `NEXT_PUBLIC_SITE_URL` to prevent Host-header spoofing in invite links.

## Authentication and authorization

- Users authenticate via Supabase Auth (email/password).
- Each user belongs to one account. Account context is resolved in `src/lib/auth/account.ts`:
  - `getCurrentAccount()` returns `{ supabase, userId, accountId, role, account }`.
  - `requireRole(minRole)` enforces a minimum role.
- Roles (`src/lib/auth/roles.ts`): `viewer` < `agent` < `admin` < `owner`.
  - Use predicates like `canManageMembers`, `canEditSettings`, `canSendMessages`, `canViewOnly` instead of comparing role strings inline.
- Middleware (`src/middleware.ts`) redirects unauthenticated users away from protected routes and carries refreshed Supabase cookies on redirects to avoid session wedge bugs.

## Database

- Schema is managed through numbered SQL migrations in `supabase/migrations/`.
- There are 39 migrations. Apply them with the Supabase CLI (`supabase db reset --local` / `supabase migration up`).
- CI runs a migrations job (`.github/workflows/migrations.yml`) that starts a clean Postgres and replays every migration, then verifies the schema with `supabase/ci/verify-schema.sql`.
- `supabase/config.toml` is intentionally minimal and exists only for the CLI-based CI check; production settings live in the Supabase dashboard.

## Key runtime behaviors

- **WhatsApp webhook** (`src/app/api/whatsapp/webhook/route.ts`):
  - GET verifies subscriptions against encrypted `verify_token` values.
  - POST verifies HMAC, acks Meta immediately, then processes the payload inside `after()` so the function stays alive after the response.
  - Inbound messages are idempotent via a unique index on `(conversation_id, message_id)`.
  - Media attachments are mirrored into the Supabase `chat-media` bucket because Meta deletes media after ~30 days.
  - Processing fans out to flows, automations, AI auto-reply, and outbound public webhooks.
- **Broadcasts**: Background fan-out via `/api/whatsapp/broadcast`; batched to respect rate limits.
- **Automations/Flows cron**: External scheduler must hit `GET /api/automations/cron` and `GET /api/flows/cron` with the `x-cron-secret` header. Both return 503 until `AUTOMATION_CRON_SECRET` is set.
- **Public API**: Envelope responses (`{ data }` / `{ error: { code, message } }`). Pagination uses opaque keyset cursors.

## Deployment

Recommended path is Hostinger managed Node.js (one-click Git deploy). The repo also supports Docker:

```bash
# Docker Compose
docker compose --env-file .env.local up --build -d

# Plain Docker
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  -t wacrm .
docker run -d --env-file .env.local -e PORT=3000 -p 3000:3000 wacrm
```

The build produces a standalone server bundle (`.next/standalone`) so the Docker image does not need `node_modules` or the Next CLI at runtime.

## CI

`.github/workflows/ci.yml` runs on every PR/push to `main`:

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run build`

CI uses dummy `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ENCRYPTION_KEY`, and `META_APP_SECRET` so builds can complete without real credentials.

## MCP server

Located in `mcp-server/`. It is a separate npm package (`wacrm-mcp`) that wraps the public `/api/v1` API for MCP clients.

- Read-only by default.
- Set `WACRM_ENABLE_WRITES=true` to allow contact writes and message sending.
- Set `WACRM_ENABLE_BROADCASTS=true` to allow mass broadcasts.
- Logs must go to stderr; stdout is the MCP protocol channel.

See `mcp-server/README.md` and `docs/mcp.md` for full details.

## When you make changes

- Run `npm run typecheck` and `npm run lint`.
- Run `npm test`.
- If you touch SQL, run the migrations job locally or ensure the CI migrations check passes.
- Update this `AGENTS.md` if you change build commands, env vars, security rules, or project conventions.
- Prefer minimal, scoped changes. This is a template; speculative abstractions and broad refactors usually belong in a fork.
