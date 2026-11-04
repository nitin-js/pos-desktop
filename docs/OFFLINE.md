# Offline client

The server protocol is `pos-backend/docs/OFFLINE-SYNC.md`. This document is the terminal side of that protocol. If the two disagree, the server document wins and this file is updated to match.

## When the terminal may sell offline

All of the following are true:

- A bootstrap has succeeded at least once on this terminal.
- The catalog cache is non-empty.
- The cashier still has a locally stored session that the UI can attach to the outbox. If the access token is expired, the sale is stored locally and the sync waits until refresh succeeds. If refresh fails because the session was revoked, the outbox stays on disk and the UI asks the cashier to sign in. It does not drop the outbox.
- The tender is cash. The pay screen hides UPI, card, and Razorpay while `navigator.onLine` is false and while the last health check failed.

Catalog edits, refunds of synced orders, and shift close of a shift the server has never seen stay disabled offline. Shift open can be queued only for a shift id created locally and included in the same sync batch as its orders. If that is not possible yet, the cashier must open the shift while online. Phase 7 implements queued shift open together with the batch `groupId`.

## Local store

One interface, two drivers.

| Driver | When |
| --- | --- |
| IndexedDB | Browser and PWA |
| SQLite via the Electron preload bridge | Packaged desktop app in Phase 9 |

Logical tables match the server document: `meta`, `catalog`, `balances`, `outbox`, `orders`.

`balances` is a display cache. The outbox stores movement deltas produced from the cached recipe. The payload does not include a field for the new on-hand quantity.

Each sale writes, in one local transaction:

1. The order with UUID v7, line snapshots (name, unit price, tax, recipe id, recipe version, unit cost if known), `qtyMilli`, and `offlineReceiptRef`.
2. One outbox operation per stock movement the recipe or retail link implies.
3. One cash payment operation.
4. A local balance decrement so the grid can warn the next item. That decrement is not uploaded.

`idempotencyKey` is `{terminalId}:{entityType}:{id}`.

`offlineReceiptRef` format is `OFF-{terminalCode}-{localSequence}`.

## Sync cycle

A timer and a connectivity event call the same function. There is no dependence on the Background Sync API.

1. Refresh the access token if needed.
2. Read `pending` outbox rows in sale `groupId` order: order, movements, payment.
3. `POST /api/v1/sync/batches`.
4. Mark `applied` and `duplicate` as `synced`. Store `receiptNumber` on the local order.
5. Leave `rejected` visible with the server message. Do not auto-retry a rejection.
6. On a network error, increment `attempts`, keep `pending`, and back off.

Then `GET /api/v1/sync/catalog?since=` updates the catalog cache. Cached rows are replaced by id. The client does not push catalog changes, because it has no editor for them.

`GET /api/v1/sync/conflicts` feeds the `/sync` screen for this branch.

## What the cashier sees after a clash

Two terminals can sell the last onions while offline. Both receipts stand. The server applies both deltas. If on-hand goes negative, this client shows the conflict returned for its own operation and does not rewrite the local receipt. A manager posts a stock count in Business Admin. That adjustment is a normal online movement, not a local edit of the historical ticket.

The client never offers "use my quantity" as a resolution.

## Printing offline

The receipt renderer uses the local order. It prints `offlineReceiptRef` in the number slot and the business name from `meta`. After sync, reprint uses `receiptNumber` and keeps the offline reference as a second line so a paper receipt can be matched.

## Service worker

The worker caches the app shell and static assets. API calls are not served from that cache. Catalog data lives in IndexedDB or SQLite so a cache purge of the worker cannot delete unpaid outbox rows.
