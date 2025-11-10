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

The “Start session” screen now includes a **Quick setup** card that:

- Seeds the default onboarding template (`individual_kyc_v1`) on first load.
- Lets you generate a client record with one click.
- Presents all templates in a dropdown so you can choose without copying IDs.

Before opening the web app, make sure the API can talk to a database. If you
need a detailed runbook for local Postgres + Prisma, follow these steps from
the repository root:

1. **Locate the Prisma schema and place `.env` alongside it.**
   ```bash
   find . -name schema.prisma
   # expected path: ./apps/api/prisma/schema.prisma
   cat > apps/api/prisma/.env <<'EOF'
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/agent_proto?schema=public"
   EOF
   ```

2. **Start Postgres (optional if you already have one running).**
   ```bash
   docker run --name agent-proto-postgres -d \
     -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=agent_proto \
     -p 5432:5432 postgres:16
   ```

3. **Apply migrations and generate the Prisma client in the hoisted workspace.**
   ```bash
   pnpm --filter @agent-proto/api exec prisma migrate deploy \
     || pnpm --filter @agent-proto/api exec prisma migrate dev --name init
   pnpm prisma:regenerate
   ```

4. **Seed the default onboarding template.**
   ```bash
   pnpm --filter @agent-proto/api run prisma:seed
   ```

5. **(Optional) Create or inspect clients in Prisma Studio.**
   ```bash
   pnpm --filter @agent-proto/api exec prisma studio
   ```

After completing these steps, visit `/sessions/start` in the web app. Use the
“Generate client ID” button, pick a template from the dropdown, and submit the
form to launch a session.

### Regenerating the Prisma client (monorepo/hoisted installs)

If you encounter errors indicating that `@prisma/client` has not been
generated, run the helper script from the repository root to clear cached
artifacts, rebuild the package, and regenerate the client in the hoisted
workspace location:

```bash
pnpm prisma:regenerate
```

The script removes `node_modules/.prisma`, rebuilds `@prisma/client`, and
executes `pnpm --filter @agent-proto/api exec prisma generate`. You can
confirm the client exists by verifying the generated files under
`node_modules/.pnpm/@prisma+client@<version>.../node_modules/@prisma/client`.

## Env
Copy `.env.example` to `.env` and adjust values as needed.

## Docker (DB)
```bash
docker compose up -d
```
Services:
- PostgreSQL on 5432
- pgAdmin on 5050 (user: admin@local.test / password: adminadmin)

