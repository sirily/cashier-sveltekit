# Proposal: Bootstrap Initial System Specs

## Why

Capture the behavior deliberately established in this personal fork and recorded in its
wiki documents, so later cleanup preserves the owner's workflows without freezing the
upstream feature inventory. The initial draft incorrectly included unused WebDAV and
turned some existing UI and implementation choices into obligations.

## What Changes

- Define four initial capability contracts around offline capture, explicit server Sync,
  confirmation-based cleanup, and trustworthy full-book analysis.
- Retain separate scenarios for success, failure, retry, conflicting identities, partial
  batches, and preservation of local and multi-currency data.
- Remove obligations to preserve particular cards, picker screens, report routes, query
  selection modes, placeholder accounts, or cache mechanisms merely because they exist.
- Keep account history and correct analysis as outcomes. Apply report-specific guarantees
  to any retained reports without making every existing report an obligatory feature.
- Keep API-token protection independent of optional settings transfer; do not require
  backup, preview, comparison, or restore features.
- Record each requirement's source and distinguish documented decisions from necessary
  safety elaborations and current implementation evidence in `design.md`.
- Use capability names and present-tense behavior, not historical delivery milestones.
- Documentation only: no runtime code, API behavior, dependencies, or copied wiki history changes.

## Capabilities

### New Capabilities

- `ledger-sync`: Authoritative server-book and reference-data pull, safe local replacement,
  zero-error acceptance, local composition, authentication, and credential protection.
- `manual-transaction-writeback`: Explicit push/pull/reconcile, stable local identity,
  completed-only submission, safe retries, partial success, and concrete failure explanations.
- `transaction-entry`: Offline manual capture and narrow local editing, completion-flag and
  posting fidelity, usable local references, and durable-save failure handling.
- `ledger-analysis`: Trustworthy full-book analysis and account history, applicable report
  semantics, explicit freshness, original currencies, valuation coverage, and completeness.

### Modified Capabilities

None. This is the initial baseline. All four capability files remain `ADDED` deltas in the
active change; the premature main-spec publication has been reversed.

## Impact

- Changes only OpenSpec artifacts. WebDAV is excluded by explicit owner decision, but its
  application code is not removed here. Other unused-feature removal also requires separate work.
- Existing UI is implementation evidence, not an automatic commitment to retain every
  screen or tool. Conditional scenarios protect data if optional features remain; they do
  not mandate keeping or adding those features.
- Known code deviations and additional safety cases are not represented as passing runtime
  tests. The change does not silently implement fixes or introduce new product functions.
- Snapshot preparation, validation, deduplication, and filesystem restrictions are external
  server obligations. Deployment routing remains owned by the deployment repository.
- Keep the change active for owner review. Publishing main specs and archiving require an
  explicit request; neither happens as part of this revision.
