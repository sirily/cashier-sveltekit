# Design

## Context

See `proposal.md`. The identity already exists in transaction metadata in local `cashier.bean`. It is lost at two boundaries: `LedgerService.directiveToXact()` builds an editor model without metadata, and `xactToBeancountText()` builds a replacement directive without that metadata. The editor then replaces the original source span with this text.

The published identity/edit requirements already cover this bug; they need no new specification. Restore and other retiring functions are outside this task.

## Goals / Non-Goals

**Goal:** Saving a supported edit to an existing local transaction retains its exact existing `cashier_id`, and later preparation uses that same ID.

**Non-Goals:** Server editing, new identity protocols, API changes, backup repair, general rich-source editor redesign, or feature removal.

## Decisions

Preserve the existing ID through the actual load/edit/serialize/save pipeline. Choose the smallest existing model/metadata or source-preservation seam that carries it across both boundaries; changing only one boundary leaves the bug intact. Editing keeps the original ID; a genuinely new or duplicated transaction has an independent identity assigned by the existing preparation flow. Keep the server's existing same-ID conflict handling when edited content differs from a previously accepted record.

Add a failing regression first using a saved source with an existing ID. Exercise narration edit, durable save and reopen, then writeback preparation; assert unchanged ID, one local entry and untouched neighboring source. Include accepted-send/failed-pull retry and new/duplicate identity isolation. Use actual conversion/serialization or browser save paths, not a test that manually inserts an ID only at the final formatter.

Preserve applicable existing metadata/source behavior under the published contract. An unrelated unsupported rich-source case remains subject to explicit rejection rather than silent data loss; do not expand this small fix into a complete editor rewrite.

## Risks / Trade-offs

- Preserving the ID on only load or only serialization still loses it at the other boundary → test the full pipeline.
- Copying the existing ID into a new operation conflates identities → test new and duplicated records separately.
- Browser/UI success can hide changed source → inspect persisted journal content after reload and the prepared writeback payload.

## Verification

Run focused identity/editor/writeback tests first, followed by type-check, unit tests, production build and relevant browser journal/Sync tests. Obtain impact evidence before editing and graph-change analysis before the separate commit. Record actual results; do not repair or verify retiring backup/import features as part of this fix.
