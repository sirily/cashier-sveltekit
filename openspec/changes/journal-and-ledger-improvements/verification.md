# Verification

## Automated checks

- `npm run test:unit -- --run tests/*.test.ts`: 804 tests passed across 41 application test files.
- `npm run check`: no errors or warnings.
- `npm run check:specs`: the active change and all four published capabilities passed strict validation.
- Changed TypeScript files: Oxfmt check and Oxlint with warnings denied passed.
- Changed Svelte files: Prettier check and ESLint with warnings denied passed.
- `npm run check:build`: production build and static-output checks passed.
- `git diff --check`: passed.
- Production-build Playwright run: 57 tests passed using one worker across `cross-currency`, `cross-currency-sync`, `journal`, `ledger-inspector`, `navigation`, `qa-followup`, and `sync`.

The browser run covers ordinary account-selected exchange creation, both completion flags, exact and repeating-rate amounts, offline save/reload/reopen, consecutive corrections, source/identity preservation, sign changes, calculator/account selection, remembered transactions, ordinary same-currency capture, existing annotation and repeat-edit regressions, Validation/Reload, inspector navigation and source immutability, About update controls, and mocked Sync retry/rejection/confirmation/history.

A broad Vitest filter also collected dependency tests inside the local GitNexus toolchain and failed there. The final application run used explicit `tests/*.test.ts` paths; no dependency tests or application assertions were disabled. An initial browser invocation found the preview port occupied by another test run; the final run completed after it became available.

## Source safety and review

Parser-backed tests distinguish `@` from `@@`, preserve exact decimal spelling and positional association, and cover duplicate accounts, omitted units, multiline strings, unsupported costs/flags, stale source, metadata/comments/neighbors, and consecutive saves. Originally mismatched explicit totals remain visible as imbalanced rather than being silently corrected. Ordinary plain/omitted postings can be corrected into a supported exchange without relaxing annotated-source rejection.

Independent review identified two ordinary-to-exchange editing transitions; both were fixed and verified with source-to-model-to-save regressions and WASM-backed probes. Follow-up review found no remaining material findings.

The local GitNexus index was refreshed. Change analysis reported 19 tracked changed files, 32 changed symbols and 12 affected processes, with HIGH risk around the shared posting model, serialization, source restoration and editing. New helper files were inspected and tested directly as well; tracked-diff analysis alone does not enumerate untracked files. No commit was created.

## External Python-server integration

**Unavailable; not exercised.** No real Python-server URL or test credential was provided in this environment, and no integration configuration was found in local environment files or relevant environment variables. Tests used isolated browser storage and mocked HTTP responses, not an owner's accounting book.

The raw-payload and mocked Sync tests establish client preservation of `@@`, exact units/currencies and persistent identity through preparation, retry, rejection and confirm-before-delete reconciliation. They do **not** establish real Python-server acceptance, deduplication or end-to-end integration. That external check remains necessary when an appropriate configured server is available.
