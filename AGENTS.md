# Cashier

Cashier is a mobile assistant for Beancount personal finance management.
It is implemented as a PWA using Svelte and DaisyUI frameworks.

## Projects

- Project plans and docs are stored in the `/docs/` folder.
- Completed project docs are in `/docs/completed-projects/`.
- Current Stage 2 writeback plan for PWA agents: `/docs/2026-05-28-stage-2-manual-transaction-writeback-pwa.md`.

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

Before implementing Stage 2 code, read `/docs/2026-05-28-stage-2-manual-transaction-writeback-pwa.md`.

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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **cashier-sveltekit** (1816 symbols, 3803 relationships, 129 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/cashier-sveltekit/context` | Codebase overview, check index freshness |
| `gitnexus://repo/cashier-sveltekit/clusters` | All functional areas |
| `gitnexus://repo/cashier-sveltekit/processes` | All execution flows |
| `gitnexus://repo/cashier-sveltekit/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
