# Cashier

A personal fork of [cashier-sveltekit](https://github.com/alensiljak/cashier-sveltekit):
an offline-capable Beancount finance assistant built with SvelteKit, Svelte, and DaisyUI.

The app captures manual transactions locally, synchronizes with
[Cashier Server](https://github.com/sirily/cashier-server-python), and provides full-book
account history and analysis. Ledger files are stored in browser OPFS; application settings
and reference data use IndexedDB.

## Development

Use Node.js 22.17 or newer (Node.js 24.15 is the recommended CI version), npm, and the versions recorded in `package.json` and `package-lock.json`.

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
```

Run the checks appropriate to the change and report anything not executed. See
[AGENTS.md](AGENTS.md) for project conventions.

CI also validates GitHub Actions workflows with Actionlint. Svelte template linting reports
six existing rule groups as warnings; other recommended-rule violations fail the check.
The browser suite covers local offline saving, editing, and synchronization with a mocked API;
it does not replace integration tests against the Python server.

Dependency auditing runs separately on PRs and weekly. It includes build/development
dependencies and reports severity counts and known vulnerabilities as warnings; detailed findings
are available in the CI job logs. Registry or audit-command failures fail the audit job. Findings
require review and do not establish that all installed dependencies are safe.

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
