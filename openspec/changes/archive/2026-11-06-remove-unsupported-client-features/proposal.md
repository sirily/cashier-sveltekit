# Proposal

## Why

This fork is a Beancount client of the owner's Python server, with offline capture and local analysis. Unused upstream transports, Ledger-cli compatibility, prototypes, and disconnected tooling obscure that architecture and increase regression risk.

## What Changes

- **BREAKING**: Remove Voice Entry, the peer-sync demo, WebDAV/cloud backup, filesystem synchronization, and their navigation, clients, credentials, and exclusive dependencies.
- **BREAKING**: Remove local book/transaction imports, OPFS file upload and drag-and-drop, backup/scheduled-record restore, and arbitrary settings JSON ingestion. External accounting data enters the PWA through the existing Python-server Sync flow; manual transaction entry and ordinary configuration controls remain.
- **BREAKING**: Remove Ledger-cli support and source selection; explicit Sync uses the fork's existing Beancount server flow only. Recognized legacy source selections must not strand existing installations.
- Remove unreachable DAL/storage-selection implementations, the test-only cross-list drag demo, four unused build dependencies, and disconnected Tailwind/source-manifest configuration.
- Preserve offline manual journal entry and local editing/deletion, confirmation-based writeback, reference data and account history, RustLedger WASM calculations, actual-book analytics, journal export and outbound local backup.
- **BREAKING**: Remove scheduled transaction creation/editing/actions/calendar, Upcoming Transactions, dedicated scheduled export, and the forecast driven by schedules, including its settings and home-card configuration. Preserve existing scheduled rows and their passive inclusion in credential-free outbound backup; no database reset or conversion into journal transactions.
- Fix stale full-book analysis after Journal Delete All and OPFS source saves, and reject readable but obsolete binary caches on cold load. Add warm-worker, browser-reload and cache-enabled regressions under the existing analysis-freshness contract.
- Fix loss of an existing local transaction's `cashier_id` when saving an edit, as a separate task and commit within this change before the removal sequence. Preserve the same ID on later Sync preparation/retry and independent identities for new or duplicated transactions.
- Fix the retained Settings file-picker return path as a separate task within this change: clear return parameters while keeping the Settings URL and selected value. Complete its regression checks before committing slice 4.
- Resolve PR #26 browser-QA findings D1–D4 and D6 within this change: preserve the editor on return from posting deletion/reorder, use the selected currency's balance for adjustments, retain Sync failure explanations through navigation, explain authorization failures, and align About/Help with the retained fork workflow. D5 (deployment access to server Reload) is explicitly excluded by the owner.
- The original nine removal commits are followed by separately tested cache-freshness, Delete All, OPFS-save fixes, one atomic schedule/forecast removal commit, and bounded PR #26 QA repairs, each leaving a coherent application; shared-code dependencies require dependency-aware rollback. Run the retained-workflow regression gate before every commit; stop on failure or unavailable required checks.
- Document the fork architecture in `docs/architecture.md`, link it from agent/project entry points, and retire `docs/completed-projects/`. OpenSpec owns requirements and change history; Git retains deleted historical documents.

## Capabilities

### New Capabilities

None. This change removes optional implementations and adds no business capability.

### Modified Capabilities

None. The published `transaction-entry`, `manual-transaction-writeback`, `ledger-sync`, and `ledger-analysis` contracts remain unchanged and apply in full. Their regression coverage is mapped in `design.md` and `tasks.md`.

The removed optional features have no published requirements to delete. Scope and transition handling are recorded in this proposal and design; `.openspec.yaml` uses `skip_specs: true` so the change carries no duplicate spec. Preserving actual-book reports, local deletion, journal export and outbound backup is an agreed boundary. The later QA decision retires schedule-driven forecasts and dedicated scheduled export; legacy scheduled rows remain available through outbound backup.

## Impact

- Runtime work affects local transaction identity preservation through editor conversion/save, navigation, settings and file-picker return URL handling, removed route groups, sync source selection, Ledger-cli query/parser branches, unused DAL/storage factories, drag-test fixtures, and package/configuration files. QA follow-up also covers schedule/forecast ownership, legacy home-card normalization, journal bulk deletion, OPFS save and full-book worker/cache freshness.
- No Python-server API or server-repository changes; no CRDT, S3, new transport, ledger-engine replacement, or upstream merge.
- Shared backup naming and API-token protection survive WebDAV removal. Legacy credential removal must not reset unrelated settings or financial data; removed file/drop/paste/restore entry points must leave existing data unchanged; outbound backups remain credential-free.
- Post-sync transaction editing/deletion and account creation/deletion are future work, not cleanup tasks. Retain their existing journal/editor/account foundations; this proposal does not design or implement those features.
- Previously removed eight orphan files are already committed in `7dc6bfad` and are not repeated here. Architecture/history documentation preparation is separate from the nine runtime slices.
- The page-content audit in design decision 7 records stale descriptions and deferred correctness findings across all 60 pages. The owner-approved PR #26 follow-up brings About/Help ownership and link corrections and D1–D4 into this change under design decision 12. Other audit findings remain outside scope; this is not general UI/analytics repair. The original QA report remains unchanged as evidence, not proof of fixes.
