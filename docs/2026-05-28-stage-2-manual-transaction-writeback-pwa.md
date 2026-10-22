# Cashier Stage 2: PWA manual transaction writeback

Created: 2026-05-28
Status: implementation-ready plan for code agents

## Purpose

Stage 1 is accepted in production: the PWA can pull the real Beancount ledger from the Python server, store it in OPFS, and parse it with `@rustledger/wasm@0.14.1` with `0` parse errors.

Stage 2 adds the narrow writeback flow for transactions that the mobile PWA creates while offline. The PWA must not become a general Beancount editor. It only pushes Cashier-created manual transactions to the server, then pulls the full ledger again and removes local overlay entries only after they are confirmed in the parsed server ledger.

## One-button user model

The existing explicit Sync action becomes one sequential operation:

```text
1. push: local cashier.bean -> server /api/xact -> server manual_transactions.bean
2. pull: server main.bean -> OPFS / full ledger
3. reconcile: if local cashier_id is present in parsed main.bean, delete local copy
```

The UI progress text should follow this sequence:

```text
Отправка локальных операций -> Загрузка полной книги -> Сверка локального журнала
```

Do not add a second permanent sync button for writeback. Do not add a separate hidden background write loop for v1.

## Transaction states

Persist only two meaningful states:

| State    | Storage                                                      | User surface                                               |
| -------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| `local`  | local `cashier.bean`; not confirmed in pulled `main.bean`    | Journal entry may show `На устройстве`                     |
| `synced` | included in pulled server ledger; local overlay copy removed | appears once from the full ledger, with no local duplicate |

Do not persist `uploading`, `accepted`, or `confirmed` as durable states. Transient in-memory progress during Sync is fine.

Rejected transactions remain `local` and show the concrete backend validation error. Do not invent generic wording if the backend provides a useful reason.

## Stable identity

Every locally created transaction must have stable metadata before its first push:

```beancount
cashier_id: "UUID"
```

Rules for code agents:

1. `cashier_id` is the idempotency and reconciliation key.
2. Generate it once and persist it into the local transaction before sending anything to the server.
3. If an old local transaction lacks `cashier_id`, assign and persist one before the first push.
4. Do not use formatted transaction text as the primary identity.
5. Optional future metadata such as `cashier_device_id` or `cashier_created_at` may be added for diagnostics, but it must not replace `cashier_id`.

## API contract used by the PWA

Use the short endpoint name:

```http
POST /api/xact
```

The request must contain only Cashier-created manual transactions. v1 only sends completed `*` transactions; incomplete `!` transactions are out of scope.

Expected response shape:

```json
{
	"synchronized": ["transaction-uuid-1"],
	"rejected": [
		{
			"cashier_id": "transaction-uuid-2",
			"reason": "Транзакция не сбалансирована: сумма по RUB равна 50.00 RUB"
		}
	]
}
```

The PWA does not need to know whether a synchronized ID was newly accepted or was already present on the server. Both mean: proceed to pull the full ledger and confirm the ID appears in the parsed ledger before deleting the local copy.

## Required client algorithm

Implementation must follow this order exactly:

1. Load pending local manual transactions from local `cashier.bean` / local journal storage.
2. Ensure each pending transaction has a persisted `cashier_id`.
3. If there are pending transactions, POST them to `/api/xact`.
4. For IDs returned in `rejected`, keep those transactions local and attach/show the returned reason.
5. Pull the full ledger using the existing Stage 1 offline-ledger sync path.
6. Parse the pulled ledger through the existing RustLedger full-ledger path.
7. Find `cashier_id` metadata in the parsed full ledger.
8. Delete a local overlay transaction only when its own `cashier_id` appears in the parsed pulled ledger.
9. Render the operation from the full ledger only once.

Important failure behavior:

- If POST succeeds but pull fails, keep local copies. A later retry is safe because the server deduplicates by `cashier_id`.
- If POST response is lost, keep local copies. A later retry is safe for the same reason.
- If the server rejects a transaction, keep it local with the server reason.
- If a mixed batch has valid and invalid transactions, valid ones may sync while invalid ones remain local.

## Acceptance scenarios for PWA agents

A Stage 2 PWA implementation is not accepted until these scenarios pass:

1. Normal expense: create in PWA, Sync, server appends once, full ledger pulls/parses, local copy removed, UI shows exactly one operation.
2. Lost response or failed pull: repeated Sync deduplicates by `cashier_id`; later successful pull clears the local overlay.
3. Rejected unbalanced transaction: server does not write it; PWA leaves it local with the returned reason.
4. ID conflict: server refuses overwrite; PWA leaves local entry and shows conflict reason.
5. Mixed batch: valid transactions commit and later disappear from local overlay; invalid ones stay local.
6. End-to-end boundary: UI-created expense -> push/pull -> `manual_transactions.bean` contains it once -> materialized `main.bean` -> OPFS -> `@rustledger/wasm@0.14.1` -> parse errors `0`.

## Non-goals

Do not implement any of these in Stage 2 v1:

- general Beancount mutation API;
- account creation from mobile;
- editing or deleting arbitrary server transactions;
- persistent `uploading` / `accepted` / `confirmed` local state machine;
- separate permanent `Синхронизировано` badge after local overlay removal;
- support for incomplete `!` transactions.

## Related server expectations

The server owns validation and writing. The PWA must assume:

- only one server file is writable: `/workspace/manual_transactions.bean`;
- the ledger workspace is otherwise read-only;
- `main.bean` includes `manual_transactions.bean`;
- the server deduplicates by `cashier_id` and rejects conflicts;
- the server validates the candidate full ledger before committing.
