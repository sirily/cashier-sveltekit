# Tasks

## 1. Preserve identity when editing a local journal transaction

- [ ] 1.1 Add a regression using an existing local `cashier_id`: load through the real journal/editor conversion, change narration, save and reopen; verify the test fails on the current code because the ID disappears, and assert one entry plus unchanged neighboring source.
- [ ] 1.2 Preserve the original ID through model conversion, editor state and serialization/source replacement; verify the regression passes and a second save retains the same ID without a network request or extra entry.
- [ ] 1.3 Verify writeback preparation/retry uses the preserved ID after accepted-send/failed-pull, while new and duplicated transactions get independent identities through the existing flow; keep the server's same-ID content-conflict behavior unchanged.
- [ ] 1.4 Run focused editor/identity/writeback unit and browser tests, type-check, retained-workflow unit checks and production build; review the diff and graph impact, update any affected implementation documentation, and deliver `fix: preserve local transaction identity on edit` separately from cleanup commits. Record actual checks and their results; retiring restore/import functionality is outside verification scope.

## Workflow follow-up

- This task implements existing published requirements; main specs and their archive remain unchanged.
- Apply and archive require the owner's corresponding request. No feature-removal work is bundled into this fix.
