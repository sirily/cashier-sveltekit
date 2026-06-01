# Cashier

Cashier is a mobile assistant for Beancount personal finance management.
It is implemented as a PWA using Svelte and DaisyUI frameworks.

## Projects

- Project plans and docs are stored in the `/doc/` folder.
- Completed project docs are in `/doc/completed-projects/`.
- Current Stage 2 writeback plan for PWA agents: `/doc/2026-05-28-stage-2-manual-transaction-writeback-pwa.md`.

## Usage Scenarios

### Mobile App

- balance overview
- quick transaction entry, stored locally until confirmed by server sync
- import/sync Beancount files into local storage (OPFS)

#### Desktop App

- detailed review, analysis, reports
- sorting transactions from `cashier.bean` into appropriate beancount files

## Architecture

- The app is a PWA with a single page application (SPA) architecture, using SvelteKit and DaisyUI frameworks.
- Uses **Svelte 5** with runes syntax (`$state`, `$derived`, `$effect`) — do NOT use Svelte 4 store or `$:` reactive patterns.
- Uses **TailwindCSS v4** and **DaisyUI v5** — class names and config differ from v3/v4 respectively.
- It is deployed as a static website to Netlify (via `npm run deploy`).
- The ledger files are stored in OPFS, in Beancount format. The app data is in IndexedDb (via **Dexie**).
- The configuration information is in Settings table in IndexedDb.
- The app uses File System API to access the ledger files on the device.

### Stage 1 accepted boundary

Stage 1 is read-only offline-ledger sync:

- PWA pulls `main.bean` and related Beancount sources from `cashier-server-python`.
- Files are stored in OPFS.
- The complete ledger parses through `@rustledger/wasm@0.14.1` with `0` parse errors.
- The server ledger is authoritative for synced data.

Do not regress this boundary when adding writeback.

### Stage 2 manual transaction writeback

Before implementing Stage 2 code, read `/doc/2026-05-28-stage-2-manual-transaction-writeback-pwa.md`.

Stage 2 is a narrow one-button flow:

```text
1. push: local cashier.bean -> POST /api/xact -> server manual_transactions.bean
2. pull: server main.bean -> OPFS / full ledger
3. reconcile: delete local transaction only when its cashier_id appears in parsed pulled main.bean
```

Rules that code agents must follow:

- Use `POST /api/xact` as the endpoint name.
- Every local transaction must have a stable persisted `cashier_id` before first push.
- Persist only two meaningful states: `local` and `synced`.
- Do not add durable `uploading`, `accepted`, or `confirmed` states.
- Local Journal entries may show `На устройстве`.
- Show the concrete backend rejection reason for rejected transactions.
- Stage 2 v1 sends only completed `*` transactions, not incomplete `!` transactions.
- Delete local overlay entries only after the pulled full ledger parses and contains the same `cashier_id`.
- Treat lost POST responses and failed pulls as retryable; keep local entries so server deduplication by `cashier_id` can make retry safe.
- Mixed batches are allowed: valid entries may sync while invalid ones remain local.

### Rust Ledger WASM

- `ledgerService` is the light version, loading only the Transactions. It provides the LSP features and is used for saving the Xact record to a correct place in the source file.
- `fullLedgerService` loads the complete book, with all files, and is used to run financial reports and queries.
- `ledgerWorkerClient` is the interface to the fullLedgerService, running in a Worker and handling data in the background.
- Individual pages send queries and use the returned data asynchronously.

### Key directories

- `src/lib/components/` — shared UI components
- `src/lib/data/` — data access layer
- `src/lib/services/` — business logic services
- `src/lib/storage/` — OPFS and IndexedDb storage abstractions
- `src/lib/stores/` — Svelte stores (reactive state)
- `src/lib/sync/` — synchronization logic
- `src/lib/rledger/` — Rust Ledger WASM integration
- `src/lib/utils/` — utility functions
- `src/lib/assetAllocation/` — asset allocation logic, validation, and sync API client
- `src/lib/webrtc/` — WebRTC peer-to-peer sync
- `src/lib/workers/` — background web workers (e.g. ledger worker)
- `src/routes/` — SvelteKit file-based routes (~60+ pages)

## Dev Server

- Assume the local dev server is running at `http://localhost:5173/`. It is started and managed by the user.

## Tools

- `npm` is the package manager.
- Use ripgrep (`rg`) CLI for fast text search across text files. Prefer over `grep`.
- Use `agent-browser` CLI to run the browser.
- **Formatting**: `oxfmt` (with Prettier as fallback for `.svelte` files via `prettier-plugin-svelte`).
- **Linting**: `oxlint` for JS/TS; `eslint-plugin-svelte` via ESLint for Svelte templates.
- **Unit tests**: Vitest — `npm run test:unit`
- **E2E tests**: Playwright — `npm run test:e2e`
- Run `npm run format` to format, `npm run lint` to lint, `npm run check` to type-check (svelte-check + TypeScript).
- Use Serena MCP for codebase navigation.

### Code Intelligence (LSP)

Prefer LSP over Grep/Glob/Read for code navigation:

- `goToDefinition` / `goToImplementation` to jump to source
- `findReferences` to see all usages across the codebase
- `workspaceSymbol` to find where something is defined
- `documentSymbol` to list all symbols in a file
- `hover` for type info without reading the file

Before renaming or changing a function signature, use `findReferences` to find all call sites first.
Use Grep/Glob only for text/pattern searches (comments, strings, config values) where LSP doesn't help.
After writing or editing code, check LSP diagnostics before moving on. Fix any type errors or missing imports immediately.
