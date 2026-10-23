# Release policy

This document defines branch names, versions, candidate acceptance, publication, and rollback
for this repository. It is a repository process, not an application specification.

## Automation status

**The policy below is the target process; release automation is not implemented yet.**
The current [Docker workflow](../.github/workflows/docker.yml) builds on pushes to `main` or
`master`, `v*` tags, pull requests, and manual dispatch. Non-PR runs can publish images;
default-branch builds update `latest`. It does not build release-branch pushes automatically,
allocate candidate numbers, record candidate approval, or promote a tested image without
rebuilding it. The repository protection settings have not been verified.

Do not treat a current `latest` image or a successful existing workflow as proof of release
acceptance. Implement and verify the automation and protections below before the first release
under this policy. Until then, do not imitate that process with ad hoc agent-created release
tags or use the legacy Netlify scripts as a substitute.

## Branches

| Purpose | Name | Base and destination |
| --- | --- | --- |
| Production history | `main` | Receives accepted release branches through reviewed PRs |
| Release integration | `releases/X.Y.Z` | Created from freshly fetched `origin/main`; collects changes for that version |
| Feature | `feat/short-description` | Created from its target release branch; PR back to that branch |
| Fix | `fix/short-description` | Created from its target release branch; PR back to that branch |
| Documentation | `docs/short-description` | Created from its target release branch; PR back to that branch |
| Maintenance | `chore/short-description` | Created from its target release branch; PR back to that branch |

Use `main`, not `master`, as the production branch for this fork. A release branch is a
collection point for several short-lived branches, not a permanent development branch.
Normally keep one active release branch. Existing work branches can be merged after reviewing
their full diff against the target release; they do not need to be recreated merely to fit a name.

Fetch the remote before creating a release branch. Do not base a release on an unverified
local `main` or set a release branch's upstream to `origin/main`. Creating, pushing, merging,
and deleting branches are separate actions and require the owner's corresponding authorization.

Use merge commits for work-branch integration and for the release-to-`main` PR so the collected
changes and release boundary remain visible. Do not force-push shared release branches or
rewrite history already used to build a candidate.

## Versions and names

The owner explicitly chooses `X.Y.Z`; neither an agent nor commit-message analysis chooses
it automatically:

- **PATCH** (`1.1.1`): compatible fixes.
- **MINOR** (`1.2.0`): compatible new behavior.
- **MAJOR** (`2.0.0`): incompatible changes, including relevant API or persisted-data contracts.

The release version must agree with `package.json` and the matching package-lock metadata
before building a candidate. Prepare version changes in the release branch, not in the final
promotion: changing files after acceptance requires another candidate. Do not change a
package version merely when creating a branch.

| Object | Example | Meaning |
| --- | --- | --- |
| Release branch | `releases/1.1.0` | Integration branch for one intended version |
| Candidate Git tag | `v1.1.0-rc.1` | Immutable reference to one candidate source commit |
| Final Git tag | `v1.1.0` | Immutable reference to the accepted release merge in `main` |
| Test image | `ghcr.io/sirily/cashier-sveltekit:sha-<full-commit-sha>` | Image built from that exact release-branch commit |
| Candidate image | `ghcr.io/sirily/cashier-sveltekit:1.1.0-rc.1` | Immutable alias of the selected test-image digest |
| Final image | `ghcr.io/sirily/cashier-sveltekit:1.1.0` | Immutable alias of the accepted candidate digest |

`latest` is a mutable convenience alias for the most recently accepted final release, never
for a test build, candidate, or arbitrary `main` push. Deployments must pin an explicit version
and preferably an image digest. No moving candidate or final-version tags are allowed.

For multi-platform images, the recorded digest identifies the tested image index and its
platform manifests, not a newly assembled or rebuilt index during promotion. An existing
source-SHA image is reused, not silently replaced by a later rebuild of the same source.

## Release sequence

### 1. Collect changes

1. Choose the version and create `releases/X.Y.Z` from current `origin/main`.
2. Merge reviewed work branches through PRs targeting that release branch, not `main`.
3. Required checks run on PRs. Every new release-branch commit produces a uniquely identified
   test image; building alone never deploys to production or updates `latest`.
4. Reconcile any changes that reached `main` before preparing the next candidate.

### 2. Prepare a candidate

1. A release workflow is explicitly requested for the chosen release-branch commit.
2. Automation verifies the branch/version, required checks, and successful image publication.
3. Automation allocates the next unused `rc.N`, creates the immutable candidate Git tag, and
   assigns the candidate image tag to the existing image digest without rebuilding it.
4. The candidate record captures the full source SHA, Git tree, version, image-index digest,
   build/check runs, supported platforms, and relevant backend/deployment versions.

Only a commit that has a successful completed test-image build is eligible. Candidate numbers
increase monotonically within a version; cancelled or failed reservations are not reused.
Allocation is serialized per version and fails on an existing tag rather than moving it.
A `v*` tag event must not trigger a second build that replaces the selected candidate image.

Once a candidate exists, freeze its release scope: only fixes needed for acceptance enter that
release branch. New unrelated features go to later work. Any source change, including docs,
version changes, or integration of newer `main`, produces a new build and a new candidate.

### 3. Test and accept

Test the candidate by its recorded digest in a deployment-shaped environment, with a separate
PWA origin so its service worker and browser storage cannot replace production state. Use
isolated fixtures, backend credentials, and writable transaction data; a test instance must
not accidentally write to the production ledger.

Required checks include formatting/linting, type checking, unit tests in non-watch mode,
a production build, and relevant browser tests. Run expensive checks in CI rather than
assuming they passed locally. Record failures and any explicitly accepted exceptions; an
agent must not waive a required check unilaterally.

For changes affecting finance behavior, acceptance covers the relevant specification scenarios:
local capture, explicit Sync, completed-only sending, retained incomplete `!` entries,
retries/conflicts, mixed batches, zero-error server-book parsing, confirmation-based overlay
removal, and one visible operation after reconciliation. Include currency/valuation and
account-history checks when affected. Preserve existing browser state during update tests.

The owner approves a **specific candidate and digest**, not a moving branch or the phrase
"latest build". Record acceptance with the test evidence. Changing or replacing the candidate
invalidates that approval and requires a new candidate and acceptance.

### 4. Merge and publish

1. Open the accepted release's PR into `main`. Its head must still be the approved candidate
   commit, and required checks must pass.
2. Release automation verifies that `main` has not diverged in a way that changes the accepted
   content. Merge with a merge commit; the resulting Git tree must equal the candidate tree.
   A merge conflict or any content difference stops final publication and requires another
   candidate tested with the resolved content.
3. After the verified merge and owner authorization, automation creates `vX.Y.Z` on the
   release merge commit and assigns `X.Y.Z` to the **already tested image digest**. It does
   not run a new application build.
4. Publish release notes containing the candidate source SHA, final merge SHA, image digest,
   accepted evidence, and compatibility/migration notes. The image's original source labels
   can refer to the candidate SHA; the release record explains the final merge relationship.
5. Only after final publication succeeds, update `latest` to the same digest. Deployment is
   a separate authorized action in the deployment repository, not an automatic consequence
   of merging documentation or publishing an image.
6. After successful publication and confirmation that included changes are preserved, the
   release branch can be deleted with owner authorization. Keep the Git tags and images.

A metadata-only promotion retry must reuse the same accepted source, final Git commit, and
digest. If an expected tag already points to exactly that object, the retry can continue;
a tag pointing elsewhere is a hard error, never an invitation to overwrite it. Partial
publication must not update `latest` or deploy a different image.

## Enforcement to implement

GitHub Actions and repository rules must enforce the process; instructions to an agent are
not a replacement for these controls:

- Protect `main` and shared `releases/*` from direct unreviewed pushes, force-pushes, and deletion.
  Limit the release-creation/cleanup exception to the authorized workflow or maintainer.
- Require PR checks on the actual integration result. Recheck the release head and target at
  final merge; a stale green check or an old approval is insufficient.
- Protect final and candidate Git tags against update/deletion and restrict creation to the
  release workflow, with only a documented recovery exception for the owner.
- Give image/tag publication permissions only to the appropriate trusted workflow jobs.
  Pull requests must not obtain production publication credentials.
- Serialize candidate numbering and final publication per release, and serialize updates
  to the production release pointer. A late job must not overwrite a newer accepted release.
- Bind human approval to the immutable candidate record and verify it during final publication.
  Configure an approval mechanism appropriate to repository capabilities; do not assume a
  protected environment is already available or enabled.
- Validate version syntax, branch/package-version agreement, source/tree identity, existing-tag
  collisions, and registry digest equality. Never fall back to rebuilding on promotion failure.
- Make push, candidate-tag, final-tag, and promotion triggers non-overlapping so creating a
  tag cannot start an uncontrolled duplicate build or update `latest`.

No specific workflow names or dispatch commands are promised until these jobs exist. The
current workflow and branch protections must be changed and tested in a separate implementation.

## Hotfixes and rollback

An urgent fix still starts from current production `main`, uses a patch release branch,
and goes through candidate testing and explicit acceptance. An abbreviated acceptance needs
an explicit owner decision with the risk recorded; it is not permission to bypass identity,
data-preservation, or publication controls.

If another release branch is active, merge the hotfix's production changes into it before
its next candidate. An earlier candidate is no longer promotable when the resulting merge
would change its tested tree.

Rollback deploys a previously accepted immutable image digest. Do not move final Git tags,
rewrite `main`, or clear browser storage to simulate rollback. Check IndexedDB/OPFS and
backend compatibility first: restoring an image does not undo a data migration. Use an
explicit recovery plan if newer data is not readable by the older app, and record the
rollback in the deployment history.
