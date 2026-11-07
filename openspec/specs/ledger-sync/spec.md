# ledger-sync Specification

## Purpose

Keep an offline copy of the authoritative server Beancount book and its reference data,
without making the pull path a server editor or risking unsent on-device transactions.

## Requirements

### Requirement: Server Ledger Pull

The system SHALL pull the authoritative Beancount book and account/payee references from
the configured server for offline use. Where selective synchronization is offered, it SHALL
respect the selected work without presenting skipped work as completed. `main.bean` SHALL
be the default remote root, not a restriction on configured root names. No particular
selection controls or settings screen are required.

#### Scenario: Successful pull

- **WHEN** the user starts Sync for the book and account/payee references against a reachable configured server
- **THEN** the selected reference data and book are stored locally
- **AND** the downloaded root is selected for analysis only as part of a successful book update
- **AND** each selected stage has a visible outcome

#### Scenario: Metadata-only synchronization

- **GIVEN** the application offers a reference-data-only synchronization option
- **WHEN** the user requests account or payee updates without ledger-file synchronization
- **THEN** only the selected reference data is updated
- **AND** no local transactions are sent, no ledger files are replaced, and no overlay reconciliation runs
- **AND** the result is identified as metadata-only, not full-ledger acceptance

#### Scenario: Unselected reference data

- **GIVEN** the application offers independently selectable synchronization work
- **WHEN** the user requests book synchronization but leaves accounts or payees unselected
- **THEN** the unselected reference data is not replaced
- **AND** its omission is not reported as a successful reference-data refresh

#### Scenario: Configured remote root

- **WHEN** the user configures a supported root such as `books/personal.bean` and synchronizes it
- **THEN** that root, rather than an assumed `main.bean`, determines the downloaded book and its selected local root

#### Scenario: Server unavailable

- **WHEN** a selected stage cannot obtain its data because the server is unreachable or returns an error
- **THEN** the failed stage is reported and its previously usable local data is preserved
- **AND** independently completed reference-data stages need not be rolled back, but are not evidence that the book synchronized

### Requirement: Safe Ledger Replacement

The system SHALL reject unsafe or incomplete downloaded file sets before replacing a usable
book. Book files and the selected-root setting SHALL recover together after a failed write,
root selection, or parse. A pull SHALL NOT overwrite the local `cashier.bean` overlay.
Storage failure SHALL NOT be reported as successful persistence.

#### Scenario: Existing local overlay

- **WHEN** a book pull succeeds while `cashier.bean` contains unsent transactions
- **THEN** the pull preserves the overlay byte content
- **AND** only the separate confirmation-based reconciliation phase can remove eligible local entries

#### Scenario: Missing local overlay

- **WHEN** an initialized device has no `cashier.bean` and a valid book is imported
- **THEN** an empty local overlay is created without replacing any existing user file
- **AND** a failure to create it is reported rather than silently ignored

#### Scenario: Remote file would overwrite overlay

- **WHEN** a downloaded root or included file maps to local `cashier.bean`
- **THEN** the book update is rejected before downloaded files are written
- **AND** the existing overlay and selected book remain unchanged

#### Scenario: Incomplete or unsafe download

- **WHEN** the server returns a missing or blank root, or a supported multi-file download is incomplete or maps outside its permitted local locations
- **THEN** the book update fails before replacing the current book
- **AND** the error identifies the failed pull or file-set validation

#### Scenario: Failure during file replacement

- **WHEN** writing a downloaded file fails after an earlier file has already been replaced
- **THEN** the previous book files and root selection are restored, including removal of newly created candidate files
- **AND** the sync is unsuccessful and does not reconcile local entries

#### Scenario: Failure selecting the new root

- **WHEN** downloaded files have been written but saving the selected-root setting fails
- **THEN** the previous files and previous root selection are restored
- **AND** the candidate book is not reported as accepted

#### Scenario: Existing book or overlay cannot be read

- **WHEN** reading existing book files or the overlay fails because storage is inaccessible or corrupt rather than a file being absent
- **THEN** the update does not treat that failure as an empty overlay or a missing previous book
- **AND** it reports the read failure before replacing data whose recovery cannot be established

#### Scenario: Recovery itself fails

- **WHEN** a failed book update cannot fully restore its previous files or setting
- **THEN** the UI reports both the original failure and the incomplete recovery
- **AND** it does not claim that the old book is intact or delete pending local entries

### Requirement: Full-Ledger Parse Gate

The system SHALL validate the complete candidate server book with the supported Beancount
engine before reconciliation. Zero parse/validation errors SHALL be required for acceptance.
This gate SHALL validate the downloaded server book independently of invalid pending local
overlays, and SHALL remain distinct from loading the combined book for display.

#### Scenario: Zero errors

- **WHEN** the complete downloaded server book parses with zero errors
- **THEN** parse diagnostics show `ok` and an error count of `0`
- **AND** reconciliation becomes eligible to run against that validated download

#### Scenario: Parse failure

- **WHEN** the candidate server book produces one or more parse or validation errors
- **THEN** the parse stage fails with the count and available error details
- **AND** reconciliation does not run and the previous usable book is recovered

#### Scenario: Parser cannot complete

- **WHEN** parser initialization or parsing throws rather than returning an error list
- **THEN** the parse stage fails and no local entry is confirmed from the candidate
- **AND** the candidate is not accepted merely because downloading completed

#### Scenario: Invalid local entry in a mixed batch

- **WHEN** the downloaded server book is valid but a rejected entry retained in `cashier.bean` is invalid against it
- **THEN** the server-book parse gate can still succeed and valid entries can reconcile
- **AND** errors in the combined display book are not misreported as errors in the accepted server snapshot

### Requirement: Standalone Snapshot Constraints

The server SHALL provide a ready-to-read Beancount book with included sources combined and
Python-plugin results already applied, without runtime `plugin` or `include` directives.
Amounts, currencies, prices, costs, and transaction meaning SHALL be preserved. The PWA
SHALL report failures rather than hide them by dropping directives or merging transactions.
Book preparation is an external server obligation.

#### Scenario: Plugin materialization

- **WHEN** the source workspace uses Python plugins and included files
- **THEN** the server root response contains the combined book with plugin results already applied and no runtime `plugin` or `include` directives
- **AND** plugin-generated transactions and supported metadata survive and the complete snapshot parses with zero errors

#### Scenario: Exact total-price semantics

- **WHEN** authored transactions use rounded FX `@@` totals or booking-sensitive cost annotations
- **THEN** the snapshot preserves their accounting meaning rather than replacing them with lossy parse/print approximations
- **AND** consumption by the PWA does not silently rewrite those values

#### Scenario: Book preparation failure

- **WHEN** the server cannot safely load the source files or apply the required plugins
- **THEN** it returns a controlled failure instead of a partial successful book
- **AND** the PWA reports the pull failure and preserves the previously usable local book

#### Scenario: Identifier-less desktop transactions

- **WHEN** the workspace contains valid desktop transactions with spaced or compact dated headers and no `cashier_id`
- **THEN** the snapshot contains each source transaction once without requiring an ID to be inserted
- **AND** repeated synchronization preserves that count without clearing existing device storage or masking duplicates in the UI

### Requirement: Root Book Assembly

For display and analysis, the system SHALL combine the local `cashier.bean` overlay with the
configured imported book without persisting an injected include into the overlay. Assembly
SHALL distinguish a usable combined book from local-only or incomplete configuration.
The server-only validation gate SHALL not use this combined view as its confirmation source.

#### Scenario: User book include

- **WHEN** the overlay and the configured imported book both exist and are different files
- **THEN** the combined analysis book includes the imported book in memory
- **AND** neither the imported file nor on-disk `cashier.bean` is modified by assembly

#### Scenario: Local-only configuration

- **WHEN** no imported book is configured but local transactions exist
- **THEN** the local Journal remains usable
- **AND** this is not presented as proof that a complete server book was loaded or synchronized

#### Scenario: Configured book is missing

- **WHEN** a book is configured but its required root file is absent
- **THEN** the app distinguishes the incomplete book from a valid empty full ledger
- **AND** local Journal entries remain recoverable without creating a broken on-disk include

#### Scenario: Overlay is selected as its own book

- **WHEN** the configured book filename is `cashier.bean`
- **THEN** assembly does not include the file into itself or count its transactions twice

### Requirement: Read-Only Pull Boundary

The pull stages SHALL only read the server book and reference data. Server transaction
writes SHALL occur exclusively through manual-transaction writeback, never through pull,
report queries, local editing, or snapshot repair. The server book SHALL remain authoritative
for already synchronized transactions.

#### Scenario: Pull does not write back

- **WHEN** pull stages run with local transactions present
- **THEN** those stages perform no server mutation
- **AND** any writeback request belongs to the preceding, separately identified send stage

#### Scenario: Desktop-authored change

- **WHEN** a desktop edit changes an existing server transaction and the user pulls the book
- **THEN** the imported server version is used for analysis
- **AND** the PWA does not write back its earlier cached version or add identity metadata to the desktop record

#### Scenario: Local edit before explicit Sync

- **WHEN** the user saves a local transaction or views a report without triggering writeback
- **THEN** the app does not start a hidden server write loop or mutate arbitrary server records

### Requirement: API Bearer Authentication

Protected Cashier API requests SHALL use the locally configured `Authorization: Bearer
<token>`. `/api/health` SHALL remain the explicit unauthenticated readiness endpoint, not
an authentication check. Credential and server-configuration failures SHALL be visible and
SHALL NOT trigger a tokenless fallback or a hidden authentication retry loop.

#### Scenario: Configured token

- **WHEN** the app sends a protected reference-data, infrastructure, or writeback request with a configured token
- **THEN** the request carries the Bearer credential to the configured Cashier server
- **AND** the credential is not placed in the URL

#### Scenario: Missing or invalid token

- **WHEN** a protected request has no credential or an incorrect credential and the server returns `401`
- **THEN** the UI identifies an authentication failure rather than only a generic data-read failure
- **AND** existing local data and unconfirmed entries remain available

#### Scenario: Tokenless health request

- **WHEN** a readiness check is made to `/api/health` without a token
- **THEN** the external server contract permits a readiness response without ledger data
- **AND** health success does not imply that protected requests will authenticate

#### Scenario: Server token is unconfigured

- **WHEN** the protected API returns `503` because the server token is not configured
- **THEN** the app shows the server-configuration failure rather than treating the API as public or successful
- **AND** no unconfirmed local transaction is discarded

#### Scenario: Explicit retry after correcting credentials

- **WHEN** the user corrects the stored token after an authentication failure and starts Sync again
- **THEN** the new attempt uses the corrected credential
- **AND** it retries pending entries with their existing identities rather than generating replacement transactions

### Requirement: Local API Credential Protection

The API token SHALL be configured and stored locally. Diagnostics SHALL NOT expose its
secret value. If settings export, inspection, or import is retained, it SHALL exclude the
token from exported or inspected settings, ignore imported token values, and preserve the
existing local credential. This does not require different tokens per device or mandate
any backup, restore, preview, or comparison feature.

#### Scenario: Token stays on the device

- **GIVEN** a settings export mechanism is retained
- **WHEN** the user exports settings
- **THEN** the payload does not contain `syncApiToken` or its secret value
- **AND** the existing local token remains configured

#### Scenario: Restore keeps local token

- **GIVEN** settings import or restore is retained
- **WHEN** settings containing another device's token are restored on a device with a configured token
- **THEN** the foreign token is ignored and the existing local token remains configured

#### Scenario: Restore onto a tokenless device

- **GIVEN** settings import is retained
- **WHEN** settings containing a token are imported on a device without a local token
- **THEN** no token is imported
- **AND** authenticated Sync requires explicit local configuration

#### Scenario: Secret-free explanations

- **WHEN** a user views or copies synchronization diagnostics, or uses any retained settings preview or comparison
- **THEN** the app does not display or copy the API secret in that output
- **AND** the explicit token-configuration control remains the place to enter the credential

#### Scenario: Failed settings restore

- **GIVEN** settings restore is retained
- **WHEN** a settings restore fails validation or persistence
- **THEN** it does not erase or replace the existing local API credential
- **AND** the failure is reported without exposing that credential

### Requirement: Sync Diagnostics And Offline Continuity

The system SHALL expose per-stage results for selected synchronization work and distinguish
metadata success, validated server-book success, pending writeback, and display-refresh
failure. Failed synchronization SHALL NOT require clearing site data or reinstalling the
PWA to retain access to local transactions and the last usable book.

#### Scenario: Reference data is not full-book acceptance

- **WHEN** accounts and payees succeed but downloading or parsing the book fails
- **THEN** the UI retains the successful reference-stage results and the failed book-stage result
- **AND** it does not report full-ledger synchronization as successful

#### Scenario: Server book valid but display refresh fails

- **WHEN** server validation and reconciliation complete but refreshing the displayed combined book fails
- **THEN** the UI distinguishes display health from the validated server-book result
- **AND** it does not claim a successful refreshed display solely from a zero server parse-error count

#### Scenario: Offline use after synchronization

- **WHEN** an already initialized app with a previously usable imported book loses connectivity
- **THEN** locally available Journal data and book analysis remain accessible without a live server request
- **AND** the app does not present cached data as a newly completed synchronization

#### Scenario: Normal PWA update

- **WHEN** the installed app is updated without an explicit user request to delete data
- **THEN** synchronization recovery does not require clearing IndexedDB, OPFS, or unsent transactions
- **AND** the user can retry failed synchronization against the retained device state
