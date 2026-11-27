# Proposal

## Why

The calculator cannot use a local account balance without the user looking it up and retyping it. The decorative logo is styled as a key but has no action.

## What Changes

- Give the existing Cashier logo key an action that inserts or replaces an operand with an account balance. Keep its appearance.
- Open the relevant account directly when the calculator has an account context; otherwise offer account search for each operand.
- Show signed balances by original commodity without converting them or editing the source account or transaction.

## Capabilities

### New Capabilities

- `calculator`: offline account balance operands in the shared calculator and explicit result application from an amount editor.

### Modified Capabilities

## Impact

Shared calculator body, standalone calculator and amount-entry callers, local RustLedger analysis, and calculator tests. No changes to sync, stored data formats, or backend APIs.
