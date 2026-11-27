# Home Section Cards — Spec Delta

## Purpose

Let users choose which application sections they can see and use directly on Home while retaining the standalone pages.

## ADDED Requirements

### Requirement: One List of Home Card Choices

Home Settings SHALL offer one Show Cards list covering every current side-menu destination except Home. My Accounts SHALL be represented by the existing Account Groups option, and Journal SHALL appear only once. Menu group headings SHALL NOT be card choices. Home Settings and Reorder Cards SHALL use the same user-facing card labels.

#### Scenario: A single choice for each section

- **WHEN** the user opens Home Settings
- **THEN** Account Groups and Journal each have one checkbox, and there is no separate checkbox for My Accounts or Home
- **AND** all other side-menu destinations have a checkbox in the same list

#### Scenario: The drawer is independent of Home visibility

- **WHEN** the user hides or reorders a card on Home
- **THEN** the corresponding drawer link stays in its existing group and opens the same standalone page

### Requirement: Section Content on Home

Each selected section SHALL appear on Home in a consistent card layout with a heading, an icon, and section-specific content. A link to the full page SHALL NOT substitute for the card body. Card controls SHALL be usable at mobile and desktop widths without duplicating the app toolbar or blocking other Home controls.

#### Scenario: Journal and account views retain useful content

- **WHEN** the user selects these sections and opens Home with local data available
- **THEN** Account Groups shows the configured groups and their balances, with navigation to account history and group management
- **AND** Journal shows the recent device entries and distinguishes incomplete entries, with access to the full device journal
- **AND** Account Tree shows the expandable tree and balances, Accounts shows the searchable account list, and Payees shows the searchable payee list
- **AND** selecting an account in a browsing view opens its history rather than changing a transaction in the editor

#### Scenario: Report and analysis content is available from Home

- **WHEN** the user selects Reports and Asset Allocation
- **THEN** Reports exposes Queries, Transaction Search, Assets, Expenses, and Income vs Expenses as direct links to the individual reports
- **AND** Asset Allocation shows the locally calculated target and current allocation and values, with access to asset-class details when available

#### Scenario: Data and utilities have their own content

- **WHEN** the user selects the corresponding Data and Utilities sections
- **THEN** Server Sync shows connection configuration status, current progress, and available results or failure diagnostics without displaying the API token
- **AND** Backup shows the local backup contents and filename with explicit download and share actions
- **AND** File Storage shows the local files and lets the user open a file through the existing file editor
- **AND** Serialization shows the local ledger and binary-cache status
- **AND** Calculator shows a working keypad and result display and calculates on Home without returning a value to a transaction editor
- **AND** Validation shows local ledger errors and warnings, or the result of a completed check, and provides access to the parsed-book inspector

#### Scenario: Information and configuration have visible content

- **WHEN** the user selects Help, About, and Settings
- **THEN** Help displays the usage and setup guidance, About displays app information including the installed version, and Settings shows current book and allocation selections and ordinary preferences such as currency and date format
- **AND** the standalone pages still provide the full workflows, including editing settings and checking for or applying app updates

### Requirement: Local Loading and Explicit Actions

Displaying Home cards SHALL NOT initiate Sync, change user settings or accounting sources, reset or delete the ledger cache, or download or share a backup. Cards SHALL use the existing local data sources and show loading, empty, unavailable, or failed states as applicable. One unavailable section SHALL NOT prevent the remaining cards from being used.

#### Scenario: Offline or unavailable data

- **GIVEN** the app and applicable local data are already available on the device
- **WHEN** the user opens Home offline with multiple cards selected
- **THEN** available local content and tools remain usable without a live server request
- **AND** a missing book, missing allocation definition, or failed read is shown in its own card, not as a confirmed empty result or as a failure of Home

#### Scenario: Selecting the Sync card does not run Sync

- **WHEN** the user enables the Server Sync card and visits Home
- **THEN** the card can show previously available results or that no result is available, without contacting the Cashier server
- **AND** the existing Home Synchronize action remains the only Home control that starts a Sync, while server credential entry remains on Server Sync

#### Scenario: Rendering data tools does not change device data

- **WHEN** the user opens Home with Settings, Backup, File Storage, Serialization, or Validation selected and takes no action
- **THEN** displaying those sections does not save preferences, write or delete source files, force a cache reload or reset, or initiate a backup transfer
- **AND** existing explicit actions and confirmations remain available on the corresponding standalone page

### Requirement: Ordered and Compatible Home Preferences

Home Settings, Reorder Cards, and Home SHALL agree on the selected cards. Reorder Cards and Home SHALL agree on their saved order. Saving selection SHALL retain the relative order of cards that stay selected and append newly selected ones. Reordering SHALL take effect only when saved. Saved choices and order SHALL survive reload, including layouts saved before content cards were introduced.

#### Scenario: Previously selected shortcuts become content cards

- **GIVEN** Calculator and Reports were saved alongside Journal in a particular order
- **WHEN** the updated app reads those preferences
- **THEN** the three cards display content in that order without requiring reselection or rewriting preferences on read

#### Scenario: Historical card identifiers

- **GIVEN** an older saved list contains a My Accounts shortcut, a Favourites card, or an Account Groups card
- **WHEN** the app reads the list
- **THEN** it shows one Account Groups card at the first occurrence of any of those entries
- **AND** obsolete Forecast, Scheduled Transactions, and legacy Sync card entries neither render nor enable a current card, and unrecognized entries are not rendered

#### Scenario: Defaults and an explicitly empty Home are distinct

- **WHEN** the app opens with no saved card list
- **THEN** only Account Groups and Journal are selected by default
- **AND** if the user saves an empty list, Home remains empty after reload and its New transaction and Synchronize actions remain available

#### Scenario: Editing the layout only changes it on confirmation

- **GIVEN** the user has selected multiple cards
- **WHEN** they change the selection or drag the cards to a new order and leave without saving
- **THEN** the last saved layout is unchanged
- **AND** when they confirm an updated selection or order, Home uses that layout on return and after reload
