# Proposal

## Why

Saving an existing local journal transaction drops its persisted `cashier_id` during editor conversion and serialization. A later Sync can consequently assign a new identity to an operation that the server already received.

## What Changes

- Preserve the existing transaction's `cashier_id` through opening, editing, saving and reloading the local journal.
- Keep the same identifier for later writeback preparation and retries, including after a successful send followed by a failed pull.
- Add a regression test reproducing identity loss through the actual editor/save path, and retain independent identities for newly created or duplicated transactions.
- Deliver the fix as a separate commit from feature removal.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This fixes compliance with published `transaction-entry` / "Lossless Local Edit and Stable Identity" and `manual-transaction-writeback` / "Stable Transaction Identity". Those contracts remain unchanged; spec generation is skipped.

## Impact

- Local transaction representation/conversion, serialization and source-aware saving, plus focused unit/browser tests.
- No change to the Python API, server-origin record editing, ID assignment before first push, or synchronization confirmation rules.
- This is the existing G1 identity-loss bug, narrowly scoped to preserving `cashier_id`. Broader rich-source editing concerns remain governed by the accepted preservation/rejection contract.
