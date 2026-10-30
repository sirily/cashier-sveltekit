# Cashier

Cashier is a mobile assistant for Beancount personal finance management.
It is implemented as a PWA using Svelte and DaisyUI frameworks.

## Repository map

### Documentation and requirements

| Location                                               | Contents                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [README.md](README.md)                                 | Project overview, setup, and development commands                                    |
| [openspec/specs/](openspec/specs/)                     | Published application behavior contracts                                             |
| [openspec/changes/](openspec/changes/)                 | Proposed changes and their planning artifacts                                        |
| [openspec/changes/archive/](openspec/changes/archive/) | Historical change records                                                            |
| [docs/releasing.md](docs/releasing.md)                 | Release branches, versions, candidates, publication, rollback, and automation status |
| [docs/design.md](docs/design.md)                       | Visual design and palette reference                                                  |
| [cashier-theme-daisy.css](cashier-theme-daisy.css)     | Theme tokens and their actual values                                                 |
| [docs/completed-projects/](docs/completed-projects/)   | Historical project documents                                                         |

### Application code

| Location                                             | Contents                                           |
| ---------------------------------------------------- | -------------------------------------------------- |
| [src/routes/](src/routes/)                           | SvelteKit pages and route-specific logic           |
| [src/lib/components/](src/lib/components/)           | Shared UI components                               |
| [src/lib/data/](src/lib/data/)                       | Data models and data access                        |
| [src/lib/services/](src/lib/services/)               | Business logic and ledger service interfaces       |
| [src/lib/storage/](src/lib/storage/)                 | OPFS and IndexedDB storage abstractions            |
| [src/lib/stores/](src/lib/stores/)                   | Reactive application state                         |
| [src/lib/sync/](src/lib/sync/)                       | Synchronization logic                              |
| [src/lib/rledger/](src/lib/rledger/)                 | Rust Ledger WASM integration                       |
| [src/lib/workers/](src/lib/workers/)                 | Background workers, including full-book analysis   |
| [src/lib/utils/](src/lib/utils/)                     | Shared utilities                                   |
| [src/lib/assetAllocation/](src/lib/assetAllocation/) | Asset allocation logic, validation, and API client |
| [src/lib/webrtc/](src/lib/webrtc/)                   | WebRTC peer synchronization                        |

### Tests, automation, and packaging

| Location                                                                                                             | Contents                                 |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [tests/](tests/)                                                                                                     | Unit and browser tests                   |
| [vite.config.ts](vite.config.ts), [vitest.config.ts](vitest.config.ts), [playwright.config.ts](playwright.config.ts) | Build and test configuration             |
| [.github/workflows/](.github/workflows/)                                                                             | CI workflows                             |
| [Dockerfile](Dockerfile), [docker/](docker/)                                                                         | Static app image and Caddy configuration |
| [package.json](package.json), [package-lock.json](package-lock.json)                                                 | Commands and dependency versions         |
| [src/service-worker.ts](src/service-worker.ts)                                                                       | Native SvelteKit service worker          |
| [src/lib/services/pwaUpdate.svelte.ts](src/lib/services/pwaUpdate.svelte.ts)                                         | PWA update lifecycle                     |

## Working rules

- Behavior requirements belong in OpenSpec, not in this file. Check `openspec list --json`
  and `openspec list --specs --json` before selecting the relevant change or main capability.
- Archived changes and completed-project documents provide history, not substitutes for
  current specifications or automatically mandatory implementation plans.
- Read the release policy before creating or merging release branches, preparing tags or
  images, publishing, or deploying. Do not substitute manual agent actions for the required
  release automation; its current implementation limits are documented there.
- Consult the visual-design guide and actual theme tokens before changing interface colors.
- Do not commit, push, tag, merge, publish, or deploy without the owner's corresponding request.

## Usage

Core workflows:

- capture and correct manual transactions locally, including while offline;
- explicitly synchronize with [cashier-server-python](https://github.com/sirily/cashier-server-python),
  retaining local entries until confirmed;
- view balances, account history, and reports over the locally available book.

## Architecture

- The app is a PWA with a single page application (SPA) architecture, using SvelteKit and DaisyUI frameworks. SvelteKit configuration lives in `vite.config.ts`; `#lib` is a package-import alias declared in `package.json`.
- Uses **Svelte 5** with runes syntax (`$state`, `$derived`, `$effect`) — do NOT use Svelte 4 store or `$:` reactive patterns.
- Uses **TailwindCSS v4** and **DaisyUI v5** — class names and config differ from v3/v4 respectively.
- The production build is static and is packaged as a Docker image served by Caddy.
  Backend and deployment configuration belong to their separate repositories. Follow
  [docs/releasing.md](docs/releasing.md) for release and publication policy.
- The ledger files are stored in OPFS, in Beancount format. The app data is in IndexedDb (via **Dexie**).
- The configuration information is in Settings table in IndexedDb.
- The app uses File System API to access the ledger files on the device.

### Rust Ledger WASM

- `ledgerService` handles the local transaction overlay and source-position-aware editing.
- Active full-book reports use `ledgerWorkerClient`, backed by `ledger.worker.ts`, with
  asynchronous loading and queries. Some callers import that client under the local name
  `fullLedgerService`; the separate `fullLedgerService.ts` class is not that worker client.
- Keep local editing and full-book analysis responsibilities separate. Read the relevant
  OpenSpec contracts before changing synchronization, identity, reconciliation, or currency handling.

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

| Resource                                           | Use for                                  |
| -------------------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/cashier-sveltekit/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/cashier-sveltekit/clusters`       | All functional areas                     |
| `gitnexus://repo/cashier-sveltekit/processes`      | All execution flows                      |
| `gitnexus://repo/cashier-sveltekit/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                               |
| -------------------------------------------- | -------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->
