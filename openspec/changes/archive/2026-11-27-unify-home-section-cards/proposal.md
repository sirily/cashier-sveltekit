# Proposal

## Why

Home can show Account Groups and Journal content, but most other selected menu destinations are still links, and Reports has a special case. Users should be able to see and use the content of any selected section on Home without opening a separate page first.

## What Changes

- Keep one **Show Cards** list for the current side-menu destinations, excluding Home itself. My Accounts and Account Groups are one choice; Journal is offered once.
- Show the selected sections in a consistent card layout. Each card has real section content: Reports shows the available reports, Calculator works in place, and data views show local results or their loading, empty, or error states.
- Drive the drawer, Home Settings, Reorder Cards, and Home from the same section catalog. The drawer remains a list of links to full pages. Cards and pages reuse their section content without embedding entire routes or their toolbars.
- Keep saved selections, ordering, defaults, and explicit empty layouts. Selections saved as shortcuts become content cards in place without requiring reselection.
- Keep existing full-page workflows, including credential configuration, destructive confirmations, and transaction selection. Showing a card does not start Sync or change application data.

## Capabilities

### New Capabilities

- `home-section-cards`: Select, render, and reorder Home cards with content from the app's side-menu destinations.

### Modified Capabilities

None. Existing transaction-entry, synchronization, and analysis contracts continue to apply.

## Impact

This affects the Svelte navigation catalog, Home and its customization routes, and content components shared with the standalone routes. It reuses the current card preference and local services. No backend or API changes, storage schema changes, or new accounting calculations are in scope.
