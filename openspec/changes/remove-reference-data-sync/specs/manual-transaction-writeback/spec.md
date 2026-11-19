# Spec Delta

## MODIFIED Requirements

### Requirement: One-Button Sync Operation

The system SHALL perform writeback within the existing explicit Sync action in the order push (`POST /api/xact`), pull, reconcile. Writeback SHALL use this explicit Sync action, not a second permanent writeback button or a hidden background write loop.

#### Scenario: Full cycle

- **WHEN** the user presses the Sync button with completed local transactions present
- **THEN** the system attempts to push eligible local transactions before pulling and validating the full server book

#### Scenario: No pending transactions

- **WHEN** no completed local transactions are eligible for sending
- **THEN** the system skips `POST /api/xact` and continues the full-ledger pull and parse
- **AND** it does not manufacture transactions or send an empty writeback request

#### Scenario: Send failure does not suppress pull

- **WHEN** transaction preparation or the POST attempt fails during Sync
- **THEN** the system records the send failure and still attempts the full-ledger pull
- **AND** subsequent reconciliation obeys the confirmation and unresolved-outcome safeguards rather than treating a successful pull as proof that sending succeeded

* #### Scenario: Mixed drafts and exact total prices
*
* GIVEN the local journal contains a completed transaction
* with an exact `@@` total and an incomplete `!` transaction
* WHEN full Sync prepares, sends, pulls, validates,
* and reconciles the entries
* THEN only the completed transaction is sent,
* with its exact authored total-price value rather than
* a reconstructed rounded unit price
* AND the `!` entry remains local and unchanged by writeback
* AND retry uses the same persisted `cashier_id` and content,
* and safe confirmation removes only the completed local copy
* without creating another transaction
