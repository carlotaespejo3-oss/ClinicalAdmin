# ClinAdmin

A clinical admin dashboard for an NHS CAMHS consultant — triages incoming Outlook mail, plans the consultant's week, and tracks behavioural signals across emails (deferrals, acknowledgements, archive state).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/clinadmin run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for the API contract; codegen produces hooks and Zod schemas from this
- `lib/db/src/schema/` — Drizzle table definitions (one file per table); `index.ts` re-exports them
- `artifacts/api-server/src/routes/` — Express route handlers, one file per resource
- `artifacts/clinadmin/src/lib/*Store.ts` — client-side stores (`useSyncExternalStore`-backed) that wrap the generated API client
- `artifacts/clinadmin/src/tabs/` — top-level UI per workflow (Inbox, Today, Calendar, Archive, etc.)

## Architecture decisions

- **Three-bucket storage rule** (foundational, never violated):
  - **Lives in Outlook** — all correspondence: emails received from patients/families/colleagues, emails the clinician writes and sends in reply. Anything that is correspondence, sent or received.
  - **Lives in our database** — the clinician's own organisational layer over their inbox: notes, task titles, document names, reminders; scheduling metadata (deferrals, priorities, deadlines); clinical decision metadata (category, risk flags, sources cited, warnings acknowledged); action records (archived, acknowledged, done — and when); behavioural signals (deferral counts, time estimates, patterns).
  - **Lives nowhere in our system** — email body text of any kind, incoming or outgoing. That content has one home and it is Outlook. Subject, body, sender are fetched live from Microsoft Graph at display time and never duplicated locally.
- **Single carve-out: `draft_audit` (medico-legal trail, audit-only)** — the only deliberate exception to the storage rule. This table stores **de-identified** AI draft text plus SHA-256 hashes for one purpose: proving what the AI suggested vs what the clinician sent. The carve-out is narrow and the boundaries are enforced server-side:
  - The **incoming patient email body is still never persisted** — Graph remains its only home.
  - The **sent reply text is never stored** — only its SHA-256 hash leaves the browser. The full text stays in Outlook Sent Items.
  - The AI draft text **is** stored, but only after a server-side de-id pass replaces patient/parent/other names with `[PATIENT_NAME]` / `[PARENT_NAME]` / `[NAME]` placeholders (`artifacts/api-server/src/lib/deidentify.ts`). The original pre-scrub draft is hashed and discarded.
  - `draft_edited` is derived server-side from `ai_draft_hash` vs `sent_hash` inside a single atomic upsert — race-safe and tamper-evident.
  - The Stage 4 de-id scrubber is a deterministic rule-based helper. It is explicitly **not production-grade NER** and must be replaced with a proper NER service before any clinical pilot.
- **Per-email DB tables use composite PK `(clinician_id, outlook_email_id)`** — multi-clinician ready from day one; single-tenant for now via `DEFAULT_CLINICIAN_ID = "default"` in each route.
- **Client stores follow a hydrate-once + fire-and-forget pattern** — first hook subscriber triggers a one-shot GET to populate an in-memory cache, mutations update the cache synchronously and POST/DELETE asynchronously. Failures are logged, not surfaced as toasts (these are advisory features, not safety-critical).
- **Idempotency is enforced server-side** — POST endpoints are safe to call repeatedly with the same key; DELETE returns 204 even on missing rows.

## Product

- **Inbox triage** with AI category and risk hints over the consultant's Outlook mail.
- **Weekly planner** that fits the inbox into the consultant's available time and surfaces what slips.
- **Deferral tracking** — when an email can't fit in this week's runway, the planner records it; emails deferred multiple weeks get a stronger visual warning.
- **Archive / acknowledge** to clear handled or no-action items from the active view while preserving the audit trail.

## User preferences

- **British spelling, plain language** in all UI copy. Audience is a clinician, not an engineer — no jargon.
- **Storage rule is non-negotiable** — see the three-bucket rule above. If a feature seems to need email content in the database, it doesn't; fetch from Graph at display time. Anything the patient or family wrote stays in Outlook.
- **Confirm before destructive actions** in the UI (delete, bulk archive, etc.).
- **Decisions made about safety/UX should be flagged** — e.g. an "undo" window before sending email — rather than silently chosen.

## Gotchas

- After editing `openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` before typechecking — generated client and Zod schemas drive both the server validation and the client hooks.
- After editing `lib/db/src/schema/*`, run `pnpm --filter @workspace/db run push`. `drizzle-kit push` is interactive on column renames; in dev, dropping and recreating via `psql` is often cleanest.
- Generated API client does NOT URL-encode path params (orval default). Always wrap path-param values in `encodeURIComponent` at the call site — Microsoft Graph IDs contain `/`, `+`, `=`.
- Client stores currently key by numeric seed IDs (`Number(outlookEmailId)`). When real Graph IDs replace the seed data, the cache key type must become `string` end-to-end and the `Number()`/`String()` coercion shims removed.
- Restart the `artifacts/api-server: API Server` workflow after adding new routes — esbuild rebuilds, but the running process needs a restart to pick them up.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
