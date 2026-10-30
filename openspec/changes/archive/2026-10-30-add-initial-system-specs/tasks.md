# Tasks: Bootstrap Initial System Specs

## 1. Reopen the initial change and correct scope

- [x] 1.1 Restore `add-initial-system-specs` from the archive with its original metadata; verify that `openspec status --change add-initial-system-specs --json` resolves the active change.
- [x] 1.2 Remove the prematurely published capability specs without losing their corrections; verify that all revised requirements are retained in active `ADDED` deltas and main specs contain only `.gitkeep`.
- [x] 1.3 Remove the unused WebDAV capability and correct its usage claims; verify that proposal and delta inventory contain four capabilities and document the owner's explicit exclusion without deleting runtime code.

## 2. Specify and review each retained capability

- [x] 2.1 Revise `ledger-sync` with separate selected-stage, file-safety, parse, snapshot, composition, authentication, credential, and offline scenarios; verify consistency with the accepted server-book pull boundary, deployment authentication contract, and current code findings.
- [x] 2.2 Revise `manual-transaction-writeback` with identity, completion flags, API, retry/conflict, parsed confirmation, partial-batch, refresh, and explanation scenarios; verify that missing/lost acceptance never authorizes unsafe deletion and desktop IDs are not required.
- [x] 2.3 Revise `transaction-entry` with offline/restart persistence, local-only scope, source mapping, lossless edit, retained incomplete entries, postings, references, and save-failure scenarios; verify that local Journal behavior is not confused with server-book reports.
- [x] 2.4 Revise `ledger-analysis` with readiness/query errors, account history, conditional report semantics, freshness, currencies, valuation coverage, identity/postings, and conditional cache/completeness scenarios; verify that universal page subscriptions and all-parsing-in-worker claims are not made.
- [x] 2.5 Record source precedence, external server obligations, evidence limits, and known implementation gaps in `design.md`; verify that no unmet runtime requirement is represented as a passing test or a completed code fix.

## 3. Critical scope and provenance review

- [x] 3.1 Reconcile the four contracts against the owner's fork changes and applicable wiki decisions; verify that existing UI or historical plans alone do not make an upstream feature mandatory.
- [x] 3.2 Generalize cards, selection controls, report inventory, placeholder policy, cache strategy, and settings-transfer assumptions; verify that distinct preservation and failure scenarios remain testable without requiring those optional mechanisms.
- [x] 3.3 Record requirement-level provenance and safety elaborations in `design.md`; verify that cancelled decisions are excluded and historical delivery labels are absent from the change.

## 4. Integration checks and owner review

- [x] 4.1 Validate the active change using `openspec validate add-initial-system-specs --strict --no-interactive`; verify all four capability deltas have meaningful purposes, canonical headings, bounded requirement descriptions, and actionable WHEN/THEN scenarios.
- [x] 4.2 Check cross-spec consistency, relative links, capability inventory, and source-file isolation; verify there are no dangling WebDAV capability references, no main-spec publication, and no runtime changes.
- [x] 4.3 Owner review of the revised requirement wording and scenario coverage; explicitly approved in this conversation on 2026-10-23, including preservation and editability of incomplete `!` entries during synchronization.

## Workflow completion

- On 2026-10-30, the owner explicitly requested publication and archiving of this completed change.
- Published all four reviewed capabilities to main specs, preserving all 33 requirements and their scenarios; strict OpenSpec validation passed.
- Archived the change after confirming all 14 tasks were complete and all four main specs matched their deltas.
- Runtime bug fixes and unused-feature removal remain separate work. The known-gap inventory is not authorization to implement them or a requirement to fix all of them in this documentation change.
