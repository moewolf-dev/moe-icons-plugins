# Visual Studio Marketplace publishing

## Identity and current version

- Extension: `moewolf.moe-icons-plugins`
- GitHub: `moewolf-dev/moe-icons-plugins`
- Current plugin version: 0.0.2
- Accepted CLI baseline: 0.0.3; bundled legacy resource baseline: 0.0.17

The plugin version and resource version are independent. This is an early release
and does not claim completion of the four-target iteration.

## Authentication: GitHub → Entra ID → Marketplace

The workflow uses `azure/login` with GitHub workload identity federation, then
`vsce publish --azure-credential`. It does not use Marketplace direct trusted
publishing (`--oidc`), PATs, client secrets or certificates.

Repository variables:

- `AZURE_CLIENT_ID`: the Application (client) ID
- `AZURE_TENANT_ID`: the Directory (tenant) ID

Configure the app's federated credential:

- Issuer: `https://token.actions.githubusercontent.com`
- Audience: `api://AzureADTokenExchange`
- Subject: `repo:moewolf-dev/moe-icons-plugins:ref:refs/heads/main`

The Marketplace publisher must separately authorize the Azure identity. Run
`verify-entra.yml` on `main`: it logs in without subscriptions, calls
`vsce verify-pat moewolf --azure-credential` without publishing, and retrieves
the identity ID from the Azure DevOps profiles API. Add that profile ID (not the
client ID or the Entra object ID) to the `moewolf` publisher as **Contributor**.
The legacy command name `verify-pat` also supports Entra; it does not create a
PAT. Its access check alone does not prove write rights: actual publication
requires Contributor or Owner access. No access token is printed in these steps.

## One tag, two release destinations

1. Review changes and synchronize package.json, package-lock.json, the version
   map and release baseline. Run compile, tests, build and release validation.
2. Commit and push the version commit to `main`.
3. Create and push its matching stable `vX.Y.Z` tag.
4. The tag coordinator dispatches `release.yml` on `main`, preserving the
   existing branch-based federation subject. A tag itself cannot log in using
   a credential bound only to `main`.
5. The dispatched workflow validates the tag format, version and ancestry on
   `main`, checks out the tagged code, tests, validates and packages it without
   Azure credentials.
6. It publishes the reviewed VSIX and SHA-256 to GitHub Release. If a release
   already exists, its assets must exist, pass SHA-256 and match every file's
   content in a fresh build of the tag. Its original bytes are retained.
7. A separate job receives `id-token: write`, logs into Entra, checks publisher
   access, verifies the VSIX digest and publishes that exact artifact.

Branch pushes and PRs run CI without publication. Runs are serialized per tag.
The GitHub Release and Marketplace jobs have separate permissions; only the
Marketplace job can obtain an Azure identity. There is no PAT fallback.

## Recovery without a new version

Dispatch `release.yml` on `main` with `release_tag=v0.0.2` and `publish=true`
to publish the existing reviewed 0.0.2 package. `publish=false` validates and
packages without creating a GitHub Release or obtaining an Azure credential.
Do not move existing tags or allocate a new version just to test authentication.
`--skip-duplicate` permits recovery when the Marketplace version already exists;
it does not replace that version. A new change needs a higher patch version.

Authentication failure leaves the GitHub Release and reviewed VSIX available.
After fixing membership or federation, rerun the same dispatch. GitHub Release
is not evidence of Marketplace publication; check the Marketplace version and
verification status separately. Updates follow each user's VS Code settings.

## Evidence and migration history

- Manual first publication of 0.0.1 was confirmed on 2026-10-05.
- 0.0.2 source tag: `62df19d6ebe0c69546457e8704041df04160cfdb`.
- Reviewed 0.0.2 VSIX SHA-256:
  `12e7c1df54a2a13bd15c935fffa8e5840cc6f29949969e5ce4ec2f390666dc31`.
- Direct Marketplace OIDC publication failed with
  `Trusted Publishing is not supported` in run `37306940878`. The temporary
  vsce OIDC compatibility patch and old 0.0.1 retry job have been retired.
- Entra preflight run `37316511052`: federation login passed, identity profile
  read passed, publisher access rejected with `The requested operation is not
  allowed`. The returned Marketplace identity ID is
  `e7044b7b-85cc-670b-9a9c-52d885338a1c`; add it to `moewolf` as Contributor.
  The publisher owner subsequently added this identity as Contributor.
- Entra release run `37317535464` succeeded: tests/package verification, existing
  GitHub Release asset reuse, Entra login and publisher access all passed;
  Marketplace accepted `moewolf.moe-icons-plugins` 0.0.2. The artifact retains
  SHA-256 `12e7c1df54a2a13bd15c935fffa8e5840cc6f29949969e5ce4ec2f390666dc31`.
  Public-page verification/CDN propagation can lag successful upload; confirm
  the visible version independently before announcing public availability.
- Workflow actionlint validation passed. A package-only recovery run
  `37317418380` confirmed the existing 0.0.2 VSIX matches every file's content
  in a fresh tagged build. The future tag-to-main dispatch is implemented;
  this recovery exercised the main dispatch directly without creating a new tag.

## Local state recovery

`release-state.mjs` serializes upstream-event allocation with `.release-state-lock`
and a `.release-state-transaction.json` journal. Interrupted transactions recover
only when files match their recorded before/after content. A live lock rejects
competing operations. Inspect the owner PID before removing a stale lock, retain
the journal, then retry. External changes stop recovery for manual review.

Do not use `npm version patch` alone: it leaves the version map and baseline
unsynchronized. Maintainer-initiated patches must synchronize the four metadata
files without inventing upstream events. These local protections do not replace
the planned cross-repository durable event receiver.

Official references:

- https://github.com/Azure/login (OIDC login and no-subscription support)
- https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- https://github.com/microsoft/vscode-vsce (Entra publishing implementation)
