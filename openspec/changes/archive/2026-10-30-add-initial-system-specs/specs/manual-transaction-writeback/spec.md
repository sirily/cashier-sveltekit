# manual-transaction-writeback Specification Delta

## Purpose

One-button writeback of PWA-created manual transactions pushes completed entries to
`POST /api/xact`, pulls the full ledger, and removes local overlays only after safe
`cashier_id` confirmation, with idempotent retries and concrete rejection reasons.

## ADDED Requirements

### Requirement: One-Button Sync Operation

When ledger-file synchronization is enabled, the system SHALL perform writeback within the
existing explicit Sync action in the order push (`POST /api/xact`), pull, reconcile.
Selected reference-data stages can precede this sequence; they SHALL NOT reorder its
writeback phases. Writeback SHALL use this explicit Sync action, not a second permanent
writeback button or a hidden background write loop.

#### Scenario: Full cycle

- **WHEN** the user presses the Sync button with ledger-file synchronization enabled and
  completed local transactions present
- **THEN** the system attempts to push eligible local transactions before pulling the full
  ledger and reconciling confirmed overlays within the same visible operation
- **AND** reference-data steps may run before writeback without changing this relative order

#### Scenario: Metadata-only synchronization

- **WHEN** the user synchronizes reference data with ledger-file synchronization disabled
- **THEN** the system does not push local transactions, pull ledger files, or reconcile
  local overlays as part of that operation
- **AND** the local journal remains unchanged by writeback

#### Scenario: No pending transactions

- **WHEN** ledger-file synchronization is enabled but no completed local transactions are
  eligible for sending
- **THEN** the system skips `POST /api/xact` and continues the full-ledger pull and parse
- **AND** it does not manufacture transactions or send an empty writeback request

#### Scenario: Send failure does not suppress pull

- **WHEN** transaction preparation or the POST attempt fails during a ledger-file Sync
- **THEN** the system records the send failure and still attempts the full-ledger pull
- **AND** subsequent reconciliation obeys the confirmation and unresolved-outcome safeguards
  rather than treating a successful pull as proof that sending succeeded

### Requirement: Stable Transaction Identity

The system SHALL assign each PWA-created local transaction a UUID v4 `cashier_id` before
its first push and SHALL successfully persist that identity in local `cashier.bean` before
sending. The identity SHALL remain stable across retries and edits; formatted transaction
text SHALL NOT be the primary identity.

#### Scenario: Identity before first push

- **WHEN** a newly created PWA transaction without `cashier_id` becomes eligible for its
  first push
- **THEN** the system generates one UUID v4 and successfully saves it as transaction metadata
  in local `cashier.bean` before sending
- **AND** the request contains that same persisted ID

#### Scenario: Legacy local transaction

- **WHEN** an older local transaction without `cashier_id` is prepared for its first push
- **THEN** the system assigns and successfully persists an ID before sending it
- **AND** migration does not require adding IDs to desktop-authored server records

#### Scenario: Retry and no-op preparation preserve identity

- **WHEN** a transaction already has a persisted `cashier_id` and preparation runs again,
  whether after failure or without any local change
- **THEN** preparation and retry preserve its existing ID and transaction content
- **AND** no replacement ID or duplicate local transaction is created

#### Scenario: Local edit preserves identity

- **WHEN** a user edits and saves a local transaction that already has `cashier_id`
- **THEN** the saved transaction retains that metadata and the same ID
- **AND** a later push uses the same ID, so a previously accepted but changed transaction
  is subject to the same-ID conflict contract rather than silently becoming a new entry

#### Scenario: Identity persistence failure

- **WHEN** saving a newly assigned ID fails or successful persistence cannot be established
- **THEN** the system does not send the affected transaction using an in-memory-only ID
- **AND** it reports the preparation/storage failure and retains the local transaction

#### Scenario: Independent transactions with identical text

- **WHEN** a user independently creates two local transactions with otherwise identical
  user-visible content
- **THEN** each receives its own stable `cashier_id`
- **AND** the system does not merge them by text or structural similarity

### Requirement: Two Persistent States Only

The system SHALL represent only two meaningful durable transaction conditions: `local`
(the local overlay remains) and `synced` (the server transaction is safely confirmed and
its local overlay is removed). These are conceptual conditions, not a requirement for a
persisted enum or state table. The system SHALL NOT add durable `uploading`, `accepted`, or
`confirmed` transaction states.

#### Scenario: Transient progress only

- **WHEN** a sync is in flight
- **THEN** upload, acceptance, and reconciliation progress are transient UI feedback rather
  than additional persisted transaction states

#### Scenario: Accepted but not confirmed remains local

- **WHEN** a transaction has been acknowledged by the server but safe reconciliation has
  not completed
- **THEN** its local overlay remains and is identified as on-device according to transaction-entry
- **AND** neither an acknowledgement nor an error explanation creates a third durable state

### Requirement: Completed-Only Push

The system SHALL send only PWA-created completed `*` transactions and SHALL keep incomplete
`!` transactions local. Incomplete entries SHALL NOT become eligible merely because they
have an ID or resemble a server transaction.

#### Scenario: Incomplete stays local

- **WHEN** the local journal contains an incomplete `!` transaction
- **THEN** it is excluded from the push payload and retained in `cashier.bean`
- **AND** it may be shown as on-device without being reported as synchronized

#### Scenario: Mixed completion flags

- **WHEN** a journal contains both completed `*` and incomplete `!` transactions
- **THEN** only completed entries are prepared for sending
- **AND** incomplete entries remain unchanged by writeback preparation and reconciliation

#### Scenario: Completing a local transaction

- **WHEN** a user changes a local transaction from `!` to `*` and saves it
- **THEN** it becomes eligible for the next ledger-file Sync
- **AND** any existing `cashier_id` is preserved, or a missing ID is persisted before sending

### Requirement: Narrow Writeback API Contract

The PWA SHALL use `POST /api/xact` with `transactions`, an array of raw Beancount strings
containing persisted IDs. Responses SHALL provide `synchronized` IDs and `rejected` entries
with `cashier_id` and `reason`. Validation, deduplication, conflict rejection, and fixed-file
writes are an **external server contract**, not proven by PWA behavior. The client SHALL NOT
select writable paths or request arbitrary remote mutations.

#### Scenario: Transaction-only request

- **WHEN** eligible local entries are pushed
- **THEN** the request uses `POST /api/xact` and `{"transactions": ["<raw Beancount transaction>"]}`
  with one raw string per eligible transaction
- **AND** the payload contains neither a destination path nor instructions to create
  accounts, replace ledger files, edit, or delete arbitrary remote transactions

#### Scenario: Unreadable local journal

- **WHEN** the local journal cannot be read because storage access fails rather than the file being absent
- **THEN** preparation reports the storage failure instead of treating the journal as empty
- **AND** it does not create, overwrite, or send replacement transactions from an assumed empty source

#### Scenario: Per-entry response handling

- **WHEN** the server returns synchronized IDs and rejected entries
- **THEN** the PWA reads `synchronized` as an array of IDs and `rejected` as an array of
  objects with `cashier_id` and concrete `reason`, associating results by ID
- **AND** an unattributed rejection may have a null `cashier_id` and is still reported as an
  operation-level error without discarding its reason
- **AND** synchronized IDs trigger pull-based confirmation, not immediate local deletion

#### Scenario: Malformed or incomplete response

- **WHEN** a POST response cannot be decoded as the agreed per-entry result, or an entry's outcome cannot be established
- **THEN** the affected entry has an unresolved send outcome and remains subject to the safe-retry safeguards
- **AND** a nominal HTTP success is not interpreted as permission to delete local transactions

#### Scenario: External validation and fixed destination

- **WHEN** the server processes a writeback request under the external server contract
- **THEN** only valid, nonconflicting PWA transactions may be committed to the fixed
  `manual_transactions.bean` after candidate full-ledger validation
- **AND** `main.bean` includes that file and all other ledger sources remain read-only to this API
- **AND** invalid entries are rejected without writing them, and neither the client nor this
  API selects another writable ledger source

### Requirement: Idempotent Retry

Lost POST outcomes and failed pulls SHALL be retryable without losing local entries. The
external server contract SHALL deduplicate equivalent same-ID transactions and reject
same-ID content conflicts without overwrite. An unresolved POST outcome SHALL block deletion
unless a retry resolves acceptance of current local content or authoritative equivalence
is established; ID presence alone SHALL NOT suffice. Identifier-less desktop structural
matching SHALL NOT be introduced.

#### Scenario: Push accepted, pull lost

- **WHEN** the server records a transaction but the subsequent pull or parse fails
- **THEN** the local overlay remains with its original ID for the next Sync
- **AND** a later successful retry and confirmation remove it without a second server append

#### Scenario: Lost POST outcome

- **WHEN** the POST response is lost and a subsequent pull contains the local transaction's ID
- **THEN** the system retains the overlay unless a retry resolves acceptance of its current
  content or authoritative equivalence with the server transaction is established
- **AND** ID presence alone does not resolve the unknown POST outcome

#### Scenario: Repeated Sync does not duplicate

- **WHEN** the same unchanged transaction is sent repeatedly after a retryable failure
- **THEN** each request uses the same persisted ID and content
- **AND** under the external server contract the server acknowledges the existing equivalent
  transaction without appending another copy, and safe confirmation eventually clears the overlay

#### Scenario: Same ID with changed content

- **WHEN** local content differs from a server transaction with the same `cashier_id`
- **THEN** the external server contract rejects the conflict without overwriting that entry,
  and the PWA keeps the local edit with the concrete conflict reason
- **AND** if the conflict response is lost, pulling the older server ID alone still cannot
  justify deleting the differing local edit

### Requirement: Confirm-Before-Delete Reconcile

Deletion SHALL require a zero-error parse of the current pull's complete server-only book
and matching transaction-level `cashier_id` on a completed `*` server transaction. Local,
stale, cached, raw-text, posting, and other-directive matches SHALL NOT confirm an entry.
Rejections SHALL veto deletion; unknown POST outcomes SHALL obey Idempotent Retry safeguards.
Reconciliation SHALL preserve concurrent local edits and succeed only when any journal
changes are durably saved.

#### Scenario: Unconfirmed entry survives

- **WHEN** a local `cashier_id` is absent from parsed transactions in the current pulled ledger
- **THEN** the local entry remains on the device for a later Sync
- **AND** textual or structural similarity to a server transaction does not replace ID confirmation

#### Scenario: Parsed server transaction confirms overlay

- **WHEN** the current server-only full ledger parses with zero errors and contains a
  completed `*` transaction with transaction-level `cashier_id` matching a completed local entry
- **AND** the entry was not rejected and its current content has no unresolved POST outcome
- **THEN** the system removes that completed local overlay and successfully persists the reconciled journal

#### Scenario: Acknowledgement alone is insufficient

- **WHEN** a POST response lists an ID in `synchronized` but the current pulled parsed ledger
  does not confirm that transaction
- **THEN** the local overlay is retained despite the acknowledgement

#### Scenario: Rejection vetoes removal

- **WHEN** the current POST rejects an ID that also appears in the pulled parsed ledger
- **THEN** the corresponding local entry remains with its rejection reason
- **AND** the matching server ID does not override the rejection or discard a conflicting edit

#### Scenario: Overlay and stale files cannot confirm

- **WHEN** an ID occurs only in local `cashier.bean`, a stale OPFS file outside the current
  pull's authoritative file set, or an earlier cached parse
- **THEN** it does not count as server confirmation and the local entry remains

#### Scenario: Non-transaction metadata cannot confirm

- **WHEN** the ID text appears only in a comment, a posting's metadata, or another directive's
  metadata rather than a parsed transaction's own metadata
- **THEN** reconciliation does not treat it as a matching transaction
- **AND** the local overlay remains even if a raw-text search would find the ID

#### Scenario: Pull or parse failure prevents deletion

- **WHEN** the full-ledger pull is incomplete or fails, parsing fails, or the current
  server-only ledger has one or more parse errors
- **THEN** the system does not remove local entries based on that pull
- **AND** it reports the failed stage without substituting an earlier successful parse

#### Scenario: Incomplete server transaction cannot confirm

- **WHEN** the current server book parses with zero errors but the matching transaction-level `cashier_id` belongs only to an incomplete `!` server transaction
- **THEN** it does not confirm the completed local `*` transaction
- **AND** the local overlay remains available for retry or correction

#### Scenario: Concurrent local edit or append

- **GIVEN** another tab or editor changes the local journal while Sync is in progress
- **WHEN** reconciliation attempts to save removal of confirmed overlays
- **THEN** it preserves newly appended entries and locally edited content not confirmed by this attempt
- **AND** if safe reconciliation cannot be established, it reports a retryable reconciliation
  failure and leaves local entries recoverable without overwriting concurrent changes

#### Scenario: Reconciled journal cannot be saved

- **WHEN** confirmed overlays are selected for removal but saving the updated local journal fails
- **THEN** the system reports reconciliation as failed rather than claiming local cleanup completed
- **AND** local entries remain recoverable for an idempotent retry

### Requirement: Partial Batch With Concrete Rejections

The system SHALL allow mixed batches where valid entries synchronize while invalid entries
remain local. It SHALL display each concrete server rejection reason without replacing it
with generic text. Error explanations SHALL remain available until the next Sync run.

#### Scenario: Mixed batch

- **WHEN** a batch contains one unbalanced transaction and several valid transactions
- **THEN** accepted entries may be removed only after safe pull-based confirmation
- **AND** the rejected entry stays local with the server's concrete imbalance reason available
  until the next run, even though other entries completed

#### Scenario: Entire batch rejected

- **WHEN** every submitted transaction is rejected, for example for unknown accounts
- **THEN** all rejected transactions remain local with their individual reasons
- **AND** the system still attempts the independent ledger pull without reporting the
  rejected writeback as successful

### Requirement: Post-Reconciliation Ledger Refresh

The system SHALL refresh the displayed ledger after successful reconciliation, including a
no-op reconciliation. Any eligible overlay removals SHALL be durably saved before refresh.
A confirmed operation SHALL then appear once from the full ledger, without a duplicate
local overlay. UI refresh health SHALL be distinguished from validation of the downloaded
server-only ledger.

#### Scenario: Refresh follows persisted removal

- **WHEN** safe reconciliation removes a confirmed overlay and successfully saves the journal
- **THEN** the displayed ledger is refreshed after that save, without presenting the new
  server copy alongside its old local overlay as duplicate operations
- **AND** the resulting ledger view shows the operation once without requiring local ledger
  storage to be cleared

#### Scenario: Successful pull with no overlay removal

- **WHEN** a valid pull changes the server book but reconciliation has no eligible overlays to remove
- **THEN** the system refreshes the displayed ledger from the new server book and retained overlays
- **AND** newly pulled desktop transactions become visible without requiring a local writeback or a storage reset

#### Scenario: UI refresh fails after reconciliation

- **WHEN** the server-only pulled ledger parsed with zero errors and reconciliation succeeded,
  but the subsequent UI ledger refresh fails
- **THEN** the system distinguishes the UI refresh failure from server-ledger validation
- **AND** it does not falsely report a server parse failure, restore a confirmed overlay,
  or claim that the UI view is healthy merely because synchronization succeeded

#### Scenario: Desktop entries require no PWA identity

- **WHEN** the pulled ledger contains desktop-authored transactions without `cashier_id`,
  including ordinary and compact transaction headers
- **THEN** those records are displayed as supplied by the authoritative parsed server ledger
  without requiring PWA IDs or mutating them to add IDs
- **AND** the PWA does not structurally match local overlays to those records or merge
  independent transactions to hide a server snapshot defect

### Requirement: Sync Failure Explanations

The system SHALL provide a visible explanation of failures by stage, including send, pull,
parse, and reconcile, with transaction attribution where available. Toasts and diagnostics
SHALL be supplementary rather than the only explanation. Explanations SHALL remain
available through navigation until the next Sync run; this UI retention requirement SHALL
NOT imply additional durable transaction states or guaranteed retention across an app restart.

#### Scenario: Concrete stage and transaction explanation

- **WHEN** a stage fails or the server rejects a transaction
- **THEN** a visible explanation identifies the failed stage and the affected `cashier_id`
  when available, preserving the concrete server reason when supplied
- **AND** dismissing a toast does not remove the only explanation

#### Scenario: Next run replaces previous explanations

- **WHEN** the user starts the next Sync after a failed run
- **THEN** the prior run's explanations may be reset and replaced by the new run's results
- **AND** clearing explanations neither deletes unresolved local entries nor marks them synced

#### Scenario: Navigation retains the explanation

- **WHEN** the user navigates away from the Sync surface and returns before another Sync run
- **THEN** the previous run's failure explanation remains available
- **AND** the user need not reproduce the failure just to recover its reason

#### Scenario: Independent stage outcomes remain distinguishable

- **WHEN** sending fails but pulling succeeds, or sending succeeds but pulling, parsing,
  or reconciliation subsequently fails
- **THEN** the explanation preserves the actual successful and failed stage outcomes
- **AND** a later successful stage does not erase an earlier failure or authorize unsafe
  local deletion
