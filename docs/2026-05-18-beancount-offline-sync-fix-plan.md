# Beancount Offline Sync Fix Status

Status date: 2026-05-18.

Branch: `merge-main-beancount-sync-recovery`.

Reviewed commits through: `5b627fc fix: address multi-currency audit and CSO findings`.

## Verdict

The Beancount offline sync implementation is functionally complete for the planned PWA-side scope.

The remaining gaps are hardening and follow-up items, not core implementation blockers:

- Server-side `/infrastructure` path confinement must be enforced in `cashier-server-python`; the PWA client cannot be the security boundary.
- WebDAV password/app-token storage remains an existing local-browser secret-storage risk outside this Beancount sync change, now called out in the settings UI.

## Current Architecture

The Beancount sync flow now uses `cashier-server-python` as a read-only source for:

- accounts metadata into IndexedDB
- payees metadata into IndexedDB
- ledger files into OPFS through `GET /infrastructure?file_path=...`
- post-sync full-ledger parsing through `ledgerWorkerClient`

Local OPFS state after successful offline sync:

```text
cashier.bean        # local writable transaction overlay, preserved if present
main.bean           # synced read-only root book, or the basename of the configured remote root
subdir/*.bean       # synced include files under the selected root tree
```

Important invariants currently enforced:

- `cashier.bean` is preserved and is only created when missing.
- Synced infrastructure is rejected if it would overwrite `cashier.bean`.
- `cashier.bean` does not persist injected book includes.
- The worker remains responsible for composing `cashier.bean` with the selected book in memory.
- Stage 1 Beancount sync is read-only: no `/xact`, no `/search`, no `/shutdown`, no server-side write-back.
- `@rustledger/wasm` remains in use as the Beancount parsing/query engine.

## Implementation Completion

1. Explicit Beancount root book setting: done.
2. Recursive Beancount file download from `/infrastructure`: done.
3. Remote-to-local OPFS path mapping: done.
4. OPFS persistence after full file-map validation: done.
5. `cashier.bean` preservation: done.
6. Automatic selected-book configuration after file sync: done.
7. Full-ledger cache invalidation and parse validation after file sync: done.
8. Metadata vs ledger-file progress split in `/sync`: done.
9. Beancount sync diagnostics summary: done.
10. Account navigation fallback/discoverability: done.
11. Multi-currency UI audit: done for current PWA account, asset, expense, and income/expense report surfaces.
12. Test runner separation: done.
13. Beancount sync unit tests: done.
14. Route inventory unit test: done.
15. Stale user-facing rledger routes/tests/data-source branches: done for known product routes.
16. Unused Stage 1 Beancount POST client methods: done.
17. Quick cleanup of obvious dead UI links and `Not implemented` actions: mostly done.

## Verification

Commands run in the latest pass against `5b627fc`:

```bash
npm run lint
npm run check
npm run test:unit -- --run
npm audit --omit=dev --audit-level=moderate
npm run build
```

Results:

- `npm run lint`: pass, 0 warnings, 0 errors.
- `npm run check`: pass, 0 errors, 6 pre-existing Svelte warnings.
- `npm run test:unit -- --run`: pass, 6 files, 23 tests.
- `npm audit --omit=dev --audit-level=moderate`: pass, 0 production dependency vulnerabilities.
- `npm run build`: pass.

Notes:

- `tests/sync-beancount.test.ts` intentionally exercises error paths; Vitest prints expected stderr for parse failure, `cashier.bean` overwrite rejection, and missing include rejection. The suite still passes.
- `tests/routeInventory.test.ts` remains in the unit suite and passes.
- Build/check still report existing Svelte warnings in `DragContainer.svelte`, `Dragable.svelte`, `XactEditor.svelte`, and `routes/opfs/sync/+page.svelte`.

## Review Results

Review status: `DONE_WITH_CONCERNS`.

Findings:

1. No blocking code-review findings remain for the Beancount offline sync path.
2. The original unsafe ordering issue is closed: downloaded files, selected book, and ledger cache are rolled back when parse validation fails.
3. The original `cashier.bean` overwrite risk is closed: downloaded infrastructure cannot map to `cashier.bean`.
4. The original stale rledger product surface is closed for known UI/data-source routes.
5. The route inventory test is useful but intentionally shallow; it catches literal visible routes, not every dynamic navigation or runtime-only link.
6. Focused chart/summary review found base-currency report labels missing on expenses and income/expense summaries; `5b627fc` fixed this by adding currency labels to totals and chart tooltips.
7. Static stale-surface scan found no active `/shutdown`, stale rledger product route, broken cloud backup settings link, or `Not implemented` UI action. The remaining `/xact` matches are legitimate `xact-actions` transaction UI paths.
8. No new blocking review findings were found in the refreshed branch.

## CSO Results

CSO status: `DONE_WITH_CONCERNS`.

Findings:

1. No secrets were found in the Beancount sync changes.
2. Production dependency audit reports 0 vulnerabilities.
3. Beancount Stage 1 sync no longer exposes client-side mutating server calls.
4. The PWA validates and normalizes infrastructure paths before OPFS writes, but the server must still enforce its own root jail / allowlist for `/infrastructure`.
5. WebDAV credentials are stored in browser settings/IndexedDB. This is pre-existing, not introduced by Beancount sync, but it remains a security hardening item.
6. The generated build still includes the RustLedger WASM asset because the active Beancount worker depends on it. This is expected.
7. `6824f19` and `5b627fc` document and surface the WebDAV token-storage risk; no new secret material was introduced.
8. PWA-side `/infrastructure` path normalization remains covered by unit tests, but the server-side root jail cannot be verified from this repository.

## Remaining Work

1. Add or verify server-side `/infrastructure` path confinement in `cashier-server-python`.
2. Decide whether WebDAV credential storage needs encryption or session-only storage beyond the current product warning.
3. Consider reducing the remaining Svelte warnings as a separate cleanup.

## Acceptance Status

PWA-side implementation acceptance is met:

- accounts and payees can sync into IndexedDB
- ledger root and include files can sync into OPFS
- `cashier.bean` is preserved
- selected book is configured after successful sync
- full-ledger cache is invalidated and parse errors fail the sync
- `/sync` status and diagnostics distinguish metadata, file download, selected book, and parse result
- Stage 1 Beancount sync is read-only from the client

Full project acceptance is not closed until server-side path confinement is verified in `cashier-server-python`.
