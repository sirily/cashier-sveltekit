# Cashier

A personal fork of [cashier-sveltekit](https://github.com/alensiljak/cashier-sveltekit):
an offline-capable Beancount finance assistant built with SvelteKit, Svelte, and DaisyUI.

The app captures manual transactions locally, synchronizes with
[Cashier Server](https://github.com/sirily/cashier-server-python), and provides full-book
account history and analysis. Ledger files are stored in browser OPFS; application settings
and reference data use IndexedDB.

## Development

Use Node.js 24.15 or newer (Node.js 24.15 is the CI version), npm, and the versions recorded in `package.json` and `package-lock.json`.

```sh
npm ci
npm run dev
```

The development server normally runs at `http://localhost:5173/`. Agents should use the
user-managed server rather than starting a second one without checking.

Checks and builds:

```sh
npm run lint
npm run lint:svelte
npm run check:specs
npm run check
npm run test:unit -- --run
npm run test:e2e
npm run build
npm run check:build
```

Run the checks appropriate to the change and report anything not executed. See
[AGENTS.md](AGENTS.md) for project conventions.

CI validates GitHub Actions workflows with Actionlint. Linting, Svelte checks, type checks,
unit tests, and the production build are blocking gates; any lint, Svelte-check, or build warning
fails its check. The build warning gate uses Vite's logger and `console.warn`, preserving the
original diagnostic output.
Unit tests also fail on unexpected `console.warn` or `console.error` calls while preserving
those calls in the test output. Expected diagnostics must be explicitly mocked and asserted.
The browser suite covers local offline saving, editing, and synchronization with a mocked API;
it does not replace integration tests against the Python server.

Dependency auditing runs as a blocking reusable PR check and separately on a weekly schedule. It includes build/development dependencies; findings of any severity fail the audit job, with detailed results available in CI logs. Registry or audit-command failures also fail the audit job. A clean scan does not establish that all installed dependencies are safe.

## Releases and deployment

The agreed [release policy](docs/releasing.md#release-rules) uses squash-only PRs for both
work-branch integration into `releases/X.Y.Z` and release integration into `main`. The owner
selects the version through the release branch name. Merging the release PR approves the release;
its squash commit is the source for a fresh final image build. Publication does not deploy the app.

The static app is packaged in a Docker image served by Caddy. Backend deployment and routing
are managed separately.

## Documentation

- [Visual design](docs/design.md) — theme colors, their roles, and palette reference.
- [Release policy](docs/releasing.md) — repository and publication process.
- [Project instructions](AGENTS.md) — lasting development conventions.
- [OpenSpec](openspec/) — application behavior contracts and proposed changes. Use
  `openspec list --specs` and `openspec list` to distinguish main specs from active changes.
- [Initial specification change](openspec/changes/add-initial-system-specs/README.md) —
  owner-reviewed initial contracts, still awaiting explicit publication.
- [Historical project records](docs/completed-projects/) — context, not automatically current requirements.
