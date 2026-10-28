# Releases

Run `npm ci`, `npm run check`, and `npm pack --dry-run`. Create a Changeset for each public change, run `npx changeset version` in a version PR, review the changelog, and merge after CI. A maintainer creates a protected tag `v<package.json version>` on that main commit. The tag is the only publish trigger.

`release.yml` checks out that commit on a GitHub-hosted runner, checks tag/version and main ancestry, runs the full suite and package validation, checks npm for an existing version, packs an exact tarball, publishes that tarball using OIDC to `https://registry.npmjs.org` under `next`, verifies the registry version and tarball integrity, then creates a GitHub Release. A package version cannot be unpublished as a rollback strategy; issue a corrective version. No publication is claimed yet.

Before first publication, verify npm organization ownership of `@b42y`, package name availability, GitHub repository visibility, and the exact `repository.url`. Trusted Publishing requires the npm package to exist first. If `npm view @b42y/core name --registry=https://registry.npmjs.org` returns E404, an npm organization member with publish permission must bootstrap the package from the protected `v0.1.0` tag. On the maintainer's machine, with npm account login and 2FA enabled, run:

```sh
git checkout v0.1.0
npm ci
npm run check
npm pack --dry-run
mkdir -p .tmp
archive=$(npm pack --pack-destination .tmp --silent)
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm publish ".tmp/$archive" --access public --tag next --registry=https://registry.npmjs.org
test "$(npm view @b42y/core@0.1.0 version --registry=https://registry.npmjs.org)" = "0.1.0"
expected="sha512-$(openssl dgst -sha512 -binary ".tmp/$archive" | openssl base64 -A)"
test "$(npm view @b42y/core@0.1.0 dist.integrity --registry=https://registry.npmjs.org)" = "$expected"
gh release create v0.1.0 --target "$(git rev-parse HEAD)" --verify-tag --generate-notes
```

The maintainer also needs GitHub CLI authentication to create the Release. Rerunning the tag workflow will reject this already-published version. Then configure npm Trusted Publishing for organization `B42y`, repository `b42y-core`, workflow filename `release.yml`, GitHub environment `npm-release`, and **Allow npm publish**. Set a protected `npm-release` GitHub environment with required reviewers. Keep the publisher on GitHub-hosted runners with `id-token: write`; subsequent versions use OIDC without an npm token. If the package exists but publishing still returns E404, check the trusted publisher's exact repository, workflow filename, environment, and direct-publish permission, as well as the npm organization's package ownership.

For CI push and manual jobs, repository or organization variable `SELF_HOSTED=true` requires a runner with labels `self-hosted`, `linux`, `x64`, and `b42y-core`. Pull requests always run on GitHub-hosted `ubuntu-latest` because their code is untrusted. The publish job also ignores `SELF_HOSTED`. `b42y-app` should install a specific verified version rather than a floating tag for production integration.
