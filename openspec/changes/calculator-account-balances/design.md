# Design

## Context

Home and `/calculator` share `CalculatorBody`; only the route can apply a result to an amount request. The full-book worker already owns local analysis of the selected book and the journal overlay.

## Goals / Non-Goals

Keep the picker within the calculator, preserve operand source labels and signed quantities, and never reroute through the global account selection used by the transaction editor. No currency conversion, transaction history picker, or storage migration.

## Decisions

- Use a modal opened on demand. In general mode, reuse the existing searchable account list in selection mode. In a scoped amount request pass the source account explicitly; the Home body receives no editor context.
- Query original signed quantities by commodity for the exact account through the local worker, using all posting dates like the account screen. Check diagnostics in the account chooser and balance lookup so incomplete books are not shown as empty. Do not use the existing lossy helper that can coerce an invalid balance to zero.
- Use calculator tokens for active operands and their source labels. An explicit tapped operand takes precedence; otherwise replace the trailing operand or insert into an empty operand position. Token-based arithmetic preserves negative operands without confusing their sign with subtraction, and avoids dynamic evaluation. Decimal arithmetic keeps imported sums meaningful. The picker borrows no transaction selection state.

## Risks / Trade-offs

- Account quantities are original units, not converted values. Label the commodity at selection time and in the expression; the calculator still performs numeric arithmetic, not currency conversion.
- A pending or refreshed ledger must not expose a stale selectable balance. Reuse the existing version-aware request pattern and invalidate a pending lookup when its dialog closes or account changes.
- The calculator receives and returns decimal text. Posting editing retains that text alongside its numeric projection; results outside the supported numeric range are not applied. No implicit apply or currency update.
