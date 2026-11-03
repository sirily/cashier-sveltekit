# Tasks

## Execution rules

Use published `transaction-entry`, `manual-transaction-writeback`, `ledger-sync`, and `ledger-analysis` as the business regression baseline. Their requirements remain unchanged; this change uses proposal, design and tasks with spec generation skipped.

The original identity fix and nine removal commits are complete; their checked tasks and verification records below retain the scope tested at that time. QA follow-up adds three separately tested analysis-freshness fixes (sections 10–12), followed by one atomic schedule/forecast retirement (section 13), all within this change. The eight orphan-file deletions already landed in `7dc6bfad`. Manual journal entry, ordinary settings, local editing, journal export, outbound backup and offline RustLedger actual-book analysis remain. Scheduled transaction authoring/actions/calendar, dedicated scheduled export and schedule-based forecast retire; existing scheduled rows remain passively backed up. External accounting data enters through server Sync. Import, upload/drop, pasted-record ingestion and restore are removal scope. Post-sync mutations, account management and analytics redesign are separate work.

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

- [ ] 10.1 Add regression-first tests with real WASM/worker composition: a readable cached book must not reactivate removed drafts or old edited amounts after journal/root/include changes, same-length edits, or a fresh worker/browser reload. Preserve the exact QA order including OPFS edit and Delete All; assert source and real remaining errors, not only diagnostic count.
- [ ] 10.2 Validate cache against the effective current source composition and relevant root/parsing identity before activation. Rebuild on mismatch, old unvalidated cache, missing/corrupt cache, deleted include or root change; keep the valid matching-cache fast path. Preserve financial files/overlay and genuine error diagnostics. Hash verification after cache activation is insufficient.
- [ ] 10.3 Make invalidation durable against a failed cache rewrite so the next reload cannot accept an obsolete binary. Cover persistence failures and expose freshness/loading/error state instead of presenting stale calculations as current; avoid silent failure or disabling caching as the fix.
- [ ] 10.4 Run G and fresh graph/review checks, including all cache-enabled regression paths; record results and create only `fix: validate ledger cache against current sources`.

## 11. Refresh full-book analysis after Journal Delete All — separate fix commit

- [ ] 11.1 Reproduce cached report diagnostics from incomplete local drafts alongside a valid selected book, then Delete All. Test warm report navigation and browser reload with cache both enabled and disabled, without manual validation/cache toggles. Verify downloaded book, settings/token, currencies and server-origin records remain intact.
- [ ] 11.2 Refresh/invalidate the analysis worker after durable journal clearing, propagate loading/version changes to dependent views, and preserve actual remaining-book diagnostics. Cover journal-write failure and post-save refresh failure separately: do not claim a durable deletion was rolled back or expose stale results as current. Delete All remains local and makes no server mutation/request.
- [ ] 11.3 Run G and fresh graph/review checks, record results and create only `fix: refresh reports after clearing local journal`.

## 12. Refresh analysis after OPFS book saves — separate fix commit

- [ ] 12.1 Reproduce edited root/include data remaining stale in reports/cache. Cover cache-enabled same-length edits, selected root and included files, warm navigation/cold reload, valid-invalid-valid recovery, and the combined OPFS edit → incomplete drafts → Delete All sequence.
- [ ] 12.2 On successful relevant source save, refresh/invalidate full-book calculations and persisted cache through their existing owner while preserving the pending overlay. Failed writes preserve source and show failure; post-write analysis failure remains distinguishable from storage failure. Keep non-book text editing and manual/server boundaries unchanged.
- [ ] 12.3 Run G and fresh graph/review checks; verify actual balances/report values, original currencies, current diagnostics and unchanged unrelated files/settings. Record results and create only `fix: refresh analysis after OPFS book edits`.

## 13. Remove scheduled transactions and schedule-based forecast — separate removal commit

- [ ] 13.1 Confirm all route/component/service and string-built consumers with fresh graph plus source references. Remove `/scheduled-xacts` with calendar/loader, `/scx-editor/[[id]]` with loader, `/scx-actions/[id]`, ScheduleEditor, Upcoming card, transaction Schedule action and drawer links; preserve shared manual journal/editor/selection helpers. Do not fix or test successful schedule editing, recurrence or search.
- [ ] 13.2 Remove ForecastCard, DailyForecastChart, `/forecast-settings`, exclusive recurrence/projector code, controls and exclusive colorscheme dependency after verifying consumers. Preserve actual-book reports, local worker/WASM, `chart.js`, `moment`, investment/allocation data and live reorder. No replacement forecast implementation.
- [ ] 13.3 Remove home-card defaults/toggles/identifiers and normalize only the legacy `ForecastCard` / `ScheduledXactCard` names at the shared read boundary. Preserve remaining order and explicit empty lists; avoid automatic configuration writes or default resurrection. Verify Home, Home Settings and Reorder on fresh and upgraded installations.
- [ ] 13.4 Remove live schedule stores and load/save/export APIs, exclusive enums/constants and `/export/scheduled` branch/matcher. Retain existing Dexie scheduled table/schema/rows and minimal legacy model for passive `scx` outbound backup. Keep journal export, token filtering and unrelated settings/OPFS data; no reset, store drop or conversion to journal entries.
- [ ] 13.5 Update backup/UI copy and affirmative architecture/agent documentation. Split mixed tests: remove retiring workflow correctness cases, keep legacy-row backup and data-preservation assertions. Add former schedule/forecast/export URL/action checks for no record mutations/network, and retained manual entry/reorder/report/export checks.
- [ ] 13.6 After sections 10–12 pass, run G and fresh graph/review checks for the atomic removal; verify upgrade/reload preserves financial data/token/server selection/legacy rows, credential-free outbound backup still contains legacy `scx`, and manual journal, Sync retry, actual-book analytics and offline PWA work. Record checks and create only `chore: remove scheduled transactions and forecast`.

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

## Workflow follow-up

- Runtime implementation requires a separate apply request. Planning does not start the removal sequence.
- Design decision 7 records the 60-page source audit. About/Help ownership/link corrections and retained-feature defects outside the explicit identity fix, task 4.0 and QA sections 10–13 need separately scoped OpenSpec work; do not silently broaden removal commits.
- Asset-allocation TOML delivery through server Sync is a recorded integration gap. The cleanup preserves existing local data and analysis; new server/client delivery behavior needs its own change.
- Archive only on the owner's explicit request. Published business specs and their originating archive remain unchanged; cleanup verification covers retained workflows and non-mutating retired entry points rather than correct operation of functions selected for deletion.
- Real-server tests need a disposable book and explicit connection/credentials; report them as not run until available. Push, merge, release, publication and deployment require separate authorization.
