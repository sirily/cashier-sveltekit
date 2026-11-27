# Design

## Context

See `proposal.md` for motivation and scope. The accepted deltas modify only `ledger-sync` and `manual-transaction-writeback`. Existing transaction-entry and analysis contracts remain in force without a new reference subsystem or first-run behavior.

The release-branch implementation offers separate Accounts/Payees and ledger-file selections. `sync-beancount.ts` sends dedicated reference BQL requests; `sync-common.ts`, reference helpers in `appService.ts`, and the DAL handle their IndexedDB results.

Local analysis already runs through `ledgerWorkerClient` and `ledger.worker.ts`, using the selected book with `cashier.bean`. Account and payee pages query that composition, then merge IndexedDB references. Removing the merge does not require a new analysis engine, cache, or reference database.

The earlier unapproved implementation is saved in a stash. It includes runtime/test changes, documentation, and changes to all four published specifications. It predates the accepted scope and must be reviewed, not accepted wholesale.

## Goals / Non-Goals

**Goals:**

- Remove independent reference synchronization and keep the existing explicit full Sync.
- Reuse existing local book queries without legacy IndexedDB list supplementation.
- Preserve existing writeback, data safety, Journal, offline, and analysis behavior.
- Recover useful work from the stash and discard its rejected or unnecessary additions.

**Non-Goals:**

- No compatibility mode or behavior for old sync choices.
- No new account creation, payee entry, missing-book message, first-run UI, or list-specific availability/refresh contract.
- No reference-table writes, migrations, or cleanup of existing rows.
- No broad worker/report rewrite, new dependency, or external server change.
- No implementation during this document update; no commit, push, merge, publication, deployment, or OpenSpec sync/archive without the corresponding request.

## Decisions

### 1. Recover and triage the stash before completing implementation

Identify the stash by object `195c302b9fb61e33fffc149e448e09ae8429a4e1` and message, not just its mutable stack position. It is currently `stash@{0}`. Inspect tracked and untracked contents and map changes to the accepted scope before applying them.

Protect the current accepted planning artifacts and unrelated user work before `git stash pop`. In particular, the stash's broad edits to published specifications must not be mistaken for approved spec synchronization. Resolve conflicts without replacing accepted planning documents. After a successful pop, review each restored file: keep relevant removal work and tests, rework useful partial implementation, and delete only the unnecessary changes restored from this stash. If pop conflicts, Git retains the stash; resolve and verify recovery before removing its remaining entry.

Explicitly remove rejected missing-book messaging, separate reference-readiness/refresh machinery, unrelated rewrites, and unapproved published-spec edits. Preserve user work not originating from this stash. Do not introduce commits or another implementation branch merely to protect the review. Run fresh impact/reference analysis before restoring or editing affected runtime code as project rules require.

### 2. Remove independent reference stages

Remove Accounts/Payees controls, the ledger-file enable/select-all controls that permit metadata-only runs, their option branches, and obsolete setting definitions. Keep the existing full send → pull → reconcile cycle and its normal analysis refresh.

Delete dedicated account/payee server methods, response handlers, reference import/replace helpers, and DAL accessors only when no retained consumers remain. Preserve query helpers used by local reports or investment analysis. Hiding controls while leaving the old execution paths is insufficient.

Remove obsolete reference progress, counts, and metadata-only diagnostics. Preserve the retained stage outcomes, authentication handling, failure explanations, and distinction between server validation and displayed-book refresh. Do not add a separate selection-list refresh stage.

### 3. Remove the extra list source, not existing book analysis

Retain existing account/payee queries over the local book composition. Remove the subsequent IndexedDB reads/merges; leave the old schema and rows alone. Do not persist a new reference projection or add a migration.

Accounts already declared open, unused accounts, available currencies, transaction-derived payees, and existing selection/free-text controls are regression coverage, not new capabilities. Adjust extraction only if a focused test demonstrates that removing the fallback breaks retained behavior. Do not rewrite workers or introduce account/payee features preemptively.

All views continue to use existing book availability, freshness, and offline behavior. Verify lists reflect the current book after the existing post-reconciliation refresh, without a separate reference refresh contract or first-run UI.

### 4. Preserve writeback and recovery

Keep standalone server-book validation, safe replacement, completed-only submission, stable persisted `cashier_id`, exact `@@` totals, rejection/unknown-outcome safeguards, and confirmation-before-delete. Preserve previous usable files and pending entries on failure according to existing contracts.

Check these guarantees along the touched full Sync path. A regression demonstrated in that path can justify a focused correction; it does not justify a general storage rewrite or new product requirement.

### 5. Keep technical regression checks out of long-term specifications

Tests must show that separate Accounts/Payees requests no longer occur and contradictory IndexedDB reference rows neither affect the lists nor get modified. Tests also preserve ordinary accounts/currencies, existing payee selection/input, offline Journal/analysis, post-Sync freshness, and writeback failure/retry behavior.

These checks live in tasks/tests rather than new specification scenarios. Use unit/orchestration, real local worker/WASM, and relevant browser tests. Mocked API evidence does not prove Python-server validation, deduplication, or snapshot semantics; report real-server integration as unavailable if no authorized environment exists.

## Risks / Trade-offs

- [Stash includes rejected code and published-spec edits] → Inspect before pop, protect current work, and triage every restored file against accepted deltas before treating it as implementation.
- [Removing fallback exposes a dependency on old reference rows] → Verify existing local query behavior with focused tests; correct only demonstrated extraction regressions.
- [Shared query helpers are removed accidentally] → Check references and impact before deletion; retain helpers used by active local analysis.
- [Refactoring alters writeback or recovery] → Run retained failure, retry, draft, identity, and exact-price regressions before broader checks.
- [OpenSpec rejects deliberate scenario removal] → Record the exact blocker; do not restore obsolete scenarios, invent compatibility, bypass validation, or change the accepted specs to obtain a green result. Resolve a supported sync/validation path separately before spec synchronization or any gated commit; report if that requires authorization outside this change.

## Migration Plan

1. Start implementation only after a separate apply request; the current action updates documents only.
2. Inspect the identified stash and current branch/worktree, protect accepted documents, and run required impact checks. Pop and triage the stash as described above.
3. Complete the approved runtime removal and list-source cleanup on `feat/local-book-reference-data`, based on `releases/1.1.0`. Do not touch reference table contents.
4. Update README/architecture descriptions of the retained Sync and local query paths. Keep published specifications untouched until an authorized sync/archive step.
5. Run the retained-workflow gate in `tasks.md`, review the final diff for rejected leftovers, and deliver actual results and limitations. A failed or unavailable required gate blocks any separately requested cleanup commit.
6. No destructive data migration is introduced. A later code rollback does not undo server writeback or confirmed reconciliation and must not restore obsolete local transaction copies.
