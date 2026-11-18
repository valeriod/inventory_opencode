# Inventory — Operations (Postgres hardening, backup/restore, upgrades)

Deployment target: single operator on this DGX Spark (Arm64), Node 22 + pnpm, Docker available. SQLite is the default; Postgres is the shared/production option (kept first-class, dual-engine parity required).

## Environment

- `DATABASE_URL`
  - SQLite (default): `file:./data/inventory.db` (or omit to use repo default `data/inventory.db`)
  - Postgres: `postgres://USER:PASSWORD@HOST:5432/DB`
- `PORT` (API, default 3000), `HOST` (default `0.0.0.0`), `CORS_ORIGIN` (comma-separated or unset for permissive dev CORS)
- Toolchain (DGX Spark): `export PATH=$HOME/opencode/.toolchains/node22/bin:$PATH`

## Local run

```bash
cd ~/opencode/Inventory
export PATH=$HOME/opencode/.toolchains/node22/bin:$PATH
pnpm install
pnpm dev            # API (:3000) + web (:5173); Vite proxies /api -> :3000
# or: pnpm -C apps/api dev  and  pnpm -C apps/web dev -- --host
```

API auto-applies migrations and seeds default categories on start (`apps/api/src/server.ts`). Manual migrate: `pnpm -C packages/db migrate` (uses `DATABASE_URL`).

## Postgres

Start local Postgres (dev):

```bash
cd ~/opencode/Inventory
docker compose up -d postgres
# service: postgres:16, user/pass/db inventory/inventory/inventory, port 5432
```

Point the app at Postgres:

```bash
export DATABASE_URL='postgres://inventory:inventory@localhost:5432/inventory'
pnpm -C apps/api dev
```

Migrations for both engines live in `packages/db/drizzle/sqlite` and `packages/db/drizzle/postgres` (generated from one Drizzle schema). The API/migrate command selects the correct set from `DATABASE_URL`.

## Dual-engine parity tests (M7 exit criteria)

CI runs the full suite with a Postgres service (`TEST_POSTGRES_URL=postgres://inventory:inventory@localhost:5432/postgres`). Locally:

```bash
cd ~/opencode/Inventory
export PATH=$HOME/opencode/.toolchains/node22/bin:$PATH
docker compose up -d postgres
export TEST_POSTGRES_URL='postgres://inventory:inventory@localhost:5432/postgres'
pnpm -r run lint && pnpm -r run typecheck && pnpm -r run test
```

- DB package tests and API integration tests (items/categories/projects/allocations/reports/labels, including concurrent allocation invariant) run on **SQLite (temp)** and **Postgres (scratch DB per test env)** when Postgres is reachable.
- If Postgres is not reachable/unset, Postgres suites are reported as skipped-unreachable in API tests; SQLite suites still run. Parity is only considered green when Postgres suites pass.

## Indexing / performance notes

Baseline indexes (schema + migrations): `items(category_id, location)`, `movements(sku, created_at, sku+created_at)`, `allocations(project_id, sku, project_id+released_at, sku+released_at)`. These support common filters, movement history/ranges, and active-allocation/availability checks. Revisit with `EXPLAIN`/query stats if inventory grows large (v1 search does app-layer text scoring over SQL candidates; FTS5/pg_trgm are the planned optimization path per plan §4.3).

## Backup and restore

### SQLite (default)

- Data file: `data/inventory.db` (repo default). Stop the API before copying for a consistent snapshot.
- Backup:
  ```bash
  mkdir -p backups
  # preferred: stop API, then copy
  cp data/inventory.db "backups/inventory-$(date +%Y%m%d-%H%M%S).db"
  # or online backup: sqlite3 data/inventory.db ".backup 'backups/inventory.db'"
  ```
- Restore:
  ```bash
  # stop API
  cp backups/<chosen>.db data/inventory.db
  # start API (migrations auto-apply; keep backup of current DB first)
  ```

### Postgres

- Backup (custom format, recommended):
  ```bash
  mkdir -p backups
  docker compose exec -T postgres pg_dump -U inventory -d inventory -Fc > "backups/inventory-$(date +%Y%m%d-%H%M%S).dump"
  # plain SQL alternative: pg_dump -U inventory -d inventory > backup.sql
  ```
- Restore (into existing empty/target DB):
  ```bash
  # stop API; ensure target DB exists
  docker compose exec -T postgres dropdb -U inventory --if-exists inventory
  docker compose exec -T postgres createdb -U inventory inventory
  docker compose exec -T postgres pg_restore -U inventory -d inventory --clean --if-exists < backups/<chosen>.dump
  # start API
  ```
- Volume: named volume `pgdata` (see `docker-compose.yml`). For disaster recovery, prefer logical backups (`pg_dump`) over raw volume copies.

## Upgrade runbook

1. **Prepare**
   - Take a backup (SQLite copy / `pg_dump`) and note current commit (`git rev-parse --short HEAD`) and `DATABASE_URL`/deployment.
   - Ensure Postgres container is healthy if used: `docker compose ps`.
2. **Apply**
   - Fetch/update code, then:
     ```bash
     export PATH=$HOME/opencode/.toolchains/node22/bin:$PATH
     pnpm install --frozen-lockfile
     pnpm -C packages/db build   # keeps dist in sync; API also consumes workspace src via tsx in dev
     pnpm -r run lint && pnpm -r run typecheck && pnpm -r run test  # include TEST_POSTGRES_URL for parity
     ```
   - Start/restart API; migrations run automatically on boot (and are idempotent via Drizzle journal). Verify `GET /api/health` returns `{ "status": "ok" }`.
3. **Verify**
   - Smoke test: login-less UI loads, search/items/projects/reports/scan/labels basic flows, create/move/allocation as applicable.
   - Check logs for migration or startup errors.
4. **Rollback**
   - Stop API, restore DB backup, checkout previous commit, reinstall/build as needed, restart API. (Migrations are forward-only; rollback relies on DB restore + matching app version.)

## Camera / HTTPS note (for barcode scanning on phones)

Phone camera access requires a secure context (HTTPS) except `localhost`. For LAN use, serve behind a TLS reverse proxy (e.g. Caddy) with a trusted/self-signed cert installed on the device, or use an SSH tunnel to localhost. The `/scan` page and labels work over plain HTTP on localhost during development.
