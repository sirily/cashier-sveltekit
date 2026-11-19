# Implementation verification

## Scope delivered

- Removed independent Accounts/Payees Sync controls, ledger-file enable/select-all controls, metadata-only execution, retired option definitions, dedicated server BQL requests, reference response handlers and unused import/replace helpers.
- Retained explicit send → download/validate → reconcile → existing local analysis refresh. An empty eligible batch still pulls; visiting Sync does not synchronize automatically. Diagnostics distinguish send, pull, parse, reconciliation and display-refresh outcomes without a separate reference stage.
- Accounts and Payees retain their existing local worker/BQL query path, without IndexedDB supplementation. Removed the unused DAL and its obsolete tests. Database schema and legacy reference rows remain unchanged.
- Corrected a demonstrated worker extraction failure: unrestricted open accounts now include currencies from actual postings. Unused open accounts and declared currencies remain available; closed and unselected accounts are excluded.
- Preserved existing payee selection/free-text controls, Journal access and downloaded-book offline analysis. No missing-book message, first-run UI, reference readiness subsystem or new account/payee feature was added.
- Corrected demonstrated retained-safety failures: validate the candidate before storage replacement; propagate storage errors; recover attempted partial writes and root selection independently; require parsed transaction confirmation plus acceptance of unchanged local content before removal; preserve unresolved outcomes, drafts, exact total prices, source boundaries and observed concurrent edits.
- Reviewed and popped the identified earlier stash. Its rejected implementation and published-spec edits were discarded as recorded in `stash-review.md`. No stash entry or unresolved conflict remains.

## Main implementation locations

| Area                             | Files                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Sync UI/settings/progress        | `src/routes/sync/+page.svelte`, `src/lib/settings.ts`, `src/lib/stores/syncProgressStore.ts`                                          |
| Network/orchestration/recovery   | `src/lib/sync/sync-beancount.ts`                                                                                                      |
| Writeback and strict journal I/O | `src/lib/sync/manual-writeback.ts`, `src/lib/sync/journal-storage.ts`                                                                 |
| Local lists and currencies       | `src/routes/accounts/+page.svelte`, `src/routes/payees/+page.svelte`, `src/lib/workers/ledger.worker.ts`                              |
| Retired code                     | `sync-common.ts`, `dal.ts`, `dbdal.ts` deleted; unused reference methods/templates removed from `appService.ts` and `sync-queries.ts` |
| Documentation                    | `README.md`, `docs/architecture.md`                                                                                                   |

Shared BQL helpers used by local security analysis remain. Published specifications under `openspec/specs/` and `src/lib/data/db.ts` are unchanged from the release baseline. Accepted delta contracts are unchanged. No dependency or deployment configuration was changed.

## Executed checks

| Check                             | Result                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm run lint`                    | Passed: formatting and Oxlint, zero warnings/errors                                                                            |
| `npm run lint:svelte`             | Passed                                                                                                                         |
| `npm run check`                   | Passed: zero errors and warnings                                                                                               |
| `npm run test:unit -- --run`      | Passed: 42 files, **818 tests**                                                                                                |
| `npm run check:build`             | Passed: warning-gated static production build                                                                                  |
| `npm run test:e2e -- --workers=2` | Passed: **154 tests**                                                                                                          |
| `git diff --check`                | Passed                                                                                                                         |
| GitNexus pre-commit analysis      | Completed without `partial`/`truncated` results; runtime writeback changes classified CRITICAL and reviewed/tested accordingly |
| Strict OpenSpec validation        | Failed with the known intentional-scenario-deletion errors below; not bypassed or claimed passing                              |
| Real Python-server integration    | Unavailable: no authorized test environment supplied; no real server mutations attempted                                       |

The retained-workflow browser gate also passed **105 tests** before the section 4 commit. It includes offline journal capture/edit/delete, Sync success/failure/retry, account history and book calculations, export, credential-free outbound backup, and retired import/restore entry points leaving stored data unchanged.

## Focused regression evidence

- Real worker/WASM tests cover unused open accounts, declared and unrestricted multi-currency accounts, full commodity symbols, selected-book plus journal payee queries, closed/unselected exclusion, real binary-cache restoration and invalidation, with caching enabled and disabled.
- Browser tests seed contradictory legacy Accounts/Payees rows, prove they cannot supplement or override lists, and read back unchanged rows. Existing editor account/payee controls and free-text selection remain usable.
- Production-service-worker tests cover cold offline Journal and downloaded-book queries with browser HTTP cache disabled, in both analysis-cache modes.
- Full HTTP-mocked Sync tests exercise real browser preparation, WASM validation, OPFS persistence, reconciliation and analysis reload. Warm and cold lists reflect synchronized operations and remaining drafts, and repeat Sync does not repost a confirmed operation. Expected traffic is writeback and infrastructure only, never Accounts/Payees BQL requests.
- Full-cycle unit tests cover exact authored `@@`, unchanged `!`, persisted identity after accepted send followed by failed pull or parse, idempotent retry under the mock server contract, and confirmation/removal exactly once.
- Fault-injection tests cover inaccessible storage, failed reads/open/write/close, incomplete download, parser initialization/errors/exceptions, partial replacement, root-setting mutation then failure, independent recovery errors, reconciliation persistence failure and observed concurrent journal changes.
- Confirmation tests use the real supported WASM query over parsed `entries`, including completed transactions without postings, excluding posting/other-directive metadata and drafts. Raw-file confirmation fallback was removed.
- Missing, malformed or lost per-entry POST outcomes cannot authorize removal. Omitted submitted IDs have visible unresolved send errors. Rejections veto removal and changed same-ID local source remains local.
- Refresh regressions verify that durable reconciliation precedes reload, including no-op reconciliation. Display-refresh failure does not become a server parse failure or restore confirmed copies.

## Known OpenSpec limitation

`npm run check:specs` exits 1: four published capabilities pass, while change `remove-reference-data-sync` fails because OpenSpec 1.14.3 rejects these intentional scenario omissions from MODIFIED requirements:

1. `ledger-sync / Server Ledger Pull`: `Metadata-only synchronization`, `Unselected reference data`.
2. `ledger-sync / Sync Diagnostics And Offline Continuity`: `Reference data is not full-book acceptance`.
3. `manual-transaction-writeback / One-Button Sync Operation`: `Metadata-only synchronization`.

The owner explicitly instructed implementation to continue despite this error. The removed scenarios were not restored, the accepted behavior was not changed, and checks/tooling were not disabled. Spec synchronization and archival were not performed; their tooling issue remains unresolved.

## Evidence boundaries and operational limits

- Mocked HTTP tests establish client behavior only. They do not prove Python-server validation, deduplication, plugin materialization or exact `@@` snapshot semantics.
- Journal save checks reject observed source changes before committing and verify persisted content. They are not an atomic cross-tab compare-and-swap mechanism; a competing writer between the final check and close remains a residual concurrency limitation. No broad editor locking change was introduced.
- Fault injection proves attempted recovery and explicit incomplete-recovery diagnostics. Storage that also rejects recovery cannot be claimed intact; pending local entries are not reconciled on those failed pulls.
- No new missing-book UI was implemented, following the accepted scope rather than the superseded initial wording.
- No merge, publication, deployment, spec sync or archive was performed.
