# Release process

This document is for maintainers. Kledo MCP uses pull-request metadata to
collect release candidates, a curated root changelog for user-facing history,
staged npm publishing for human approval, and GitHub Releases for the complete
pull-request and contributor record.

## Release model

```text
release pull request
        |-----------------------> curated CHANGELOG.md section
        |
        v
merge to protected main
        |
        v
annotated version tag
        |
        v
Release workflow: prepare
        |-----------------------> draft GitHub Release
        |                         generated contributor notes
        v
staged npm package
        |
        v
maintainer review and 2FA approval
        |
        v
Release workflow: publish
        |-----------------------> public GitHub Release
        v
public npm package
```

The release pull request owns `CHANGELOG.md`. It turns the collected public
release notes into concise highlights, compatibility information, and any
migration instructions. Normal feature, fix, documentation, and maintenance
pull requests must not edit that file.

GitHub automatically appends the complete change categories, merged pull
requests, contributor mentions, first-time contributors, and compare link. The
categories and exclusions live in `.github/release.yml`. A contributor receives
credit through the GitHub account that owns the merged pull request. AI
assistance is recorded separately in the pull request template and never
replaces human attribution.

## Preconditions

- The release commit must be merged into protected `main` through a pull
  request.
- `CHANGELOG.md` must contain one `Unreleased` section and a dated section for
  the package version being released.
- `package.json`, `package-lock.json`, and `server.json` must contain the same
  version.
- Prerelease versions use an npm `next` dist-tag. Stable versions use `latest`.
- The version tag must be exactly `v` followed by the package version.
- The `npm-release` GitHub environment must require maintainer approval.
- The npm trusted publisher must identify `kevzakaria/kledo-mcp`, workflow
  `release.yml`, environment `npm-release`, and allow only staged publishing.
- Traditional npm publishing tokens should be disallowed after trusted
  publishing has been verified.

The workflow pins a supported npm 11 release because staged publishing requires
npm 11.15.0 or later and Node.js 22.14.0 or later.

## Repository governance

The public repository is configured so `main` requires a pull request, a
strict successful `Node 22.19 verification` check, resolved conversations, and
linear history. The policy applies to administrators, blocks force pushes and
deletion, permits squash merge only, and deletes merged branches.

The required approval count is intentionally zero while the project has one
maintainer, so the pull-request and CI gate does not deadlock releases. Raise it
to at least one before granting another account write or maintain permission.

## Prepare a release

1. Open a release pull request that changes only release-owned files. Update
   package and registry versions, move the curated `Unreleased` entries into a
   dated section for that version, add a new empty `Unreleased` section, and
   update its compare link.
2. Run `npm run changelog:check`. Confirm the required CI check passes and merge
   the pull request with squash merge.
3. Create an annotated tag from the merged commit and push only that tag:

   ```bash
   git switch main
   git pull --ff-only
   git tag -a v0.1.0-rc.1 -m "kledo-mcp v0.1.0-rc.1"
   git push origin v0.1.0-rc.1
   ```

4. Run the `Release` workflow from `main` with:
   - phase: `prepare`
   - tag: the exact version tag
   - stage package: enabled
5. Approve the `npm-release` GitHub environment deployment.
6. Review the draft GitHub Release. Its opening highlights must match the
   versioned changelog section. Its generated details should contain only the
   expected pull requests and contributor mentions.
7. Review the staged package on npm. Inspect its manifest, provenance, files,
   version, dist-tag, and repository before approving it with 2FA.

## Publish a prepared release

After the staged package has been approved and is public on npm, run the
`Release` workflow again with:

- phase: `publish`
- the same exact tag
- stage package: ignored by this phase

The workflow rebuilds and repacks the tag, verifies the public npm tarball
integrity against that result, and publishes the existing draft GitHub Release.
It refuses to publish when the npm version is absent or different.

## First npm bootstrap

npm does not allow staged publishing for a package name that has never been
published. For the first prerelease only:

1. Run the prepare phase with `stage_package` disabled. This creates the draft
   release and a verified tarball artifact without attempting npm staging.
2. Download and inspect the tarball artifact from that workflow run.
3. Publish that exact tarball interactively from a maintainer-controlled shell
   with npm 11.15.0 or later, 2FA, public access, and the `next` dist-tag.
4. Configure the npm trusted publisher for later releases:

   ```bash
   npm trust github kledo-mcp \
     --repo kevzakaria/kledo-mcp \
     --file release.yml \
     --env npm-release \
     --allow-stage-publish
   ```

5. Change npm publishing access to require 2FA and disallow traditional publish
   tokens.
6. Run the publish phase. It will verify the bootstrapped npm tarball before
   publishing the GitHub Release.

Never paste an npm session, password, 2FA code, or token into an issue, pull
request, repository file, workflow input, or AI chat.

## Pull request labels

Apply the narrowest release-note label before merging:

| Label | Generated section |
| --- | --- |
| `security` | Security |
| `enhancement` | Features |
| `bug` | Fixes |
| `documentation` | Documentation |
| `dependencies` | Dependencies |
| `maintenance` | Maintenance |
| `skip-changelog` | Excluded |

Each pull request must have exactly one of these labels. It must also fill the
`Release note` section with one public sentence and select one version impact.
`skip-changelog` requires a short `Not applicable:` reason and version impact
`none`. CI evaluates the event payload directly and reruns when labels or the
pull-request body change.

Pull requests from `dependabot[bot]` and `github-actions[bot]` are excluded from
the contributor list. Do not add AI agents as human co-authors. Record AI use in
the provenance fields and preserve the GitHub pull-request author's credit.

## Recovery rules

- Never move or recreate a published version tag.
- Never reuse an npm package version, even if a failed version is unpublished.
- A failed prepare run may leave a draft GitHub Release. Reuse the draft after
  resolving the failure.
- If a staged npm package is wrong, reject it with 2FA, bump the package version,
  and prepare a new tag.
- If npm is public but the GitHub Release is still a draft, rerun the publish
  phase. Its integrity check makes this recovery safe.
