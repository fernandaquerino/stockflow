# StockFlow – Verification Report

Everything below was executed in this repository's build environment on 2026-11-08. Nothing is
claimed that was not run. Legend: ✅ passed · ❌ failed (see notes) · ⏭️ skipped · ❓ unverified.

**Environment:** Linux (4 CPUs), Node.js v22.23.4, npm 10.9.9, NestJS 11.2.x, Prisma 6.19.3,
TypeScript 5.9.x, Jest 29.7, SQLite (file database through Prisma).

## 1. Clean-room run (README setup from scratch)

The project was copied _without_ `node_modules`, `dist`, any `*.db` file and `.env`, and the commands
from the README were run in order in that copy (final run, after all fixes in section 5):

| Step                                               | Result | Notes                                                                                           |
| -------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `npm install` (runs `prisma generate` postinstall) | ✅     | Prisma Client 6.19.3 generated                                                                  |
| `cp .env.example .env`                             | ✅     |                                                                                                 |
| `npm run db` (migrate deploy + seed)               | ✅     | 1 migration (with CHECK constraints) applied; 6 products, 10 SKUs, 4 customers, 4 orders seeded |
| `npm run db` again                                 | ✅     | Seed skipped: "Database already contains data"                                                  |
| `npm run lint`                                     | ✅     | 0 errors, 0 warnings                                                                            |
| `npm run format:check`                             | ✅     |                                                                                                 |
| `npm run typecheck`                                | ✅     | strict mode                                                                                     |
| `npm run test:unit`                                | ✅     | 12 suites, **76 tests** passed                                                                  |
| `npm run test:integration`                         | ✅     | 7 suites, **109 tests** passed                                                                  |
| `npm test`                                         | ✅     | 19 suites, **185 tests** passed                                                                 |
| `npm run build`                                    | ✅     | `dist/main.js` produced                                                                         |

Additional checks:

- ✅ **Stability:** the integration suite (including the concurrency tests) was run 5 times in a row
  on the final code – 109/109 passed every time.
- ✅ **Coverage** (`npm run test:cov`): **99.2 % statements, 91.8 % branches, 100 % functions**
  (DTOs, modules, `main.ts` excluded). Uncovered: the "database unreachable" branch of `/health`, two
  defensive branches of the exception filter, and two defensive branches of `OrdersRepository`
  (the "invariant violated during release" guard and a non-shortage rollback path).
- ✅ **No migration drift:** `prisma migrate diff --from-migrations … --to-schema-datamodel …` reports
  "No difference detected" even though the migration was hand-edited to add CHECK constraints;
  `prisma migrate status`: "Database schema is up to date!".
- ✅ **Seed consistency:** after seeding, a script compared every SKU's `onHand`/`reserved` with
  `Σ movements` and `Σ ACTIVE reservations` – all 10 SKUs consistent (the seeded rows also satisfy
  the migration's CHECK constraints, otherwise the seed would have failed).

## 2. What the automated tests cover

| Area                      | Where                                                                                                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input validation          | all `test/*.e2e-spec.ts`: 400s with field paths (`items[0].quantity`), float/negative/string quantities and prices, unknown properties, explicit `null`s, malformed ids/JSON, pagination bounds; unit specs for env + pipes                                                             |
| Successful CRUD / flows   | products, SKUs, customers, receive → adjust → order → cancel                                                                                                                                                                                                                            |
| Domain invariants         | `docs/INVARIANTS.md` I1–I15: no overselling, all-or-nothing orders, release exactly once, adjustment cannot go below reserved, reason/direction rules, price snapshots, inactive SKU/product not orderable, totals cap                                                                  |
| Invalid state / not found | cancel twice (409), unknown product/SKU/order/customer (404), inactive product (422), unknown SKU codes (404 with list)                                                                                                                                                                 |
| Persistence               | `persistence.e2e-spec.ts`: restart keeps stock/orders/reservations; **CHECK constraints** reject `reserved > onHand`, negative stock, inconsistent line totals, negative prices when the API is bypassed; FK and unique constraints; money/quantities stored as SQLite `integer`        |
| Concurrency               | `concurrency.e2e-spec.ts`: 40 racing orders for 7 units → exactly 7 × 201 / 33 × 409 / 0 × 5xx; multi-line orders in opposite SKU order; 15 racing cancels of one order release once; adjustments racing with orders; reads during writes                                               |
| Ledger/invariant checker  | `test/helpers/invariants.ts` runs after **every** inventory, orders and concurrency test: `0 ≤ reserved ≤ onHand`, `onHand = Σ onHandDelta`, `reserved = Σ reservedDelta = Σ ACTIVE reservations`, running balances of each movement, order totals, reservation status vs. order status |
| Money                     | `order-calculator.spec.ts` (integer cents, drift example, cap), order e2e tests (3 × 2495 + 12 × 1650 = 27285), price snapshot unaffected by later price change                                                                                                                         |
| Error handling            | uniform error shape, unknown route, malformed JSON, Prisma-error mapping, no leakage of 500 details                                                                                                                                                                                     |
| Pagination / sorting      | totals, `totalPages`, `inStock` column-to-column filter, date ranges (inclusive), deterministic tie-breaking                                                                                                                                                                            |
| Test-DB isolation         | `test/global-setup.ts` recreates `prisma/test.db` from the committed migrations; `prisma/dev.db` untouched                                                                                                                                                                              |

## 3. Manual smoke test against the running API

Built (`npm run build`), started with `npm start` on port 3001 against the seeded `dev.db`:

| Request                                                        | Observed                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /health`                                                  | ✅ 200 `{"status":"ok","database":"up",…}`                                                      |
| `GET /products?q=beans`                                        | ✅ 1 product with `skuCount` 3                                                                  |
| `GET /inventory?inStock=false`                                 | ✅ `GRIND-PRO-01`: onHand 5, reserved 5, available 0                                            |
| `POST /products`, `POST /products/:id/skus` (code `mug-smoke`) | ✅ 201; code normalised to `MUG-SMOKE`                                                          |
| `POST /inventory/:skuId/receive` (10)                          | ✅ 201, `RECEIPT` movement                                                                      |
| `POST /inventory/:skuId/adjust` `DAMAGED` with `+2`            | ✅ 422 `ADJUSTMENT_REASON_MISMATCH`                                                             |
| `POST /inventory/:skuId/adjust` `DAMAGED` with `-1`            | ✅ 201                                                                                          |
| `POST /orders` 4 × 1299                                        | ✅ 201 `ORD-000005`, `RESERVED`, total **5196**, availability 9 / 4 / 5                         |
| `POST /orders` asking for 6 with 5 available                   | ✅ 409 `INSUFFICIENT_STOCK`, `shortages: [{requested 6, available 5}]`; stock unchanged (9/4/5) |
| `POST /orders/:id/cancel`                                      | ✅ `CANCELLED`, reservation `RELEASED`, availability back to 9                                  |
| `POST /orders/:id/cancel` again                                | ✅ 409 `ORDER_ALREADY_CANCELLED`                                                                |
| `GET /inventory/:skuId/movements?sortOrder=asc`                | ✅ RECEIPT 10 → ADJUSTMENT −1 → RESERVATION +4 → RELEASE −4 with correct balances               |
| `GET /orders?status=RESERVED&sortBy=totalCents&sortOrder=desc` | ✅ sorted, correct `meta`                                                                       |
| `GET /orders/999`; `POST …/receive` with `"quantity":"x"`      | ✅ 404; 400                                                                                     |
| `GET /docs`, `GET /docs-json`                                  | ✅ 200; 16 documented paths                                                                     |
| **20 concurrent orders of 1 unit with 9 units available**      | ✅ 9 × 201, 11 × 409; final onHand 9 / reserved 9 / available 0                                 |
| **40 concurrent orders of 1 unit with 3 units available**      | ✅ 3 × 201, 37 × 409 in 0.16 s (run while fixing, see section 5 #1)                             |

The smoke tests wrote rows into `dev.db`; it was restored with `npm run db:seed:reset`.

## 4. Other scripts

| Script                  | Result | Notes                                                                                                                                                                                                                |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:generate`   | ✅     | Also runs implicitly through `postinstall`                                                                                                                                                                           |
| `npm run db:seed:reset` | ✅     | Argument pass-through works (`prisma db seed -- --reset`); ids restart at 1                                                                                                                                          |
| `npm run db:migrate`    | ⚠️     | The equivalent `prisma migrate dev --name init --create-only` created the migration, which was then hand-edited and applied with `migrate deploy`; the npm alias itself was not re-run                               |
| `npm run lint:fix`      | ✅     | Exit code 0, no changes needed                                                                                                                                                                                       |
| `npm run db:reset`      | ⏭️     | **Skipped on purpose.** Prisma's safeguard blocks `migrate reset` when it detects an AI agent and demands explicit user consent; it is destructive, so it was not forced (the same block was observed in QueueDesk). |
| `npm run db:studio`     | ⏭️     | Interactive GUI, not run                                                                                                                                                                                             |

## 5. Failures and defects found while building (all fixed)

1. **Concurrency defect (found by manual probing before the tests existed):** with the default Prisma
   pool, 20 simultaneous order requests for 7 available units returned **4 × 201 and 16 × 500**
   (`PrismaClientKnownRequestError: Socket timeout`, P1008, after 5 s each). Stock stayed consistent
   (reserved = 9 = 5 + 4 created orders) – the invariants held, but requests failed. Cause: several
   pooled SQLite connections contend for the single write lock. Fix: `PrismaService` forces
   `connection_limit=1` (writers queue in-process). Afterwards 40 simultaneous orders gave exactly
   the available number of successes and the rest 409 in 0.16 s.
   **Mutation check:** with the fix removed, `concurrency.e2e-spec.ts` failed **5 of 5 tests in 4 of 4
   runs**; with the fix it passed in 5 of 5 consecutive full-suite runs. `prisma.service.spec.ts` also
   asserts the pool configuration deterministically.
2. **Explicit-`null` validation hole** (originally found in QueueDesk, where it caused 500s):
   StockFlow was built with `@IsOptionalNotNull()` from the start; tests send `null` for optional and
   non-nullable fields and expect 400 (`null phone`, `null description`, `null reference`,
   `priceCents: null`, `reason: null`, `name: null`, `active: null`).
3. Scaffold mistake: copying shared files with `--exclude=prisma` also dropped `src/prisma/`; the
   TypeScript compile failed immediately and the folder was restored.
4. `ListInventoryQueryDto` first used `declare sortOrder` (decorators are not allowed on `declare`
   fields, and it would not have applied the default); replaced with `override sortOrder = 'asc'`.
5. First integration run: several order tests failed because the `getInventory` test helper returned the
   full inventory view and `toEqual` compared extra identifying fields. This was a test-helper
   problem, not an API defect; the helper now returns only the three quantities.
6. A smoke-test script used stale customer ids after several seed resets; the seed now clears
   `sqlite_sequence` so ids restart at 1 after `db:seed:reset`. (Not an API defect.)
7. A hacky helper class for the "unknown SKU codes" error was replaced by a plain `AppException`
   during development, before the first test run.

## 6. Not verified / known gaps

- ❓ `/health` returning 503 when the database is down (code path exists, never executed).
- ❓ Mutation test of the atomic `WHERE` guards themselves (e.g. deleting the availability condition
  from `reserve`) was **not** performed; only the connection-limit mutation was. The CHECK
  constraints would turn such a bug into an error rather than silent overselling, which is covered by
  the persistence tests, but the combination was not mutation-tested.
- ❓ Swagger UI rendering in a browser (only HTTP 200 and the JSON document were checked).
- ❓ Behaviour on Windows/macOS, other Node versions, or a read-only filesystem.
- ❓ Sustained load or large data volumes (tests use dozens of concurrent requests and small data); `npm audit` was not run.
- ❓ A future migration that makes Prisma redefine a table (which would drop the hand-written CHECKs)
  was not exercised – the risk is documented in `docs/INVARIANTS.md`.
- Not implemented by design (see `BACKLOG.md`): fulfilment/shipments, reservation expiry, returns,
  multi-location, idempotency keys, alerts, reporting.
