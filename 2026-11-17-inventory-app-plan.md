# Inventory App — Plan

Date: 2026-11-17
Status: M0–M8 complete (2026-11-18); M9 tests/CI/Playwright pending

## 1. Goals

Build an inventory management system for mixed item types (electronic
components, electrical wire, tools, fasteners, etc.) with:

- **Category-driven records** — each category defines its own custom fields
  (e.g. resistance value/tolerance for resistors, gauge/length for wire).
- **A Svelte PWA front end** that can:
  - search and browse items,
  - produce inventory reports,
  - set parts aside (allocate) for specific projects,
  - scan barcodes / QR codes with a phone camera.
- **Storage flexibility** — the same application runs against either
  **SQLite** (single machine, zero config) or **PostgreSQL** (shared/production).

Non-goals for v1: multi-tenant support, user accounts/auth (single-operator or
trusted LAN use), purchasing/orders, multi-location warehouses.

## 2. Key decisions

| Decision           | Choice                                               | Rationale                                                                                                                                     |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend            | Node.js 22 + TypeScript + Fastify                    | One language across the stack, small and fast, easy to deploy on the DGX Spark (Arm64).                                                       |
| ORM / SQL layer    | Drizzle ORM                                          | First-class support for both SQLite (better-sqlite3) and Postgres (postgres.js) from one schema definition; SQL migrations; no runtime magic. |
| JSON custom fields | `jsonb` (Postgres) / `text` + JSON1 (SQLite)         | Matches the requested record shape; indexable per category.                                                                                   |
| Front end          | SvelteKit + Svelte 5, `vite-plugin-pwa`              | Modern Svelte, first-class PWA tooling (service worker, manifest, offline caching).                                                           |
| Barcode scanning   | Barcode Detection API with `@zxing/browser` fallback | Native API is fast/accurate where available; ZXing covers Code 128, Code 39, EAN, QR, DataMatrix everywhere else.                             |
| Label generation   | `bwip-js` on the server (PNG/SVG)                    | One place to define symbologies; printable label pages in the PWA.                                                                            |
| Validation         | Zod                                                  | Shared schema definitions for API and PWA form generation.                                                                                    |

## 3. Data model

Core record shape per requirement: **SKU as primary key, quantity on hand,
JSON blob of custom fields.**

### 3.1 `categories`

| Column                      | Type                 | Notes                                     |
| --------------------------- | -------------------- | ----------------------------------------- |
| `id`                        | TEXT PK              | UUID                                      |
| `name`                      | TEXT NOT NULL UNIQUE | e.g. "Resistors"                          |
| `description`               | TEXT                 |                                           |
| `field_schema`              | JSON NOT NULL        | Ordered list of field definitions (below) |
| `created_at` / `updated_at` | TIMESTAMPTZ          |                                           |

**Field schema entry** (Zod-validated):

```json
{
	"key": "value",
	"label": "Resistance value",
	"type": "string | number | integer | boolean | select | date | currency",
	"required": false,
	"options": ["5%", "1%", "0.1%"], // for select
	"unit": "Ω", // display unit for numbers
	"min": 0,
	"max": null,
	"searchable": true // include in search index
}
```

### 3.2 `items`

| Column                      | Type                             | Notes                                                  |
| --------------------------- | -------------------------------- | ------------------------------------------------------ |
| `sku`                       | TEXT PK                          | Human-meaningful, e.g. `RES-10K-5%`, `WI-24AWG-BLK`    |
| `category_id`               | TEXT FK → categories.id          | NOT NULL                                               |
| `name`                      | TEXT NOT NULL                    | Short display name                                     |
| `description`               | TEXT                             | Free text                                              |
| `unit`                      | TEXT                             | `pc`, `roll`, `m` — drives how quantity is interpreted |
| `quantity_on_hand`          | NUMERIC(18,3) NOT NULL DEFAULT 0 | Numeric so continuous quantities (wire in meters) work |
| `unit_cost`                 | NUMERIC(12,4)                    | Optional, currency                                     |
| `location`                  | TEXT                             | Shelf / bin, e.g. `A3-12`                              |
| `data`                      | JSON                             | Custom fields per the category's field schema          |
| `created_at` / `updated_at` | TIMESTAMPTZ                      |                                                        |

Indexes: `category_id`, `location`, plus FTS/trigram search (see §4.3).
The SKU itself is the scannable barcode/QR value — no separate barcode
column is needed in v1.

### 3.3 `projects`

| Column                      | Type          | Notes                |
| --------------------------- | ------------- | -------------------- |
| `id`                        | TEXT PK       | UUID                 |
| `name`                      | TEXT NOT NULL |                      |
| `description`               | TEXT          |                      |
| `status`                    | TEXT          | `active` \| `closed` |
| `created_at` / `updated_at` | TIMESTAMPTZ   |                      |

### 3.4 `allocations` — parts set aside for a project

| Column        | Type                               | Notes               |
| ------------- | ---------------------------------- | ------------------- |
| `id`          | TEXT PK                            | UUID                |
| `project_id`  | TEXT FK                            | NOT NULL            |
| `sku`         | TEXT FK → items.sku                | NOT NULL            |
| `quantity`    | NUMERIC(18,3) NOT NULL CHECK (> 0) |                     |
| `note`        | TEXT                               |                     |
| `reserved_at` | TIMESTAMPTZ                        | NOT NULL            |
| `released_at` | TIMESTAMPTZ                        | NULL while reserved |

**Quantity semantics:** `available(sku) = quantity_on_hand −
SUM(active allocations.quantity)`. Reserving never mutates
`quantity_on_hand`; only actual use/consumption does.

### 3.5 `movements` — append-only audit log

Every quantity change is a row here; `quantity_on_hand` is the running sum.

| Column          | Type                   | Notes                                                                       |
| --------------- | ---------------------- | --------------------------------------------------------------------------- |
| `id`            | INTEGER PK             | AUTOINCREMENT / BIGSERIAL                                                   |
| `sku`           | TEXT NOT NULL          |                                                                             |
| `delta`         | NUMERIC(18,3) NOT NULL | Signed                                                                      |
| `resulting_qty` | NUMERIC(18,3) NOT NULL | Denormalized for easy history display                                       |
| `reason`        | TEXT                   | `received` \| `used` \| `reserved` \| `released` \| `adjusted` \| `counted` |
| `project_id`    | TEXT FK                | NULL-able                                                                   |
| `reference`     | TEXT                   | Free text (purchase order, project note)                                    |
| `created_at`    | TIMESTAMPTZ            |                                                                             |

This makes reports and stock audits possible and gives the PWA an item
history view.

### 3.6 Seed categories

Ship sensible defaults with field schemas (admin can edit later):

- **Resistors** — value, tolerance (select), power rating (select), package (select), voltage rating
- **Capacitors** — capacitance, type (select: ceramic/electrolytic/tantalum/film), voltage rating, tolerance, ESR, package
- **Inductors / Coils** — inductance, DCR, saturation current, package
- **Diodes / Semiconductors** — part number, type (select), max current, max voltage, package
- **ICs** — part number, manufacturer, package, function, datasheet URL
- **Wire & Cable** — gauge/size, conductor material, insulation, voltage rating, color, meters per roll (unit = `m`)
- **Connectors** — type (select: header/receptacle/terminal), pitch (mm), pin count, gender, mounting
- **Fasteners** — size, thread pitch, material, standard (select), head type
- **PCBs** — dimensions, layer count, thickness, surface finish
- **Tools** — brand, model, category (select), condition (select), calibration due date

## 4. Dual-database support (SQLite + Postgres)

### 4.1 Strategy

- One Drizzle schema in `packages/db`; driver selected at boot from
  `DATABASE_URL`:
  - `file:./data/inventory.db` → SQLite (better-sqlite3)
  - `postgres://user:pass@host:5432/inventory` → PostgreSQL
- Repository functions (not raw SQL) are the only place dialect matters;
  all of it is contained in `packages/db/repositories/*`.
- Migrations: one set of SQL migration files per dialect, generated from the
  same Drizzle schema. `npm run migrate` picks the right set. Schema is
  intentionally dialect-stable (no exotic types beyond JSON).

### 4.2 JSON handling

- Postgres: `data jsonb` — filter with `data @> '{...}'::jsonb`.
- SQLite: `data text` — validate JSON in the app layer; query with
  `json_extract(data, '$.value')`.
- Field-schema `type` determines app-side validation for both engines, so a
  malformed field is impossible regardless of backend.

### 4.3 Search

- `name`, `description`, `sku`: SQLite **FTS5** virtual table (trigram-ish
  prefix + substring match) vs Postgres `pg_trgm` GIN index. Same API:
  `GET /api/items?q=...` returns ranked results.
- Search also scans a configurable subset of JSON fields
  (`searchable: true` in the field schema) via `jsonb_path_exists` /
  `json_each` so e.g. `q=10k` finds a resistor by value without the name
  containing it.
- Filters: `category`, `location`, `minQty`, `searchable` custom fields as
  key=value query params.

## 5. API (REST, JSON)

```
GET    /api/health
# Items
GET    /api/items?search=&category=&location=&minQty=&field[key]=value&sort=&page=
GET    /api/items/:sku
POST   /api/items                    (validates data against category field schema)
PATCH  /api/items/:sku
DELETE /api/items/:sku               (only when qty = 0 and no active allocations)
POST   /api/items/:sku/move          {delta, reason, projectId?, reference?}
# Categories
GET    /api/categories
POST   /api/categories
PATCH  /api/categories/:id           (field schema evolution rules below)
# Projects
GET/POST /api/projects
PATCH  /api/projects/:id
GET    /api/projects/:id             (includes active allocations + totals)
# Allocations
POST   /api/allocations              {projectId, sku, quantity, note?}   → 409 if insufficient available
PATCH  /api/allocations/:id          (release or edit quantity)
# Reports
GET    /api/reports/summary?category=&groupBy=category|location
GET    /api/reports/low-stock?threshold=
GET    /api/reports/movements?sku=&from=&to=
GET    /api/reports/projects?status=active
GET    /api/reports/export.csv?report=summary|movements
# Labels
GET    /api/items/:sku/label?format=png|svg&size=code128|qr
GET    /api/labels/print?sku=...&sku=...&layout=a5|4x6
```

Transaction rule: `move` and `allocation` writes are always atomic
(quantity check + movement row insert + on-hand update in one transaction).

**Field-schema evolution:** adding a field is always allowed; changing a
field's type or removing one is allowed but flagged — existing `data` blobs
keep old values, and the PWA hides fields not in the current schema.

## 6. PWA front end (Svelte)

### 6.1 Stack

- SvelteKit (Svelte 5), `@sveltejs/adapter-node` behind the Fastify server
  (single deployable) — or `adapter-static` + any static host for the PWA.
- `vite-plugin-pwa` (Workbox) for service worker, manifest, icons.
- Tailwind CSS v4 for styling.
- TanStack Query (Svelte) for data fetching/caching; Svelte stores for small
  UI state.

Deviation notes (implemented 2026-11-18, M3):

- `bits-ui` is headless/unstyled (melt-style primitives, no default CSS), so
  M3 uses plain Tailwind-styled native controls instead; revisit if custom
  widgets (e.g. virtualized lists) become needed.
- `vite-plugin-pwa` deferred to a later polish milestone; the app is fully
  functional without the service worker.
- `@tanstack/svelte-query` v6 API (`createQuery`/`createMutation` +
  `QueryClientProvider`), not the older `useQuery`/`QueryClientContext` API.
- Shared Zod field-schema types imported from `packages/db` → the item form
  is **generated from the category's field schema** (no per-category code).

### 6.2 Pages

| Route           | Purpose                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`             | Dashboard: totals, low-stock alerts, recent movements                                                                                          |
| `/items`        | Search + filter list (debounced search, category/location filters, pagination)                                                                 |
| `/items/:sku`   | Item detail: display generated custom fields, qty on hand / available / reserved, full movement history, label button, move & allocate actions |
| `/items/new`    | Create item: pick category → generated form + SKU field                                                                                        |
| `/categories`   | Category manager: edit field schemas (admin)                                                                                                   |
| `/projects`     | Project list with allocation totals                                                                                                            |
| `/projects/:id` | Project detail: set parts aside (item picker + qty), release, history                                                                          |
| `/reports`      | Summary by category/location, low stock, movements, projects; CSV export; print-friendly layout                                                |
| `/scan`         | Full-screen camera scan (below)                                                                                                                |
| `/labels`       | Batch label preview & print                                                                                                                    |

### 6.3 Barcode / QR scanning

- Camera via `getUserMedia`; try `BarcodeDetector` (Chrome/Android, iOS 17+)
  first, fall back to `@zxing/browser` decode loop.
- Supported symbologies: Code 128, Code 39, EAN-13/UPC, ITF-14, QR, DataMatrix.
- On decode: normalize (trim) → `GET /api/items/:sku` → open item page,
  continuous scanning mode with vibration/audio feedback on match; unknown
  codes offer "create item with this SKU".
- Requirements: HTTPS in production (camera API). Serve via a reverse proxy
  (Caddy) with a valid cert, or `localhost`/LAN self-signed with a documented
  install step.
- Labels: SKU rendered as Code 128 + QR (QR holds the same SKU for
  cross-checking) plus name, qty, location. Server renders via `bwip-js`;
  `/labels` lays them out on A5 / 4×6 printable sheets.

### 6.4 Offline & install

- Installable PWA (manifest, 192/512 icons, splash).
- Workbox `stale-while-revalidate` for item/category reads — recently used
  items remain viewable offline on the phone.
- Writes require connectivity in v1; a queued-write sync layer is a
  post-v1 stretch goal.

## 7. Repository layout

```
Inventory/
├── package.json                 # pnpm workspace root
├── pnpm-workspace.yaml
├── packages/
│   └── db/                      # schema, migrations (sqlite/ + postgres/),
│                                # repositories, field-schema validation
├── apps/
│   ├── api/                     # Fastify server, routes, label generation
│   └── web/                     # SvelteKit PWA
├── docker-compose.yml           # postgres:16 for local Postgres dev
└── docs/
```

Env: `DATABASE_URL`, `PORT`, `CORS_ORIGIN`, `DATA_DIR` (SQLite file dir).

## 8. Testing strategy

- **Unit (Vitest):** field-schema validation, quantity/availability math,
  Zod API schemas.
- **Integration (Vitest + Fastify inject):** the same API test suite runs
  against **both** backends — SQLite (temp file) and Postgres
  (via `docker compose` service container). This is the parity guarantee
  for the dual-DB requirement; added to CI.
- **E2E (Playwright):** search → item detail → move quantity → allocation
  flow; scan page with a mocked camera (fed barcode frames).
- **Lint/typecheck:** ESLint + Prettier + `tsc --noEmit` across all
  packages; run in CI.

## 9. Milestones

| #   | Milestone              | Contents                                                                                                           | Exit criteria                                   |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| M0  | Scaffolding            | pnpm workspace, Fastify hello, SvelteKit hello, CI (lint+typecheck+test), docker-compose postgres                  | Both apps run; CI green                         |
| M1  | Data layer             | Drizzle schema, migrations for SQLite + Postgres, seed categories, repositories, dual-DB integration test skeleton | Migrations apply cleanly on both engines        |
| M2  | Items API              | Item CRUD, `move`, search (FTS5 / pg_trgm), custom-field validation                                                | API tests pass on both engines                  |
| M3  | PWA core               | Search list, item detail, generated forms, category manager                                                        | Full item lifecycle usable in browser           |
| M4  | Projects & allocations | Project CRUD, set-aside/release, available-qty enforcement, history tabs                                           | Allocation invariants hold under concurrent use |
| M5  | Reports                | Summary, low stock, movements, project reports, CSV export, print layout                                           | Reports verifiable vs seeded data               |
| M6  | Barcodes               | Scan page (native + ZXing), label generation, print sheets                                                         | Scan→item works on a real phone over HTTPS      |
| M7  | Postgres hardening     | Parity test run, index tuning, backup/restore docs, upgrade runbook                                                | Same suite green on Postgres; documented ops    |
| M8  | PWA polish             | Offline reads, install UX, icon/splash pass, real-device pass, README                                              | Installable on phone; usable offline for reads  |

Estimated order of magnitude: M0–M2 are the foundation (~1–2 weeks of
focused work each), M3–M6 roughly parallelizable, M7–M8 polish.

## 10. Risks & mitigations

| Risk                                                          | Mitigation                                                                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON fields make querying/reporting slow or dialect-divergent | Restrict reportable fields to typed columns (qty, cost, category, location); JSON used only for display + filtered search via documented functions; per-dialect tests. |
| Camera API needs HTTPS on LAN                                 | Ship Caddy reverse-proxy config + cert issuance in docs (M6).                                                                                                          |
| Schema drift between SQLite and Postgres                      | Single Drizzle schema; both migration sets generated together; CI runs both.                                                                                           |
| SKU collisions / bad data entry                               | SKU pattern validation (e.g. `^[A-Z0-9][A-Z0-9\-]{2,31}$`), uniqueness enforced by PK, scan-create flow double-checks against existing items.                          |
| Field-schema edits break old data                             | Values kept as-is, unknown fields hidden, type changes flagged in admin UI.                                                                                            |

## 11. Open questions — ANSWERED 2026-11-18 (before M1)

1. **Currency/tax** — single currency, **USD**. No tax handling in v1;
   `unit_cost` is a plain USD amount.
2. **Per-package qty** — **not needed**. On-hand qty + `unit` is sufficient.
3. **Deployment target** — **single operator on this DGX Spark** (Arm64,
   Node 22 + pnpm, Docker available). No auth in v1. SQLite is the default
   backend; Postgres is the shared/production option, kept first-class.
4. **Label printer** — **generic printer via browser print**. No direct
   thermal-label integration.
5. **Category nesting** — **flat list** for v1.
