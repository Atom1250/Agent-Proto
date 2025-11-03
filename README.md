# Agent Proto Monorepo

Monorepo for AI Agent client onboarding.

- apps/web: Next.js (App Router)
- apps/api: Fastify (TypeScript)
- packages/shared: shared types
- packages/config: eslint + tsconfig bases

## Requirements
- Node v20+ (`.nvmrc` provided)
- pnpm v9+
- Docker (for Postgres/pgAdmin)

## Setup
```bash
pnpm i
```

## Development
```bash
pnpm dev
```
Runs `apps/web` and `apps/api` concurrently.

- API health: `http://localhost:3001/health`
- Web: `http://localhost:3000/`

## Env
Copy `.env.example` to `.env` and adjust values as needed.

## Docker (DB)
```bash
docker compose up -d
```
Services:
- PostgreSQL on 5432
- pgAdmin on 5050 (user: admin@local.test / password: adminadmin)

