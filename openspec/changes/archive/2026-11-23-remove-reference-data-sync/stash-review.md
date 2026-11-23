# Stash recovery review

Recovered with `git stash pop stash@{0}` after verifying object
`195c302b9fb61e33fffc149e448e09ae8429a4e1` and its recorded message.
Pop completed without conflicts and removed the stash entry. The worktree was clean
before recovery; accepted change artifacts were not part of the stash and survived
unchanged. All 19 tracked and two untracked files were inspected.

## Disposition

| Restored file                                         | Review and disposition                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `README.md`                                           | Useful source/Sync wording mixed with rejected missing-book behavior. Restored baseline; rewrite narrowly in sections 2 and 3.                                                                                                                                           |
| `docs/architecture.md`                                | Useful reference/DAL cleanup mixed with compatibility and list-specific availability/refresh claims. Restored baseline; rewrite narrowly in sections 2 and 3.                                                                                                            |
| `openspec/specs/ledger-analysis/spec.md`              | Rejected expanded list freshness/offline contract. Restored baseline.                                                                                                                                                                                                    |
| `openspec/specs/ledger-sync/spec.md`                  | Unapproved published-spec changes, including rejected scenarios. Restored baseline; no spec synchronization.                                                                                                                                                             |
| `openspec/specs/manual-transaction-writeback/spec.md` | Unapproved published-spec edits and expanded refresh contract. Restored baseline.                                                                                                                                                                                        |
| `openspec/specs/transaction-entry/spec.md`            | Rejected new list/missing-book requirements. Restored baseline.                                                                                                                                                                                                          |
| `src/lib/data/dal.ts`                                 | Removal relevant only after caller cleanup. Restored baseline for section 3.                                                                                                                                                                                             |
| `src/lib/data/dbdal.ts`                               | Same; deletion must not leave page imports broken. Restored baseline for section 3.                                                                                                                                                                                      |
| `src/lib/services/appService.ts`                      | Reference import/replace removal useful after caller checks. Restored baseline for section 2.                                                                                                                                                                            |
| `src/lib/stores/syncProgressStore.ts`                 | Reference progress removal useful together with orchestrator/UI. Restored baseline for section 2.                                                                                                                                                                        |
| `src/lib/sync/sync-beancount.ts`                      | Useful removal mixed with extensive storage/recovery rewrite; UI and callers were not updated. Restored baseline; implement narrow removal in section 2 and make safety corrections only after demonstrated regressions in section 4.                                    |
| `src/lib/sync/sync-common.ts`                         | Empty replacement module is unnecessary. Restored baseline; remove module with its consumers in section 2.                                                                                                                                                               |
| `src/lib/sync/sync-queries.ts`                        | Retain local-analysis helpers; remove retired templates only after caller checks in section 2. Restored baseline.                                                                                                                                                        |
| `src/lib/workers/ledger.worker.ts`                    | Preemptive currency/account extraction expansion. Restored baseline; test existing extraction before changing it in section 3.                                                                                                                                           |
| `src/routes/accounts/+page.svelte`                    | Rejected missing-book messaging and separate reference request machinery. Restored baseline; remove only IndexedDB merge in section 3.                                                                                                                                   |
| `src/routes/payees/+page.svelte`                      | Same; retain existing query/input behavior. Restored baseline for section 3.                                                                                                                                                                                             |
| `tests/beancount-reference-data.test.ts`              | Useful local-query helper regression, but premature removal assertions. Restored baseline; adapt with actual removal in section 2.                                                                                                                                       |
| `tests/dal.test.ts`                                   | Premature deletion while baseline consumers remain. Restored baseline until section 3.                                                                                                                                                                                   |
| `tests/sync-beancount.test.ts`                        | Retained exact-total/completed-only/stable-ID retry regression, adapting only the current Sync invocation. Other restored changes depend on uncommitted runtime behavior; restored baseline before adding this regression. Rework focused failure fixtures in section 4. |
| `src/lib/services/localReferenceData.ts` (untracked)  | Rejected book-readiness subsystem and unnecessary query indirection. Deleted restored file.                                                                                                                                                                              |
| `tests/local-reference-data.test.ts` (untracked)      | Useful real-WASM fixture ideas mixed with rejected readiness contracts. Deleted restored suite; build focused retained-query regressions in section 3.                                                                                                                   |

Runtime is deliberately unchanged by this recovery commit: the partial implementation
cannot form a coherent intermediate state. Useful implementation ideas remain available
in the reviewed Git object, not as another stash or an unapproved runtime patch.
Subsequent sections implement and validate each coherent change separately.

## Tooling limitation

Strict OpenSpec validation rejects the accepted deletion of obsolete scenarios.
The owner explicitly instructed implementation to continue despite this known error.
Accepted deltas and validation tooling remain unchanged; report this failure rather
than claiming validation passes. All other required checks still apply.
