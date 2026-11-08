# StockFlow – Product & Engineering Backlog

None of the items below exist in the MVP. They are written against the code as it stands today
(`InventoryRepository` as the only stock writer, order placement/cancellation in
`OrdersRepository`, integer cents, SQLite with `connection_limit=1`, hand-written CHECK constraints).
Read [`docs/INVARIANTS.md`](./docs/INVARIANTS.md) before touching any of them: every item must keep
those invariants true and extend `test/helpers/invariants.ts` when it adds new ones.

Conventions for every item: add a Prisma migration (`npm run db:migrate -- --name <name>`; if Prisma
redefines a table, copy its CHECK constraints into the migration), update the seed when sample data
helps, add unit tests for rules and integration tests under `test/`, run
`assertInvariants` in the new integration tests, document endpoints with Swagger decorators and
update `README.md`.

| #   | Item                                           | Size | Depends on      |
| --- | ---------------------------------------------- | ---- | --------------- |
| 1   | Idempotent order creation                      | S    | –               |
| 2   | Partial order fulfilment (shipments)           | L    | –               |
| 3   | Reservation expiration                         | M    | –               |
| 4   | Product returns and restocking                 | M    | 2               |
| 5   | Low-stock alerts                               | M    | –               |
| 6   | Inventory reconciliation (cycle counts)        | M    | –               |
| 7   | Multi-location inventory                       | L    | 2 (recommended) |
| 8   | Sales and inventory reporting                  | M    | 2 (for sales)   |
| 9   | Order editing (change lines before fulfilment) | M    | –               |
| 10  | Pricing: price lists and discounts             | M    | –               |

---

## 1. Idempotent order creation

**Problem / user need.** A client that times out and retries `POST /orders` creates a second order and
reserves the stock twice. Integrations and flaky networks make this a matter of when, not if.

**Goal.** Make order creation safe to retry using an `Idempotency-Key` header.

**Scope.**

- In: `Idempotency-Key` header (8–128 chars) on `POST /orders` (optionally on receive/adjust too),
  a table storing key, request fingerprint (hash of the normalised body), response status and body,
  `createdAt`; replay returns the stored response with `Idempotent-Replay: true`.
- In: same key + different body → 422 `IDEMPOTENCY_KEY_REUSED`; same key while the first request is
  still running → 409 `IDEMPOTENCY_IN_PROGRESS`; keys expire after 24 h (cleanup method).
- Out: idempotency for every endpoint, distributed locks.

**Acceptance criteria.**

- Two sequential requests with the same key and body create exactly one order and reserve stock once; the second response is byte-identical apart from the replay header.
- 20 concurrent requests with the same key create exactly one order (unique constraint on the key decides the winner).
- A failed attempt (e.g. 409 insufficient stock) is **not** cached as final if the failure is transient; 4xx validation errors are cached.
- Requests without the header behave as today.

**Suggested files / modules.** new `src/idempotency/` (module, repository, interceptor or service),
`prisma/schema.prisma` (`IdempotencyKey` with `@@unique([key])`), `src/orders/orders.controller.ts`,
`test/orders.e2e-spec.ts` / new `test/idempotency.e2e-spec.ts`.

**How to verify.** Integration tests for replay, key reuse with a different body and the concurrent
case; check `GET /inventory/:skuId` shows a single reservation after retries.

**Dependencies.** None.

---

## 2. Partial order fulfilment (shipments)

**Problem / user need.** Today an order can only be reserved or cancelled. Warehouses ship what they
have, in several parcels, and stock only leaves the building when it is shipped – so on-hand is
currently never reduced by sales.

**Goal.** Fulfil orders line by line in shipments that consume reserved stock.

**Scope.**

- In: `Shipment` and `ShipmentItem` tables, `POST /orders/:id/shipments` with `items[{orderItemId, quantity}]`,
  order statuses `RESERVED → PARTIALLY_FULFILLED → FULFILLED` (plus existing `CANCELLED`),
  `OrderItem.quantityShipped`, `StockReservation.quantityFulfilled` (or reduce the reservation),
  a new movement type `FULFILLMENT` (`onHandDelta = −n`, `reservedDelta = −n`).
- In: cancelling a partially fulfilled order releases only the **unshipped** remainder.
- Out: carriers, tracking numbers, backorders.

**Acceptance criteria.**

- A shipment cannot exceed the unshipped quantity of a line (409 `SHIPMENT_EXCEEDS_ORDERED`) and is rejected for `CANCELLED`/`FULFILLED` orders.
- Shipping n units lowers `onHand` **and** `reserved` by n in one transaction with one movement; `available` is unchanged by shipping.
- Order status updates to `PARTIALLY_FULFILLED`/`FULFILLED` automatically.
- Invariants I1–I9 still hold; extend I5/I7: `reserved = Σ (reservation quantity − fulfilled)` for ACTIVE reservations.
- Concurrent shipments of the same line cannot over-ship.

**Suggested files / modules.** new `src/shipments/` (controller, service, repository),
`src/inventory/inventory.repository.ts` (new atomic primitive `fulfil`), `src/orders/orders.repository.ts`
(cancel releases remainder), `prisma/schema.prisma`, `test/helpers/invariants.ts`.

**How to verify.** Integration tests: ship 3 of 10, ship 7 more, try to ship 1 more (409), cancel a
partially shipped order and check released quantity; `assertInvariants` after each.

**Dependencies.** None; prerequisite for returns (4) and sales reporting (8).

---

## 3. Reservation expiration

**Problem / user need.** Orders that are never confirmed or picked up hold stock forever, making
sellable stock look unavailable.

**Goal.** Automatically release reservations of stale orders.

**Scope.**

- In: `Order.expiresAt` (default now + configurable `RESERVATION_TTL_HOURS`), `EXPIRED` order status,
  an `ExpirationService.releaseExpired(now)` method triggered by a scheduler (`@nestjs/schedule`) and
  callable on demand (`POST /admin/reservations/expire`), `RELEASE` movements with reason `ORDER_EXPIRED`.
- In: `PATCH /orders/:id/extend` to push the expiry (max N extensions).
- Out: per-customer TTLs, e-mail warnings.

**Acceptance criteria.**

- Orders past `expiresAt` in `RESERVED` become `EXPIRED`, their reservations are `RELEASED` and stock returns to available – exactly once, even if the job runs twice or concurrently.
- Cancelling an expired order → 409; extending an expired one → 409.
- The job processes in batches (e.g. 100) so a backlog never holds one huge transaction.
- All time logic uses an injectable `Clock`, tests never sleep.

**Suggested files / modules.** new `src/reservations/` (service, scheduler), shared `Clock` provider in
`src/common/`, `src/orders/orders.repository.ts` (reuse the cancel/release path),
`src/config/env.validation.ts`, `prisma/schema.prisma`.

**How to verify.** Unit tests with a fake clock; integration test: create order with TTL 1 h, advance
the clock 2 h, run `releaseExpired`, assert `EXPIRED`, availability restored, one `RELEASE` movement.

**Dependencies.** None. Shares the release code path with cancellation (refactor into one function).

---

## 4. Product returns and restocking

**Problem / user need.** Customers send goods back. Today there is no way to put returned stock back
on the shelf or to record damaged returns.

**Goal.** Record returns against shipped order lines and restock or write off the units.

**Scope.**

- In: `Return` / `ReturnItem` (orderItem, quantity, condition `RESELLABLE | DAMAGED`, reason),
  `POST /orders/:id/returns`, new movement type `RETURN` (resellable: `onHand +n`), damaged units
  recorded with `ADJUSTMENT`-style write-off movement (no on-hand increase).
- In: a return cannot exceed _shipped − already returned_ for the line.
- Out: refunds/payments, return shipping labels, RMA approval workflow.

**Acceptance criteria.**

- Returning 2 resellable units raises `onHand` by 2 with a `RETURN` movement referencing the return; damaged units do not change `onHand`.
- Over-returning → 409 `RETURN_EXCEEDS_SHIPPED`; returns on never-shipped lines → 409.
- Ledger invariants (I4) hold; order detail shows `quantityReturned` per line.

**Suggested files / modules.** new `src/returns/`, `src/inventory/inventory.repository.ts` (reuse
`increaseOnHand`), `prisma/schema.prisma`, `test/helpers/invariants.ts` (returned ≤ shipped).

**How to verify.** Integration test: ship, return partially, return the rest, try one more; check
inventory and movements; `assertInvariants`.

**Dependencies.** Item 2 (shipments define what can be returned).

---

## 5. Low-stock alerts

**Problem / user need.** Purchasing finds out about shortages when an order fails. They need early
warning per SKU.

**Goal.** Reorder points per SKU with alerts raised when available stock crosses them.

**Scope.**

- In: `Sku.reorderPoint` (nullable, ≥ 0) and `reorderQuantity`, `LowStockAlert` rows (open/resolved,
  `openedAt`, `resolvedAt`, `availableAtOpen`), alert creation inside the same transaction that
  lowered available stock (reserve, adjust, fulfil), automatic resolution on receipt,
  `GET /alerts/low-stock?status=OPEN`, `GET /inventory?lowStock=true`.
- Out: delivery channels (e-mail/Slack) – the alert row _is_ the notification for now.

**Acceptance criteria.**

- Crossing the reorder point downwards opens exactly one alert per SKU (never duplicates, even under concurrent orders – use a partial unique index or guarded insert).
- Receiving stock above the point resolves the open alert and records `resolvedAt`.
- SKUs without a reorder point never alert; changing the point re-evaluates immediately.

**Suggested files / modules.** new `src/alerts/`, hook into `InventoryRepository` primitives (return the
post-change levels, which already exist), `src/skus/*` (reorder fields), `prisma/schema.prisma`.

**How to verify.** Integration tests: set reorder point 10, order down to 9 → one open alert; two more
orders → still one; receive 50 → resolved. Concurrency test with many small orders.

**Dependencies.** None.

---

## 6. Inventory reconciliation (cycle counts)

**Problem / user need.** Physical counts differ from the system. Staff need to record a count and have
the discrepancy corrected transparently instead of ad-hoc adjustments.

**Goal.** Count sessions that compare counted quantities with the system and post the differences.

**Scope.**

- In: `StockCount` (status `OPEN | APPLIED | CANCELLED`) with `StockCountLine` (sku, expected snapshot, counted), `POST /stock-counts`, `PUT /stock-counts/:id/lines`, `POST /stock-counts/:id/apply` which creates one `ADJUSTMENT` (reason `COUNT_CORRECTION`) per differing line.
- In: `GET /reports/ledger-consistency` that recomputes I4/I5 for all SKUs and lists mismatches (the logic of `test/helpers/invariants.ts` as production code).
- Out: barcode scanning, blind counts, multi-user counting.

**Acceptance criteria.**

- Applying a count whose expected snapshot is stale (stock moved since) → 409 `COUNT_STALE` listing the SKUs; the user can re-snapshot.
- Applying never takes `onHand` below `reserved` (lines that would are reported, nothing is partially applied).
- The consistency report returns an empty list on healthy data and flags a deliberately corrupted row in a test.

**Suggested files / modules.** new `src/stock-counts/`, new `src/reports/ledger-consistency.service.ts`
(extract from `test/helpers/invariants.ts`), `src/inventory/inventory.repository.ts` (reuse `adjustOnHand`).

**How to verify.** Integration tests for apply/stale/below-reserved; corrupt a row via Prisma in a
test and assert the report names it.

**Dependencies.** None.

---

## 7. Multi-location inventory

**Problem / user need.** Stock lives in several warehouses/bins. Availability, receiving and
reservations must be per location.

**Goal.** Track stock per location and reserve from specific locations.

**Scope.**

- In: `Location` model, `InventoryItem` keyed by `(skuId, locationId)` (migrate existing rows to a default location), `locationId` on movements and reservations, receive/adjust endpoints take a location, order reservation strategy "single location first, then split by priority".
- In: `GET /inventory/:skuId` returns totals plus a per-location breakdown.
- Out: transfers between locations (follow-up), bin-level tracking.

**Acceptance criteria.**

- Existing data is migrated to a default location without changing totals (migration test).
- An order never reserves more than any location's available stock; reservations record the location(s) used.
- Cancel releases from the same locations; ledger invariants hold per `(sku, location)`.
- CHECK constraints are recreated on the new table (`reserved ≤ onHand` per row).

**Suggested files / modules.** `prisma/schema.prisma` + hand-written migration (table rebuild),
`src/inventory/*` (all primitives take `locationId`), `src/orders/orders.repository.ts`,
new `src/locations/`, `test/helpers/invariants.ts` (per-location sums).

**How to verify.** Migration test on a seeded DB; integration tests with two locations where only the
combination can satisfy an order; concurrency tests per location.

**Dependencies.** Best after item 2 so fulfilment and returns are location-aware from day one.

---

## 8. Sales and inventory reporting

**Problem / user need.** Managers need to see what sells, what sits on the shelf and how stock moved,
without exporting the database.

**Goal.** Read-only reports built from orders, shipments and the movement ledger.

**Scope.**

- In: `GET /reports/sales?from&to&groupBy=day|sku|customer` (units, revenue in cents), `GET /reports/inventory-valuation` (onHand × current price, plus slow movers with no outbound movement for N days), `GET /reports/stock-movements.csv`.
- In: all money as integer cents; SQL aggregation (`groupBy`/`$queryRaw`), never loading everything in memory.
- Out: dashboards, scheduled e-mailed reports.

**Acceptance criteria.**

- Sales exclude cancelled orders and count shipped (or, until item 2 exists, reserved) quantities as documented.
- Totals equal the sum of the underlying orders (cross-check test against `/orders`), with no rounding errors.
- Date filters are inclusive/exclusive as documented and validated (`from > to` → 400); CSV escapes commas and quotes.

**Suggested files / modules.** new `src/reports/` (controller, service, repository), `src/common/csv.ts`.

**How to verify.** Seed deterministic orders with fixed timestamps, compare endpoint output with
hand-computed numbers; verify CSV with a tricky SKU variant name.

**Dependencies.** Item 2 for true sales numbers; usable earlier on reservations.

---

## 9. Order editing before fulfilment

**Problem / user need.** Customers change their mind about quantities or lines; cancelling and
re-ordering loses the original order and briefly exposes the stock.

**Goal.** Modify the lines of a `RESERVED` order atomically, adjusting reservations.

**Scope.**

- In: `PATCH /orders/:id/items` with a full replacement of lines (add, remove, change quantity), recalculated totals, reservation deltas applied as `RESERVATION`/`RELEASE` movements, `OrderRevision` history (who/what/when).
- In: unchanged lines keep their original price snapshot; new lines use the current price.
- Out: editing after any shipment, customer changes.

**Acceptance criteria.**

- Increasing a line reserves only the delta and fails with the usual `INSUFFICIENT_STOCK` shortages; decreasing releases the delta.
- The whole edit is atomic: a failure leaves lines, reservations and stock untouched.
- Editing a `CANCELLED`/`FULFILLED` order → 409; concurrent edits to one order are serialised (compare-and-set on an `Order.version`).

**Suggested files / modules.** `src/orders/orders.service.ts`, `src/orders/orders.repository.ts`
(`editOrder` using `reserve`/`release` primitives), `src/orders/order-calculator.ts` (diff of lines),
`prisma/schema.prisma` (`version`, `OrderRevision`).

**How to verify.** Unit tests for the line diff; integration tests for increase/decrease/remove/add and
the failure path, then `assertInvariants`.

**Dependencies.** None (becomes more complex after item 2 – restrict to unshipped orders).

---

## 10. Pricing: price lists and discounts

**Problem / user need.** Wholesale customers get different prices and promotions run for a limited
time, but today there is exactly one price per SKU.

**Goal.** Customer-specific price lists and simple percentage/fixed discounts, all in integer math.

**Scope.**

- In: `PriceList` (per customer or default) with per-SKU `priceCents` overrides and validity window, `Discount` (percentage in basis points or fixed cents, optional min quantity) applied per line, rounding rule documented (round half up to the cent, once per line), snapshot of list price, discount and net price on `OrderItem`.
- Out: coupons, tax, multi-currency.

**Acceptance criteria.**

- Price resolution order is documented and tested: customer price list → default price list → SKU price.
- Percentage discounts use basis points and integer arithmetic only; property-based test: `net ≤ list` and `net ≥ 0` for random inputs.
- `lineTotal = quantity × netUnitPrice` still holds (CHECK constraint updated); order total remains the sum of lines.

**Suggested files / modules.** new `src/pricing/` (pure `price-resolver.ts`, service),
`src/orders/order-calculator.ts`, `prisma/schema.prisma` + migration (update the `OrderItem` CHECK),
`src/orders/orders.service.ts`.

**How to verify.** Unit tests for the resolver and rounding edge cases (e.g. 333 cents × 12.5 %);
integration test placing the same order for two customers with different price lists.

**Dependencies.** None.

---

## Technical debt and refactoring ideas (not feature work)

- Add response DTO classes so Swagger documents response schemas, not just requests.
- Extract the repeated `list()` + `$transaction([findMany, count])` pattern into a small shared helper.
- Introduce a `Clock` provider instead of `new Date()` (needed by items 1, 3, 8).
- Move `assertInvariants` from the test helpers into a production `LedgerConsistencyService` (item 6) and
  reuse it in tests.
- Replace the process-wide `connection_limit=1` with per-operation write queueing if read throughput
  ever matters (or move to PostgreSQL and use row locks).
- Add autocannon/k6 smoke scripts for order placement and inspect query plans with `EXPLAIN QUERY PLAN`.
