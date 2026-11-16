# Tasks

The accepted delta specifications are the source of truth. These tasks implement their narrow removal scope and verify existing contracts; regression coverage is not a new product feature. All tasks remain unchecked until implementation starts through a separate apply request. This document update does not pop the stash or change runtime code.

## 1. Recover and triage the earlier implementation stash

- [x] 1.1 Check branch/worktree and identify the stash by object `195c302b9fb61e33fffc149e448e09ae8429a4e1` and message `WIP unapproved local-book reference implementation before OpenSpec review` (currently `stash@{0}`); inspect tracked and untracked contents and record which files/hunks are reusable, rejected, or need rework. Verify the inventory includes old published-spec edits and new files, and protect current accepted planning documents and unrelated user work before restoring anything.
- [x] 1.2 Check graph freshness, run upstream impact for affected runtime symbols, report callers/processes/risk, and resolve `UNKNOWN` using references/text checks; then execute `git stash pop` for the verified current selector. Verify accepted planning documents and unrelated work survive, all restored files are accounted for, and any conflicts are resolved. If pop retains the entry because of conflicts, remove that residual entry only after verifying successful recovery; do not pop a different stash.
- [x] 1.3 Review every restored file against the accepted deltas and remove unnecessary stash-origin changes: rejected first-run/missing-book messaging, separate reference-readiness/refresh machinery, unrelated rewrites, and unapproved published-spec changes. Keep or rework only relevant code/tests/docs. Verify a reviewed file inventory, no leftover rejected behavior, and an unchanged accepted specification contract; leave unrelated user work intact.

## 2. Remove independent Accounts/Payees synchronization

- [ ] 2.1 Complete removal of Accounts/Payees controls, metadata-only branching, ledger-file enable/select-all controls that permit that mode, option types/arguments, and obsolete setting consumers. Preserve the existing full send → pull → reconcile flow and analysis refresh without compatibility behavior. Verify unit/browser tests cover explicit ordering, an empty eligible batch continuing pull, no automatic Sync on navigation, and removal of the controls.
- [ ] 2.2 Remove dedicated Accounts/Payees requests, server BQL templates, response handlers, and import/replace helpers with no retained consumers; preserve query helpers used by local analysis. Verify references/searches show no retired runtime path and tests assert no separate Accounts/Payees request or BQL query during full Sync, empty-batch Sync, or retry.
- [ ] 2.3 Remove obsolete reference stages, counts, and mode labels from Sync diagnostics/progress while retaining existing full-cycle outcomes, error explanations, and token protection. Verify diagnostics/browser tests distinguish send, pull/parse, reconcile, and existing display-refresh outcomes without a separate list-refresh stage or exposed credential.
- [ ] 2.4 Update relevant Sync descriptions in `docs/architecture.md` and README. Verify instructions describe only the remaining explicit full flow, with no reference-only mode, compatibility behavior, or new product guarantee.

## 3. Remove IndexedDB supplementation from existing list queries

- [ ] 3.1 Keep existing local-book account/payee queries and remove the subsequent IndexedDB reference reads/merges; remove unused DAL accessors after caller checks, without writing, migrating, or clearing the old tables. Verify tests seed contradictory reference rows, show they cannot add/override list results, and confirm the seeded rows remain unchanged.
- [ ] 3.2 Verify ordinary query/selection behavior after fallback removal: existing open accounts without postings, declared and unrestricted multi-currency accounts, and existing payee selection/free-text controls. Use focused real-worker/WASM and existing editor tests; adjust extraction only for a demonstrated retained-behavior failure, and introduce no account or payee feature.
- [ ] 3.3 Verify current lists after the existing post-reconciliation book refresh, including just-synchronized transactions and remaining local entries, and preserve existing cold/offline Journal and book analysis behavior. Use unit/browser regressions with cache enabled and disabled; add no missing-book message, first-run UI, reference-readiness state machine, or separate
      refresh stage.
- [ ] 3.4 Update architecture/README descriptions to remove IndexedDB as an active list source and describe the existing local query path. Verify documentation neither requests cleanup of stored rows nor claims new account, payee, offline, or analysis behavior.

## 4. Preserve existing writeback and data-safety guarantees

- [ ] 4.1 Run focused full-cycle tests with completed `*` entries, an unchanged `!` draft, and exact authored `@@`; cover acceptance followed by failed pull/parse and repeat Sync with the persisted `cashier_id`. Verify only eligible entries are sent, identities and exact totals survive retry, confirmed local copies are removed safely, and no extra transaction appears after repeat Sync under the mocked server contract.
- [ ] 4.2 Verify send rejection, preparation/transport failure, failed/incomplete download, returned parse errors, and parser exceptions preserve pending local data and the previous usable book as required by existing contracts. Retain partial replacement/root-selection recovery, concurrent-edit, unresolved-outcome, rejection-veto, and reconciliation-save failure coverage. Make a focused correction only for a demonstrated regression in the touched path; record results without undertaking an unrelated storage rewrite.
- [ ] 4.3 Verify existing refresh ordering and isolation: reload follows durable reconciliation, including no-op reconciliation; failed display refresh is not a server parse failure and does not restore confirmed copies or discard remaining entries. Run the existing refresh regressions and retain the existing contract without separate selection-list semantics.

## 5. Integration checks and final review

- [ ] 5.1 Run retained offline journal capture/edit/delete, account history/balances/reports, journal export, and credential-free outbound backup regressions; verify retired import/restore entry points leave stored data unchanged. Record passing, failing, and unavailable checks as required by the project retained-workflow gate.
- [ ] 5.2 Run formatting/lint gates (`npm run lint`, `npm run lint:svelte`), type checking (`npm run check`), full unit tests (`npm run test:unit -- --run`), warning-gated production build (`npm run check:build`), relevant Playwright suites, and `git diff --check`. Verify actual results and distinguish baseline failures from changes caused by this implementation.
- [ ] 5.3 Re-run strict OpenSpec validation (`npm run check:specs`) and report the installed CLI's rejection of intentional scenario deletion. Identify a supported resolution before any authorized spec sync/archive or gated commit; do not change accepted deltas, restore removed scenarios, bypass checks, or expand into a tooling implementation without separate authorization. Verify either strict validation passes with the accepted contract or the exact unresolved blocker is reported.
- [ ] 5.4 If an authorized real Python-server environment is available, verify send/pull/reconcile, retry after failed pull, deduplication, and exact `@@` snapshot semantics; otherwise record real-server integration as unavailable. Verify mocked API evidence is labeled client-only and not presented as server integration.
- [ ] 5.5 Review the final runtime/test/documentation diff against the accepted scope and stash inventory, then report changed files, behavior, tests, and limitations. Verify no rejected stash additions, unapproved main-spec changes, table migration/cleanup, or unfinished pop conflicts remain; confirm no merge/publication/deployment occurred. Before any separately authorized cleanup commit, complete graph change analysis and the required retained-workflow gates; partial/truncated graph output or failed/unavailable required checks block that commit.

## Workflow follow-up

- Start implementation only on a separate apply request. Stash inspection/pop/triage is part of that implementation, not this planning update.
- Synchronize accepted deltas into published specifications or archive only through the corresponding requested workflow, after resolving the tooling blocker.
- Commits, pushes, merges, publication, and deployment each require the owner's corresponding authorization and release-policy checks.
