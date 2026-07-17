# Tess Portal

An **agentic job-search platform** — a private, invite-only web app where an
AI agent ("Tess") runs a job hunt end to end: discovering roles across many
sources, verifying visa sponsorship against official government registers,
tailoring applications, managing outreach and a built-in mailbox, preparing
for interviews, and coaching salary negotiation — with a human-approval gate
on every outbound action.

> This repository is a **public source snapshot for review**. It contains the
> full application source, tests, and configuration. Secrets, environment
> files, backups, and internal operational documents are intentionally
> excluded — see `.env.example` for the shape of the required configuration.

## What it does

- **Discovery engine** — searches five job APIs (Careerjet, Adzuna, JSearch,
  Jooble, Reed) and seven applicant-tracking systems (Greenhouse, Lever,
  Ashby, Workable, SmartRecruiters, Recruitee, Teamtailor) across five
  countries, then filters relevance with a deterministic title gate backed by
  vector-embedding similarity (pgvector).
- **Visa-sponsorship verification** — matches each job's employer against
  official licensed-sponsor registers (UK, Ireland, Netherlands, Canada),
  ingested and refreshed automatically; unverifiable roles in register
  countries are hidden by default.
- **Pipeline & applications** — a drag-and-drop board (Saved → Applied →
  Interview → Offer) with CV/cover-letter tailoring from the user's real CV.
- **Embedded mailbox** — a full IMAP/SMTP email client (threading, rich
  compose, undo/scheduled send, rules, AI-drafted replies) connected to the
  user's own professional address.
- **Interview prep & salary coaching** — grounded generation throughout:
  company briefs cite their sources, interview questions map only to the
  user's real projects and stories, and negotiation figures come only from
  real observed postings. Nothing is fabricated.
- **Human-in-the-loop** — every outbound message is queued for explicit user
  approval before it is sent.

## Architecture

- `apps/web` — Next.js 16 / React 19 app: UI, API routes, server-sent events
- `apps/worker` — background worker: BullMQ scheduler, discovery adapters,
  sponsor-register ingestion, mailbox sync; runs DB migrations on boot
- `packages/db` — Drizzle ORM schema, migrations, and clients (PostgreSQL + pgvector)
- `packages/shared` — pino logger with secret redaction, shared helpers

**Stack:** TypeScript · Next.js 16 · React 19 · PostgreSQL (pgvector) ·
Redis · Meilisearch · Drizzle ORM · BullMQ · Docker Compose · deployed behind
Caddy on a Linux VPS. An encrypted secrets vault (AES-256-GCM) stores
third-party API keys; nightly GPG-encrypted offsite backups.

## Running it

The app is designed to run as a Docker Compose stack. `.env.example` documents
every required variable; a helper script generates the real secrets locally.

```sh
./scripts/generate-env.sh    # generates .env with fresh secrets (never committed)
docker compose build
docker compose up -d
```

No container publishes a host port; TLS terminates at an external Caddy reverse
proxy that reaches `tessportal-web:3000` over a shared network.

## Tests

```sh
bash scripts/run-tests.sh    # web + worker suites (Vitest)
```

---

*Built by Emem. This snapshot is provided for portfolio review.*
