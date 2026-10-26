# Release policy

## Release rules

This document defines the required release process.

### Branches

| Purpose             | Name                      | Base and destination                                               |
| ------------------- | ------------------------- | ------------------------------------------------------------------ |
| Production history  | `main`                    | Receives release PRs                                               |
| Release integration | `releases/X.Y.Z`          | Created from current `origin/main`; collects work for that version |
| Feature             | `feat/short-description`  | Created from the target release branch; PR back to it              |
| Fix                 | `fix/short-description`   | Created from the target release branch; PR back to it              |
| Documentation       | `docs/short-description`  | Created from the target release branch; PR back to it              |
| Maintenance         | `chore/short-description` | Created from the target release branch; PR back to it              |
| Automation          | `ci/short-description`    | Created from the target release branch; PR back to it              |

Use `main` as this fork's production branch. Normally keep one active release branch; there is no permanent `develop`. Fetch the remote before creating a release branch, and do not set its upstream to `origin/main`. Existing work branches can be integrated after reviewing their full diff; recreating them just to fit a name is unnecessary.

Integrate work branches into the release branch through squash-only PRs. Integrate the release branch into `main` through a squash-only PR as well. Do not use merge commits for either integration. Creating, merging, pushing, or deleting branches requires the owner's corresponding authorization. The release branch can be deleted after successful publication; Git tags and published versioned images remain.

### Version ownership

The owner chooses `X.Y.Z` when opening a release, expressed by its branch name. Neither an agent nor automation guesses a version from commit messages:

- **PATCH** (`1.1.1`): compatible fixes.
- **MINOR** (`1.2.0`): compatible new behavior.
- **MAJOR** (`2.0.0`): incompatible changes to behavior, APIs, or persisted data.

The release process verifies that the version in `releases/X.Y.Z` matches `package.json` and both root version entries in `package-lock.json`. A mismatch stops the build; it does not silently update files or choose a different version. Package metadata changes are reviewed release content. Agents do not assign RC numbers or create release tags manually.

| Object           | Example                                       | Assignment                                      |
| ---------------- | --------------------------------------------- | ----------------------------------------------- |
| Release branch   | `releases/1.1.0`                              | Owner-selected release version                  |
| RC container     | `ghcr.io/sirily/cashier-sveltekit:1.1.0-rc.7` | Numbered build from a release-branch push       |
| Final container  | `ghcr.io/sirily/cashier-sveltekit:1.1.0`      | Fresh build from the release squash commit      |
| Final Git tag    | `v1.1.0`                                      | Created on the release squash commit            |
| Production alias | `latest`                                      | Updated only after successful final publication |

`rc` identifies a build of the intended release, not a separate approval procedure. `N` uses the workflow run counter; it is not required to be per-version, so a version's first RC need not be `rc.1` and gaps are normal. A retry of the same run uses the same number and must not move an existing validated image; a new run receives a new number. Container labels record the full source SHA and version.

### Release sequence

#### 1. Collect changes and build RCs

1. Create `releases/X.Y.Z`
   from freshly fetched `origin/main` and prepare matching package version metadata as reviewed release content.
2. Integrate work branches through squash-only PRs into this release branch, not directly into `main`.
3. Each push to `releases/X.Y.Z` runs the required checks and builds `X.Y.Z-rc.<run_number>` after validating the branch version against `package.json` and both root version entries in `package-lock.json`.
4. A retry of the same run uses the same tag and must reuse an existing validated image rather than move it. Start a new run for a new RC number.
5. Any further push produces another RC. No manual candidate-preparation command, special freeze state, or additional approval is needed to continue development.

Required checks cover linting, types, unit tests, a production build, and relevant browser tests. Run expensive checks in CI; do not claim they passed from documentation validation. RC images are available in GHCR. This release process does not require a test URL or test deployment. The owner decides where and how to inspect a build.

#### 2. Merge to approve

Open a PR from `releases/X.Y.Z` into `main`. The PR can remain open while work accumulates. Required checks must pass on the current proposed integration before merging.

**Merging this PR is the release approval.** There is no additional GitHub Environment approval, acceptance receipt, or required evidence URL. A separate `release/accepted` status is not part of this policy. New source changes require fresh checks, not a second manual acceptance procedure. Merge the PR using squash; the resulting squash commit is the release commit.

#### 3. Build and publish the final release

After a same-repository release PR is merged, publication determines the version from the release branch name and verifies it against `package.json` and both root version entries in `package-lock.json`. The merged PR's API `merge_commit_sha` must equal the event's squash commit. Publication validates the source SHA and version, runs required checks, and builds a fresh production image from that exact squash commit as `X.Y.Z`. It creates `vX.Y.Z` on that commit and updates `latest`. An arbitrary `main` push is not a release.

A retry for a version whose final image already exists must fail closed or complete the same interrupted publication against the exact commit; it must not rebuild over an existing final image, replace different content, or move a final Git tag. Final versions are unique. Failed or stale runs cannot overwrite a newer production release.

The final image is freshly built from the merged release squash commit, not promoted from an RC. Its digest can differ from the RC's; this process does not promise that production runs identical tested bytes. Publishing an image does not deploy it. Production deployment remains a separately authorized operation using an explicit version, preferably pinned by digest, rather than a floating `latest` reference.

### Automation and repository protections

The implementation of this policy must enforce, rather than delegate to an agent's memory:

- Release-branch/version syntax and agreement with package metadata.
- Automatic, concurrency-safe RC numbering and unique final versions.
- Required PR checks; no unreviewed direct pushes or force-pushes to shared release/production branches.
- Release-PR detection and verification that the merged PR's `merge_commit_sha` equals the event's squash commit before final builds; no final publication from work branches, RCs, arbitrary `main` commits, or untrusted PR code.
- Separate publication permissions from untrusted PR checks; never expose registry write credentials to fork code.
- Protection against rewriting final Git tags and published versioned image tags.
- Safe retries and serialized production updates so a late job cannot replace a newer `latest`.

The workflows require the repository's `GITHUB_TOKEN` to have `contents: write` for Git tag creation and `packages: write` for GHCR publication. Branch protection and token settings are separate from workflow code. Required checks and permissions must be configured and verified by the owner. An optional retry can use the existing workflow run in GitHub's UI. The release script tests can be run with `node --test scripts/release-tests.mjs`.

### Hotfixes and rollback

An urgent fix follows the same process: create a patch release from current `main`, let pushes produce RCs, then merge its release PR to approve the final build. Integrate a released hotfix back into any other active release branch before its next final merge.

Rollback deploys an earlier immutable final image digest. It does not move Git tags, rewrite `main`, or clear browser storage. Check compatibility with existing IndexedDB, OPFS, and backend data first: restoring an older container does not undo a data migration.
