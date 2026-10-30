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

### GitHub authentication in devcontainers

The devcontainer installs GitHub CLI (`gh`) and stores its configuration in a named
Docker volume, `<workspace-folder-name>-devcontainer-github-auth`, mounted at
`/home/node/.config/gh`. This does not use a host-OS-specific credentials directory.

Run these commands in a terminal **inside the container**:

```sh
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
gh auth status
```

Follow the terminal instructions: open the displayed GitHub URL in your host browser
and enter the one-time code. Never put a token in the repository or a remote URL.
Authentication performed before the volume was mounted is not automatically migrated;
log in again after rebuilding if necessary.

Once authenticated, Git uses `gh` for HTTPS credentials without asking on every push.
The volume preserves authentication across container restarts and rebuilds on the same
Docker daemon. On startup, `postStartCommand` checks authentication and reconnects Git
to `gh` when available. Otherwise it prints a login reminder in the lifecycle log;
it does not open a browser or start an interactive login automatically. If Git asks
for credentials, run `gh auth status` and repeat the login commands if needed.

A different Docker host, a different workspace folder name, deletion of the auth volume,
or an expired/revoked token requires a new login. Containers using the same volume name
share its credentials, so use distinct workspace folder names for separate accounts.

To remove the locally saved account credentials:

```sh
gh auth logout --hostname github.com
```

Logging out or deleting the volume does **not** revoke the token on GitHub. To revoke
GitHub CLI access, use GitHub **Settings → Applications → Authorized OAuth Apps →
GitHub CLI**; this can also affect other GitHub CLI logins.

**Security:** without a system credential store, `gh` saves its token unencrypted in
`/home/node/.config/gh/hosts.yml`. The volume is not a secret vault. Its directory is
restricted to the container user, but processes running as `node`, container root, and
anyone controlling the Docker daemon can access it. Other containers can access it if
the same volume is mounted into them. Only run trusted code in this environment; do not
share or publish the volume or its backups.

### Serena in Zed devcontainers

The development image installs uv and Serena 2.1.0. Project settings in
`.zed/settings.json` run Serena inside the container (`remote: true`) and activate
this repository automatically. `.mcp.json` provides the equivalent configuration
for clients that read that file; Zed uses `context_servers` instead.

After changing the image, rebuild the devcontainer. In Zed, open
**Settings → AI → MCP Servers** and check that `serena` is active; restart it if
needed and enable its tools in the current agent profile. The first launch downloads
the Svelte and HTML language servers and needs network access.

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
