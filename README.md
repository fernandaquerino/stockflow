# StockFlow

REST API for inventory and order management: products with SKUs, stock receipts and adjustments, an
append-only stock-movement ledger, customer orders that **reserve stock atomically**, and
cancellations that release it again.

**Stack:** Node.js 22 · NestJS 11 · TypeScript (strict) · Prisma 6 · SQLite · class-validator ·
Swagger/OpenAPI · Jest + Supertest · ESLint + Prettier. No Docker, no external services.

Money is **integer cents** (single currency, USD assumed) and quantities are integers – there is no
floating-point arithmetic anywhere. The consistency rules are documented in
[`docs/INVARIANTS.md`](./docs/INVARIANTS.md).

---

## Quick start

Prerequisites: Node.js 22 and npm. Nothing else (SQLite is a file, Prisma downloads its engines on
`npm install`).

```bash
cd stockflow
npm install                 # also runs `prisma generate`
cp .env.example .env
npm run db                  # applies migrations + seeds sample data (prisma/dev.db)
npm run dev                 # http://localhost:3001  (watch mode)
```

- Swagger UI: <http://localhost:3001/docs> (JSON: `/docs-json`)
- Health: <http://localhost:3001/health>

StockFlow listens on port **3001** by default so it can run next to QueueDesk (3000).

Production-style run:

```bash
npm run build
npm start                   # runs dist/main.js
```

A quick tour once it is running:

```bash
curl -s localhost:3001/inventory | head -c 600
curl -s -X POST localhost:3001/orders -H 'content-type: application/json' \
  -d '{"customerId":1,"items":[{"skuCode":"BEANS-ETH-250","quantity":2}]}'
```

(Customer ids after seeding are 1–4 on a fresh database; use `GET /customers` to look them up.)

## Scripts

| Command                     | What it does                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`               | Start the API in watch mode (`nest start --watch`)                                  |
| `npm run build`             | Compile to `dist/` (`nest build`)                                                   |
| `npm start`                 | Run the compiled app (`node dist/main.js`)                                          |
| `npm run lint`              | ESLint over `src`, `test`, `prisma` (`lint:fix` to auto-fix)                        |
| `npm run format`            | Prettier write (`format:check` to verify only)                                      |
| `npm run typecheck`         | `tsc --noEmit` over source, tests and seed                                          |
| `npm test` / `npm run test` | Unit **and** integration tests, run in band                                         |
| `npm run test:unit`         | Unit tests only (`src/**/*.spec.ts`, repositories mocked)                           |
| `npm run test:integration`  | Integration tests only (`test/**/*.e2e-spec.ts`, real SQLite file `prisma/test.db`) |
| `npm run test:cov`          | All tests with coverage                                                             |
| `npm run db`                | `db:deploy` + `db:seed` (apply migrations, seed if empty)                           |
| `npm run db:generate`       | `prisma generate`                                                                   |
| `npm run db:migrate`        | `prisma migrate dev` – create/apply a migration during development                  |
| `npm run db:deploy`         | `prisma migrate deploy` – apply committed migrations only                           |
| `npm run db:seed`           | Seed sample data **only if the database is empty**                                  |
| `npm run db:seed:reset`     | **Deletes all data in `dev.db`**, then seeds                                        |
| `npm run db:reset`          | `prisma migrate reset --force` – drop, re-migrate, re-seed (**destroys dev data**)  |
| `npm run db:studio`         | Open Prisma Studio                                                                  |

Configuration (`.env`, validated at startup – the app refuses to boot on invalid values):

| Variable       | Default         | Notes                                                              |
| -------------- | --------------- | ------------------------------------------------------------------ |
| `NODE_ENV`     | `development`   | `development` \| `test` \| `production`                            |
| `PORT`         | `3001`          | 1–65535                                                            |
| `DATABASE_URL` | `file:./dev.db` | SQLite file; relative paths resolve against `prisma/schema.prisma` |

> The app opens SQLite with `connection_limit=1` (added automatically) so concurrent writers queue
> instead of failing. Details in `docs/INVARIANTS.md`.

## Testing and database isolation

`npm test` never touches your development data:

- Integration tests force `DATABASE_URL=file:./test.db` (see `test/setup-env.ts`).
- `test/global-setup.ts` deletes `prisma/test.db`, then runs `prisma migrate deploy` against it, so
  the committed migrations – **including the hand-written CHECK constraints** – are exercised on
  every run.
- Every integration test file boots the real Nest application (all modules, pipes and filters) and
  drives it over HTTP; tables are emptied before each test.
- After each inventory/order test, `test/helpers/invariants.ts` re-derives the stock invariants from
  the database (ledger sums, reservations, order totals) and fails on any violation.
- `test/concurrency.e2e-spec.ts` fires dozens of simultaneous requests (orders, cancels,
  adjustments) and asserts no overselling and no 5xx.
- Integration tests share one SQLite file, hence `--runInBand`.

## API overview

All list endpoints return `{ "data": [...], "meta": { "page", "pageSize", "total", "totalPages" } }`
and accept `page` (default 1), `pageSize` (default 20, max 100), `sortBy` and `sortOrder`. Sorting
always uses the id as a tie-breaker, so pages are stable.

| Method & path                                             | Description                                                                                  | Success |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------- |
| `GET /health`                                             | API + database check                                                                         | 200     |
| `POST /products`                                          | Create product (`name`, `description?`, `category?`)                                         | 201     |
| `GET /products`                                           | List; `q` (name or SKU code), `category`, `active`; `sortBy=createdAt\|name\|id`             | 200     |
| `GET /products/:id`                                       | Product with SKUs and their stock availability                                               | 200     |
| `PATCH /products/:id`                                     | Update details / activate / deactivate                                                       | 200     |
| `POST /products/:productId/skus`                          | Add a SKU (`code`, `variantName?`, `priceCents`); creates its inventory row                  | 201     |
| `GET /products/:productId/skus`                           | SKUs of one product                                                                          | 200     |
| `GET /skus`                                               | All SKUs; `code`, `productId`, `active`; `sortBy=code\|priceCents\|createdAt\|id`            | 200     |
| `GET /skus/:id`                                           | One SKU with availability                                                                    | 200     |
| `PATCH /skus/:id`                                         | Change `priceCents`, `variantName`, `active` (the code is immutable)                         | 200     |
| `GET /inventory`                                          | Stock per SKU; `productId`, `skuCode`, `inStock`; `sortBy=skuCode\|quantityOnHand\|skuId`    | 200     |
| `GET /inventory/:skuId`                                   | `quantityOnHand`, `quantityReserved`, `quantityAvailable`                                    | 200     |
| `POST /inventory/:skuId/receive`                          | Receive stock (`quantity`, `reference?`, `note?`)                                            | 201     |
| `POST /inventory/:skuId/adjust`                           | Adjust stock (`quantityDelta`, `reason`, `note?`)                                            | 201     |
| `GET /inventory/:skuId/movements`                         | Movement history; `type`; newest first by default                                            | 200     |
| `POST /customers`, `GET /customers`, `GET /customers/:id` | Create / list (`search`) / read customers                                                    | 201/200 |
| `POST /orders`                                            | Place an order and reserve stock (`customerId`, `items[{skuCode, quantity}]`, `notes?`)      | 201     |
| `GET /orders`                                             | List; `status`, `customerId`, `createdFrom`, `createdTo`; `sortBy=createdAt\|totalCents\|id` | 200     |
| `GET /orders/:id`                                         | Order with lines, reservations and **current availability** per line                         | 200     |
| `POST /orders/:id/cancel`                                 | Cancel and release reserved stock (`reason?`)                                                | 200     |

Adjustment reasons: `COUNT_CORRECTION`, `DAMAGED`, `LOST`, `FOUND`, `OTHER` (`OTHER` requires a note;
`DAMAGED`/`LOST` need a negative delta, `FOUND` a positive one).

### Business rules (short version – full list in `docs/INVARIANTS.md`)

- Creating a SKU creates its inventory row with zero stock. SKU codes are upper-cased, unique and
  immutable. SKUs cannot be added to inactive products.
- `available = onHand − reserved`. Receipts raise `onHand`; adjustments change it by a signed amount
  but can never take it below what is reserved.
- An order reserves **every** line or **none**: if one line lacks stock the response is
  `409 INSUFFICIENT_STOCK` with the per-SKU shortages and nothing changes.
- Each SKU can appear once per order (1–50 lines, quantity 1–10,000 per line).
- Only active SKUs of active products can be ordered. The unit price is snapshotted at order time.
- Cancelling a `RESERVED` order releases its reservations exactly once; cancelling again is a 409.
- Every stock change writes a movement (`RECEIPT`, `ADJUSTMENT`, `RESERVATION`, `RELEASE`) with the
  resulting balances, in the same transaction.

### Errors

Same contract as QueueDesk – every error looks like:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "code": "INSUFFICIENT_STOCK",
  "message": "Not enough available stock for: GRIND-PRO-01",
  "details": { "shortages": [{ "skuCode": "GRIND-PRO-01", "requested": 3, "available": 0 }] },
  "path": "/orders",
  "timestamp": "2026-11-08T04:00:43.396Z"
}
```

| Status | Meaning                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | Invalid input (`VALIDATION_FAILED` with per-field `details`), malformed JSON/ids, duplicate SKU in an order                                              |
| 404    | Unknown resource (`ORDER_NOT_FOUND`, `SKU_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `CUSTOMER_NOT_FOUND`)                                                         |
| 409    | Conflicts with current state (`INSUFFICIENT_STOCK`, `INSUFFICIENT_AVAILABLE_STOCK`, `ORDER_ALREADY_CANCELLED`, `SKU_CODE_TAKEN`, `STOCK_LIMIT_EXCEEDED`) |
| 422    | Refers to an ineligible resource (`SKU_NOT_ORDERABLE`, `PRODUCT_INACTIVE`, `ADJUSTMENT_REASON_MISMATCH`, `ORDER_TOTAL_TOO_LARGE`)                        |
| 500    | Unexpected; logged server-side, details never leaked to the client                                                                                       |

## Project layout

```
docs/INVARIANTS.md       business invariants and how each is enforced and tested
prisma/
  schema.prisma          data model
  migrations/            committed SQL migrations (hand-edited: CHECK constraints)
  seed.ts                realistic sample data
src/
  main.ts, app.module.ts, app.setup.ts    bootstrap, wiring, shared HTTP setup, Swagger
  config/                environment validation (class-validator)
  prisma/                PrismaService (single-connection SQLite) / PrismaModule
  common/                exceptions, exception filter, pipes, pagination, DTO helpers
  health/                GET /health
  customers/ products/ skus/ inventory/ orders/
      *.controller.ts    HTTP only: routing, DTOs, status codes, Swagger metadata
      *.service.ts       business rules
      *.repository.ts    all Prisma access for the aggregate
      dto/               request validation
  inventory/inventory.repository.ts   the ONLY writer of InventoryItem (atomic conditional UPDATEs)
  orders/order-calculator.ts          pure integer money math
test/                    integration tests, helpers (factories, invariant checker), global setup
```

Dependency direction: controller → service → repository → Prisma. `OrdersRepository` calls
`InventoryRepository`'s transaction-scoped primitives so stock changes and order changes commit
together.

## Known limitations

- No authentication or authorisation.
- Orders can only be placed and cancelled – there is no fulfilment/shipping step, so on-hand stock is
  not yet reduced by sales (see `BACKLOG.md`: partial order fulfilment).
- Reservations do not expire; one warehouse only; single currency without tax or discounts.
- Order creation is not idempotent (a retried request creates a second order).
- Swagger documents request bodies/queries in detail; response bodies are described in prose only.
- SQLite serialises writes (the app queues them through one connection) – fine for a local project,
  not a scaling story.
- Prisma enums on SQLite are validated by the client, not by the database.
- If a future migration makes Prisma redefine a table, the hand-written CHECK constraints must be
  copied into it (see `docs/INVARIANTS.md`).

Planned work lives in [`BACKLOG.md`](./BACKLOG.md); the results of the last verification run are in
[`VERIFICATION.md`](./VERIFICATION.md).
