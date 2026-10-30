# Design: Bootstrap Initial System Specs

## Context

See [proposal.md](proposal.md) for scope. This is an initial contract for the behavior the
owner deliberately established in this fork and recorded in the wiki, not an inventory of
all upstream code. The initial change is active after reversing premature publication.
WebDAV has never been used by the owner and is not wanted. No runtime code changes here.

## Goals / Non-Goals

**Goals:**

- Preserve offline manual capture, explicit server synchronization, and trustworthy
  full-book analysis while allowing unrelated upstream features to be removed later.
- Retain separate, testable success, failure, retry, partial-result, and data-safety scenarios.
- Identify documented decisions, implementation evidence, and safety elaborations without
  presenting all of them as historical owner decisions or passing runtime tests.
- Describe current capabilities without historical delivery labels.

**Non-Goals:**

- Requiring every current report page, home card, picker route, or optional tool to survive.
- Requiring a draft-management suite, a particular placeholder account, query-mode selector,
  cache format, settings-transfer interface, or backup product.
- Adding arbitrary server-ledger editing, hidden background writeback, or durable upload states.
- Reviving identifier-less structural matching, assigning PWA IDs to desktop records, or
  hiding source duplication through UI deduplication.
- Fixing application bugs, deleting features, rewriting copied wiki history, or deploying services.

## Decisions

### Scope follows fork decisions, not implementation inventory

The four capabilities protect behavior, not a required screen layout:

- `ledger-sync`: authoritative server-book and reference-data access, safe local replacement,
  validation, offline continuity, and authenticated requests.
- `manual-transaction-writeback`: the explicit push/pull/reconcile operation and its identity,
  rejection, confirmation, and retry guarantees.
- `transaction-entry`: local manual capture and narrow editing without loss of source identity
  or entered posting data, including safe retention of existing incomplete entries.
- `ledger-analysis`: full-book/account-history correctness, currencies, valuation coverage,
  freshness, and honest error/completeness reporting.

Report-specific scenarios apply when those reports are retained. They do not require every
current report or arbitrary-query UI. Selection scenarios protect input and locally available
references, not separate account/payee/currency/amount screens or a merge algorithm.
Cache scenarios apply only if caching is retained. Completion flags protect existing `!`
entries without requiring a full draft feature or exact automatic flag transitions.
Selective sync behavior is conditional on offering those choices; it does not mandate the
current checkbox layout or a metadata-only mode.

WebDAV is excluded by explicit owner instruction. Local API-secret protection remains
independent: any retained settings transfer must not expose or import the credential, but
no export, restore, preview, or comparison feature is required. The token can be the same
server credential entered manually on several devices; separate per-device tokens are not
required.

Alternative rejected: preserve a function just because it exists or was touched by a
maintenance PR. That would turn the unwanted upstream inventory into a product commitment.

### Required outcomes and implementation mechanisms are separate

Specs state observable behavior. The current light editor uses `ledgerService` and source
spans for `cashier.bean`; analysis pages use `ledgerWorkerClient` and `ledger.worker.ts`.
These explain current code, not a requirement to retain those exact classes or subscription
stores. `fullLedgerService.ts` is a parallel class, not proof of the active report path.

Current persistent report work runs in a worker. Candidate-server-book validation currently
parses separately on the calling thread. The analysis requirement concerns responsive
background report work, not a claim that every parser operation is already off the UI thread.
Queries currently return empty arrays when unloaded; readiness must prevent those arrays
from masquerading as a successfully executed empty query. Different readiness mechanisms
can satisfy the same contract.

Alternative rejected: document every internal mechanism as mandatory, or describe a current
bug as supported behavior merely to make a baseline appear fully implemented.

### Server validation and combined display are separate boundaries

The downloaded server book must pass zero-error validation before confirming local entries.
Invalid retained local entries must not stop valid independent batch items from reconciling.
Only afterward is display refreshed from the imported book plus remaining local overlay;
server validation success does not prove display refresh success.

Current display composition injects the configured book include in memory, never into the
on-disk overlay. `main.bean` is the default, not a universal filename restriction. The
production producer supplies a ready-to-read book with source includes combined and plugin
results applied. Recursive include/glob transport exists as compatibility code; this baseline
does not require adding or retaining a general filesystem-import interface because of it.

### Retry safety does not introduce a new product workflow

Stable `cashier_id` survives preparation, retries, and supported edits. Received rejections
veto removal. A lost POST response does not prove that differing local content was accepted
merely because the server book contains the same ID. Retry or authoritative equivalence
must resolve that ambiguity, without prescribing a fingerprint algorithm or new durable state.
Concurrency, stale-target, and malformed-response scenarios elaborate preservation of data;
they do not mandate a multi-user product, locking protocol, or reconciliation UI.

The API remains `POST /api/xact`, with raw transaction strings in `transactions`, synchronized
IDs, and per-item rejection reasons. Fixed `manual_transactions.bean` destination,
deduplication, conflict rejection, full candidate validation, and safe writes are external
backend obligations. The PWA cannot select another destination or edit arbitrary server records.

### Source precedence and provenance

Use source meaning and later corrections, not just timestamps:

- **Pull** — [accepted sync record](../../../../docs/cashier-beancount-sync-status.md) and
  [snapshot contract](../../../../docs/cashier-python-plugin-materialization-investigation.md):
  local overlay preservation, source-preserving ready-to-read book, zero parse errors.
- **Writeback** — the owner's PWA manual-writeback plan dated 2026-05-28 and the writeback
  procedure copied into [docs](../../../../docs/), together with
  [AGENTS.md](../../../../AGENTS.md): explicit Sync, persisted identity, completed-only sending,
  two meaningful states, partial success, concrete reasons, and confirmation before deletion.
  The procedure's identifier-less matching paragraphs are superseded, not current obligations.
- **Identity correction** — [duplicate incident](../../../../docs/cashier-sync-duplication.md):
  desktop IDs are not required; structural matching and UI masking are not the fix. The
  compact-header incident is closed, not reopened by this documentation work.
- **QA/operations** — [current QA](../../../../docs/cashier-qa-algorithms.md) and
  [deployment](../../../../docs/cashier-deployment.md): visible per-phase evidence, retry/conflict/
  mixed-batch coverage, retained browser data, authentication, and repository boundaries.
- **Currencies** — [finance-tool evaluation](../../../../docs/personal-finance-tool-evaluation.md):
  original commodities and explicit valuation coverage. The archived multicurrency QA record
  explains earlier display fixes, but its entire screen/preflight list is not current scope.
- **Owner clarification** — this review confirms the fork changes/wiki as baseline and
  excludes WebDAV. A general finance-app feature catalogue, external Money+ migration, and
  completed implementation plans do not independently establish new product obligations.

The table accounts for every requirement. **Documented** identifies its enduring source;
**safety elaboration** identifies reasoning added during this review. These labels are
provenance, not extra requirement states or implementation-completion claims.

| Capability / requirement                                              | Documented basis                                             | Safety elaboration or scope limit                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| ledger-sync / Server Ledger Pull                                      | Pull; QA/operations                                          | Selective work is honored if offered; no mandatory selection UI.                                                 |
| ledger-sync / Safe Ledger Replacement                                 | Pull; QA/operations data preservation                        | Partial writes, unreadable originals, and failed recovery expand the no-loss invariant.                          |
| ledger-sync / Full-Ledger Parse Gate                                  | Pull; Writeback                                              | Server-only validation is separated from invalid local overlay and display refresh.                              |
| ledger-sync / Standalone Snapshot Constraints                         | Pull; Identity correction                                    | External server book preparation, not client-side dropping or merging.                                           |
| ledger-sync / Root Book Assembly                                      | Pull; project architecture                                   | Missing/self-selected book handling protects completeness without mandating a file browser.                      |
| ledger-sync / Read-Only Pull Boundary                                 | Pull; Writeback                                              | The prohibition applies to pull, not the separate explicit send operation.                                       |
| ledger-sync / API Bearer Authentication                               | QA/operations authentication rollout                         | Explicit errors and no tokenless fallback elaborate the protected API boundary.                                  |
| ledger-sync / Local API Credential Protection                         | Authentication rollout; credential filtering in owner PR #19 | No new credential model; transfer/inspection scenarios are conditional, not a backup commitment.                 |
| ledger-sync / Sync Diagnostics And Offline Continuity                 | Pull; QA/operations                                          | Distinguish partial outcomes and display failure without routine storage resets.                                 |
| manual-transaction-writeback / One-Button Sync Operation              | Writeback                                                    | Existing selectable work is not an obligation to retain the current controls.                                    |
| manual-transaction-writeback / Stable Transaction Identity            | Writeback                                                    | Edit, storage-error, and identical-independent-entry cases elaborate stable identity.                            |
| manual-transaction-writeback / Two Persistent States Only             | Writeback                                                    | Meaningful conditions, not a required database enum.                                                             |
| manual-transaction-writeback / Completed-Only Push                    | Writeback; QA/operations                                     | Preserves existing incomplete entries; does not require a draft suite.                                           |
| manual-transaction-writeback / Narrow Writeback API Contract          | Writeback; current API evidence                              | Unreadable storage and malformed replies elaborate safe failure handling.                                        |
| manual-transaction-writeback / Idempotent Retry                       | Writeback; Identity correction                               | Resolving lost/conflicting outcomes is additional protection, not a revived structural matcher.                  |
| manual-transaction-writeback / Confirm-Before-Delete Reconcile        | Writeback; QA/operations                                     | Metadata ownership, completed-server flag, stale files, and concurrent changes refine confirmation.              |
| manual-transaction-writeback / Partial Batch With Concrete Rejections | Writeback; QA/operations                                     | Rejection does not stop independent valid items or authorize unsafe deletion.                                    |
| manual-transaction-writeback / Post-Reconciliation Ledger Refresh     | Writeback single-result outcome; duplicate correction        | Refresh/no-op ordering and distinct display health elaborate the visible outcome.                                |
| manual-transaction-writeback / Sync Failure Explanations              | Writeback procedure; QA/operations                           | Navigation retention elaborates availability until the next run, not restart-persistent state.                   |
| transaction-entry / Local Quick Entry                                 | Owner mobile use; Writeback                                  | Restart survival and immediate visibility make successful local capture meaningful.                              |
| transaction-entry / Local Overlay Distinction                         | Writeback local/synced distinction                           | Observable distinction, not a required badge string or translation.                                              |
| transaction-entry / Source-Position-Aware Save                        | Owner local editing; project architecture                    | Ambiguous/stale source refusal protects neighboring records without requiring an editing algorithm.              |
| transaction-entry / Lossless Local Edit and Stable Identity           | Writeback stable ID; currency/source fidelity                | Preserve or reject unsupported constructs; no general rich editor is required.                                   |
| transaction-entry / Completion Flags and Retained Incomplete Entries  | Writeback; QA/operations incomplete-entry boundary           | Protect saved entries without prescribing placeholder accounts or draft UI choreography.                         |
| transaction-entry / Posting and Reference Selection Fidelity          | Pull reference availability; Currencies; local entry         | Posting/zero/omitted-unit and cancellation cases protect input, not particular pickers or merge logic.           |
| transaction-entry / Durable Save and View Refresh Isolation           | Owner offline capture; Writeback                             | Durable success, retained form, and refresh isolation elaborate no data loss.                                    |
| ledger-analysis / Background Full Ledger                              | Owner desktop analysis; project architecture                 | Responsive full-book results without prescribing classes, stores, or every parser's thread.                      |
| ledger-analysis / BQL Query Interface                                 | Owner full-book queries; current query contract              | Readiness, empty/error distinctions do not require a particular query screen or empty-array convention.          |
| ledger-analysis / Report Semantics                                    | Owner analysis/account history; Currencies                   | Named report scenarios are conditional; they do not preserve the whole upstream report inventory.                |
| ledger-analysis / Currency Fidelity                                   | Currencies; Pull source semantics                            | Missing/stale valuation and long-symbol cases prevent silent omission without requiring an original/base toggle. |
| ledger-analysis / Report Freshness                                    | Owner reliable analysis; Writeback single-result outcome     | Current/stale outcomes, not exact mount events, cards, subscriptions, or automatic watchers.                     |
| ledger-analysis / Transaction Identity and Posting Coverage           | Identity correction; account-history use                     | Identical headers and multiple account postings must not lose independent contributions.                         |
| ledger-analysis / Cache and Book Completeness Safety                  | Authoritative book; Pull zero-error boundary                 | Cache safeguards apply only if retained; missing/error book results cannot look complete.                        |

## Verification Status and Known Gaps

### Evidence boundary

Reviewed application commit: `25be4b0a840409a33978cf7b6bfd87825fbe5f80` plus working-tree
documentation. GitNexus was bound to this repository at `19f3bfe`; no `src/` or `tests/`
changes exist between that indexed commit and reviewed HEAD. Current source inspection
verified findings. Markdown is unindexed, so graph `UNKNOWN` results were supplemented by
reference searches, not treated as an all-clear.

OpenSpec checks structure, not runtime compliance. Earlier targeted unit-test attempts
could not start (`vitest: command not found`). Isolated Node probes substituted dependencies
and do not establish real WASM, browser, server, or deployment acceptance. No new runtime
acceptance or bug fix is claimed here. Historical wiki acceptance is evidence of the
recorded deployment, not a test of every newly elaborated scenario.

### Observed alignment

Selected reference data and the enabled ledger operation run in the existing sync path;
completed entries are prepared with IDs, received rejections veto removal, and downloaded
server-book parse failures prevent normal reconciliation. Full-book report work uses the
worker; composition injects the selected book in memory. Ordinary successful settings
restore filters imported API tokens and retains the local credential.

### Remaining runtime deviations and uncertainties

| ID  | Outcome and current evidence                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Stable identity/lossless editing: `ledgerService.ts:322-335` omits metadata in the editor model; `xactUtils.ts:34-57` rebuilds without metadata, tags/links, prices/costs, or comments. Supported editing must preserve them or reject without loss.                                        |
| G2  | Durable persistence/safe reads: `opfslib.ts:18-66` swallows handle failures and can resolve without writing; reads conflate absence and access failure. Capture, ID preparation, and replacement cannot treat that as reliable storage success.                                             |
| G3  | Unknown POST result: `sync-beancount.ts:594-607` continues after failure, while `manual-writeback.ts:170-197` can remove differing local content on ID presence without a received rejection.                                                                                               |
| G4  | Parsed confirmation: `parseDownloadedLedger` retains errors, not the parsed transaction set; `manual-writeback.ts:218-244` scans text without reliable metadata ownership and assumes spaced headers. This is separate from the closed server duplication incident.                         |
| G5  | Book-update recovery: `sync-beancount.ts:703-726` lacks rollback for partial writes or root-setting failure; restoration is only in the parse catch. Recovery failures can obscure the initial failure.                                                                                     |
| G6  | Visible explanations: GET failures lose status/reason at `sync-beancount.ts:353-357,408-413`; Sync-page explanations disappear on navigation despite the intended lifetime until another run.                                                                                               |
| G7  | Edit target safety: listing has transaction-only fallback spans at `ledgerService.ts:275-291`; edits/deletes use document symbols at `:126-160`. Consistent location and stale-target handling need verification/fixes.                                                                     |
| G8  | Current/complete analysis: reload can yield a final empty result; some mutations do not refresh full-book state, and missing-book/cache freshness is not fully established. Availability does not check the returned parse-error count. Exact subscriptions are not themselves obligations. |
| G9  | Currency/valuation fidelity: income-expense skips symbols longer than four characters; account history selects the first currency balance. Retained conversions need explicit policy/date/coverage rather than silently complete-looking totals.                                            |
| G10 | Identity/posting coverage: search groups by date/payee/narration; account history uses only the first matching local posting and nonunique content matching. Conditional search and required account history must not merge independent contributions.                                      |
| G11 | Display health: `sync-beancount.ts:612-619` suppresses post-reconciliation refresh exceptions. Validated server data does not prove the visible book refreshed.                                                                                                                             |
| G12 | Conditional settings restore: `backupService.ts:13-20` clears settings before insertion, so failure can erase the local token. This matters only while settings restore is retained, not as a reason to preserve that feature.                                                              |

These findings are not a complete security audit or an implementation backlog authorized
by this change. Safety elaborations such as concurrency preservation, stale-target checks,
malformed-response handling, recovery errors, and valuation coverage still require focused
verification. Source anchors describe the reviewed commit and can move after later fixes.

### Acceptance for later runtime changes

Use [current QA](../../../../docs/cashier-qa-algorithms.md) with deployment-shaped local
Compose/Caddy and retained browser storage. Create a local transaction through visible
controls, click Sync, and corroborate the UI with POST, server-file, prepared-book, OPFS,
parse, reconciliation, and single-operation evidence. Include lost responses/failed pulls,
same-ID conflicts, mixed batches, incomplete entries, compact desktop controls, and repeat
Sync. Verify original/converted currencies and missing-price cases for retained views.
Production claims need an authorized deployed flow, not only mocked unit tests or API calls.

## Risks / Trade-offs

- [Mistaking implementation for product scope] → Keep optional mechanisms conditional and
  use the provenance table when deciding what to remove later.
- [Safety scenarios exceed proven behavior] → Keep deviations visible; document validation
  is not a runtime pass, and no bug is fixed silently in this change.
- [Removing dependencies needed by owner workflows] → Preserve input/reference availability,
  local sources, and complete account-history outcomes without freezing their route layout.
- [Older wiki text contradicts later decisions] → Apply explicit source precedence without
  rewriting history or resurrecting cancelled matching logic.
- [Premature publication implies acceptance] → Keep this initial change active and owner
  wording review unchecked until explicitly approved.

## Publication Plan

All four files remain `ADDED` capability deltas. Main specs contain only `.gitkeep` while
review continues. Do not publish or archive automatically. After owner approval and an
explicit archive request, use the normal OpenSpec workflow. Runtime corrections and
unused-feature removal require separately bounded work and verification.
