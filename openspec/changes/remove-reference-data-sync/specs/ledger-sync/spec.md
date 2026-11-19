# Spec Delta

## MODIFIED Requirements

### Requirement: Server Ledger Pull

The system SHALL pull the authoritative Beancount book from the configured server for offline use through explicit Sync. Account and payee lists SHALL be derived from the locally available book composition. `main.bean` SHALL be the default remote root, not a restriction on configured root names.

#### Scenario: Successful pull

- **WHEN** the user starts Sync against a reachable configured server
- **THEN** the book is stored locally
- **AND** the downloaded root is selected only as part of a successful book update
- **AND** each stage has a visible outcome

#### Scenario: Configured remote root

- **WHEN** the user configures a supported root such as `books/personal.bean` and synchronizes it
- **THEN** that root, rather than an assumed `main.bean`, determines the downloaded book and its selected local root

#### Scenario: Server unavailable

- **WHEN** a selected stage cannot obtain its data because the server is unreachable or returns an error
- **THEN** the failed stage is reported and its previously usable local data is preserved

### Requirement: Read-Only Pull Boundary

The pull stages SHALL only read the server book. Server transaction writes SHALL occur exclusively through manual-transaction writeback, never through pull, report queries, local editing, or snapshot repair. The server book SHALL remain authoritative for already synchronized transactions.

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

Protected Cashier API requests SHALL use the locally configured `Authorization: Bearer <token>`. `/api/health` SHALL remain the explicit unauthenticated readiness endpoint, not an authentication check. Credential and server-configuration failures SHALL be visible and SHALL NOT trigger a tokenless fallback or a hidden authentication retry loop.

#### Scenario: Configured token

- **WHEN** the app sends a protected infrastructure or writeback request with a configured token
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

### Requirement: Sync Diagnostics And Offline Continuity

The system SHALL expose per-stage synchronization results and distinguish validated server-book success, pending writeback, and display-refresh failure. Failed synchronization SHALL NOT require clearing site data or reinstalling the PWA to retain access to local transactions and the last usable book.

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
