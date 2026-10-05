# Visual Studio Marketplace publishing runbook

## Extension identity

The publisher is `moewolf`, created by the maintainer. The package name remains
`moe-icons-plugins`, so the extension ID is **`moewolf.moe-icons-plugins`**.
The GitHub repository is `moewolf-dev/moe-icons-plugins`; the organization name
is independent of the Marketplace publisher ID. The current plugin version is
`0.0.1`; it is independent of the resourceVersion `0.0.18`.


## Local package review

1. Use a clean, reviewed commit and a stable SemVer version in `package.json` and `package-lock.json`.
2. Run compile, tests, build, and `vsce package` in the plugin repository.
3. Inspect `vsce ls` and the VSIX archive. Confirm that it contains only runtime code, the metadata-only catalog, docs, and declared assets; it must contain no credential files, tests, private resource artifacts, SVG source, or bitmap bytes.
4. Install that VSIX into a clean VS Code profile and verify activation and the declared commands/views before publication.
5. Publish the same reviewed version with `vsce publish` only after the publisher identity and authentication path are ready. Retain the VSIX SHA-256 and Marketplace readback as release evidence.

## Automation and authentication

The release workflow now packages the VSIX in a credential-free job, then publishes that exact digest with `npx @vscode/vsce publish --oidc` in a separate job that alone receives `id-token: write`. Configure a Visual Studio Marketplace trusted-publishing policy for this repository and workflow before enabling a release. `vsce` requests a GitHub Actions OIDC token with the Marketplace audience and exchanges it for a short-lived credential; it does not fall back to a PAT if trusted publishing fails. The workflow never reads or stores a Marketplace secret. A dispatch credential for reading upstream repositories is a separate identity and must never be reused as Marketplace authentication.

## Updates and recovery

VS Code applies Marketplace updates according to the user's automatic-update settings, extension compatibility (`engines.vscode`), and any version-channel policy. A successful publish does not force every installed client to upgrade immediately. To recover a defective release, publish a corrected higher patch version; do not attempt to roll clients back by publishing a lower version. Keep the original VSIX, digest, source commit, package version, and Marketplace readback together.

## External prerequisites

- Verified publisher ownership and extension ID.
- A Marketplace trusted-publishing policy bound to this repository/workflow, plus publisher ownership and permission.
- Repository permissions to read the required upstream release artifacts and dispatch events.
- A maintainer to perform first publish and confirm Marketplace readback.

## Local release state recovery

`release-state.mjs` serializes state changes with `.release-state-lock` and writes a
`.release-state-transaction.json` journal before updating the package, lockfile,
version map and event ledger. The next operation finishes an interrupted
transaction only when every file still matches its recorded before/after state.
A live lock owner rejects competing operations; retry the same event later.
A lock from a stopped process requires inspecting the owner PID and removing the
lock directory only after confirming no release operation is running. Retain the
transaction journal, then retry the event to recover. External file changes cause
recovery to stop for manual review. These protections do not replace the durable
cross-repository event queue required by the receiver workflow.

## First publication and trusted policy

1. Run the `release` workflow manually with `publish=false` on a reviewed commit.
   Download its `reviewed-vsix` artifact; it contains the VSIX and SHA-256 file.
2. In https://marketplace.visualstudio.com/manage/publishers/ select **moewolf**
   and use **New extension → Visual Studio Code** to upload the reviewed VSIX.
   Uploading a VSIX is the documented first-publication path and creates the
   extension; no long-lived Marketplace PAT is needed for this path.
3. Once the extension's management UI offers trusted publishing, configure the
   GitHub policy for owner **moewolf-dev**, repository **moe-icons-plugins**,
   workflow **release.yml**. This workflow filename is the one implemented here;
   do not configure `publish.yml` unless the file and policy are both changed.
   Marketplace UI availability and the policy's effective permissions must be
   confirmed externally. The official vsce guide does not establish that a
   first-upload bootstrap is universally required before OIDC can be configured.
4. For subsequent releases, use a reviewed version commit whose package, lock,
   version map and release state agree. Push its exact `vX.Y.Z` tag. The release
   workflow checks the tag against `package.json`, packages once, verifies the
   digest and publishes that VSIX with OIDC. Ordinary branch pushes and PRs run
   `ci.yml` without publishing. Manual `publish=true` also requires selecting the
   matching tag; a branch cannot be published through this workflow.

Do not use `npm version patch` alone in this repository: it does not update the
version map or durable release ledger. Allocate upstream versions through the
existing release-state tool, review all related data changes, commit them, then
create/push the matching tag. This documentation does not authorize publishing
the current incomplete iteration as a completed four-target feature release.

Official references:
- https://github.com/microsoft/vscode-vsce#trusted-publishing (OIDC and Node 22+)
- https://code.visualstudio.com/api/working-with-extensions/publishing-extension (publisher and VSIX upload)
