# Proposal

## Why

Issue #31 requires entering and correcting a two-posting cross-currency operation directly in Journal. Today the form cannot represent total price, reports a false imbalance, and cannot safely edit the annotated postings. Ledger diagnostics are also split between Validation and About; consolidate access under Validation and retire the unnecessary local-only inspector.

## What Changes

- Use the ordinary Journal form, without an exchange mode, confirmation step, or separate transfer screen.
- For two explicit, finite, nonzero posting amounts of opposite signs in different currencies, automatically put `@@` on the negative posting using the positive posting's exact entered amount and currency.
- Display a directional, informational exchange rate; never reconstruct the received amount from a rounded rate.
- Make the balance indicator and Validate use the same price-aware balance calculation.
- Restore supported total-price postings from verified source on reopening and safely update their units and total price while preserving identity, metadata, comments, and neighbors.
- Add access to the existing full-book inspector from Validation, remove Experiments from About, and retire the local-only `/ledger` screen while retaining `/ledger/multi`.
- Update the retained inspector's labels to describe the full local analysis book rather than obsolete `parseMultiFile` terminology.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `transaction-entry`: Ordinary two-posting cross-currency capture, total-price-aware validation, lossless reopening and supported corrections.
- `ledger-analysis`: Extend existing diagnostic coverage with access from Validation and retirement of the local-only inspector.

## Impact

Affects `Posting`, Journal editor controls and validation, `xactToBeancountText`, `DirectiveFormatter`, local source projection and `mergeTransactionEdit`, plus unit and browser tests. The existing `manual-transaction-writeback` contract is unchanged; Sync coverage is regression verification only. No new dependencies, routes, server API, persistent transaction states, or storage migration are intended. RustLedger WASM does not distinguish `@` from `@@` in parsed posting projections, so verified source must retain that distinction.

Also affects About, Validation, the inspector routes, and their navigation tests. Retain `JsonTreeNode`, the full-book worker client, and Journal's `ledgerService`; diagnostic changes do not alter ledger composition, validation logic, or accounting source files.

General investment/cost editing, commission allocation, automatic pricing of multi-posting operations, and exchange-rate services are out of scope. Existing unsupported source constructs must remain preserved or fail closed, not be silently normalized.
