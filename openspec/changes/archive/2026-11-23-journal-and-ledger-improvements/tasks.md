# Tasks

## 1. Total-price representation and serialization

- [x] 1.1 Add the narrow posting price-kind and exact-decimal representation needed by the design, plus the shared two-posting inference and rate/weight calculation. Verify unit cases for reversed row order, asset-to-expense postings, repeating rates, precise decimal input, zero/missing/nonfinite amounts, same-currency entries, and multi-posting exclusions.
- [x] 1.2 Extend `xactToBeancountText` and `DirectiveFormatter` to emit inferred and supported explicit total prices as `@@`, without changing existing `@` behavior. Verify exact serialization of `-10 GBP @@ 12.30 USD` and `12.30 USD`, and prove rounded rate display never determines the saved amount.

## 2. Verified source restoration and safe correction

- [x] 2.1 Restore total versus unit price and original decimal values from verified local source in `getXactsWithSpans`, without relying on the lossy WASM price projection. Verify parser-backed tests distinguish `@` from `@@`, retain posting order and flags, and do not misassociate duplicate-account postings or unsupported cost structures.
- [x] 2.2 Extend `mergeTransactionEdit` for supported total-price corrections while preserving metadata, comments, and neighbors. Verify no-op, narration-only, source/destination amount and currency edits, repeated Edit after Save, stable `cashier_id`, stale source rejection, and continued fail-closed behavior for unsafe cost or structural edits.

## 3. Ordinary Journal form

- [x] 3.1 Integrate automatic inference, directional rate display, and the shared weighted balance calculation into XactEditor and Validate without adding a mode, confirmation, or route. Keep decimal inputs coherent across typing, sign changes, account and calculator selection, and remembered transactions. Verify focused unit/component tests and Svelte type checks.
- [x] 3.2 Add browser regressions for ordinary cross-currency creation, offline save/reload/reopen, correction of both amounts, immediate repeat editing, exact total price, and both completion flags. Verify balance and Validate agree, metadata/identity remain intact, source contains one operation, and ordinary same-currency capture is unchanged.

## 4. Ledger diagnostics

- [x] 4.1 Add an Inspect parsed ledger action to `src/routes/util/validation/+page.svelte` targeting the retained `/ledger/multi` inspector, and remove Experiments from About. Update the D6 About browser test to assert the removed links and retained application/update controls; add navigation coverage from Validation to the inspector and back.
- [x] 4.2 Remove only `src/routes/ledger/+page.svelte`, preserving `JsonTreeNode.svelte`, the `/ledger/multi` route, and Journal's `ledgerService`. Verify a direct visit to `/ledger` no longer offers the local inspector or changes journal/book source files, and the full inspector still renders its tree.

- [x] 4.3 Update the full inspector's title and description to identify the full local analysis book and remove obsolete `parseMultiFile` wording. Add browser assertions for selected-book and local-overlay directives, visible diagnostics, and Reload; verify accounting source files remain unchanged.

- [x] 4.4 Rewrite About and Help as user-facing application information and usage instructions: remove repeated fork/upstream comparisons and developer-oriented origin or architecture explanations. Keep About focused on the application, version, updates, and repository; keep Help focused on Journal, offline storage, Sync, reports, and actionable error recovery. Preserve useful instructions, required attribution/license information, and existing controls and links. Update browser tests that assert fork-specific wording; verify About and Help no longer describe the app as a fork and the retained user workflows remain documented and navigable.

## 5. Synchronization and integration

- [x] 5.1 Add raw-payload and mocked Sync regression coverage of the unchanged `manual-transaction-writeback` contract, proving `@@`, both original amounts/currencies, and persisted identity survive preparation, retry, rejection, and confirm-before-delete reconciliation; verify the refreshed history renders one confirmed operation. Keep mock evidence distinct from the external Python-server contract.
- [x] 5.2 Run formatting and lint checks for changed files, `npm run check`, strict OpenSpec validation, application unit tests, and relevant production-build Playwright tests. Verify the retained #29 repeat-edit and annotation-preservation cases, existing Validation results and Reload & Validate, About update controls, and full-book inspector navigation still work without browser errors. Scope Vitest explicitly to application tests if local toolchain directories are collected.
- [x] 5.3 Exercise the completed exchange through a real configured Python server when available and record the result; otherwise explicitly record the unavailable integration check without claiming server acceptance or deduplication. Review the full diff and GitNexus change impact before any separately authorized commit.
