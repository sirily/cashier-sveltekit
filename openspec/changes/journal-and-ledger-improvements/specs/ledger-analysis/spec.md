# Spec Delta

## MODIFIED Requirements

### Requirement: Cache and Book Completeness Safety

Analysis sources SHALL remain authoritative. Any retained cache SHALL NOT make obsolete or
unusable data appear current. Reports SHALL distinguish available analysis from a complete,
error-free book and disclose incomplete sources and ledger diagnostics. Analysis availability
SHALL NOT replace the separate complete-book, zero-error gate for sync and overlay removal.

#### Scenario: Unusable cache

- **GIVEN** analysis caching is retained
- **WHEN** a cache is corrupt or incompatible
- **THEN** it does not produce apparently successful current results; analysis either succeeds
  from authoritative sources or reports that analysis is unavailable
- **AND** a source-load failure is reported rather than hidden as an empty book

#### Scenario: Source changes and cached data

- **GIVEN** a retained cache represents an earlier source composition
- **WHEN** a retained local edit, import, sync/reconciliation mutation, or selected-book change
  occurs through the application
- **THEN** current results reflect the changed sources rather than the obsolete cached composition
- **AND** a later load cannot present that obsolete composition as current merely because the
  cache is readable

#### Scenario: Selected book missing

- **GIVEN** `cashier.bean` exists but the configured selected book is missing from local storage
- **WHEN** analysis is requested
- **THEN** the system reports unavailable analysis or identifies any available overlay-only
  results as incomplete, with report totals carrying an incompleteness warning
- **AND** overlay-only availability does not satisfy the sync or reconciliation parse gate

#### Scenario: Available analysis with parse or validation errors

- **GIVEN** analysis is available but an intended included source is missing or the ledger
  reports parse or validation diagnostics
- **WHEN** a report uses that analysis
- **THEN** missing-source information and diagnostics remain accessible, and the report does
  not claim error-free complete results merely because a query succeeds
- **AND** the sync/writeback gate checks the complete pulled book and zero errors separately
  before allowing reconciliation

#### Scenario: Inspect the full book from Validation

- **WHEN** the owner opens Validation under Utilities
- **THEN** an action opens a separate inspector showing the full analysis book’s parsed directives and diagnostics
- **AND** the inspector identifies its full-book scope and supports reloading without changing accounting source files
- **AND** opening and returning from the inspector preserves access to the existing validation workflow

#### Scenario: Diagnostic navigation is consolidated

- **WHEN** the owner opens About
- **THEN** it contains no Experiments section or ledger inspector links
- **AND** application information and update controls remain available

#### Scenario: Local-only inspector is retired

- **WHEN** the owner attempts to open the retired local-only inspector directly
- **THEN** no local-only inspection screen is offered
- **AND** the request does not change stored journal or book source files
- **AND** the full-book inspector remains accessible from Validation
