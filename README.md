# Inventory

Single-user electronics component inventory and project allocation tracker for DGX Spark / Linux. Monorepo: SvelteKit PWA + Fastify API + shared TypeScript/Drizzle DB package.

## What it does

- **Items**: SKU, name, description, category, location, unit/cost, quantity, min-stock, barcode, timestamps; search and filters.
- **Stock moves**: receive/issue/adjust with reason, reference, project; immutable movement history.
- **Projects/allocations**: reserve, partial release, return to stock with quantity invariants and Postgres row locks.
- **Reports**: summary, low stock, movements, project allocations; CSV export; print layout.
- **Labels/scan**: Code128/QR labels (PNG/SVG), batch print, camera scan with BarcodeDetector + ZXing fallback.

## Stack

- Node 22 + pnpm workspaces, TypeScript strict
- Web: SvelteKit + Vite + Tailwind + TanStack Query
- API: Fastify + Zod
- DB: Drizzle ORM, SQLite default, Postgres first-class (`DATABASE_URL` selects engine)

## Quick start

```bash
cd ~/opencode/Inventory
export PATH=$HOME/opencode/.toolchains/node22/bin:$PATH   # DGX Spark toolchain
pnpm install
pnpm dev
```

- Web: http://localhost:5173 (Vite proxies `/api` to API)
- API: http://localhost:3000
- Health: `GET /api/health`

The API auto-applies migrations and seeds default categories on startup. SQLite data defaults to `data/inventory.db`.

## Postgres

```bash
docker compose up -d postgres
export DATABASE_URL='postgres://inventory:inventory@localhost:5432/inventory'
pnpm -C apps/api dev
```

## Quality gates

```bash
export PATH=$HOME/opencode/.toolchains/node22/bin:$PATH
pnpm -r run lint
pnpm -r run typecheck
pnpm -r run test
# parity (requires reachable Postgres):
TEST_POSTGRES_URL='postgres://inventory:inventory@localhost:5432/postgres' pnpm -r run test
```

## PWA / offline

- Installable PWA with manifest and service worker (`apps/web/src/service-worker.ts`).
- App shell/static assets cached; API GETs use stale-while-revalidate for read-only offline browsing.
- **Writes require connectivity** (create/edit/move/allocate). The UI shows an offline banner.
- Camera scanning on phones requires HTTPS or localhost; use an SSH tunnel or TLS reverse proxy for LAN.

## Operations

See [`docs/operations.md`](docs/operations.md) for backup/restore, upgrade/migration, Postgres parity, and camera/HTTPS notes. Project plan: [`2026-11-17-inventory-app-plan.md`](2026-11-17-inventory-app-plan.md).
