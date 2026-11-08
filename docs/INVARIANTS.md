# StockFlow – Business invariants and how they are protected

Stock consistency is the one thing this system must never get wrong. This document lists every
invariant, where it is enforced, and which tests prove it. If you change stock-related code, read it
first and keep every row true.

## Vocabulary

| Term        | Meaning                                                                        |
| ----------- | ------------------------------------------------------------------------------ |
| `onHand`    | Physical units in the warehouse (`InventoryItem.quantityOnHand`)               |
| `reserved`  | Units promised to open orders (`InventoryItem.quantityReserved`)               |
| `available` | `onHand − reserved`: what can still be promised to new orders                  |
| Movement    | One row in the append-only ledger `StockMovement`                              |
| Reservation | One row in `StockReservation` per order line (`ACTIVE` → `RELEASED`)           |
| Money       | Integer cents (`priceCents`, `unitPriceCents`, `lineTotalCents`, `totalCents`) |

## The invariants

| #   | Invariant                                                                                                                           | Enforced by                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| I1  | `0 ≤ reserved ≤ onHand` for every SKU, i.e. `available ≥ 0` – **no overselling**                                                    | Conditional `UPDATE … WHERE` in `InventoryRepository`; `CHECK` on `InventoryItem` (migration)       |
| I2  | `onHand` changes only through **receipts** and **adjustments**; `reserved` only through **reservations** and **releases**           | `InventoryRepository` is the only writer; services/controllers never touch `InventoryItem`          |
| I3  | Every stock change writes **exactly one** movement in the **same transaction**                                                      | `InventoryRepository.receive / adjust`, `OrdersRepository.placeOrder / cancelOrder`                 |
| I4  | `onHand = Σ onHandDelta` and `reserved = Σ reservedDelta` over a SKU's movements; each movement's `…After` equals the running total | Consequence of I3; verified by `test/helpers/invariants.ts` after every integration test            |
| I5  | `reserved = Σ quantity of the SKU's ACTIVE reservations`                                                                            | Orders create/release reservations and move `reserved` in the same transaction; verified as above   |
| I6  | An order is **all-or-nothing**: either every line is reserved or the order is rejected                                              | Single transaction in `OrdersRepository.placeOrder`; the first failing line rolls everything back   |
| I7  | `RESERVED` orders have only `ACTIVE` reservations; `CANCELLED` orders have only `RELEASED` ones                                     | Cancel flips the status and releases reservations in one transaction                                |
| I8  | Cancelling releases stock **exactly once**, even with concurrent or repeated requests                                               | Guarded `UPDATE … WHERE status = 'RESERVED'` is the first statement; a second cancel affects 0 rows |
| I9  | `lineTotal = quantity × unitPrice` and `orderTotal = Σ lineTotal`, all integers                                                     | `order-calculator.ts`; `CHECK` on `OrderItem`; verified by `assertInvariants`                       |
| I10 | An order keeps the unit price it was placed at; later SKU price changes never alter it                                              | `OrderItem.unitPriceCents` is a snapshot copied at placement                                        |
| I11 | An adjustment can never take `onHand` below `reserved`                                                                              | `adjustOnHand` guard `onHand + delta ≥ reserved`                                                    |
| I12 | Every adjustment carries a reason; `DAMAGED`/`LOST` must be negative, `FOUND` positive, `OTHER` needs a note                        | `AdjustStockDto` + `InventoryService.adjust`                                                        |
| I13 | Only active SKUs of active products can be ordered                                                                                  | `OrdersService.create` (checked before reserving)                                                   |
| I14 | `onHand ≤ 1,000,000,000` per SKU and order totals `≤ 2,000,000,000` cents (no integer overflow)                                     | Guard inside the receive/adjust `UPDATE`; `exceedsMaxTotal`                                         |
| I15 | SKU codes are unique and immutable; one inventory row exists per SKU                                                                | `UNIQUE(Sku.code)`; `UpdateSkuDto` has no `code`; SKU + inventory are created in one nested write   |

## How consistency is achieved

### 1. Atomic conditional updates (no read-then-write)

A naive implementation reads the stock, checks it in JavaScript, then writes – two requests can both
see "5 available" and both reserve 5. StockFlow instead sends the check **inside** the statement:

```sql
UPDATE "InventoryItem"
SET    "quantityReserved" = "quantityReserved" + :qty
WHERE  "skuId" = :sku AND "quantityOnHand" - "quantityReserved" >= :qty
RETURNING "quantityOnHand", "quantityReserved";
```

The database evaluates the condition and applies the change as one atomic step. An empty result means
"not enough available stock – nothing was changed". The `RETURNING` values feed the movement row
(`onHandAfter` / `reservedAfter`) without a second read.

### 2. Transactions

`placeOrder` and `cancelOrder` wrap the stock updates, the order/reservation writes and the movement
rows in one Prisma interactive transaction. If any line fails, the whole thing rolls back
(`InsufficientStockSignal` inside the transaction triggers the rollback).

Lines are processed in ascending SKU id order. SQLite serialises writers so deadlocks cannot occur,
but a deterministic order keeps the code safe if the database is ever replaced.

### 3. Serialised writes on SQLite

SQLite has one writer at a time. With several pooled connections, concurrent write transactions fight
over the file lock and fail with Prisma error P1008 ("Socket timeout") – observed during development
(16 of 20 concurrent order requests returned 500, although the data stayed consistent).
`PrismaService` therefore forces `connection_limit=1`, which makes Prisma queue transactions
in-process. `test/concurrency.e2e-spec.ts` fails reliably if this is removed.
A PostgreSQL migration would drop this workaround and rely on row locks or `SELECT … FOR UPDATE`.

### 4. CHECK constraints (last line of defence)

`prisma/migrations/*_init/migration.sql` was hand-edited to add:

| Table              | Constraint                                                                           |
| ------------------ | ------------------------------------------------------------------------------------ |
| `InventoryItem`    | `quantityOnHand ≥ 0 AND quantityReserved ≥ 0 AND quantityReserved ≤ quantityOnHand`  |
| `StockMovement`    | `onHandAfter ≥ 0 AND reservedAfter ≥ 0 AND reservedAfter ≤ onHandAfter`              |
| `OrderItem`        | `quantity > 0 AND unitPriceCents ≥ 0 AND lineTotalCents = quantity × unitPriceCents` |
| `StockReservation` | `quantity > 0`                                                                       |
| `Sku`              | `priceCents ≥ 0`                                                                     |
| `Order`            | `totalCents ≥ 0`                                                                     |

Prisma does not model CHECK constraints and does not report them as drift (verified with
`prisma migrate diff`). **Caution:** if a future migration makes Prisma _redefine_ one of these
tables (SQLite recreates the table), the generated SQL drops the CHECKs – copy them into that
migration. The persistence tests (`CHECK constraints reject invariant violations…`) fail if they go
missing.

## Verification

- `test/helpers/invariants.ts` re-derives I1, I4, I5, I7 and I9 from the database after **every**
  integration test of inventory, orders and concurrency (`afterEach(assertInvariants)`).
- `test/concurrency.e2e-spec.ts` – 40 racing orders for 7 units give exactly 7 successes; racing
  cancels release once; adjustments racing with orders never push `reserved` above `onHand`.
- `test/persistence.e2e-spec.ts` – CHECK, FK and unique constraints reject violations when the API
  is bypassed; money/quantity columns hold SQLite `integer` values.
- `src/orders/order-calculator.spec.ts`, `src/inventory/*.spec.ts` – pure rules and error mapping.

## Known limits of the current design

- Prices and totals are single-currency (USD assumed); there is no tax, discount or shipping.
- Reservations never expire (backlog: _Reservation expiration_).
- There is no fulfilment step: `RESERVED` orders can only be cancelled (backlog: _Partial order
  fulfilment_). Therefore `onHand` is never reduced by sales yet.
- SKU/product activity is checked before the reservation transaction starts; a SKU deactivated in
  the few milliseconds in between can still be ordered once.
- One warehouse only (backlog: _Multi-location inventory_).
