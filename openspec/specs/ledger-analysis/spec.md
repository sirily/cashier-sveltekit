# ledger-analysis Specification

## Purpose

Provide trustworthy full-book analysis over the local `cashier.bean` overlay and selected
book, preserving transaction identity, original currencies, explicit valuation coverage,
and observable freshness and completeness.

## Requirements

### Requirement: Background Full Ledger

The system SHALL analyze the local `cashier.bean` overlay together with the selected book
and its included sources, not silently substitute local-only data for the full book.
Full-book report loading and queries SHALL run asynchronously in the background so users
can continue interacting while analysis is pending. Readiness and pending work SHALL be
distinguishable from completed analysis.

#### Scenario: Full-book composition

- **GIVEN** local storage contains `cashier.bean`, a different selected book, and its included files
- **WHEN** the full analysis ledger loads
- **THEN** queries cover both the local overlay and the selected book's reachable sources
- **AND** composing the analysis book does not rewrite `cashier.bean` on disk

#### Scenario: Analysis after source changes

- **WHEN** sync or a retained local mutation changes the analysis sources
- **THEN** subsequent current results reflect the resulting composition
- **AND** results from the earlier composition are not presented as current while the updated
  analysis is pending or unavailable

#### Scenario: Responsive background analysis

- **WHEN** a report requests a full-book load or BQL query
- **THEN** the request completes asynchronously and the user can continue interacting while
  the analysis runs in the background
- **AND** pending analysis is distinguishable from a completed result

#### Scenario: No ledger files configured

- **WHEN** a load attempt finds no Beancount files in local storage
- **THEN** analysis exposes the unconfigured state without crashing report callers
- **AND** reports distinguish unavailable data from a successfully queried empty book

### Requirement: BQL Query Interface

The system SHALL expose an asynchronous BQL query interface returning `{ columns, rows,
errors }` for executed queries. Not-ready analysis, successful empty results, query validation
errors, and operational failures SHALL remain distinguishable. Failures SHALL NOT be
silently converted into successful empty results.

#### Scenario: Query before load

- **WHEN** a consumer requests a BQL query before the ledger is ready
- **THEN** the request remains pending or communicates that analysis is not ready
- **AND** the consumer does not treat the absence of rows as final evidence of no matching data

#### Scenario: Successful query result

- **GIVEN** the analysis ledger is ready
- **WHEN** a valid BQL query completes
- **THEN** columns identify the returned row fields, structured values remain available,
  and query errors are returned in the `errors` array
- **AND** zero matching rows can be presented as an empty result only after that execution

#### Scenario: Invalid BQL

- **WHEN** the query engine returns syntax or query validation errors
- **THEN** the interface preserves those errors and the report displays their concrete
  messages rather than presenting the result as a successful zero balance or no matches

#### Scenario: Analysis or request failure

- **WHEN** analysis loading or execution fails, or its request fails instead of returning a
  query result
- **THEN** the failure is communicated to the caller and shown as an operational error
- **AND** it is not reported as an empty successful query or merely as invalid BQL

### Requirement: Report Semantics

Account history SHALL cover the full analysis book. Any retained balance, expenses,
income-expense, arbitrary-query, or transaction-search report SHALL use that same book,
honor its applicable account, period, and query criteria, and preserve signed posting
semantics. These guarantees SHALL NOT require a particular route, screen inventory, or
ledger-selection control.

#### Scenario: Balance query

- **GIVEN** a balance report is retained and the full ledger is ready
- **WHEN** the report's balance query completes
- **THEN** reported account balances reflect all applicable postings in the full book
- **AND** account scope and currencies remain identifiable rather than presenting local-only
  balances as the full book

#### Scenario: Expenses period and refunds

- **GIVEN** an expenses report is retained and an expense account has a charge and a negative
  refund within a selected period, and another posting outside that period
- **WHEN** the report queries the inclusive start and end dates
- **THEN** it aggregates the in-period signed amounts by expense account, with the refund
  reducing the expense total and the outside posting excluded
- **AND** any offered drill-down preserves the account filter and the same date bounds

#### Scenario: Income-expense period and signs

- **GIVEN** an income-expense report is retained
- **WHEN** it summarizes a selected period
- **THEN** it includes Income and Expenses within the inclusive date bounds and any requested
  grouping preserves those bounds and the signed posting contributions
- **AND** negative Beancount income is displayed with an identifiable income sign convention,
  while expense refunds reduce expenses rather than becoming positive charges
- **AND** any offered drill-down preserves the relevant account and period criteria

#### Scenario: Arbitrary full-ledger query

- **GIVEN** arbitrary BQL reporting is retained
- **WHEN** a query is submitted for full-book analysis
- **THEN** it executes against the ready full composition and returns the submitted query's
  columns, rows, or errors
- **AND** local-only results do not substitute for full-book results

#### Scenario: Filtered transaction search

- **GIVEN** transaction search is retained
- **WHEN** a search supplies supported date bounds, payee/narration pattern, account pattern,
  or amount comparison criteria
- **THEN** the populated criteria are applied together, date bounds are inclusive, the text
  pattern matches payee or narration, and amount comparisons use signed posting numbers
- **AND** results retain transaction identity and posting currencies and correspond to the
  submitted criteria rather than an earlier search

#### Scenario: Account history

- **WHEN** account history is requested for an account with postings from the selected book
  and local overlay
- **THEN** history covers that account in the full composition and represents all matching
  postings with their amounts and currencies
- **AND** its balance display includes every currency balance, not just the first one
- **AND** any on-device marking applies to local overlay entries, not unrelated desktop entries

#### Scenario: Account history on a cold page

- **GIVEN** OPFS and IndexedDB retain the selected book and local overlay
- **WHEN** account history is opened directly in a new page or reloaded, without visiting the account tree
- **THEN** it waits for the full local analysis composition and returns the same account balances
  and postings as navigation from the tree, without requiring network sync
- **AND** this holds with analysis caching enabled or disabled and for an encoded account name
- **AND** pending analysis and load/query failures are not displayed as a confirmed zero balance

#### Scenario: Unresolved report posting amounts

- **GIVEN** an expense or income posting in the selected period has no computed position,
  whether in the local overlay or selected book, including after cache restoration
- **WHEN** Expenses or Income vs Expenses is requested
- **THEN** the report identifies the unresolved posting and keeps ledger diagnostics accessible
- **AND** it does not invoke valuation on a missing position, substitute zero, or present a
  partial total or chart as complete
- **AND** completed transactions flagged `!` and successfully interpolated postings are not
  excluded merely because of that flag

#### Scenario: Recovery after completing a posting

- **GIVEN** a report cannot produce a complete result because a posting is unresolved
- **WHEN** that source entry is corrected and the analysis composition is refreshed
- **THEN** the report reflects the corrected composition and current period, including after
  a later cache restoration
- **AND** outdated results or errors do not replace the current result

### Requirement: Currency Fidelity

The system SHALL preserve original positions, amounts, and currencies and SHALL NOT exclude
commodities by symbol length. Any converted summary SHALL disclose its target currency,
conversion policy, price source, and valuation date or date-selection rule; it SHALL NOT
require a separate original-currency mode in every summary. Unavailable valuations SHALL NOT
become zero in an apparently complete total.

#### Scenario: Multi-currency ledger

- **GIVEN** the ledger contains RUB, USD, GBP, and XAU positions
- **WHEN** original balances or transaction details are displayed
- **THEN** each amount retains its original commodity, and account views include all balances
  rather than selecting only the first currency
- **AND** unlike units are not added into an unlabeled single-currency total

#### Scenario: Original and converted balances

- **GIVEN** a retained balance report displays original quantities or converted values
- **WHEN** those balances are presented
- **THEN** original quantities retain their commodities and converted values identify their
  target currency
- **AND** presentation or valuation does not change the underlying positions

#### Scenario: Long commodity symbols

- **GIVEN** an in-scope posting uses a commodity symbol longer than four characters
- **WHEN** a report aggregates the applicable postings, including any retained income-expense report
- **THEN** the posting is not silently discarded based on symbol length
- **AND** its contribution follows the disclosed valuation policy or is identified as unvalued

#### Scenario: Explicit converted summary

- **WHEN** a retained summary converts positions into one currency
- **THEN** the summary identifies that currency and makes its conversion policy, price source,
  and valuation date or date-selection rule available to the user
- **AND** transaction detail retains original amounts and currencies; a converted summary does
  not imply that those source currencies were replaced

#### Scenario: Missing or stale valuation

- **GIVEN** a position lacks a usable price or has a price stale under the disclosed policy
- **WHEN** a converted total is displayed
- **THEN** the unvalued position or stale-price condition is visible, with original units
  retained and any partial or stale total labeled accordingly
- **AND** failed conversion is not treated as zero or silently counted as complete valuation

### Requirement: Report Freshness

Reports SHALL identify whether results reflect the current analysis sources and active
criteria. Retained mutations, selected-book changes, and sync/reconciliation SHALL prevent
outdated results from being presented as current. Pending, stale, failed, incomplete, and
successfully empty results SHALL be distinguishable, without prescribing a subscription,
version-store, or page-lifecycle mechanism.

#### Scenario: Visible results after source changes

- **GIVEN** a report displays balances from an earlier source composition
- **WHEN** a retained edit or sync/reconciliation changes the applicable sources
- **THEN** the displayed balances are refreshed, hidden, or identified as stale until current
  results are available
- **AND** pending balances are not represented as confirmed zero balances

#### Scenario: Current report criteria

- **WHEN** an account or period changes, or a report, query, or search is requested with new criteria
- **THEN** the resulting request uses the current analysis composition and applicable criteria
- **AND** results for earlier criteria are not presented as satisfying the new request

#### Scenario: Query during reload

- **GIVEN** the analysis composition is being refreshed after source changes
- **WHEN** a report needs current results
- **THEN** a current result is finalized only after the updated composition is ready and the
  query has completed against it
- **AND** an interim absence of rows cannot become a final no-data or zero-balance view

#### Scenario: Old results and genuine emptiness

- **WHEN** previously displayed results outlive their source composition or a request is pending or fails
- **THEN** those values are hidden or visibly identified as stale, loading, or failed rather
  than presented as current
- **AND** a no-matches or zero-balance result is finalized only after a successful query
  against the applicable composition, with completeness warnings preserved

### Requirement: Transaction Identity and Posting Coverage

Account history and any retained transaction search SHALL keep distinct source transactions
distinct, even when their displayed fields coincide. All matching postings SHALL remain
represented. Desktop-authored records SHALL NOT require `cashier_id`; local overlay identity
and removal SHALL follow manual-transaction-writeback, not UI content-based deduplication.

#### Scenario: Identical transaction headers

- **GIVEN** two source transactions share the same date, payee, and narration
- **WHEN** both match account history or a retained transaction search
- **THEN** both remain distinct, with their respective matching postings and currencies
- **AND** header text alone is not used as a transaction grouping or deduplication key

#### Scenario: Desktop entry without cashier identity

- **GIVEN** the selected book contains desktop-authored transactions without `cashier_id`,
  including valid spaced and compact dated headers
- **WHEN** those transactions match account history or a retained report or search
- **THEN** they remain visible without adding IDs or marking them as local overlay entries

#### Scenario: Split postings to one account

- **GIVEN** one transaction posts twice to the same account, such as 10 USD and 15 USD
- **WHEN** account history displays the transaction's matching postings
- **THEN** both contributions are represented, either separately or in a faithful grouped
  representation accounting for 25 USD
- **AND** different-currency contributions remain distinct rather than being added as units

#### Scenario: Overlay shown once after reconciliation

- **GIVEN** a PWA transaction is confirmed by the same `cashier_id` in a complete, zero-error
  pulled ledger and its local overlay is removed under the writeback contract
- **WHEN** analysis reflects the reconciled sources, including after a repeated sync
- **THEN** reports and account history show the retained server transaction once
- **AND** this follows source reconciliation, not UI suppression of similar transactions or
  concealment of duplicate directives already present in the server snapshot

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
