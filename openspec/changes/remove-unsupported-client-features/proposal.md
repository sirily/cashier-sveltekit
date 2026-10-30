# Proposal

## Why

This fork is a Beancount client of the owner's Python server, with offline capture and local analysis. Unused upstream transports, Ledger-cli compatibility, prototypes, and disconnected tooling obscure that architecture and increase regression risk.

## What Changes

- **BREAKING**: Remove Voice Entry, the peer-sync demo, WebDAV/cloud backup, filesystem synchronization, and their navigation, clients, credentials, and exclusive dependencies.
- **BREAKING**: Remove local book/transaction imports, OPFS file upload and drag-and-drop, backup/scheduled-record restore, and arbitrary settings JSON ingestion. External accounting data enters the PWA through the existing Python-server Sync flow; manual transaction entry and ordinary configuration controls remain.
- **BREAKING**: Remove Ledger-cli support and source selection; explicit Sync uses the fork's existing Beancount server flow only. Recognized legacy source selections must not strand existing installations.
- Remove unreachable DAL/storage-selection implementations, the test-only cross-list drag demo, four unused build dependencies, and disconnected Tailwind/source-manifest configuration.
- Preserve offline manual entry and local editing/deletion, confirmation-based writeback, reference data and account history, RustLedger WASM calculations, existing analytics, ordinary export and outbound local backup.
- Deliver nine separately verified implementation commits in a defined sequence, each leaving a coherent application; shared-code dependencies require dependency-aware rollback. Run the retained-workflow regression gate before every commit; stop on failure or unavailable required checks.
- Document the fork architecture in `docs/architecture.md`, link it from agent/project entry points, and retire `docs/completed-projects/`. OpenSpec owns requirements and change history; Git retains deleted historical documents.

## Capabilities

### New Capabilities

None. This change removes optional implementations and adds no business capability.

### Modified Capabilities

None. The published `transaction-entry`, `manual-transaction-writeback`, `ledger-sync`, and `ledger-analysis` contracts remain unchanged and apply in full. Their regression coverage is mapped in `design.md` and `tasks.md`.

The removed optional features have no published requirements to delete. Scope and transition handling are recorded in this proposal and design; `.openspec.yaml` uses `skip_specs: true` so the change carries no duplicate spec. Preserving existing reports, local deletion, export and outbound backup is an agreed boundary of this cleanup.

## Impact

- Runtime work affects navigation, settings, removed route groups, sync source selection, Ledger-cli query/parser branches, unused DAL/storage factories, drag-test fixtures, and package/configuration files.
- No Python-server API or server-repository changes; no CRDT, S3, new transport, ledger-engine replacement, or upstream merge.
- Shared backup naming and API-token protection survive WebDAV removal. Legacy credential removal must not reset unrelated settings or financial data; removed file/drop/paste/restore entry points must leave existing data unchanged; outbound backups remain credential-free.
- Post-sync transaction editing/deletion and account creation/deletion are future work, not cleanup tasks. Retain their existing journal/editor/account foundations; this proposal does not design or implement those features.
- Previously removed eight orphan files are already committed in `7dc6bfad` and are not repeated here. Architecture/history documentation preparation is separate from the nine runtime slices.
- The page-content audit in design decision 7 records stale descriptions and deferred correctness findings across all 60 pages. About/Help ownership and link corrections are recorded for separate OpenSpec follow-up; this audit does not authorize runtime edits or expand the nine cleanup commits into general UI/analytics repair.
