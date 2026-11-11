# Design

## Context

See proposal.md for motivation. The existing editor represents postings as account, numeric amount, and currency. `xactToBeancountText` omits prices, `DirectiveFormatter.formatPriceAmount` always emits `@`, and XactEditor and the tx route independently check unweighted currency totals. `mergeTransactionEdit` preserves source but deliberately rejects annotated posting rewrites.

An installed-WASM probe confirmed that `-10 GBP @@ 12.30 USD` and `-10 GBP @ 12.30 USD` produce identical posting price projections. `getXactsWithSpans` already provides verified source association; that source, not a guessed parsed price, must distinguish the annotations. The recent consecutive-edit fix retains the updated span after saving and must continue to work.

Sync prepares and sends raw source blocks with stable identities; it does not need a new exchange protocol.

## Goals / Non-Goals

**Goals:** Keep ordinary posting entry and local source ownership; preserve the distinction between entered units, total price, and display-only rate throughout save, reopen, and edit.

**Non-Goals:** General price/cost editing, cost-basis reconstruction, rate lookup, investment booking changes, and automatic inference for commissions or multi-posting operations. Account categories do not select the behavior.

## Decisions

### One narrow inference rule, no exchange workflow

Recognize exactly two explicit account/amount/currency postings with finite nonzero opposite-sign amounts and different currencies. Infer total price only for otherwise unpriced postings, regardless of row order or account category. Serialize the positive amount and currency onto the negative posting as `@@`. Existing explicit `@`, cost annotations, or unsupported structures must not be silently converted.

Derive inferred state from current form values rather than persisting a transfer-mode flag or synchronizing a rounded rate back into the model. Same-currency ordinary postings remain unpriced. Invalid intermediate input must not generate NaN/Infinity annotations or stale inferred prices. Restored explicit source annotations remain subject to safe source editing rather than being silently discarded when a form no longer qualifies.

Alternative rejected: a dedicated exchange screen or confirmation button adds an unnecessary workflow to the ordinary two-posting operation.

### Preserve total-price semantics at the source boundary

Extend the local posting representation narrowly enough to distinguish explicit total price from unit price; do not overload Currency with Beancount syntax. When restoring local entries, use each verified DirectiveSpan to recover the original annotation kind and decimal text, associated with its actual posting. Do not identify rows by account alone or recover the marker from the WASM price object.

Carry exact entered decimal values for exchange units and total price through serialization; a numeric-only round trip must not become their source of truth. Reuse existing Big decimal arithmetic for rate and weights. Keep ordinary numeric consumers compatible instead of globally rewriting accounting models. The representation must survive account/calculator selection and local remembered-transaction serialization without dropping its price kind or substituting a stale decimal value after a numeric edit.

Extend `DirectiveFormatter` explicitly for total price while preserving existing unit-price behavior. Avoid a global replacement of `@` with `@@` or formatter-based reconstruction of rich existing source.

### Narrow, source-preserving posting changes

Extend `mergeTransactionEdit` to recognize supported total-price rows and surgically replace edited account, unit, currency, and total-price tokens. Preserve transaction/posting metadata, comments, whitespace, and unaffected decimal spellings. The positive posting remains authoritative for a supported correction to total price. No-op and header-only changes must preserve source without normalizing it.

Retain existing rejection paths for unknown syntax, cost basis, ambiguous row association, unsupported structural edits, or stale source. Do not relax safety merely to make the serializer accept annotations. The updated span must cover the actual saved source after every correction.

Alternative rejected: rebuilding the entire transaction from WASM loses source annotations and metadata and cannot distinguish total from unit price.

### Shared balance semantics

Use one pure balance/weight calculation for the indicator and Validate, including inferred and supported explicit total prices. For negative units the total price contributes a negative weight in its price currency, while the positive row contributes its units. The informational rate is received amount divided by the magnitude of spent amount, with explicit currency direction. Rounding is presentation only. Preserve ordinary omitted-unit and same-currency behavior.

### Verify the unchanged synchronization contract

No Sync behavior or requirements change. Add raw-payload and reconciliation regression cases against the existing `manual-transaction-writeback` contract rather than replacing the writeback pipeline. Mocked API tests establish client preservation and confirmation behavior, not acceptance or deduplication by the real Python server. Validate the actual Python-server flow separately when available and report its availability truthfully.

### Consolidate diagnostic navigation without changing analysis

Validation links to the existing `/ledger/multi` inspector, which keeps using `ledgerWorkerClient`. Remove the About Experiments section and only the local `/ledger/+page.svelte`; retain `JsonTreeNode.svelte` for the full inspector and `ledgerService` for Journal. Update the full inspector's labels, not its analysis or reload implementation. No replacement local-only inspector or new route is needed. Browser tests must cover the new entry point, the retired route, unchanged source files, and retained About update controls.

## Risks / Trade-offs

- WASM omits annotation kind and may expose booked values → recover supported semantics from verified source; test `@` versus `@@` explicitly.
- Existing numeric amount bindings can round decimal input or leave stale text after calculator changes → keep authoritative exchange decimals and numeric edits coherent at the input boundary; test nonterminating rates and precise amounts.
- Token edits can damage comments or metadata → bounded posting recognition, exact-source assertions, and fail-closed unsupported cases.
- Automatic inference can conceal an unintended two-currency entry → keep both original amounts/currencies and the directional rate visible; do not introduce a confirmation workflow contrary to the agreed behavior.
- Existing unit and total prices must not be conflated → regression tests for legacy annotations, costs, splits, no-op edits, and ordinary same-currency entries.

## Migration Plan

No IndexedDB migration or server contract change. Existing Beancount files remain authoritative and unchanged until an explicit save. Previously stored unpriced cross-currency entries acquire total price only on an explicit supported save. Rollback preserves files; an older client may reject edits to newly annotated rows but must not reinterpret their persisted syntax.
