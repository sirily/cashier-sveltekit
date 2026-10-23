# Release policy

## Process and implementation status

The agreed process is simple: each push to a release branch builds an RC container;
merging that release's PR into `main` approves the release and triggers a new production build.
There is no separate candidate-creation command, approval workflow, evidence receipt, or
required test deployment. Deployment remains separate from building and publishing images.

**The automation currently in this work branch does not yet implement this policy.** It
contains an earlier, superseded design with separate acceptance and image promotion. That
code is deferred for a later revision: do not use its approval jobs or treat its existing
tests as verification of the process below. This documentation update does not change CI.
The workflows deployed on GitHub may still use the older build behavior until replacements
are reviewed and merged.

## Branches

| Purpose | Name | Base and destination |
| --- | --- | --- |
| Production history | `main` | Receives release PRs |
| Release integration | `releases/X.Y.Z` | Created from current `origin/main`; collects work for that version |
| Feature | `feat/short-description` | Created from the target release branch; PR back to it |
| Fix | `fix/short-description` | Created from the target release branch; PR back to it |
| Documentation | `docs/short-description` | Created from the target release branch; PR back to it |
| Maintenance | `chore/short-description` | Created from the target release branch; PR back to it |
| Automation | `ci/short-description` | Created from the target release branch; PR back to it |

Use `main` as this fork's production branch. Normally keep one active release branch; there
is no permanent `develop`. Fetch the remote before creating a release branch, and do not set
its upstream to `origin/main`. Existing work branches can be integrated after reviewing their
full diff; recreating them just to fit a name is unnecessary.

Use merge commits for work-branch integration and the release-to-`main` PR. Shared branch
history must not be rewritten. Creating, merging, pushing, or deleting branches requires
the owner's corresponding authorization. The release branch can be deleted after successful
publication; Git tags and published versioned images remain.

## Version ownership

The owner chooses `X.Y.Z` when opening a release, expressed by its branch name. Neither an
agent nor automation guesses a version from commit messages:

- **PATCH** (`1.1.1`): compatible fixes.
- **MINOR** (`1.2.0`): compatible new behavior.
- **MAJOR** (`2.0.0`): incompatible changes to behavior, APIs, or persisted data.

Automation reads the version from `releases/X.Y.Z` and verifies that it matches `package.json`
and both root version entries in `package-lock.json`. A mismatch stops the build with a clear
error; it does not silently update files or choose a different version. The agent can prepare
those file changes when instructed, but does not assign RC numbers or create release tags
manually.

| Object | Example | Assignment |
| --- | --- | --- |
| Release branch | `releases/1.1.0` | Owner-selected release version |
| RC container | `ghcr.io/sirily/cashier-sveltekit:1.1.0-rc.7` | Automatically numbered build from a release-branch push |
| Final container | `ghcr.io/sirily/cashier-sveltekit:1.1.0` | Successful production build after merging the release PR |
| Final Git tag | `v1.1.0` | Automatically created on the merged release commit |
| Production alias | `latest` | Updated only after successful final publication |

`rc` identifies a build of the intended release, not a separate approval procedure. RC
numbers increase automatically within a version, are not reused after reservation, and are
safe under parallel runs. An existing RC or final version tag must never be moved to different
content. RC Git tags are not required; container metadata must retain the full source SHA
and the CI run so a build is traceable.

## Release sequence

### 1. Collect changes and build RCs

1. Create `releases/X.Y.Z` from freshly fetched `origin/main` and prepare matching package
   version metadata as reviewed release content.
2. Merge work branches through PRs into this release branch, not directly into `main`.
3. Every push to `releases/*` automatically validates the version, runs required checks,
   assigns the next `rc.N`, and builds and publishes the corresponding container.
4. Failed checks or builds do not publish a successful RC or update production aliases.
   A reserved number is not reused; a retried build must not overwrite an existing RC image.
5. Any further push produces another RC automatically. No manual candidate-preparation
   command, special freeze state, or additional approval is needed to continue development.

Required checks cover linting, types, unit tests, a production build, and relevant browser
tests. Run expensive checks in CI; do not claim they passed from documentation validation.
RC images are available in GHCR. This repository does not create a test URL or deploy a test
instance. The owner decides where and how to inspect a build; separate infrastructure is
not a prerequisite imposed by this release process.

### 2. Merge to approve

Open a PR from `releases/X.Y.Z` into `main`. The PR can remain open while work accumulates.
Required checks must pass on the current proposed integration before merging.

**Merging this PR is the release approval.** There is no additional GitHub Environment
approval, acceptance receipt, or required evidence URL. A separate `release/accepted` status
is not part of this policy. New source changes require fresh checks, not a second manual
acceptance procedure.

### 3. Build and publish the final release

After the release PR is merged, automation:

1. Verifies that the `main` commit is the merge of a same-repository `releases/X.Y.Z` PR,
   determines its version, and checks package metadata again.
2. Runs the required checks and builds a **new production container from the merged code**.
3. Publishes the successful image as `X.Y.Z`, then creates Git tag `vX.Y.Z` on the release
   merge commit and updates `latest` to that final image. No final tag advertises a failed build.
4. Records the source commit, CI run, and image digest with the release.

An ordinary `main` push that is not a release-PR merge must not create a release or update
`latest`. Creating Git tags must not start another uncontrolled build. Final versions are
unique: an already published version cannot be replaced with different content. Retries may
complete the same interrupted publication but must not rebuild over an existing final image
or move a final Git tag. Failed or stale runs cannot overwrite a newer production release.

The final image is rebuilt, not promoted from an RC. Its digest can differ from the RC's;
this is the agreed process, not a promise that production runs identical tested bytes.
Publishing an image does not deploy it. Production deployment remains a separately authorized
operation using an explicit version, preferably pinned by digest, rather than a floating
`latest` reference.

## Automation and repository protections

The implementation must enforce, rather than delegate to an agent's memory:

- Release-branch/version syntax and agreement with package metadata.
- Automatic, concurrency-safe RC numbering and unique final versions.
- Required PR checks; no unreviewed direct pushes or force-pushes to shared release/production branches.
- Release-merge detection before final builds; no final publication from work branches, RCs,
  arbitrary `main` commits, or untrusted PR code.
- Separate publication permissions from untrusted PR checks; never expose registry write
  credentials to fork code.
- Protection against rewriting final Git tags and published versioned image tags.
- Safe retries and serialized production updates so a late job cannot replace a newer `latest`.

Branch/tag permissions are GitHub settings, not something workflow files guarantee alone.
They must be configured with the owner's authorization. Read-only inspection on 2026-10-23
found that the active `main` ruleset allowed only squash merges and did not require checks;
a second branch ruleset was disabled. Verify and adjust those settings before enabling
this process. No separate protected approval environment is needed.

Workflow names, exact numbering storage, and retry commands belong to the upcoming simplified
implementation. Do not reuse the superseded dispatch/acceptance commands in the current code.

## Hotfixes and rollback

An urgent fix follows the same process: create a patch release from current `main`, let
pushes produce RCs, then merge its release PR to approve the final build. Integrate a released
hotfix back into any other active release branch before its next final merge.

Rollback deploys an earlier immutable final image digest. It does not move Git tags, rewrite
`main`, or clear browser storage. Check compatibility with existing IndexedDB, OPFS, and
backend data first: restoring an older container does not undo a data migration.
