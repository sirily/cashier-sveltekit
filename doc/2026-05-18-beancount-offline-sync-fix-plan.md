# Beancount Offline Sync Fix Plan

## Goal

Complete the Beancount sync flow so the PWA can use `cashier-server-python` as a read-only source for both:

- metadata sync into IndexedDB (`accounts`, `payees`)
- offline ledger sync into OPFS for full-ledger pages, reports, and queries

The current PR restores metadata sync, but the linked issue comment confirms the offline OPFS/book-file flow is still incomplete.

## Current Problem

What works now:

- Beancount sync can import accounts into Dexie.
- Beancount sync can import payees into Dexie.
- `/accounts` and `/payees` can surface synced metadata.

What is still broken:

- OPFS does not end up with a usable downloaded book.
- `userBookFilename` / book selection is not automatically configured for the downloaded book.
- full-ledger pages still depend on OPFS `.bean` files and therefore remain empty or misleading.
- sync status can look successful even when the offline ledger flow is incomplete.

## Target Architecture

For Beancount sync, the local device state should look like this:

```text
cashier.bean        # local device transactions only; may be empty
main.bean           # synced read-only root book from server
subdir/*.bean       # synced include files
optional/*.toml     # only if needed later
```

Important invariants:

- `cashier.bean` remains the transaction overlay file edited on the device.
- `cashier.bean` should not persist `include` directives.
- `ledgerWorkerClient` remains the full-book query service.
- the worker should continue injecting `include "<userBookFilename>"` into `cashier.bean` in memory at load time.
- Beancount server sync remains read-only: no `/xact`, no server-side write-back, no `manual_transactions`.

## Implementation Tasks

### Task 1. Add explicit Beancount root book setting

Add a setting for the remote Beancount root file path used during sync.

Suggested key:

```ts
SettingKeys.syncBeancountRootFile;
```

Suggested default:

```text
/workspace/main.bean
```

Acceptance criteria:

- sync code can resolve a root file path without hardcoding it inline everywhere
- the value is persisted in settings
- `/sync` exposes or at least initializes this value predictably

### Task 2. Implement recursive Beancount file download from `/infrastructure`

Extend `src/lib/sync/sync-beancount.ts` to download the root book and every included file.

Required behavior:

1. fetch the root file via `/infrastructure?file_path=...`
2. parse all `include "..."` directives
3. resolve include paths relative to the parent file
4. fetch each include recursively
5. build an in-memory file map before writing anything to OPFS

Acceptance criteria:

- sync fails if any required file cannot be fetched
- sync does not leave a half-written OPFS tree on fetch failure
- nested includes work
- duplicate includes are fetched once

### Task 3. Map remote file paths to OPFS paths

Define a deterministic mapping from remote infrastructure paths to local OPFS paths.

Recommended behavior:

- the selected remote root file becomes the local root file, for example `main.bean`
- included files preserve relative paths under that root
- remote absolute paths must be normalized so local OPFS paths stay relative and safe

Acceptance criteria:

- `main.bean` lands in OPFS as a normal file
- includes like `prices/2026.bean` land as `prices/2026.bean`
- path traversal outside the intended local tree is impossible

### Task 4. Persist synced Beancount files into OPFS

Write the downloaded file map into OPFS only after the full map has been validated.

Use the existing OPFS utilities instead of inventing a second file-writing layer.

Acceptance criteria:

- synced root book is non-empty
- include files are written to OPFS
- old stale files are either cleaned up deliberately or left untouched by documented policy

Open decision:

- either maintain a manifest for server-synced infrastructure files, or accept overwrite-only semantics for now

### Task 5. Preserve `cashier.bean` and only create it if missing

Current behavior in `createDefaultCashierFile()` overwrites `cashier.bean` with empty content.
That is unsafe once the user already has local transactions.

Introduce an `ensureCashierFileExists()` style helper and use it in Beancount sync.

Acceptance criteria:

- existing `cashier.bean` content is preserved
- missing `cashier.bean` is created automatically
- no successful sync can wipe local mobile transactions

### Task 6. Auto-configure the selected book after successful file sync

After writing the full downloaded infrastructure set:

- store the local root book file in settings via `userBookFilename`
- ensure the app sees that book as the selected root book

Acceptance criteria:

- Settings page shows the synced root book automatically
- no manual OPFS file selection is required after successful Beancount sync

### Task 7. Invalidate and reload the full ledger after file sync

After OPFS write + book selection:

- invalidate the binary ledger cache
- reload or invalidate `fullLedgerService`
- verify parse/load success before marking ledger sync completed

Acceptance criteria:

- full-ledger pages can query real data after sync
- reports and query pages stop behaving as if no book exists
- parse/load failure is surfaced as sync failure

### Task 8. Split metadata sync from ledger-file sync in UI and progress

The sync UI should distinguish between:

- account metadata synced
- payee metadata synced
- ledger files downloaded to OPFS
- root book selected
- full ledger parsed successfully

Beancount `Sync all` should only include supported Beancount steps.

Acceptance criteria:

- green success means offline ledger sync really completed
- metadata-only sync is labeled clearly as metadata-only
- no misleading success when OPFS book is empty or unconfigured

### Task 9. Add sync diagnostics for Beancount

After sync, surface a small diagnostic summary:

- imported accounts count
- imported payees count
- downloaded ledger files count
- selected root book filename
- root book size
- parse result / parse error count

Acceptance criteria:

- mobile QA can confirm whether offline sync is actually complete without devtools

### Task 10. Improve account navigation fallback

The linked issue comment notes that grouped-account navigation can still look empty even after sync.

Possible fixes:

- route top-level account navigation to `/accounts`
- or keep grouped accounts but show a clear empty-state message with a link to raw accounts

Acceptance criteria:

- synced accounts are discoverable without guessing alternative routes

### Task 11. Audit multi-currency UI usage

The imported account model preserves multiple commodities in `balances`, but some UI may still read only `account.balance`.

Audit the main synced surfaces and prefer `balances` / `currencies` where appropriate.

Acceptance criteria:

- synced multi-currency accounts are not silently flattened in key views

## Recommended Delivery Order

### Phase 1. Complete the offline ledger path

1. Task 1: root book setting
2. Task 2: recursive download
3. Task 3: path mapping
4. Task 4: OPFS persistence
5. Task 5: preserve `cashier.bean`
6. Task 6: auto-select book
7. Task 7: invalidate/reload full ledger

### Phase 2. Make the UX truthful

8. Task 8: split progress states
9. Task 9: diagnostics
10. Task 10: account navigation fallback

### Phase 3. Clean up remaining representation gaps

11. Task 11: multi-currency audit

## Acceptance Criteria for the Whole Fix

After running Beancount sync against a working `cashier-server-python` deployment:

1. accounts and payees are imported into IndexedDB
2. OPFS contains the synced root book and include files
3. `cashier.bean` exists and is preserved if already present
4. Settings shows the synced book file automatically
5. `fullLedgerService` can parse the resulting local book
6. `/accounts`, `/payees`, reports, and query pages can all see usable data
7. the sync UI does not show false success if the full offline flow is incomplete
8. only GET requests are used against the server for Stage 1 sync

## Verification Checklist

### Automated

Run when environment permits:

```bash
npm run check
npm run lint
npm run test:unit
npm run build
```

### Browser QA

1. Open `/sync` over HTTPS.
2. Choose Beancount data source.
3. Configure API URL.
4. Configure or accept the remote root book path.
5. Run sync.
6. Confirm success summary reports downloaded ledger files and selected book.
7. Open OPFS browser and verify:
   - `cashier.bean` exists
   - root book exists and is non-empty
   - include files exist
8. Open Settings and confirm root book is selected automatically.
9. Open `/accounts`, `/payees`, and at least one ledger-backed report/query page.
10. Confirm data is visible without manual post-sync repair.

### Network QA

Confirm the Beancount sync flow uses only:

- `GET /?query=...`
- `GET /infrastructure?file_path=...`
- `GET /ping` and optional `GET /reload`

And does not use:

- `POST /xact`
- server-side write-back
- `manual_transactions`

## Notes

- This plan intentionally preserves the existing architecture where `cashier.bean` is the writable local overlay and the full book is read from synced OPFS files.
- It does not introduce Stage 2 write-back behavior.
