# Release

Cynos uses an atomic local release flow: version metadata, the changelog, and
the tag are produced from one release commit.

## Before releasing

```bash
npm ci
npm run verify
npm run pack:dry-run
npm run package:smoke
npm audit --omit=dev
```

Confirm the working tree is clean, the intended branch is current, and the
package metadata, license, README, dependency lockfile, and public repository URL
are correct.

## Release command

```bash
npm run release -- patch
# or: minor, major, or an explicit x.y.z version
```

The release script verifies the tree, checks that the branch contains the remote
main, runs verification, updates `package.json` and `package-lock.json`,
regenerates the changelog, creates one release commit, and creates an annotated
tag. It also verifies that the tag points at the release commit.

For this protected public repository, do not push `main` or the tag directly after
running the release script. Preserve the release commit in a release PR:

```bash
git switch -c release/vX.Y.Z
git push -u origin release/vX.Y.Z
# open the PR, wait for verify, and merge without squash
git push origin vX.Y.Z
```

The GitHub Actions release workflow then validates the tag, builds the package, runs
the source and packed-artifact checks, publishes the exact tarball to npm using npm
Trusted Publishing (OIDC), and creates the GitHub Release.

## Two-package release order

When releasing both Cynos packages:

1. release and validate `@cynos-ai/tools`;
2. update Engineer's bundled Tools version to the published version;
3. release and validate `@cynos-ai/engineer`;
4. install both packages in a clean temporary project and verify activation.

## Rollback

If a release has not been published, remove the local tag and revert the release
commit before retrying. If npm has been published, do not reuse the version:
ship a corrective patch and document the issue in the changelog and GitHub
Release. Remove or disable a broken GitHub release asset only after recording
which npm version and commit are affected.

Never put npm tokens, signing credentials, or private registry configuration in
this repository or in issue reports.
