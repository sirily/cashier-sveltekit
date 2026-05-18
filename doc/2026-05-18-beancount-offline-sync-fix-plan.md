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

### Phase 4. Make the repo measurable

12. Fix unit/E2E test runner separation.
13. Add Beancount sync unit tests.
14. Add minimal `/sync` E2E tests with mocked server responses.
15. Add route inventory tests for visible navigation.

### Phase 5. Quick safe cleanup

16. Remove or hide user-facing dead rledger/test/demo paths that are not part of Beancount runtime.
17. Remove unused Stage 1 Beancount POST client methods.
18. Fix obvious dead UI links and "Not implemented" actions that do not require domain refactors.

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

## Test Plan

### Test harness repair comes first

Current issue:

- `npm run test:unit` runs Vitest.
- Vitest currently collects `tests/ui/rledger.test.ts`, which imports `@playwright/test`.
- `tests/ui/test.ts` still asserts the old SvelteKit starter page text.

Required changes:

1. Add or update `vitest.config.ts` so Vitest excludes `tests/ui/**`.
2. Update `playwright.config.ts` so Playwright `testDir` is `tests/ui`.
3. Replace the placeholder UI smoke test with a Cashier-specific smoke test.
4. Delete or rewrite `tests/ui/rledger.test.ts` as part of the rledger cleanup.

Acceptance:

```bash
npm run test:unit
npm run test:e2e
```

The two commands must run different suites. No runner should collect the other runner's files.

### Unit tests for Beancount sync

Create `tests/sync-beancount.test.ts`.

If needed, export pure helpers from `src/lib/sync/sync-beancount.ts` explicitly:

```ts
export const __test__ = {
	normalizeRemotePath,
	resolveRemoteInclude,
	parseIncludes,
	mapRemoteFilesToLocalPaths
};
```

Coverage target:

```text
CODE PATH COVERAGE
==================
[+] sync-beancount pure path helpers
    |
    +-- normalizeRemotePath()
    |   +-- absolute path preserved: /workspace/main.bean
    |   +-- repeated slashes and "." collapsed
    |   +-- traversal above root rejected
    |
    +-- parseIncludes()
    |   +-- multiple include directives
    |   +-- commented/non-include lines ignored
    |   +-- nested path strings preserved
    |
    +-- resolveRemoteInclude()
    |   +-- relative include resolves against parent dir
    |   +-- absolute include normalizes directly
    |
    +-- mapRemoteFilesToLocalPaths()
        +-- root /workspace/main.bean -> main.bean
        +-- /workspace/prices/2026.bean -> prices/2026.bean
        +-- include outside root tree rejected
        +-- local absolute/traversal paths rejected

[+] CashierSyncBeancount.readLedgerFiles()
    |
    +-- fetches root via /infrastructure?file_path=
    +-- recursively fetches nested includes
    +-- duplicate includes fetched once
    +-- fetch failure rejects before OPFS writes
    +-- cyclic include does not infinite loop

[+] synchronizeLedgerFiles()
    |
    +-- creates cashier.bean only when missing
    +-- preserves existing cashier.bean content
    +-- writes root and include files after full map validation
    +-- sets SettingKeys.bookFilename to local root
    +-- deletes ledger cache and invalidates fullLedgerService
    +-- parse errors mark sync as failed
    +-- diagnostics record file count, root size, parse result

[+] metadata-only sync
    |
    +-- accounts and payees can sync without ledger file download
    +-- diagnostics says metadata-only and parse skipped
    +-- success message is metadata-specific
```

Mocking strategy:

- Mock `global.fetch` for `/ping`, `/?query=...`, and `/infrastructure?file_path=...`.
- Mock `src/lib/utils/opfslib` for `fileExists` and `saveFile`.
- Mock `settings` with an in-memory map.
- Mock `fullLedgerService.deleteCache`, `invalidate`, and `getErrors`.
- Mock `Notifier` to avoid UI side effects.

Regression tests:

1. Existing `cashier.bean` content is not overwritten during Beancount sync.
2. Any failed include fetch leaves OPFS untouched.
3. Parse errors prevent green sync success.
4. The selected root book is set only after files are successfully written.

### E2E tests for `/sync`

Create `tests/ui/beancount-sync.test.ts`.

Use Playwright route mocking for `cashier-server-python` responses.

```text
USER FLOW COVERAGE
==================
[+] /sync Beancount offline sync
    |
    +-- select Beancount data source
    +-- enter server URL and root file
    +-- run accounts + payees + ledger files sync
    +-- progress shows:
    |       - accounts
    |       - payees
    |       - ledger files to OPFS
    |       - root book selected
    |       - full ledger parsed
    +-- diagnostics visible after success
    +-- server 404 for include shows failure, not green success

[+] metadata-only Beancount sync
    |
    +-- run accounts/payees with ledger files unchecked
    +-- UI says metadata synchronization completed
    +-- no ledger file diagnostics are falsely reported as successful
```

Playwright should verify visible UX. Unit tests should verify OPFS write details.

### Commands

```bash
npm run check
npm run lint
npm run test:unit
npm run test:e2e
npm run build
```

## Quick Safe Cleanup

These are intentionally small fixes that reduce repo noise without starting the global refactor.

### Cleanup 1. Remove stale rledger tests from active suites

Problem:

- `tests/ui/rledger.test.ts` points to `/rledger`, but the actual demo route is `/demo/rledger`.
- Vitest currently tries to load this Playwright file.
- `tests/rustledger.test.ts` tests deprecated behavior from `src/lib/services/rustledger.ts`.

Safe action:

- Delete `tests/ui/rledger.test.ts` when rledger demo removal starts.
- Delete or replace `tests/rustledger.test.ts` with Beancount worker/client tests.

Why safe:

- These tests are already red/noisy and do not protect the current Beancount path.

### Cleanup 2. Remove visible rledger product surface, keep the WASM engine

Problem:

- `src/routes/about/+page.svelte` still imports `rustledger`, shows "RustLedger WASM", and links to `/demo/rledger`.
- `src/routes/demo/rledger/**` is a demo surface, not a production Beancount flow.

Safe action:

- Remove the About page RustLedger version block and demo link.
- Delete `src/routes/demo/rledger/**`.
- Keep `@rustledger/wasm` and `src/lib/workers/ledger.worker.ts`.

Why safe:

- This removes user-facing rledger branding without touching the active Beancount full-ledger worker.

### Cleanup 3. Remove unused Stage 1 POST methods from Beancount sync client

Problem:

- `CashierSyncBeancount` still contains `search()` and `xact()` POST methods.
- Stage 1 Beancount sync is explicitly read-only.

Safe action:

- Delete unused `search()` and `xact()` from `src/lib/sync/sync-beancount.ts`.
- Add a unit test proving Beancount sync only calls `GET /?query=...`, `GET /infrastructure`, `GET /ping`, and optional `GET /reload`.

Why safe:

- `rg` shows no current callers for those methods.
- Removing them makes the read-only invariant enforceable.

### Cleanup 4. Fix broken Cloud Backup settings navigation

Problem:

- `BackupScxCard.svelte` redirects to `/cloud-backup-settings`, but no such route exists.
- `src/routes/cloud-backup/+page.svelte` toolbar items have no target/action.

Safe action:

- Either point settings to the existing WebDAV config route `/settings/webdav-cfg`, or hide Cloud Backup until the flow is real.
- Disable or remove toolbar items with no action.

Why safe:

- This fixes a dead user path without touching sync architecture.

### Cleanup 5. Hide or disable unimplemented filesystem settings buttons

Problem:

- `src/routes/settings/filesystem/+page.svelte` has "Set Book" and "Set Asset Allocation" paths that only show `Notifier.warning('Not implemented!')`.

Safe action:

- Disable those buttons with explanatory copy, or remove them if OPFS import is now the supported route.

Why safe:

- Dead buttons train users not to trust the app.

### Cleanup 6. Remove unsupported IndexedDB file backend from runtime selection

Problem:

- `src/lib/storage/indexedDbBackend.ts` implements `StorageBackend` but every method throws.
- `src/lib/storage/index.ts` can still instantiate it.

Safe action:

- Remove `indexeddb` from any selectable runtime backend path until implemented.
- Keep the file only if there is no user path to select it, or delete it and track a future TODO.

Why safe:

- IndexedDB remains used for app data/settings. This only removes a broken file-like storage backend option.

### Cleanup 7. Add route inventory test

Problem:

- Several visible links and tests have drifted from real SvelteKit routes.

Safe action:

- Add a static test that extracts visible `href="/..."`, `targetNav="/..."`, and common `goto('/...')` calls.
- Compare them against `src/routes/**/+page.svelte` and known dynamic route patterns.
- Exclude commented-out code.

Why safe:

- It catches broken UI paths without changing product behavior.

## Safe rledger Removal Plan

Definition:

- Remove user-facing rledger data source, demo pages, stale tests, deprecated `rustledger.ts`, and stale `PtaSystems.rledger` query branches.
- Keep `@rustledger/wasm` while `src/lib/workers/ledger.worker.ts` uses it for Beancount parsing/querying.

### Phase R0. Characterization before deletion

Add tests before deletion:

- Beancount sync unit tests from this plan.
- A `ledgerWorkerClient` smoke/contract test where feasible.
- Transaction formatting/editing tests for paths using `sourceEditor.ts` and `directiveFormatter.ts`.

### Phase R1. Remove user-facing rledger routes and tests

Delete:

- `src/routes/demo/rledger/**`
- `tests/ui/rledger.test.ts`
- `tests/rustledger.test.ts`

Update:

- `src/routes/about/+page.svelte` to remove RustLedger version and demo link.

Do not touch:

- `src/lib/workers/ledger.worker.ts`
- `@rustledger/wasm`

### Phase R2. Remove rledger data source branches

Update:

- `src/lib/enums.ts`: remove `LedgerDataSource.rledger` and `PtaSystems.rledger`.
- `src/routes/sync/+page.svelte`: remove dead `LedgerDataSource.rledger` case.
- `src/lib/sync/sync-queries.ts`: remove `RustledgerQueries` and `getQueries(...rledger)` branch.
- `src/lib/sync/sync-beancount.ts`: remove dead `PtaSystems.rledger` payee branch.
- `src/lib/assetAllocation/securityAnalysis.ts`: replace rledger fallback behavior with explicit Beancount or Ledger handling.

Acceptance:

```bash
rg -n "LedgerDataSource\\.rledger|PtaSystems\\.rledger|RustledgerQueries|rledger" src tests
```

No user-facing rledger feature should remain. WASM package-name references are acceptable only where the Beancount engine still needs them.

### Phase R3. Replace deprecated `rustledger.ts`

Current issue:

- `src/lib/services/rustledger.ts` is deprecated and initialization is disabled, but app code still imports it.

Plan:

1. Create a Beancount-named WASM adapter only if non-worker code still needs direct parse/format/hash helpers.
2. Move active helper functions there.
3. Update imports in services/routes.
4. Delete `src/lib/services/rustledger.ts`.

Do not move `ledger.worker.ts` in this phase.

## Repository Refactor Roadmap

### Problem 1. Test infrastructure is not trustworthy

Fix before feature work:

- separate unit and E2E test roots
- replace placeholder UI smoke test
- add Beancount sync tests

### Problem 2. Ledger architecture has too many sources of truth

Current services:

```text
ledgerWorkerClient.ts     active full-ledger app API
ledger.worker.ts          active WASM worker
ledgerService.ts          cashier.bean edit service
fullLedgerService.ts      older direct full-ledger service
localLedgerService.ts     older local service
rustledger.ts             deprecated disabled facade
```

Target:

- pages query via `ledgerWorkerClient`
- local `cashier.bean` edits go through one edit service
- low-level WASM imports are hidden behind worker or Beancount-named helpers
- obsolete services are removed after import migration

### Problem 3. UI has dead and misleading paths

Known examples:

- rledger tests route to `/rledger`, actual demo is `/demo/rledger`
- Cloud Backup settings route points to a missing page
- filesystem settings buttons show "Not implemented"
- payee detail flow is a no-op
- Cloud Backup toolbar items have no target/action

Plan:

- add route inventory test
- fix dead links
- hide unfinished flows from normal navigation
- convert "Not implemented" buttons to disabled explanatory UI or implement them

### Problem 4. `AppService` is a junk drawer

Do after tests exist:

- split transaction repository
- split settings repository
- split cashier file service
- split metadata import service
- split scheduled transaction service

Keep mechanical moves separate from behavior changes.

### Problem 5. Accessibility suppressions are accumulating

Plan:

- convert clickable rows/divs to buttons where possible
- keep exceptions documented only when semantic replacement is worse
- include common navigation and list flows in E2E coverage

### Parallelization

```text
Lane A: test harness -> Beancount sync unit tests -> Beancount sync E2E
Lane B: quick rledger route/test cleanup -> rledger enum/query removal
Lane C: route inventory -> dead UI link fixes
Lane D: storage backend cleanup

After A + B are green:
Lane E: deprecated rustledger.ts migration -> ledger service consolidation
```

Conflict flags:

- Lane A and Lane B both touch tests. Coordinate file placement.
- Lane B and Lane E both touch service imports. Do B first.
- Route cleanup can run in parallel if it avoids `/sync` while sync E2E is being written.

## Verification Checklist

### Automated

Run when environment permits:

```bash
npm run check
npm run lint
npm run test:unit
npm run test:e2e
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
