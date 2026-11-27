# Design

## Context

See [proposal.md](proposal.md) for the motivation. `src/lib/navigation.ts` already shares labels, icons, and destinations between the drawer and Home Settings, but its Home entries describe shortcuts, not content. `src/routes/+page.svelte` renders Account Groups and Journal explicitly, has a separate branch for Reports, and turns the rest into links. `appService.getVisibleCards()` already gives Home, the settings page, and Reorder Cards a common preference read boundary.

Some standalone pages assume they own the screen or can act on navigation, selection state, or mount. For example, Settings handles file-picker returns and can save a detected currency on mount; the Account Groups page can seed defaults; Accounts, Payees, and Calculator can return values to the transaction editor. Those page behaviors must not become Home behavior when their content is reused.

## Goals / Non-Goals

**Goals:**

- Require one catalog entry, not new conditionals on Home, to connect a section with its route and card content.
- Reuse section content and data access across the card and full-page surfaces, with an explicit boundary for page-only behavior.
- Bound layout and asynchronous work so multiple cards can coexist without blocking navigation or other cards.

**Non-Goals:**

- Rebuild the drawer as widgets, embed full routes, add separate selection controls, or design new financial reports.
- Change the ledger sources, server protocol, saved preference schema, or the actions already attached to Home's toolbar and floating buttons.

## Decisions

### 1. One section catalog and one Home renderer

Evolve `src/lib/navigation.ts` into the catalog. A section describes its destination, grouping, menu label, and icon. Each non-Home destination has a card descriptor with a stable persisted ID, an optional surface-specific label where needed (My Accounts → Account Groups), and a lazy loader for its body component. Group headings and Home are navigation-only. The drawer consumes only navigation metadata; it neither mounts nor eagerly imports card bodies.

Home Settings and Reorder Cards derive their choices and labels from the card descriptors. Home resolves the saved IDs in order and renders each through one wrapper based on `HomeCardTemplate.svelte`. The wrapper provides the header and a keyboard-accessible link to the full page. Only the body supplies section content. There are no per-route cases or generic link-only fallbacks on Home. The page can still have its own title and toolbar. The alternative, adding another Home branch for each section, would leave policy and presentation scattered among three pages.

### 2. Share content below the route boundary

Extract reusable Svelte body components below the routes. The standalone page supplies its own navigation, fixed controls, and action handlers, and renders the same body or its full presentation. Cards use in-flow controls, scoped styles and state, and responsive wrapping; long lists or help text can scroll within a bounded body. Do not import `+page.svelte` or `+page.ts` from a card or embed an iframe: those approaches would duplicate page chrome and bind the body to route data, history, and global handlers.

- **Account Groups and Journal:** Reuse group lists, account rows, and the local journal reading and row presentation instead of duplicating financial data logic. Keep the current recent Journal presentation on Home and the full list and source-span-aware actions in `/journal`. Preserve group management and history links. Group default seeding remains a standalone-route concern, not part of rendering a card.
- **Reports and Calculator:** Retain `ReportLinks.svelte` as the shared Reports body. Extract the calculator keypad, display, and expression state; make applying a value an explicit callback supplied by the editor picker route only. Home uses a normal calculator instance, independent of editor selection metadata.
- **Account Tree, Accounts, Payees, Asset Allocation:** Reuse the local data consumers and views. Accounts and Payees receive explicit browse or picker behavior; only their route wrappers may consume editor selection metadata or call `history.back()` on selection. Home search does not steal focus. Extract the data access used by the Asset Allocation route from its SvelteKit load result so both hosts use the same allocation service, missing-definition handling, and refresh rules. Keep route-specific export and definition-validation controls in the full page.
- **Server Sync, Backup, File Storage, Serialization, Validation:** Share status, diagnostic, list, and action UI with their routes. The Sync card reads configuration status and existing progress/diagnostics without exposing the token, probing the server, or adding a second Sync trigger to Home. Backup reuses the existing explicit download/share handlers. File Storage mounts the existing file browser without create/delete controls and uses the existing editor route. Serialization shows status and cache metadata without resetting or loading from cache on behalf of the card. Validation reads the current local diagnostics; keep forced reload and cache-changing controls in the standalone tools, and retain access to the full-book inspector.
- **Help, About, Settings:** Extract shared guidance and app information (including version). Preserve the standalone Help anchors, About update controls, and Settings form. The Settings card presents current preferences from a read-only projection of the same values; it does not attach file-picker return hooks, autosave a detected currency, or iterate through the form save path.

### 3. Reuse the local engine and isolate asynchronous work

Ledger-backed bodies use the existing worker/client and its loading, version, and refresh signals, not separate engines or new network requests. Keep local journal data with `ledgerService` and full-book analysis with `ledgerWorkerClient`. Start work only for visible selections; reuse concurrent loads through the existing service. Use per-card pending/error state and freshness guards so a stale request, removed card, or failed read cannot overwrite current results or break adjacent cards. Preserve missing-source and valuation diagnostics; do not turn unavailable data into a confirmed zero.

Read-only initial rendering is distinct from the app's normal initialization and from explicit user actions. Keep navigation hooks, draft selection, storage writes, cache invalidation commands, and exports behind their existing host or action boundaries. Reusing page mount handlers unchanged would introduce side effects into ordinary Home visits.

## Risks / Trade-offs

- [Many selected sections increase Home cost] → Keep the catalog cheap to import, lazy-load selected bodies, share the existing ledger load, avoid loading report calculations for the Reports menu, and verify the production PWA caches the selected body chunks for offline use after installation/update.
- [Route-only state leaks into Home] → Pass intent from the host and keep return-to-editor, settings initialization, and destructive operations out of shared mount code. Test Home while editor selection metadata is present and compare initialized device data before and after mounting the cards.
- [Long tables, lists, or dialogs take over Home] → Use a bounded inline body, keep page-level controls in the page wrapper, and test that both Home's actions and the cards remain reachable on mobile.

## Migration Plan

Keep `SettingKeys.visibleCards` (`homeCardNames`) and the published branch's `AccountGroupsCard`, `JournalCard`, and `shortcut:/…` IDs. Treat the prefix as a persistence identifier even though the representation is no longer a shortcut. Normalize the old My Accounts shortcut and `FavouritesCard` to Account Groups once, at their first existing position. Continue filtering retired card IDs. Hide unknown IDs in all three Home surfaces without rewriting preferences on read; preserve them for forward compatibility when confirming edits. Respect saved `[]` separately from a missing preference. No storage migration or automatic write is needed, and rolling back to the shortcut implementation can still read the recognized selections and order.
