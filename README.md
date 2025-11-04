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

### Bootstrapping required data

Session creation requires existing Client and Template records. Populate the
database before using the "Start session" flow:

1. Run the Prisma seed to insert the default onboarding template (e.g.
   `individual_kyc_v1`). The script automatically regenerates the Prisma
   client if needed:

   ```bash
   pnpm --filter @agent-proto/api run prisma:seed
   ```

2. Create at least one client record (via Prisma Studio, `psql`, or your
   preferred admin tool) and copy its generated `id`.

3. When starting a session, provide the client `id` from step 2 and the
   template `id` produced by the seed script.

## Env
Copy `.env.example` to `.env` and adjust values as needed.

## Docker (DB)
```bash
docker compose up -d
```
Services:
- PostgreSQL on 5432
- pgAdmin on 5050 (user: admin@local.test / password: adminadmin)

