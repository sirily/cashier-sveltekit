# Tasks

## 1. Section catalog and saved layout

- [x] 1.1 Evolve the navigation catalog to describe destinations and lazy card bodies independently of their hosts. Test drawer labels, groups, and destinations, and the single card identity for My Accounts / Account Groups and for Journal.
- [x] 1.2 Keep the shared card preference boundary and persisted IDs; test defaults versus `[]`, shortcut-to-card order, historical aliases, retired and unknown entries, and no writes on read. Test that confirmation preserves the relative order of unchanged cards and does not discard unknown IDs.
- [x] 1.3 Build the shared Home card host. Test with fixture bodies that it renders in saved order, does not load unselected bodies, and localizes load failures. Document the catalog and preference boundary in `docs/architecture.md`. Switch production Home only once all section bodies are registered.

## 2. Journal, groups, reports, and calculator

- [x] 2.1 Share the Account Groups list and balance rows between the card and management page. Test that Home does not seed groups, and that group management and account history still open the intended targets.
- [x] 2.2 Reuse local Journal reading and row presentation with recent entries on Home and source-span-aware actions on the standalone page. Test that completed and incomplete local entries are distinguishable and recent entries update after a local save or reconciliation; retain the standalone edit/delete regressions.
- [x] 2.3 Register the existing shared Reports links as body content; test all five destinations in both hosts and direct navigation to an individual report from Home.
- [x] 2.4 Extract the calculator body and keep applying an amount in the editor picker wrapper. Test an inline calculation and an editor round trip; mounting and using the Home calculator with selection metadata present must not apply an amount or navigate back.

## 3. Local ledger views

- [x] 3.1 Share Account Tree data and expandable rows with the standalone page. Test expand/collapse and account history with multi-currency balances from a seeded local book.
- [x] 3.2 Share the searchable Accounts and Payees lists with explicitly separate browse and picker behavior. Verify local results and independent filters, no Home autofocus or editor mutation, and unchanged picker return and cancellation.
- [x] 3.3 Share Asset Allocation loading and presentation below the route boundary. Test targets, current values and navigation to asset-class details, missing/invalid definitions, and refresh after a local book or definition change; retain route export and validation tests.

## 4. Data and utilities

- [x] 4.1 Share Sync status and diagnostics with the standalone page while keeping configuration and credentials there. Test that Home shows progress and a retained stage failure without exposing the token or issuing a server request on mount, and that the existing Synchronize control still uses the shared run guard.
- [x] 4.2 Share the Backup body and explicit download/share actions. Test that no transfer starts on mount and that the resulting backup excludes credentials and leaves source data intact.
- [x] 4.3 Reuse the existing File Storage browser and editor navigation. Test file-tree expansion and opening an existing file from Home without writing or deleting files; retain the standalone create/delete confirmations and file modification markers.
- [x] 4.4 Share Serialization status and Validation diagnostics with their standalone tools. Test cache metadata and local validation results, with no card-mounted reset, deletion, or forced reload. Verify Validation still opens the full-book inspector and the standalone tools retain their explicit actions.

## 5. Information and settings

- [x] 5.1 Share Help guidance and About information. Test that both are substantive on Home, that standalone Help anchors still resolve, and that About still offers the existing update checks and controls.
- [x] 5.2 Share the Settings preference reads and render a read-only body on Home. Verify displayed persisted values and missing selections, no settings writes or file-picker navigation hooks on Home, and unchanged standalone edit, file-picker return, and save behavior.

## 6. Integrate the complete Home layout

- [x] 6.1 Wire Home, Home Settings, and Reorder Cards to the catalog and replace the shortcut and Reports branches with the common host. Extend `tests/ui/home-menu-shortcuts.test.ts` to exercise every supported card body, mixed selection/reorder/removal, reload, unchanged drawer navigation, and reachable card and Home controls at mobile and desktop widths.
- [x] 6.2 Verify multiple selected cards in the production PWA offline, including bodies not previously opened as pages. Test that delayed or failed ledger reads stay local to the affected card, neighboring tools still work, and mounting the complete layout does not add API requests or change initialized preferences or source files.
- [x] 6.3 Run `npm run lint`, `npm run lint:svelte`, `npm run check`, `npm run check:specs`, `npm run test:unit -- --run`, and `npm run check:build`. Run the affected browser regressions for navigation, offline journal capture/edit/delete, Sync success/failure/retry, local accounts/history and analysis, backup/export, and unchanged retired entry points. Keep mocked client Sync results separate from Python-server integration evidence.
