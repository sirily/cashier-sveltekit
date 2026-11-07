# Tasks

## Execution rules

Use published `transaction-entry`, `manual-transaction-writeback`, `ledger-sync`, and `ledger-analysis` as the business regression baseline. Their requirements remain unchanged; this change uses proposal, design and tasks with spec generation skipped.

The original identity fix and nine removal commits are complete; their checked tasks and verification records below retain the scope tested at that time. QA follow-up adds three separately tested analysis-freshness fixes (sections 10–12), followed by one atomic schedule/forecast retirement (section 13), all within this change. Those follow-up sections are now complete; sections 14–19 for PR #26 repairs D1–D4 and D6 and repeat acceptance checks are marked complete, with verification results recorded below. D5 is explicitly excluded. The eight orphan-file deletions already landed in `7dc6bfad`. Manual journal entry, ordinary settings, local editing, journal export, outbound backup and offline RustLedger actual-book analysis remain. Scheduled transaction authoring/actions/calendar, dedicated scheduled export and schedule-based forecast retire; existing scheduled rows remain passively backed up. External accounting data enters through server Sync. Import, upload/drop, pasted-record ingestion and restore are removal scope. Post-sync mutations, account management and analytics redesign are separate work.

**Gate G before every runtime commit:** run `npm run check:specs`, `npm run lint`, `npm run lint:svelte`, `npm run check`, `npm run check:build`, and retained-workflow unit/browser suites through the repository test runners. Select and record test files/name filters so tests dedicated solely to retiring functions are excluded; split mixed tests to preserve their retained assertions. Use `npm run test:unit -- --run` and `npm run test:e2e -- --workers=2` once that selection is reflected in the invocation/configuration; unfiltered execution of retiring behavior is not required. Exercise offline journal create/edit/delete/reload; server Sync success/rejection/incomplete/failed-pull retry with stable IDs; accounts/history/reports and offline calculations; actual export content and outbound backup credential filtering. Test retained business workflows and the safety of removal. Do not test, repair or require correct operation of retiring voice/peer/backup-restore/import/filesystem/Ledger/schedule/forecast paths, including while they still exist in earlier slices. Tests whose sole purpose is exercising those paths leave the required cleanup suite; keep shared assertions for retained behavior. After retirement, check that former entry points leave stored data unchanged and positively verify data arrival through server Sync. Seed test fixtures directly in OPFS/IndexedDB, not through a production importer.

**Commit gate:** verify the graph covers current relevant source, inspect staged scope, run GitNexus `detect_changes` without partial/truncated results, account for affected flows and complete a regression review. Record commands/results and commit hash. Failed or unavailable mandatory checks block the commit. A failure in a retained business workflow requires separately authorized remediation; do not weaken assertions. Mocked HTTP is not real Python-server integration; never run tests against the owner's real book.

## 0. Preserve identity when editing a local journal transaction — separate fix commit

- [x] 0.1 Add a regression using an existing local `cashier_id`: load through the real journal/editor conversion, change narration, save and reopen; verify the test fails on the current code because the ID disappears, and assert one entry plus unchanged neighboring source.
- [x] 0.2 Preserve the original ID through model conversion, editor state and serialization/source replacement; verify the regression passes and a second save retains the same ID without a network request or extra entry.
- [x] 0.3 Verify writeback preparation/retry uses the preserved ID after accepted-send/failed-pull, while new and duplicated transactions get independent identities through the existing flow; keep the server's same-ID content-conflict behavior unchanged.
- [x] 0.4 Run focused editor/identity/writeback unit and browser tests, G and the commit gate; deliver only `fix: preserve local transaction identity on edit` before the removal commits. Record actual checks and results. Retiring restore/import functionality is outside verification scope.

## 1. Remove voice entry — commit 1

- [x] 1.1 Establish baseline G for retained workflows and current source/graph boundaries; verify browser/OS dependencies and formatting. Complete section 0's local `cashier_id` fix and regression within this change, in its own commit before feature removal. Retiring restore's known G12 defect is not a prerequisite and receives no repair/testing task here.
- [x] 1.2 Fill retained-workflow test gaps: local delete with neighbor preservation/reload, journal copy/download without mutation, outbound settings/scheduled backup with token exclusion and offline full-book analysis. Verify supported editor identity/field behavior and distinguish local checks from server acceptance.
- [x] 1.3 Remove Voice Entry route, parser, parser-only tests, navigation and exclusive imports; verify normal entry/save works and former URLs cannot initialize microphone code.
- [x] 1.4 Update affected navigation docs/assertions; run G and commit gate, then create only `chore: remove voice entry` with its tests/docs.

## 2. Remove peer-sync demo — commit 2

- [x] 2.1 Remove the demo route, PeerConnectionManager and dead navigation; remove only proven-exclusive peer settings, preserving server selections despite nearby peer comments. Verify no peer initialization or financial-data mutation.
- [x] 2.2 Cover old URLs/navigation and update affected docs; run G and commit gate, then create only `chore: remove peer sync demo`.

## 3. Remove legacy remote backups — commit 3

- [x] 3.1 Move shared backup filename generation into retained export/backup code; verify journal/scheduled copy/download before removing its former module.
- [x] 3.2 Remove WebDAV configuration/backup/preview/diff, cloud-backup page/card, remote clients, menus and `webdav` with lockfile updates; verify retained routes and old URLs initiate no remote-backup request.
- [x] 3.3 Purge only retired remote credentials locally and filter outbound backup. Verify removal/migration preserves the active token and existing data/settings; retain outbound-export and applicable diagnostic secrecy coverage. Skip restore functionality tests: that input retires in commit 4.
- [x] 3.4 Correct Backup's claim to contain transactions: verify settings/scheduled outbound payload scope and separate journal/book export; document retired-credential rollback limits, run G and commit gate, then create only `chore: remove legacy remote backups`.

## 4. Remove local import and restore entry points — commit 4

- [x] 4.0 Fix the retained Settings file-picker return URL: replace the empty `replaceState` destination with the explicitly resolved Settings path while clearing return parameters. Preserve selected book/asset-allocation definition and pending form values. Keep the existing failing book-selection regression, add allocation-definition selection coverage, and verify ordinary save/reload, unchanged unrelated settings/token/OPFS files, G and graph/review checks before completing 4.4. Do not weaken the URL assertion or bypass the picker.
- [x] 4.1 Remove `/opfs/import-ledger` including directory picker/upload fallback, `/import-ledger-xact`, their drawer/Journal/Settings links and exclusive paste-parser tests/helpers. Preserve other transactionParser consumers and folder helpers still used by filesystem sync. Verify the removed entry points cannot mutate an existing journal/book.
- [x] 4.2 Remove both OPFS Upload File and drag-and-drop ingestion, including input handlers/state and upload-only conflict/overwrite/copy dialogs. Verify file listing/selection and retained local editor/storage operations still work, and attempted retired inputs leave data unchanged.
- [x] 4.3 Remove local Restore Backup controls/file-reading/dialogs from `/backup`, the entire `/restore/[itemType]` file/paste route and Scheduled Transactions Restore action, plus arbitrary bulk-save `/settings/json-editor` and its menu. Remove restore-only services after their final consumer is gone; preserve manual schedule/settings controls and outbound backup/export. Verify old file/paste/URL paths cannot alter settings, schedules or active token.
- [x] 4.4 Preserve existing OPFS/IndexedDB data and outbound token filtering; update backup/setup descriptions to server Sync, verify no directory prompts or retired network calls, run G and commit gate, then create only `chore: remove local import and restore entry points`. Remove obsolete restore/import tests and helpers while preserving positive server-pull, outbound-export and removal-data-preservation coverage.

## 5. Keep only server synchronization — commit 5

- [x] 5.1 Remove sync-fs, `/opfs/sync`, `/settings/filesystem` and navigation. Recheck fsScan/fsHandleStore final consumers and remove exclusive helpers only now; keep importManifest while OpfsFilePicker uses its marker or remove that marker atomically. Preserve shared databases and analytics concurrency helpers; verify existing stored data and OPFS consumers survive.
- [x] 5.2 Simplify Sync to the fork's Beancount flow; normalize recognized legacy source strings at settings load, preserving URL/token/root/selection and metadata-only choices. Test fresh/partial configuration and existing filesystem/Ledger settings without data reset, invented credentials or automatic synchronization.
- [x] 5.3 Keep server Sync discoverable in navigation; describe the ledger-file option as send/pull/reconcile and Reload as server-only reload. Test old URLs, same-ID retry, rejection/incomplete entries, pull/parse rollback, overlay protection and token forwarding; update affected docs.
- [x] 5.4 Verify server pull is the supported external accounting-data input, existing local analysis still runs offline and no hidden import path was kept as a workaround; run G and commit gate, then create only `chore: keep only server synchronization`.

## 6. Remove Ledger-cli compatibility — commit 6

- [x] 6.1 Remove Ledger-cli query/parser/format branches and exclusive enums; retain Beancount and shared helpers, verifying reference-data replacement, original currencies and distinct report records. The Ledger paste-import route already retired in commit 4; do not recreate it under a new name.
- [x] 6.2 Remove optional investment HTTP fallback after verifying all worker-injected callers; test local investment calculations and absence of report network requests. Preserve existing allocation TOML/data/selector; record the unsupported server-definition delivery path for separate work instead of inventing an API or retaining an importer.
- [x] 6.3 Set journal filenames explicitly to `.bean` in the helper moved by commit 3; test actual output, unchanged journal/identity and credential-free backup, updating accounting-system copy and dependency-aware rollback notes.
- [x] 6.4 Run G and commit gate, then create only `chore: remove ledger cli compatibility`; verify RustLedger/WASM, worker, parser and cache remain functional.

## 7. Remove unused storage-selection layers — commit 7

- [x] 7.1 Remove createDAL/FSDAL and unused backend selection/cache/non-OPFS implementations, updating live DAL types/barrel consumers atomically; verify type-check and direct OPFS readers/writers need no later fix.
- [x] 7.2 Remove helpers only after checking retained OPFS selection, settings, editor and analytics consumers; preserve existing databases/data and verify server pull, journal, export/backup and local analysis.
- [x] 7.3 Update storage references, run G and commit gate, then create only `chore: remove unused storage selection layers`.

## 8. Remove cross-list drag prototype — commit 8

- [x] 8.1 Remove five prototype components and their cross-list assertions; rewrite the combined string-built harness to retain live DragReorderList coverage and verify its imports compile.
- [x] 8.2 Exercise live reorder with duplicate labels and parent bindings across retained callers; keep esbuild-wasm, update references, run G and commit gate, then create only `chore: remove cross list drag prototype`.

## 9. Remove unused build dependencies and configurations — commit 9

- [x] 9.1 Reconfirm no direct/dynamic/config/peer consumers of @floating-ui/dom, @rollup/wasm-node, autoprefixer and vite-plugin-mkcert; remove them and regenerate the lockfile, verifying framework/test dependencies and installed metadata remain consistent.
- [x] 9.2 Remove disconnected tailwind.config.js and src/manifest.json; verify CSS themes/plugins, generated manifest/icons, static routes, worker and offline production behavior; update affected configuration docs.
- [x] 9.3 Run G and commit gate, then create only `chore: remove unused build dependencies and configs`; verify scope and summarize the identity-fix and nine removal commit hashes/checks, including task 4.0's Settings return-path repair with real-server evidence distinct from mocks.

## 10. Validate full-book cache freshness — separate fix commit

- [x] 10.1 Add regression-first tests with real WASM/worker composition: a readable cached book must not reactivate removed drafts or old edited amounts after journal/root/include changes, same-length edits, or a fresh worker/browser reload. Preserve the exact QA order including OPFS edit and Delete All; assert source and real remaining errors, not only diagnostic count.
- [x] 10.2 Validate cache against the effective current source composition and relevant root/parsing identity before activation. Rebuild on mismatch, old unvalidated cache, missing/corrupt cache, deleted include or root change; keep the valid matching-cache fast path. Preserve financial files/overlay and genuine error diagnostics. Hash verification after cache activation is insufficient.
- [x] 10.3 Make invalidation durable against a failed cache rewrite so the next reload cannot accept an obsolete binary. Cover persistence failures and expose freshness/loading/error state instead of presenting stale calculations as current; avoid silent failure or disabling caching as the fix.
- [x] 10.4 Run G and fresh graph/review checks, including all cache-enabled regression paths; record results and create only `fix: validate ledger cache against current sources`.

## 11. Refresh full-book analysis after Journal Delete All — separate fix commit

- [x] 11.1 Reproduce cached report diagnostics from incomplete local drafts alongside a valid selected book, then Delete All. Test warm report navigation and browser reload with cache both enabled and disabled, without manual validation/cache toggles. Verify downloaded book, settings/token, currencies and server-origin records remain intact.
- [x] 11.2 Refresh/invalidate the analysis worker after durable journal clearing, propagate loading/version changes to dependent views, and preserve actual remaining-book diagnostics. Cover journal-write failure and post-save refresh failure separately: do not claim a durable deletion was rolled back or expose stale results as current. Delete All remains local and makes no server mutation/request.
- [x] 11.3 Run G and fresh graph/review checks, record results and create only `fix: refresh reports after clearing local journal`.

## 12. Refresh analysis after OPFS book saves — separate fix commit

- [x] 12.1 Reproduce edited root/include data remaining stale in reports/cache. Cover cache-enabled same-length edits, selected root and included files, warm navigation/cold reload, valid-invalid-valid recovery, and the combined OPFS edit → incomplete drafts → Delete All sequence.
- [x] 12.2 On successful relevant source save, refresh/invalidate full-book calculations and persisted cache through their existing owner while preserving the pending overlay. Failed writes preserve source and show failure; post-write analysis failure remains distinguishable from storage failure. Keep non-book text editing and manual/server boundaries unchanged.
- [x] 12.3 Run G and fresh graph/review checks; verify actual balances/report values, original currencies, current diagnostics and unchanged unrelated files/settings. Record results and create only `fix: refresh analysis after OPFS book edits`.

## 13. Remove scheduled transactions and schedule-based forecast — separate removal commit

- [x] 13.1 Confirm all route/component/service and string-built consumers with fresh graph plus source references. Remove `/scheduled-xacts` with calendar/loader, `/scx-editor/[[id]]` with loader, `/scx-actions/[id]`, ScheduleEditor, Upcoming card, transaction Schedule action and drawer links; preserve shared manual journal/editor/selection helpers. Do not fix or test successful schedule editing, recurrence or search.
- [x] 13.2 Remove ForecastCard, DailyForecastChart, `/forecast-settings`, exclusive recurrence/projector code, controls and exclusive colorscheme dependency after verifying consumers. Preserve actual-book reports, local worker/WASM, `chart.js`, `moment`, investment/allocation data and live reorder. No replacement forecast implementation.
- [x] 13.3 Remove home-card defaults/toggles/identifiers and normalize only the legacy `ForecastCard` / `ScheduledXactCard` names at the shared read boundary. Preserve remaining order and explicit empty lists; avoid automatic configuration writes or default resurrection. Verify Home, Home Settings and Reorder on fresh and upgraded installations.
- [x] 13.4 Remove live schedule stores and load/save/export APIs, exclusive enums/constants and `/export/scheduled` branch/matcher. Retain existing Dexie scheduled table/schema/rows and minimal legacy model for passive `scx` outbound backup. Keep journal export, token filtering and unrelated settings/OPFS data; no reset, store drop or conversion to journal entries.
- [x] 13.5 Update backup/UI copy and affirmative architecture/agent documentation. Split mixed tests: remove retiring workflow correctness cases, keep legacy-row backup and data-preservation assertions. Add former schedule/forecast/export URL/action checks for no record mutations/network, and retained manual entry/reorder/report/export checks.
- [x] 13.6 After sections 10–12 pass, run G and fresh graph/review checks for the atomic removal; verify upgrade/reload preserves financial data/token/server selection/legacy rows, credential-free outbound backup still contains legacy `scx`, and manual journal, Sync retry, actual-book analytics and offline PWA work. Record checks and create only `chore: remove scheduled transactions and forecast`.

## 14. Correct currency-specific balance adjustment — D2

- [x] 14.1 Reproduce the currency-switch failure with 290 GBP / 66.81 USD; add regression coverage for USD target 70 → +3.19 USD, switching back to GBP, and unavailable versus proven-zero baselines.
- [x] 14.2 Resolve the selected account/currency baseline without implicit conversion or stale numeric reuse; block saving when it is unavailable. Verify balanced local postings, save/reopen, original currencies, unchanged neighboring source and no server mutation.
- [x] 14.3 Run focused unit/browser checks, G and fresh impact/review checks; record evidence for D2 without changing the original QA report.

## 15. Preserve the editor across posting subpage returns — D1

- [x] 15.1 Reproduce both Delete Postings and Reorder Postings return failures through production routes for new and saved local entries; capture the actual client error/root cause before editing, without assuming the retired schedule crash is the cause.
- [x] 15.2 Repair the confirmed return/state boundary. Cover delete Cancel/OK, no-op reorder and actual pointer reordering; preserve unsaved fields, edit target, stable identity and exact posting order through return and save/reopen without duplicate entries or neighbor changes.
- [x] 15.3 Run focused browser/editor tests, G and fresh impact/review checks; record D1 outcomes separately for both routes. Do not count unsupported keyboard gestures or harness-only tests as production reorder evidence.

## 16. Retain Sync failure explanations through navigation — D3

- [x] 16.1 Add navigation regressions for same-ID conflict, unknown account and mixed accepted/rejected batches: Sync → Journal → Sync without another run must retain concrete reasons, stage outcomes and available transaction attribution.
- [x] 16.2 Keep last-run feedback outside route lifetime until the next explicit Sync starts, without new durable transaction states or a restart-persistence guarantee. Verify a new run replaces old feedback, rejected entries remain local and safe retry/reconciliation is unchanged.
- [x] 16.3 Run focused Sync tests, G and fresh impact/review checks; record D3 evidence and distinguish mocked API coverage from real Python-server execution.

## 17. Explain authentication and authorization failures — D4

- [x] 17.1 Add wrong-token HTTP authorization regressions and contrasting transport/non-authorization failures; verify stage-specific actionable messages without token/header leakage or blanket invalid-token diagnoses.
- [x] 17.2 Preserve error classification through the client/UI boundary; verify feedback survives navigation under D3 and ordinary Sync recovers after correcting credentials. Do not change server APIs or investigate D5's Reload access policy.
- [x] 17.3 Run focused client/browser tests, G and fresh impact/review checks. With an available disposable Python-server environment, repeat wrong-token/corrected-token browser checks; otherwise record that integration evidence as not run.

## 18. Align About and Help with the retained fork workflow — D6

- [x] 18.1 Update the existing About/Help pages to identify the fork/repository, manual offline journal capture, explicit Python-server Sync, local calculations and optional export. Remove retired import and Ledger CLI/Hledger setup recommendations; remove obsolete manual links or explicitly label historical upstream references.
- [x] 18.2 Add browser assertions for actual page copy/link destinations and retained build/update/tool controls. Keep the change to existing pages, without a new help system or restored ingress capabilities.
- [x] 18.3 Run focused page tests, G and fresh impact/review checks; record D6 verification within this change rather than deferring it to a separate change.

## 19. Repeat scoped PR #26 acceptance checks

- [x] 19.1 Repeat browser scenarios D2, D1, D3, D4 and D6 on rebuilt assets. Record revision, environment, per-scenario outcomes and limitations in a new verification entry, preserving the original QA report verbatim. D5 is owner-excluded: no investigation, repair or acceptance task.
- [x] 19.2 Run the full retained-workflow gate G and regression review after the fixes; distinguish automated, browser and real-server evidence. Keep remaining failures/unavailable checks explicit and do not claim readiness based on the prior 51 checked tasks. Commit, archive, push, merge and deployment still require their corresponding authorization.

## Verification record

### Identity fix

- Source preservation at `LedgerService.editTransaction` retains the stored transaction-level ID; the editor model and new/duplicate identity assignment remain unchanged. Regression-first evidence: the initial three real-WASM tests failed because saving dropped/reassigned the ID. Final focused suite: 11 passed, including multiline text, annotations and Unicode posting boundaries.
- Gate G passed: `npm run check:specs` (5/5), `npm run lint`, `npm run lint:svelte`, `npm run check` (0 errors/warnings), `npm run check:build` (no warnings).
- Retained unit command: `npm run test:unit -- --run --exclude tests/voiceNlp.test.ts --exclude tests/xactParser.test.ts -t '^(?!.*(?:restore|WebDAV)).*$'` — 149 passed, 6 retiring cases excluded. Retained browser command: `npm run test:e2e -- --workers=2 --grep-invert 'cross-list preview'` — 36 passed. Includes offline capture/edit/delete/reload, server mock success/rejection/failed-pull/retry/conflict, local reports/history, live reorder, actual export and credential-free outbound backup.
- Browser tooling installed; `.serena/project.yml` indentation formatted for lint. Build checks run sequentially because concurrent builds share `.svelte-kit` output.
- Fresh container-local GitNexus index and structured `detect_changes(scope=all)` passed without partial/truncated results: 7 changed files, 47 symbols, 3 edit/storage/parser flows, medium risk. Focused independent regression review passed. Real Python-server integration not run: no disposable environment/credentials supplied.
- Broader pre-existing rich-source preservation remains separate: document-symbol spans can include an inter-transaction comment in the edited range. This fix covers identity; it does not claim complete lossless editing.
- Commit: `fix: preserve local transaction identity on edit` (recorded in Git history).

### Voice retirement

- Identity fix committed as `5fbca27`. Removed voice route, parser, exclusive tests and drawer entry, plus stale voice documentation references. Baseline and missing retained-workflow coverage completed in the preceding fix commit.
- Gate G passed: specs, lint, Svelte lint, types and warning-gated build; retained units 149 passed / 6 retiring cases excluded; retained browsers 39 passed / cross-list prototype excluded. Unit command now excludes only `tests/xactParser.test.ts` plus the same restore/WebDAV name filter. Browser command unchanged. Three new removal checks cover former URLs, microphone inactivity, unchanged OPFS/IndexedDB and drawer access.
- Pre-edit UNKNOWN voice graph results were resolved with source/reference inspection. Independent regression review found no blockers. Fresh index and structured change gate checked before `chore: remove voice entry`; no real-server integration claimed.

### Peer demo retirement

- Voice removal committed as `402b8ca`. Removed peer demo, exclusive connection manager and commented menu; retained all server-selection settings and consumers.
- Gate G passed: specs, lint, Svelte lint, types, warning-gated build, 149 retained unit tests (6 retiring cases excluded) and 41 browser tests. Commands unchanged from voice retirement. Added old peer URL/reload checks for no WebRTC/media initialization and unchanged stored data/server selections.
- Independent regression review found no blockers; graph results were checked against source consumers. Fresh structured graph-change check precedes `chore: remove peer sync demo`. Real-server integration not run.

### Remote backup retirement

- Peer removal committed as `26addce`. Removed WebDAV/cloud routes, clients, card, links and package; retained filename helper moved to `backupFilename.ts` with existing extension behavior. Backup copy describes its actual settings/scheduled payload.
- Settings-load cleanup deletes only `webdav-settings`, `pCloudToken`, `backupServerUrl`; outbound backups filter those keys and the active token. Cleanup failures leave retained reads operational, hide retired keys and retry deletion later; concurrent initialization and persistent/transient failures tested.
- Gate G passed: specs, lint, Svelte lint, types, warning-gated build; 159 retained unit tests (5 restore cases excluded), 55 browsers. Unit selection: `npm run test:unit -- --run --exclude tests/xactParser.test.ts -t '^(?!.*restore).*$'`; browser selection unchanged. Covers actual copy/download/share, no retired requests, narrow cleanup and unchanged data.
- Shared-settings graph reach is CRITICAL; independent review exposed and verified repair of failure propagation. Fresh structured graph check precedes the separate commit. Reverting cannot recover deleted remote credentials; reintroduction requires re-entry and dependency-aware restoration of the relocated filename helper. Real-server integration not run. npm reports 10 remaining vulnerabilities; no unrelated audit updates applied.

### Local ingress retirement — verification blocker

- Remote backup removal committed as `0b1619f`. Slice 4 implementation is present but uncommitted; its task checkboxes remain open until the retained-workflow gate passes.
- Specs, lint, Svelte lint, types and unit checks passed. Warning-gated build passed on a sequential retry; an earlier attempt emitted timing diagnostics counted as warnings. Browser selection: 70 passed, 1 failed. Retired route/file/drop/paste checks passed; the retained settings file-selection workflow failed.
- Failure: after Settings → Select book → confirm `server.bean`, `handleFilePickerReturn` calls `replaceState('', {})`. The root `<base href="/">` makes the empty URL resolve to `/`, leaving the settings component mounted under the wrong address. The test expects `/settings`; it remains unchanged rather than accepting the defect.
- Reproduced against an unmodified detached production build of HEAD `0b1619f` on isolated port 4174. Relevant return-handler/picker/layout code matches the current source; the bug predates slice 4. OPFS/IndexedDB remained unchanged. Later source-edit steps were not reached. Temporary worktree removed and test server stopped; no real server API exercised.
- The owner authorized adding this retained-workflow repair to the current change. Task 4.0 records the narrow fix and regression checks. Implementation remains pending; the slice-4 commit and later removals await its passing gate. No workaround or assertion weakening applied.

### Local ingress retirement — completed verification

- Task 4.0 fixes the pre-existing return URL with `replaceState(resolve('/settings'), {})`. Both book and allocation-definition selection preserve pending values, require explicit save and survive reload without changing unrelated records, tokens or OPFS bytes.
- Removed import/upload/drop/restore/bulk-settings inputs and exclusive helpers/tests; retained source editing, OPFS browse/select, manual controls and outbound exports. Gate G passed: specs 5/5; lint, Svelte lint, types; `npm run test:unit -- --run tests` (160 passed); warning-gated build; retained browser selection (73 passed). Unit scope excludes temporary investigation artifacts outside `tests/`; retiring correctness tests have been deleted.
- Independent slice and picker reviews passed. Fresh structured graph-change analysis precedes commit 4. Real Python-server integration remains not run. The previous blocker record above documents the baseline failure, now resolved by the authorized task.

### Server-only synchronization

- Slice 4 committed as `af4a6d9`. Removed filesystem sync/routes and exclusive scan/handle helpers. Navigation/home card both open `/sync`; source selection is Beancount-only with read-time legacy normalization. Existing connection details, server selection, sync choices and financial data remain unchanged; no automatic sync or default-root write on load.
- Gate G passed: specs, lint, Svelte lint, types, `npm run test:unit -- --run tests` (170 passed), warning-gated build, retained browser selection (88 passed). Same-ID retry/rollback/rejection, metadata-only references, authenticated server-only Reload and fresh/partial/legacy configuration covered. Retired filesystem correctness not exercised.
- Shared-settings impact CRITICAL, investigated through direct consumers; independent review found no blockers. Fresh structured graph gate precedes commit 5. `importManifest` and analytics concurrency retained. Real-server integration not run.

### Beancount-only compatibility cleanup

- Server-only Sync committed as `1fb17e9`. Removed Ledger-cli query/parser/formatter/enums and investment HTTP fallback; production investment caller injects worker queries. Journal downloads use `.bean`; actual copy/share/download preserves source and IDs.
- Gate G passed: specs, lint, Svelte lint, types, 180 unit tests (`--run tests`), warning-gated build and 88 retained browser tests. Local investment/no-network, reference replacement/original currencies, real WASM/cache and distinct posting identities covered. Independent review found no blockers; HIGH/CRITICAL shared-path graph impact investigated, with fresh structured gate before commit.
- Allocation definition still uses existing selected TOML in OPFS; server definition delivery remains separately scoped per design. Rollback must resolve the earlier filename-helper relocation and shared query/enum/caller dependencies and rerun G; code reversal restores neither purged remote credentials nor new data. Real-server integration not run.

### Storage-selection cleanup

- Beancount cleanup committed as `ec520e8`. Removed unused DAL factory/FSDAL, selectable backend cache/factory, filesystem singleton and non-OPFS backends; retained DAL/CashierDAL types, OPFS public exports, shared databases and data.
- Gate G passed: specs, lint, Svelte lint, types, 186 unit tests, warning-gated build and 88 retained browsers. Positive DAL persistence and public-barrel OPFS read/write/list/delete coverage added. Independent review checked dynamic/barrel consumers and constructor initialization; no blockers. UNKNOWN graph results supplemented with source checks; fresh structured gate precedes commit 7. No real-server integration.

### Cross-list prototype retirement

- Storage cleanup committed as `2ba3752`. Removed five prototype components and cross-list-only assertions; extracted a retained-only live reorder compilation harness. Live component, production callers and `esbuild-wasm` unchanged. Added duplicate-label bound-order/persistence checks across favourites, home cards, postings and account groups.
- Gate G passed: specs, lint, Svelte lint, types, 191 unit tests, warning-gated build, all 88 browser tests (`npm run test:e2e -- --workers=2`; no retired-case filter now needed). Independent review checked string-built imports and retained DOM/parent-binding assertions; no blockers. New files staged before fresh structured graph gate. No real-server integration.

### Build dependency/configuration cleanup and original-scope gate

- Prototype retirement committed as `9fed67e`. Removed four unused dev dependencies and disconnected Tailwind/source-manifest configs. Lockfile: 18 removed entries, zero additions or changes to retained entries; no required runtime/optional/peer consumers. Installed framework/CSS peers and live `esbuild-wasm` remain satisfied. The pre-existing extraneous `node_modules/$app` metadata entry and 10 npm audit findings remain outside scope.
- Final gate G passed: specs 5/5, lint, Svelte lint, types (0 errors/warnings), `npm run test:unit -- --run tests src` (192 passed across 28 files), warning-gated build, `npm run test:e2e -- --workers=2` (89 passed). Production checks verify generated manifest, 14 declared icons, actual theme/Tailwind/DaisyUI styles; PWA tests verify offline navigation and update lifecycle. No retiring-function correctness tests run.
- All slices passed independent regression review and fresh structured graph-change gates without partial/truncated results. Real Python-server integration not run: no disposable book/credentials provided. Mocked tests cover API success/rejection/auth/retry/rollback but are not real-server evidence. No push, release, deployment or archive performed.

| Work                                         | Commit                                                              | Browser gate |
| -------------------------------------------- | ------------------------------------------------------------------- | ------------ |
| Preserve local identity                      | `5fbca27`                                                           | 36 passed    |
| Remove voice                                 | `402b8ca`                                                           | 39 passed    |
| Remove peer demo                             | `26addce`                                                           | 41 passed    |
| Remove remote backup                         | `0b1619f`                                                           | 55 passed    |
| Remove local ingress; task 4.0 picker repair | `af4a6d9`                                                           | 73 passed    |
| Server-only Sync                             | `1fb17e9`                                                           | 88 passed    |
| Beancount-only compatibility                 | `ec520e8`                                                           | 88 passed    |
| Storage-selection layers                     | `2ba3752`                                                           | 88 passed    |
| Cross-list prototype                         | `9fed67e`                                                           | 88 passed    |
| Build dependencies/configs                   | `chore: remove unused build dependencies and configs` (Git history) | 89 passed    |

### QA follow-up scope and evidence

- QA reports schedule edit 500 for balanced completed entries and drafts, missing note/search in the list, and stale report diagnostics after OPFS edits/Delete All. Isolated browser reproduction confirms the schedule crash with `effect_update_depth_exceeded`; its exact reactive loop is unisolated and retires rather than receiving a repair task. List/source confirms note is omitted and search considers payee only; both retire.
- Worker/source investigation confirms missing full-book invalidation on Delete All and OPFS Save plus unvalidated readable-cache acceptance on reload. A synthetic real-WASM worker probe reproduces stale diagnostics and cache-disabled recovery; it does not identify the user's individual 18 diagnostics.
- Earlier gates did not cover schedule create/save/re-edit, Delete All with cache, or OPFS Save recovery without explicit Reload & Validate. The original 35 checked tasks record checks actually performed, not proof of these missing scenarios. Sections 10–13 are pending; no QA fixes or schedule removal implemented in this planning update.

### Source-bound cache verification

- Section 10: regression-first actual-worker/real-WASM tests reproduced 16 failures before the fix. Cache acceptance now checks versioned source-composition and binary SHA-256 metadata before activation; old/unverified/mismatched caches reparse current source. Metadata is retired before rewrite and published last; failed cache persistence clears availability rather than preserving stale authority.
- G passed: specs, lint, Svelte lint, types, 222 unit tests (`--run tests src`), warning-gated build and 97 retained browsers (`--grep-invert 'scheduled export copies'`). Nine new cache browsers cover cold source/root/include changes, invalid caches, persistence failure and QA-order source/data preservation. The schedule-export success case retires; passive legacy backup checks remain.
- Independent source review found no introduced blockers; shared worker graph reach CRITICAL investigated, fresh structured gate precedes `fix: validate ledger cache against current sources`. No real Python-server evidence claimed.
- Test setup initially exposed the existing serialization tool's uninitialized main-thread hash call. Setup now uses the real worker Reload & Validate path; tool repair is outside this slice. Warm mutation hooks remain sections 11/12.

### Journal Delete All verification

- Source-bound cache committed as `67ac33d`. Delete All now awaits durable empty-journal storage, then refreshes local journal and full-book owners. Storage failure retains data; post-save refresh failure reports durable deletion separately. Shared missing-journal startup initialization is inside the existing error boundary.
- Regression-first component/storage/startup cases failed before fixes. G passed: specs, lint, Svelte lint, types, 234 unit tests, warning-gated build, 101 retained browsers (same retiring scheduled-export exclusion). Four new browser cases cover cache on/off, warm/cold reports, genuine remaining errors, USD/RUB postings and unchanged book/settings/token/no API requests.
- Independent review's startup-error blocker resolved and rechecked. Browser setup waits for actual route completion; journal identity scenario dismisses the offline-ready toast blocking its FAB. Fresh graph/review gate precedes `fix: refresh reports after clearing local journal`. Real-server integration not run.

### OPFS source-save verification

- Delete All fix committed as `e2fa8f0`. OPFS `.bean` saves now refresh the existing full-book owner after durable write; non-book text saves skip refresh. Strict route-local writer aborts failed writes, retains editable text and distinguishes post-save analysis failure. Save snapshots path/content before awaiting IO so navigation cannot skip required refresh.
- Regression-first editor cases reproduced storage/refresh failures; reviewer navigation-race probe became three unit cases. G passed: specs, lint, Svelte lint, types, 250 unit tests, warning-gated build and 104 retained browsers. Root/include same-length edits, warm/cold results, actual amounts/currencies/balances, invalid-valid recovery and QA edit/drafts/Delete All sequence covered with real WASM and cache enabled.
- Four previous report tests were updated from expecting obsolete results until manual validation to requiring fresh results before it, then verifying explicit reload idempotence. Independent review rechecked saved-path race and found no remaining blocker. Fresh structured graph gate precedes `fix: refresh analysis after OPFS book edits`. Real-server integration not run.

### Schedule and forecast retirement verification

- OPFS fix committed as `b05efb1`. Removed all live schedule/calendar/editor/actions and dependent forecast/card/settings/recurrence paths; closed dedicated scheduled export and removed only its exclusive colorscheme dependency. Preserved shared manual editor/actions, actual-book charts/worker/WASM, Moment, allocation/TOML and live reorder.
- Shared card read boundary filters only the two legacy names, preserving saved order and explicit/filtered empty lists across Home, Home Settings and Reorder without automatic writes. Dexie schemas/model/rows retained for passive `scx` outbound backup; inert preferences remain stored. No data purge, journal conversion or schedule repair.
- Final G passed: specs 5/5, lint, Svelte lint, types, 266 unit tests across 35 files (`--run tests src`), warning-gated production build and all 123 browser tests (`--workers=2`). Includes old URL/action non-mutation, upgrade/reload storage and card settings, legacy backup/token filtering, journal/Sync retry, real-WASM cached reports, OPFS editing, PWA offline/update/packaging. Retiring correctness cases removed rather than repaired.
- Independent regression review found no blockers; model HIGH reach investigated with source/consumer checks. Fresh staged structured graph gate precedes `chore: remove scheduled transactions and forecast`. No real Python-server integration, push, merge, deployment or archive performed in this apply session. Current npm audit still reports two low findings; no audit exception added.

| QA follow-up                                   | Commit                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| Source-bound cache acceptance                  | `67ac33d`                                                         |
| Journal Delete All analysis refresh            | `e2fa8f0`                                                         |
| OPFS book-save analysis refresh                | `b05efb1`                                                         |
| Scheduled transactions and forecast retirement | `chore: remove scheduled transactions and forecast` (Git history) |

### PR #26 browser QA — newly approved, not implemented

- [Cashier-PR26-QA-report.md](Cashier-PR26-QA-report.md) records browser observations on PWA `477f28c2653fd668dcf67485425057c914614983` with Python server `4bef2b5d3c97e61ae350728cac56129f8594627f`, using a synthetic local Compose/Caddy book. Its real-server evidence belongs to that run and does not retroactively turn earlier mocked gates into integration checks.
- The owner approved D1–D4 and D6 within this change; D5 is explicitly excluded. Sections 14–19 are pending. No fixes or new validation runs are claimed by this planning update. Prior completed tasks remain historical evidence, not proof that these scenarios pass.
- About/Help deferral in the original audit is superseded by design decision 12. Other out-of-scope findings and the report's untested scenarios remain unverified; pointer reorder is now explicitly included in D1 regression coverage.

### PR #26 repairs — 2026-11-05 verification

- Tested working tree based on `da6c821`, Linux arm64, rebuilt static application through the repository Playwright webServer on `127.0.0.1:4173`. No commit, push, archive or deployment performed. Original QA report remains byte-for-byte equal to HEAD; the owner approved its exact-path formatter exception only.
- D2: component regression initially rendered `290 USD / -220.00` for the 70 USD target. Selected-currency baselines now use a successful full-book query, reject unavailable/unresolved data, and distinguish proven empty holdings. Six component cases cover switching, zero and failures. Actual-WASM browser verifies 290 GBP / 66.81 USD, +3.19 USD, switching back, account-picker return, balanced persisted postings, save/reopen, unchanged neighboring journal source and no API requests. Decimal subtraction uses existing Big.js; new adjustment clears an earlier edit span.
- D1: both production subpage returns reproduced `effect_update_depth_exceeded`. Delete without mutation did not fail; confirmed deletion and no-op reorder did. Plain objects returned by these pages became deep proxies in the editor's identity reference, repeatedly invalidating its effect. `$state.raw` retains reference identity. Saved-entry delete Cancel/OK and no-op reorder, pointer reorder/save/reopen, stable ID and neighbor preservation pass. New-entry delete/reorder save/reopen pass; reverting only the one-line fix reproduced both new-entry failures, and restoring it made both pass again. Pointer testing uses the production route, not a harness or unsupported keyboard gestures.
- D3: navigation regression first lost the unknown-account alert. The page now restores existing service-owned last-run diagnostics and displays retained stage status and available cashier IDs. Unknown account, same-ID conflict and mixed accepted/rejected navigation cases pass; rejected source remains local, accepted entries reconcile, and a subsequent successful run removes prior errors. No durable transaction state or restart-persistence guarantee added.
- D4: accounts, payees, download and writeback HTTP failures carry operation/status and actionable 401/403 guidance. HTTP bodies/headers/URLs are not included; 500 and transport failures are not mislabeled as bad tokens, while 503 advises checking server configuration. Client tests cover 401/403/500 and transport failures; mocked browser verifies wrong-token send/pull errors, no response-secret leakage, navigation retention and corrected-token recovery. Concrete per-transaction rejection reasons remain unchanged. Reload implementation/access policy was not changed or investigated.
- D6: About/Help now identify the fork/repository, offline manual capture, explicit Python-server Sync, local RustLedger analysis and optional export. Removed obsolete upstream manual recommendations; retained build/update controls and ledger-tool destinations. Actual rendered copy and links pass browser checks.
- Final gate G: `npm run check:specs` 5 passed; `npm run lint`; `npm run lint:svelte`; `npm run check` zero errors/warnings; `npm run test:unit -- --run tests src --exclude '.gitnexus/**'` 288 passed in 37 files; `npm run check:build`; `npm run test:e2e -- --workers=2` 133 passed. Unit selection excludes only ignored local GitNexus dependencies and avoids old investigation artifacts outside application test roots. Initial unfiltered attempts incorrectly collected third-party/tooling tests; no application assertions were excluded. Subsequent targeted new-entry red/green verification restored identical runtime source and passed on rebuilt assets.
- Fresh local GitNexus 1.6.12 / Node 22.23.4 `analyze --index-only --pdg` succeeded; status matched 240 covered files and HEAD `da6c821`. `detect-changes --scope all --repo .` reported 6 mapped symbols / 19 affected flows, aggregate CRITICAL reach, with no partial/truncated payload warning. Shared HTTP methods were reviewed against successful send/pull/reconcile paths; `readFiles` pre-edit HIGH warning was reported. Svelte route symbols often remain UNKNOWN and were checked by source/production-route tests. Graph flow-entrypoint enumeration limits and untracked-file omission from Git diff prevent treating counts as exhaustive; new helper/tests were also reviewed directly. The stale Mac MCP index was not used.
- Evidence limits: HTTP mocks are client evidence, not Python-server validation. Real-server wrong/correct-token execution was **not run**: no disposable environment/credentials were supplied for this session. Prior QA's real-server run is not reused as proof of these fixes. D5 remains explicitly owner-excluded; the existing full suite's unchanged Reload test is not deployment-access verification. No claim of Android installation, OS Share, cross-tab concurrency or exhaustive rich-source editing coverage is added.

### Astra D2/D3 timing findings — 2026-11-05 follow-up

- Independent review found gaps in the preceding verification: D2 exposed editable inputs before async defaults completed and could mutate a replacement transaction after navigation; D3 restored only a snapshot on remount, missing results arriving while that remounted page stayed open. Reopened 14.2–14.3, 16.1–16.3 and 19.1–19.2 during repair. Earlier passing totals did not cover these races.
- Regression-first: three deferred-query component tests failed (enabled pending inputs and XAU replacement currency overwritten to GBP, both mounted and unmounted). A production-browser test delayed POST, navigated Sync → Journal → Sync before completion, released HTTP 401, and failed because no persistent alert appeared.
- D2 now disables the form until initialization completes and guards completion by component lifetime and transaction reference, including the earlier default-currency await. Five new component cases cover pending inputs, mounted replacement, unmounted replacement, unmounted original transaction, and navigation during default lookup. Existing USD 66.81 → 70 / +3.19, GBP switching, source-preserving save/reopen and no-API browser coverage still passes.
- D3 diagnostics now live in a session-only Svelte rune-backed object. Every service reset/replacement updates that object; the route derives diagnostics and stage-display visibility from it instead of taking a one-time copy. The delayed-response browser passes, observes the send authentication error and independent successful pull without another remount, retains local source, clears old feedback on the next run and completes ordinary retry. No new durable state, concurrent-Sync single-flight policy or unresolved-POST reconciliation change.
- Full G passed on rebuilt static assets based on `da6c821`: specs 5/5; lint; Svelte lint; type check 0 errors/warnings; `npm run test:unit -- --run tests src --exclude '.gitnexus/**'` **293 passed / 37 files**; warning-gated build; `npm run test:e2e -- --workers=2` **134 passed**. Local CLI `analyze --index-only --pdg` succeeded and `detect-changes --scope all --repo .` reported 19 mapped symbols / 25 affected flows, aggregate CRITICAL, with no partial/truncated payload warning. Existing Svelte graph gaps, flow-enumeration limits and Git-diff omission of untracked files remain; source/test review supplements the graph. Targeted impact checks preceded changes; resolved service callers were LOW, route/unresolved results were UNKNOWN and checked in source.
- Original QA report remains unchanged; approved formatter exception preserved. Real Python-server execution remains **not run** (no disposable environment/credentials supplied); delayed HTTP is mocked client evidence. No commit/push/archive. Independent Astra re-review is still pending and is not claimed by this implementation verification.

### Astra commodity identity and D1 assertion follow-up — 2026-11-05

- Reopened 14.2–14.3, 15.2–15.3 and 19.1–19.2. The previous gate did not cover whitespace/lowercase commodity lookup or complete D1 field/tuple preservation. No D1 runtime defect was established by this review.
- D2 regression-first production browser tests for `USD ` and `usd` both reproduced baseline zero / +70.00 before the fix. The existing posting editor uppercases commodity input; installed RustLedger 0.14.1 probes accepted uppercase identifiers with digits, periods, underscores, hyphens and apostrophes, while rejecting the tested lowercase, numeric-leading and internal-slash identifier `A/B`. These probes did not establish Python Beancount grammar: the initial validator incorrectly rejected valid slash prefixes and accepted invalid punctuation suffixes (corrected in the follow-up below). Balance Adjustment now trims/uppercases before validation and lookup, rejects invalid identifiers rather than assuming zero, and writes that same canonical commodity into both postings. Valid absent holdings still become zero only after the successful account-balance query. No short-currency restriction was added.
- Three real-WASM browser variants (`USD`, `USD `, `usd`) verify the 66.81 baseline, +3.19 adjustment, GBP switching, account-picker return, actual persisted -3.19/+3.19 USD postings, save/reopen, unchanged neighboring source, no API requests, and subsequent analysis showing 70 USD rather than 136.81. Ten additional component cases reject invalid identifiers and preserve valid absent identifiers (`BRK.B`, `TEST_FUND`, `ABC-1`, `ABC'D`, `XAU`) through the production serializer. Test fixtures now reset the transaction store between cases.
- D1 adds six populated production-route cases: new/saved × delete/no-op reorder/pointer reorder. Each checks the complete ordered `(account, amount, currency)` sequence, including explicit zero and mixed currencies, plus unsaved date, payee, flag and narration before leaving, after return, and after save/reopen. Delete Cancel returns all original tuples; OK deletes exactly the selected third posting. Pointer movement checks the full reordered sequence, not merely the first account. Persisted source assertions check every tuple, original saved ID exactly once, transaction uniqueness, and unchanged neighbor bytes (or unchanged original journal prefix for a new entry). All pass without D1 runtime changes.
- Full G passed: specs 5/5; lint; Svelte lint; type check 0 errors/warnings; `npm run test:unit -- --run tests src --exclude '.gitnexus/**'` **303 passed / 37 files**; warning-gated build; `npm run test:e2e -- --workers=2` **142 passed**. Local GitNexus refresh with `--index-only --pdg` succeeded; change analysis reported 21 mapped symbols / 25 flows, aggregate CRITICAL over the whole uncommitted change, with no partial/truncated payload warning. Route impact remains UNKNOWN and was supplemented by caller/source inspection and actual-route tests; prior graph coverage limits remain applicable.
- Scope excludes D5, same-component injected account navigation, concurrent Sync single-flight and unresolved POST reconciliation. Immutable QA report and its exact formatter exception are preserved. No commits, push or archive. Real-server integration remains not run without disposable credentials/environment; independent Astra re-review is pending.

### Python Beancount commodity grammar correction — 2026-11-05

- Reopened 14.2–14.3 and 19.1–19.2 after independent review rejected the RustLedger-based grammar inference. Verified the actual upstream [Python lexer](https://github.com/beancount/beancount/blob/master/beancount/parser/lexer.l): uppercase-leading CURRENCY, slash-leading CURRENCY requiring a letter, and single-letter CAPITAL. The validator now mirrors those patterns: slash prefixes allowed, at least one uppercase letter, uppercase/digit ending, punctuation internal only. Existing trim/uppercase canonicalization is unchanged. UI guidance now states these constraints. The earlier blanket slash-rejection claim above was corrected.
- Regression-first component run: 8 failures reproduced acceptance of `USD-`, `CAC_`, `ABC.`, `ABC'` and rejection of `/6J`, `/USD`, `/NQH21`, `/NQH21_QNEG21C13100`. All 33 Balance Adjustment component tests now pass, including rejection of `/6.3`, `/123`, `/`, single-letter `V`, and exact generated posting tuples/serialization for valid slash prefixes.
- Production browser persistence/reopen/reanalysis passes for `/USD` and `/NQH21`, plus unchanged `USD`, `USD ` and `usd` canonicalization. Each uses the selected 66.81 baseline, persists a 3.19 adjustment, and subsequently shows 70 in the same commodity. D1 runtime and its accepted stronger coverage are unchanged.
- Discovered engine limitation, not reclassified as invalid grammar: RustLedger 0.14.1 cannot parse `/6J` postings in a synthetic book (parse errors and `Invalid currency J`); `/USD` and `/NQH21` parse successfully. `/6J` is accepted and serialized by the corrected client validator, but successful end-to-end `/6J` analysis is **not claimed**. Its attempted browser analysis failed before adjustment initialization and is not counted among passing persistence tests. Repairing the engine is outside this validator-only correction. This check was insufficient for a new absent holding: a healthy unrestricted account could still generate `/6J` postings which the parser silently changed to `J` with divided amounts and no errors. The adjustment-local round-trip safeguard below supersedes any safety inference from the existing-book diagnostic gate.
- Final G passed: specs 5/5; lint; Svelte lint; type check 0 errors/warnings; application units **315 passed / 37 files** (`npm run test:unit -- --run tests src --exclude '.gitnexus/**'`); warning-gated build; full browsers **144 passed** (`npm run test:e2e -- --workers=2`). Refreshed local GitNexus `--index-only --pdg`; change analysis reported 22 mapped symbols / 25 flows, aggregate CRITICAL over all uncommitted work, no partial/truncated payload warning. Route UNKNOWN impact remains supplemented by source and browser checks. Original QA report unchanged; no commit/push/archive. Real Python-server integration remains not run; verifying its lexer source is not server-integration evidence. Independent re-review remains pending.

### Adjustment-local parser fidelity safeguard — 2026-11-05

- Reopened 14.2–14.3 and 19.1–19.2 after review demonstrated silent `/6J` reinterpretation for an absent holding in a healthy unrestricted account. Python grammar validity and installed-engine compatibility are separate checks. The original `/6J` diagnostic-gate evidence above was corrected; zero diagnostics are not evidence of faithful parsing.
- Regression-first actual-browser test selected absent `/6J` on healthy Assets:Cash, entered 70, selected Expenses:Food and attempted creation. Before the fix it navigated to the transaction editor instead of showing a compatibility error. After the fix it stays on Balance Adjustment, preserves entered values and journal bytes (also after reload), and shows an explicit local-engine incompatibility explanation. No API requests occur.
- The action constructs a detached candidate, serializes it through the production formatter, initializes the installed main-thread WASM parser and compares parsed posting count/order/accounts, exact commodity strings and Big.js numeric equivalence for every amount. Parse diagnostics or any mismatch reject the candidate; the temporary ParsedLedger is freed in finally. Only a verified candidate replaces editor state. Nothing is appended by this check. This is adjustment-only safety, not a global append or engine redesign.
- Async ownership: inputs/action are disabled while checking, and completion requires the component still mounted, the same transaction reference, unchanged transaction snapshot and unchanged target balance. Two deferred-engine-initialization tests verify mounted replacement and unmount/replacement do not hand off or mutate another transaction. Component tests now use the actual installed ParsedLedger; `/6J` passes grammar but is explicitly rejected by compatibility, while supported identifiers still create exact postings.
- Focused checks: **35 Balance Adjustment component tests passed**; **6 browser cases passed** for USD variants, `/USD`, `/NQH21`, and blocked healthy-book absent `/6J`. Full G: specs 5/5, lint, Svelte lint, type check 0 errors/warnings, **317 unit tests / 37 files**, warning-gated build, **145 browser tests**. Unit command remains `npm run test:unit -- --run tests src --exclude '.gitnexus/**'`; browser command `npm run test:e2e -- --workers=2`.
- Fresh local GitNexus `--index-only --pdg` succeeded; `detect-changes --scope all --repo .` reported 23 mapped symbols / 25 affected flows and aggregate CRITICAL risk over all uncommitted work, without partial/truncated payload warnings. Route impact UNKNOWN was supplemented with source/actual-route checks; earlier graph limits still apply. Immutable QA report unchanged. No commit/push/archive, no D1/D5/Sync-policy changes. Real Python-server integration remains not run; independent re-review pending.

### CI save/read synchronization follow-up — 2026-11-06

- Test-only follow-up on `releases/1.1.0` at `bfc374c`; initial worktree clean. Owner-supplied prior diagnosis identifies RC run 42051418304 failing the canonical `usd` case with `NotReadableError` immediately after Save, while Checks run 42051425077 passed 145 tests at the same SHA. Those CI runs were not rerun or independently re-fetched here.
- Pre-edit reproduction attempt: `npx playwright test tests/ui/qa-followup.test.ts --grep 'D2 real WASM canonical "usd"' --repeat-each=20 --workers=2 --retries=0` passed **40/40** in 50.2s. The CLI filter matched both `USD` and `usd`: 20 executions each, zero failures. The intermittent CI exception was not reproduced locally.
- Source confirms `saveXact` awaits journal append/edit before `history.back()`, and OPFS saving awaits stream close. The test previously read the source immediately after clicking Save. Installed Playwright evaluates the `expect.poll` callback outside its retry catch, so a read exception escapes rather than polling again. A concurrent read/write is consistent with the reported exception, not a locally reproduced storage failure.
- `tests/ui/qa-followup.test.ts` now waits for the successful return to Balance Adjustment before reading persisted D2 source. The six D1 complete-field/tuple cases had the identical immediate Save → OPFS poll pattern; they now wait for `/xact-actions` (saved entry) or `/journal` (new entry). Existing content assertions remain on the subsequent single source read. Other cases already wait for navigation/reopening, or do not save before reading, and are unchanged. No application behavior, retries, sleeps, or error swallowing added.
- Post-edit targeted command: `npx playwright test tests/ui/qa-followup.test.ts --grep 'D2 real WASM canonical|D1 complete tuples and fields' --repeat-each=20 --workers=2 --retries=0`: **220/220 passed** in 3.6m (five D2 and six D1 variants, 20 each). Full `npm run test:e2e -- --workers=2 --retries=0`: **145/145 passed** in 1.7m. Playwright built static assets and managed its own server at `127.0.0.1:4173`; no user dev server was used. `npm run lint` and `npm run check` passed, with zero type errors/warnings. Editor diagnostics refreshed but reported the test ignored by its lint configuration; CLI checks supply validation. Unit tests and real Python-server integration were not rerun for this test-only change.
- Local GitNexus index matches `bfc374c`; no stale Mac MCP graph used. File impact was UNKNOWN (zero mapped callers/processes), supplemented by source inspection; test-inclusive `readJournal` impact was LOW with this test file as its one direct dependent and zero mapped processes. `detect-changes --scope all --repo .` could not map the edited test-body hunks to indexed symbols and explicitly did not report a clean tree; direct diff review and browser runs supply the relevant evidence, not a zero-impact claim.
- Earlier runtime fixes and their evidence remain historical and unchanged. Original QA report, published specs and archive are untouched. No commit, push, CI rerun, publication or archive performed.

## Workflow follow-up

- Runtime implementation requires a separate apply request. Planning does not start the removal sequence.
- Design decision 7 records the 60-page source audit. Decision 12 and sections 14–19 now include PR #26 D1–D4 and D6, including About/Help, in this change. D5 is explicitly excluded. Other retained-feature defects outside the identity fix, task 4.0 and QA sections 10–19 still need separately scoped work; do not silently broaden implementation.
- Asset-allocation TOML delivery through server Sync is a recorded integration gap. The cleanup preserves existing local data and analysis; new server/client delivery behavior needs its own change.
- Archive only on the owner's explicit request. Published business specs and their originating archive remain unchanged; cleanup verification covers retained workflows and non-mutating retired entry points rather than correct operation of functions selected for deletion.
- Real-server tests need a disposable book and explicit connection/credentials; report them as not run until available. Push, merge, release, publication and deployment require separate authorization.
