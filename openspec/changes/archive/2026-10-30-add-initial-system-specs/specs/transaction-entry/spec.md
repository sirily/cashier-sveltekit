# transaction-entry Specification Delta

## Purpose

Protect mobile, offline-first manual capture and narrow local editing in OPFS `cashier.bean`,
without making the app a general server-ledger editor. Local Journal visibility is distinct
from server confirmation; removal of local overlays follows manual-transaction-writeback.

## ADDED Requirements

### Requirement: Local Quick Entry

The system SHALL save manual transactions locally in OPFS `cashier.bean` without network
access or server acceptance. Offline capture assumes the app has loaded and required
references are on the device, not an offline first visit. A successful save SHALL appear
immediately in the local Journal and survive restart with device storage retained.

#### Scenario: Offline entry

- **GIVEN** the app has loaded, required reference data is available locally, and the device
  is offline
- **WHEN** the owner creates a transaction from the Journal and saves it in the transaction editor
- **THEN** the transaction is durably stored in local OPFS `cashier.bean`
- **AND** it appears immediately in the local Journal without a manual reload or Sync

#### Scenario: Saved entry survives restart

- **GIVEN** a local transaction has been successfully saved
- **WHEN** the owner closes and reopens the previously loaded app with device storage
  retained and no network connection
- **THEN** the Journal loads the saved transaction from `cashier.bean`
- **AND** its saved fields, postings, and completion flag remain available for local editing

#### Scenario: Saving does not use the network

- **GIVEN** the app and necessary local reference data are available, whether online or offline
- **WHEN** the owner saves a new local transaction or edits an existing local transaction
- **THEN** saving does not initiate a network request or wait for server validation or Sync
- **AND** it does not write to a server source or a pulled server-ledger file

### Requirement: Local Overlay Distinction

The system SHALL visibly distinguish retained local overlay entries from server-confirmed
transactions, independently of completion flags. Meaningful durable conditions remain
`local` and `synced`, without durable uploading, accepted, or confirmed states. Local save
success SHALL NOT imply server acceptance; confirmation and overlay removal follow
manual-transaction-writeback. No exact indicator wording is required.

#### Scenario: Local entry indicator

- **WHEN** a Journal entry remains in `cashier.bean` without safe server confirmation under
  manual-transaction-writeback
- **THEN** a visible indication identifies it as local to the device rather than server-confirmed
- **AND** showing it in the Journal or a combined analysis view does not claim server acceptance

#### Scenario: Incomplete entry remains local

- **GIVEN** a saved local transaction has the incomplete `!` flag
- **WHEN** the Journal displays it
- **THEN** its local status is distinguishable just as for a completed but unconfirmed `*` entry
- **AND** completion and local status remain distinct: `!` is not upload eligibility, and
  `*` alone is not server confirmation

#### Scenario: Accepted but unconfirmed entry remains local

- **GIVEN** the server accepted a transaction but the subsequent pull or full-ledger parse
  failed, or the parsed pulled ledger does not contain its `cashier_id`
- **WHEN** the Journal displays the retained local overlay
- **THEN** the entry is still identified as local
- **AND** server acceptance alone does not remove the local entry or mark it synced

#### Scenario: Confirmed entry is rendered once

- **GIVEN** a successful full-ledger pull and parse confirms the local entry's `cashier_id`
  and the manual-transaction-writeback reconciliation conditions are satisfied
- **WHEN** reconciliation removes the corresponding local overlay
- **THEN** the local Journal no longer lists that overlay
- **AND** full-ledger reports and account history show the confirmed server operation once,
  without an additional local copy, a local indicator, or a permanent synced badge

### Requirement: Source-Position-Aware Save

The system SHALL replace only the selected local transaction at its verified source position
in `cashier.bean`, preserving its neighbors. Listing and editing SHALL identify the same
transaction even without `open` directives. Missing, ambiguous, or stale source mappings
SHALL fail closed, not append or overwrite another transaction. Imported or synced server
records SHALL be read-only through this editor.

#### Scenario: Edit existing transaction

- **GIVEN** the owner selects an existing local transaction with a verified current source span
- **WHEN** the owner edits and saves it
- **THEN** that directive is replaced in place in `cashier.bean`, rather than appended again
- **AND** neighboring transactions, directives, and comments remain unchanged

#### Scenario: Edit a transaction-only file

- **GIVEN** `cashier.bean` contains multiple transactions and no `open` directives
- **WHEN** the owner selects a transaction from the Journal, edits it, and saves
- **THEN** the selected transaction is correctly located and replaced in its actual source span
- **AND** only that transaction changes; listing it successfully without safely supporting
  its edit is not sufficient

#### Scenario: Unknown or ambiguous source span

- **GIVEN** an existing local transaction has no uniquely verifiable source mapping
- **WHEN** the owner attempts to save an edit
- **THEN** the system rejects the save with an actionable source-location error
- **AND** `cashier.bean` remains unchanged and the edited form remains available
- **AND** the missing span is not treated as permission to append a new transaction

#### Scenario: Source span becomes stale

- **GIVEN** `cashier.bean` changes after a transaction is opened, so its captured span no
  longer identifies the same unchanged source directive
- **WHEN** the owner attempts to save using that stale mapping
- **THEN** the system rejects the save and requests a reload or reselection
- **AND** it does not replace a different transaction now occupying the old line range
- **AND** both the current source and the owner's editable form remain intact

#### Scenario: Server record cannot be edited as a local transaction

- **GIVEN** a transaction originates from the imported or synced server ledger rather than
  the local manual overlay in `cashier.bean`
- **WHEN** the owner views it or attempts to open it through this editor
- **THEN** it is read-only through this editor
- **AND** its source span cannot authorize a write to `cashier.bean` or a server source

### Requirement: Lossless Local Edit and Stable Identity

Supported local edits SHALL preserve unedited fields and source constructs, including
`cashier_id`, metadata, tags, links, prices, costs, and comments, or be explicitly rejected
with the source unchanged. Each local transaction SHALL have a stable persisted
`cashier_id` before first push. Reopening or saving SHALL NOT regenerate an existing
identity or duplicate the entry, including after acceptance and a failed pull.

#### Scenario: No-op save preserves source and identity

- **GIVEN** an existing local transaction contains metadata including `cashier_id`
- **WHEN** the owner opens it and saves without changing any field
- **THEN** the source remains unchanged, including its identity and unexposed source constructs
- **OR** the system explicitly rejects an unsupported edit without changing the source
- **AND** no replacement identity or duplicate transaction is created

#### Scenario: Editing preserves metadata, tags, and links

- **GIVEN** a local transaction contains `cashier_id`, other transaction or posting metadata,
  tags, and links that the owner has not changed
- **WHEN** the owner edits a supported field such as narration and saves
- **THEN** the edit preserves all of those unedited values and their transaction or posting
  associations, or is explicitly rejected with the source unchanged
- **AND** saving does not silently replace metadata, tags, or links with empty values

#### Scenario: Editing preserves prices, costs, and comments

- **GIVEN** a local transaction contains posting prices, cost annotations, or transaction
  and posting comments that the owner has not changed
- **WHEN** the owner edits another supported field and saves
- **THEN** those annotations and comments are retained with their original associations,
  or the edit is explicitly rejected with the source unchanged
- **AND** dropping them to produce a simpler transaction is not reported as a successful save

#### Scenario: Edit after acceptance and failed pull preserves identity

- **GIVEN** a local transaction has a persisted `cashier_id` and the server accepted it,
  but a failed pull left its local overlay in place
- **WHEN** the owner reopens it and saves a supported edit
- **THEN** the local save preserves the same `cashier_id` and does not append another entry
- **OR** an unsupported edit is explicitly rejected with the source unchanged
- **AND** the editor does not claim to update the already accepted server record; any later
  server identity conflict belongs to the writeback flow and must not be hidden by a new ID

### Requirement: Completion Flags and Retained Incomplete Entries

The system SHALL preserve the distinction between completed `*` and incomplete `!` entries.
Only completed entries are eligible for writeback; saved `!` entries SHALL remain local
and reopenable through the retained editor. Supported saves SHALL preserve entered local
data or reject without loss. This does not require a draft-management feature suite,
automatic flag transitions, a particular placeholder account, or account creation.

#### Scenario: Save and reopen a completed transaction

- **GIVEN** the owner has selected explicit accounts and entered a completed transaction
  with the `*` flag
- **WHEN** the owner saves it and later reopens it from the Journal
- **THEN** its date, payee, narration, postings, and `*` flag are retained locally
- **AND** local save success does not assert that the server has accepted it

#### Scenario: Existing incomplete entry remains local and reopenable

- **GIVEN** a saved local transaction has the `!` flag, whether its fields are filled or unfinished
- **WHEN** the owner runs Sync, then reopens it and saves a supported narration-only edit
- **THEN** writeback leaves it local, and the editor preserves its entered fields and `!` flag
- **OR** an unsupported edit is explicitly rejected with the source unchanged and the form retained
- **AND** the entry remains available for local correction, not silently completed or discarded

#### Scenario: Locally entered unfinished postings are not silently lost

- **GIVEN** the retained editor allows entering an unfinished posting, such as one without
  an account
- **WHEN** the owner attempts to save
- **THEN** the entered row and its values are preserved in a reopenable local `!` entry,
  or the save is explicitly rejected with the form retained and the source unchanged
- **AND** if a placeholder representation is used, it preserves the entered data without
  creating an account or making the entry eligible for writeback
- **AND** no specific placeholder account or new incomplete-entry workflow is required

#### Scenario: Complete an existing local entry through a supported edit

- **GIVEN** the owner reopens an existing saved `!` entry in the retained editor
- **WHEN** a supported edit supplies the intended accounts and postings and saves it as completed `*`
- **THEN** the same local transaction is updated rather than duplicated
- **AND** its completed flag and any existing `cashier_id` survive reopening
- **AND** completion makes it eligible for writeback, not already server-accepted

### Requirement: Posting and Reference Selection Fidelity

Supported saves SHALL preserve posting order, accounts, amounts, and currencies unless
edited, distinguishing explicit zero from omitted balancing units. Reference selection
and return or cancellation SHALL preserve unrelated entered fields and identity. References
already made available on the device by sync SHALL remain usable offline. These guarantees
SHALL NOT depend on particular picker screens, routes, or a reference-merging algorithm.

#### Scenario: Split transaction retains every posting

- **GIVEN** the owner enters a split transaction with three or more postings
- **WHEN** the owner saves and reopens the transaction
- **THEN** every posting remains in its intended order with its entered account, amount,
  and currency, rather than being reduced to a two-posting transaction
- **AND** if unfinished rows can be entered locally, they follow the preservation-or-rejection
  rule for unfinished postings rather than being silently stripped

#### Scenario: Explicit zero is not an omitted amount

- **GIVEN** a posting has an explicit account, currency, and amount of zero
- **WHEN** the transaction is saved and reopened
- **THEN** the posting retains explicit zero units with that currency
- **AND** zero is not interpreted as a blank field, a balancing posting, or an unused row

#### Scenario: Omitted balancing units remain omitted

- **GIVEN** a posting has an explicit account but its amount is intentionally omitted for
  Beancount balancing
- **WHEN** the transaction is saved and reopened
- **THEN** its units remain omitted rather than being replaced with explicit zero
- **AND** other postings' explicit amounts and currencies remain unchanged

#### Scenario: Reference selection updates only the intended field

- **GIVEN** the owner is editing a multi-posting transaction with unsaved fields
- **WHEN** the owner chooses an available reference value for a field and returns to editing
- **THEN** the chosen value is applied to the intended field and posting without losing
  the entered date, payee, narration, flag, other posting values, or source identity
- **AND** any existing `cashier_id` remains unchanged
- **AND** selection alone does not create accounts or mutate server records

#### Scenario: Cancelling selection preserves entered data

- **GIVEN** the owner has unsaved transaction fields and opens a reference selection control
- **WHEN** the owner cancels selection or returns without choosing a value
- **THEN** the entered fields, posting order, source edit context, and existing `cashier_id`
  remain unchanged
- **AND** this holds whether selection is inline or involves leaving and returning to the editor

#### Scenario: Synced references remain usable offline

- **GIVEN** sync has made account, payee, or currency references available on the device
- **WHEN** the owner uses those references offline, including when the full ledger has not loaded
- **THEN** those available references can be selected without a network request
- **AND** the selected value remains usable on return to the intended editor field, even
  when it is absent from the currently loaded ledger
- **AND** saving the selection does not itself assert that the server will accept the transaction

### Requirement: Durable Save and View Refresh Isolation

The system SHALL report local save success only after durable persistence. Storage or
source-safety failures SHALL retain the form and edit context with an actionable error,
without success or navigation away. Successful saves SHALL immediately update the local
Journal; dependent views SHALL reflect the saved data at applicable ledger-analysis refresh
triggers. Report refresh SHALL NOT determine local save success or imply server confirmation.

#### Scenario: Storage failure retains the editable form

- **GIVEN** the owner has entered a new transaction or changed an existing local transaction
- **WHEN** device storage is unavailable, access is denied, or persistence fails before
  the save becomes durable
- **THEN** the save is reported as failed with an actionable error, including when no writable
  storage could be obtained
- **AND** the entered fields and source edit context remain available for correction or retry
- **AND** the system does not display success, clear the form, or navigate away

#### Scenario: Durable save updates Journal and dependent views

- **WHEN** a local transaction is durably saved
- **THEN** the Journal reflects that saved entry immediately from local data
- **AND** dependent views reflect the updated local composition or indicate that their
  results are not current, according to the freshness requirements in ledger-analysis
- **AND** local save success does not wait for report queries to finish or imply that every
  mounted report has already refreshed

#### Scenario: Dependent-view refresh failure does not undo local capture

- **GIVEN** a transaction is already durably saved in `cashier.bean`
- **WHEN** a dependent view's refresh is delayed or fails
- **THEN** the local Journal still exposes the saved transaction and it survives app restart
- **AND** the view's stale, pending, or failed status is distinguished from a local write failure
- **AND** the system does not delete, duplicate, or resubmit the local transaction as a
  consequence of the refresh failure
