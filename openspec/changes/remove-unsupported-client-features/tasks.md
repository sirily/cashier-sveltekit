# Tasks

## Execution rules

Use published `transaction-entry`, `manual-transaction-writeback`, `ledger-sync`, and `ledger-analysis` as the business regression baseline. Their requirements remain unchanged; this change uses proposal, design and tasks with spec generation skipped.

Nine separately tested runtime commits follow. The eight orphan-file deletions already landed in `7dc6bfad`. Manual transaction/schedule entry, ordinary settings, local editing, export, outbound backup and offline RustLedger analysis remain. External accounting data enters through server Sync. Import, upload/drop, pasted-record ingestion and restore are removal scope. Post-sync mutations, account management and analytics redesign are separate work.

**Gate G before every runtime commit:** run `npm run check:specs`, `npm run lint`, `npm run lint:svelte`, `npm run check`, `npm run check:build`, and retained-workflow unit/browser suites through the repository test runners. Select and record test files/name filters so tests dedicated solely to retiring functions are excluded; split mixed tests to preserve their retained assertions. Use `npm run test:unit -- --run` and `npm run test:e2e -- --workers=2` once that selection is reflected in the invocation/configuration; unfiltered execution of retiring behavior is not required. Exercise offline journal create/edit/delete/reload; server Sync success/rejection/incomplete/failed-pull retry with stable IDs; accounts/history/reports and offline calculations; actual export content and outbound backup credential filtering. Test retained business workflows and the safety of removal. Do not test, repair or require correct operation of retiring voice/peer/backup-restore/import/filesystem/Ledger paths, including while they still exist in earlier slices. Tests whose sole purpose is exercising those paths leave the required cleanup suite; keep shared assertions for retained behavior. After retirement, check that former entry points leave stored data unchanged and positively verify data arrival through server Sync. Seed test fixtures directly in OPFS/IndexedDB, not through a production importer.

**Commit gate:** verify the graph covers current relevant source, inspect staged scope, run GitNexus `detect_changes` without partial/truncated results, account for affected flows and complete a regression review. Record commands/results and commit hash. Failed or unavailable mandatory checks block the commit. A failure in a retained business workflow requires separately authorized remediation; do not weaken assertions. Mocked HTTP is not real Python-server integration; never run tests against the owner's real book.

## 1. Remove voice entry — commit 1

- [ ] 1.1 Establish baseline G for retained workflows and current source/graph boundaries; verify browser/OS dependencies and formatting. Track the local `cashier_id` loss separately in `preserve-local-transaction-identity`; keep that regression distinct from feature-removal commits. Retiring restore's known G12 defect is not a prerequisite and receives no repair/testing task here.
- [ ] 1.2 Fill retained-workflow test gaps: local delete with neighbor preservation/reload, journal copy/download without mutation, outbound settings/scheduled backup with token exclusion and offline full-book analysis. Verify supported editor identity/field behavior and distinguish local checks from server acceptance.
- [ ] 1.3 Remove Voice Entry route, parser, parser-only tests, navigation and exclusive imports; verify normal entry/save works and former URLs cannot initialize microphone code.
- [ ] 1.4 Update affected navigation docs/assertions; run G and commit gate, then create only `chore: remove voice entry` with its tests/docs.

## 2. Remove peer-sync demo — commit 2

- [ ] 2.1 Remove the demo route, PeerConnectionManager and dead navigation; remove only proven-exclusive peer settings, preserving server selections despite nearby peer comments. Verify no peer initialization or financial-data mutation.
- [ ] 2.2 Cover old URLs/navigation and update affected docs; run G and commit gate, then create only `chore: remove peer sync demo`.

## 3. Remove legacy remote backups — commit 3

- [ ] 3.1 Move shared backup filename generation into retained export/backup code; verify journal/scheduled copy/download before removing its former module.
- [ ] 3.2 Remove WebDAV configuration/backup/preview/diff, cloud-backup page/card, remote clients, menus and `webdav` with lockfile updates; verify retained routes and old URLs initiate no remote-backup request.
- [ ] 3.3 Purge only retired remote credentials locally and filter outbound backup. Verify removal/migration preserves the active token and existing data/settings; retain outbound-export and applicable diagnostic secrecy coverage. Skip restore functionality tests: that input retires in commit 4.
- [ ] 3.4 Correct Backup's claim to contain transactions: verify settings/scheduled outbound payload scope and separate journal/book export; document retired-credential rollback limits, run G and commit gate, then create only `chore: remove legacy remote backups`.

## 4. Remove local import and restore entry points — commit 4

- [ ] 4.1 Remove `/opfs/import-ledger` including directory picker/upload fallback, `/import-ledger-xact`, their drawer/Journal/Settings links and exclusive paste-parser tests/helpers. Preserve other transactionParser consumers and folder helpers still used by filesystem sync. Verify the removed entry points cannot mutate an existing journal/book.
- [ ] 4.2 Remove both OPFS Upload File and drag-and-drop ingestion, including input handlers/state and upload-only conflict/overwrite/copy dialogs. Verify file listing/selection and retained local editor/storage operations still work, and attempted retired inputs leave data unchanged.
- [ ] 4.3 Remove local Restore Backup controls/file-reading/dialogs from `/backup`, the entire `/restore/[itemType]` file/paste route and Scheduled Transactions Restore action, plus arbitrary bulk-save `/settings/json-editor` and its menu. Remove restore-only services after their final consumer is gone; preserve manual schedule/settings controls and outbound backup/export. Verify old file/paste/URL paths cannot alter settings, schedules or active token.
- [ ] 4.4 Preserve existing OPFS/IndexedDB data and outbound token filtering; update backup/setup descriptions to server Sync, verify no directory prompts or retired network calls, run G and commit gate, then create only `chore: remove local import and restore entry points`. Remove obsolete restore/import tests and helpers while preserving positive server-pull, outbound-export and removal-data-preservation coverage.

## 5. Keep only server synchronization — commit 5

- [ ] 5.1 Remove sync-fs, `/opfs/sync`, `/settings/filesystem` and navigation. Recheck fsScan/fsHandleStore final consumers and remove exclusive helpers only now; keep importManifest while OpfsFilePicker uses its marker or remove that marker atomically. Preserve shared databases and analytics concurrency helpers; verify existing stored data and OPFS consumers survive.
- [ ] 5.2 Simplify Sync to the fork's Beancount flow; normalize recognized legacy source strings at settings load, preserving URL/token/root/selection and metadata-only choices. Test fresh/partial configuration and existing filesystem/Ledger settings without data reset, invented credentials or automatic synchronization.
- [ ] 5.3 Keep server Sync discoverable in navigation; describe the ledger-file option as send/pull/reconcile and Reload as server-only reload. Test old URLs, same-ID retry, rejection/incomplete entries, pull/parse rollback, overlay protection and token forwarding; update affected docs.
- [ ] 5.4 Verify server pull is the supported external accounting-data input, existing local analysis still runs offline and no hidden import path was kept as a workaround; run G and commit gate, then create only `chore: keep only server synchronization`.

## 6. Remove Ledger-cli compatibility — commit 6

- [ ] 6.1 Remove Ledger-cli query/parser/format branches and exclusive enums; retain Beancount and shared helpers, verifying reference-data replacement, original currencies and distinct report records. The Ledger paste-import route already retired in commit 4; do not recreate it under a new name.
- [ ] 6.2 Remove optional investment HTTP fallback after verifying all worker-injected callers; test local investment calculations and absence of report network requests. Preserve existing allocation TOML/data/selector; record the unsupported server-definition delivery path for separate work instead of inventing an API or retaining an importer.
- [ ] 6.3 Set journal filenames explicitly to `.bean` in the helper moved by commit 3; test actual output, unchanged journal/identity and credential-free backup, updating accounting-system copy and dependency-aware rollback notes.
- [ ] 6.4 Run G and commit gate, then create only `chore: remove ledger cli compatibility`; verify RustLedger/WASM, worker, parser and cache remain functional.

## 7. Remove unused storage-selection layers — commit 7

- [ ] 7.1 Remove createDAL/FSDAL and unused backend selection/cache/non-OPFS implementations, updating live DAL types/barrel consumers atomically; verify type-check and direct OPFS readers/writers need no later fix.
- [ ] 7.2 Remove helpers only after checking retained OPFS selection, settings, editor and analytics consumers; preserve existing databases/data and verify server pull, journal, export/backup and local analysis.
- [ ] 7.3 Update storage references, run G and commit gate, then create only `chore: remove unused storage selection layers`.

## 8. Remove cross-list drag prototype — commit 8

- [ ] 8.1 Remove five prototype components and their cross-list assertions; rewrite the combined string-built harness to retain live DragReorderList coverage and verify its imports compile.
- [ ] 8.2 Exercise live reorder with duplicate labels and parent bindings across retained callers; keep esbuild-wasm, update references, run G and commit gate, then create only `chore: remove cross list drag prototype`.

## 9. Remove unused build dependencies and configurations — commit 9

- [ ] 9.1 Reconfirm no direct/dynamic/config/peer consumers of @floating-ui/dom, @rollup/wasm-node, autoprefixer and vite-plugin-mkcert; remove them and regenerate the lockfile, verifying framework/test dependencies and installed metadata remain consistent.
- [ ] 9.2 Remove disconnected tailwind.config.js and src/manifest.json; verify CSS themes/plugins, generated manifest/icons, static routes, worker and offline production behavior; update affected configuration docs.
- [ ] 9.3 Run G and commit gate, then create only `chore: remove unused build dependencies and configs`; verify scope and summarize nine commit hashes/checks with real-server evidence distinct from mocks.

## Workflow follow-up

- Runtime implementation requires a separate apply request. Planning does not start the removal sequence.
- Design decision 7 records the 60-page source audit. About/Help ownership/link corrections and retained-feature defects need separately scoped OpenSpec work; do not silently broaden removal commits.
- Asset-allocation TOML delivery through server Sync is a recorded integration gap. The cleanup preserves existing local data and analysis; new server/client delivery behavior needs its own change.
- Archive only on the owner's explicit request. Published business specs and their originating archive remain unchanged; cleanup verification covers retained workflows and non-mutating retired entry points rather than correct operation of functions selected for deletion.
- Real-server tests need a disposable book and explicit connection/credentials; report them as not run until available. Push, merge, release, publication and deployment require separate authorization.
