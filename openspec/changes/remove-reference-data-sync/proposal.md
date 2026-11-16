# Proposal

## Why

Separate Accounts and Payees synchronization duplicates information already present in the downloaded Beancount book. The list pages already use local book queries, but an additional IndexedDB merge can introduce obsolete references or override current account data. Remove those independent paths while retaining the existing full Sync and local analysis.

## What Changes

- **BREAKING**: Remove independent Accounts/Payees synchronization, its controls, dedicated requests, response handling, obsolete settings, and metadata-only mode. Keep the existing explicit send → pull → reconcile flow and analysis refresh.
- Use the existing local book composition for account and payee lists, without the additional IndexedDB reference merge. Leave the old tables and rows untouched; do not introduce persistence, migration, or compatibility behavior.
- Preserve existing completed-only writeback, `!` drafts, persisted `cashier_id` retry, exact `@@`, confirmation-before-delete, failure recovery, Journal access, and offline analysis.
- Update diagnostics and documentation to remove the retired stages. Verify retained behavior through regression tests rather than introduce new account, payee, first-run, offline, or analysis requirements.
- During implementation, inspect and pop the earlier unapproved implementation stash, then remove or rework everything outside the accepted scope. Its code and main-spec changes are not accepted merely because they are in the stash.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ledger-sync`: Describe book synchronization and local-composition lists, remove scenarios for retired reference stages, and retain existing failure, refresh, and offline guarantees.
- `manual-transaction-writeback`: Remove the ledger-file enable condition and metadata-only scenario while retaining existing writeback guarantees.

The accepted delta specifications are the planning source of truth. Existing `transaction-entry` and `ledger-analysis` contracts are unchanged. No new missing-book message, first-run UI, account-creation flow, payee-entry feature, separate list-refresh stage, or reference availability/freshness contract is included.

## Impact

- Runtime: Sync route/orchestration, progress and settings, account/payee pages, and unused reference-network, DAL, and import/replace helpers. Preserve shared local query helpers and the existing worker architecture.
- Tests: verify removal of reference requests and stale IndexedDB influence; retain ordinary account/currency/payee behavior and full Sync, writeback, failure, and offline regressions.
- Documentation: update the relevant README and architecture descriptions; do not reintroduce rejected behavior through documentation or tests.
- Stash recovery: currently `stash@{0}`, object `195c302b9fb61e33fffc149e448e09ae8429a4e1`, titled `WIP unapproved local-book reference implementation before OpenSpec review`. Resolve its current selector by identity before popping; preserve accepted planning artifacts and unrelated user work.
- No new dependency, server API, schema migration, reference-data deletion, or server implementation is required. Existing writeback and infrastructure endpoints remain.
- The installed OpenSpec CLI rejects intentional scenario deletion in MODIFIED blocks. Treat that as a validation/sync blocker, not a reason to alter the accepted contract or expand implementation into a tooling project.
- This update authorizes planning only. Implementation, commits, pushing, merging, publication, deployment, and OpenSpec sync/archive are separate actions requiring the corresponding request.
