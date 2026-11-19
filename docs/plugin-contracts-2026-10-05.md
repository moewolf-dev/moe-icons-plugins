# Plugin integration contracts (2026-10-05)

> Updated 2026-11-18 for the PLUG workstream. Runtime requirement: the extension
> runs in the VS Code Extension Host (VS Code `^1.85.0`); the Moeicons CLI and
> extension development/CI/packaging require Node.js 24+. See
> [version-compatibility.md](version-compatibility.md).

## Generated project targets

The library package currently declares `free/{react,vue,vanilla,assets}` and corresponding `pro/*` export paths. The CLI has a separate managed-project output contract: React/Vue use PascalCase proxy modules; Vanilla uses `create<Component>` factories under style-group namespaces; Assets contains files and a manifest, not component exports. Plugin language analysis trusts hash-verified `.moeicons/install-metadata.json` and catalog data and chooses a workspace from the document URI. It must not execute project configuration.

Support currently implemented in this plugin is narrower than the declared product goal: TS/JS React imports and Vue SFC/template recognition are represented by the language service. Vanilla completion, Assets reference completion, generated import edits, package alias resolution, and a complete 4-target fixture matrix remain open. Do not interpret package `exports` declarations or catalog `targets` as proof that every resource is present in a particular installed project.

## Generated project contract states

`src/language/metadata.ts` validates the CLI contract explicitly and never
folds every problem into an empty project. The independent states are:

- `cliMissing`: no CLI project/installation marker in the workspace.
- `notGenerated`: `.moeicons`, `moeicons.config.*` or a local CLI package exists,
  but `.moeicons/install-metadata.json` has not been generated.
- `invalidMetadata`: JSON/field/unsafe-path/bounds failure.
- `schemaDrift`: metadata or catalog schema is not the supported version 1.
- `staleGenerated`: catalog or generated files no longer match recorded hashes.
- `cliVersionTooOld`: metadata records a CLI below the verified minimum (0.0.5).
- `ready`: hashes verified and generated exports are authoritative.

`ProjectContract.versions` records the metadata schema, catalog schema, optional
metadata CLI version, optional installed CLI version, artifact version and
catalog resource version. Missing optional fields are tolerated; they are not
treated as "too old". Project diagnostics map each degraded state to a
`MOE-ICON-*` code and ordered recovery steps. The extension never runs the CLI,
opens a terminal or auto-installs anything.

## Metadata input and release evidence

The present `data/icons.json` is a legacy `{name, styleGroup, tier}` list of free `outline` icons. The generator now requires an extracted release root with `release-descriptor.json`, `release-input.json`, and `free/` plus `pro/` package roots. It checks evidence/version/source bindings and catalog digests, then derives names from target declarations and asset references from metadata; it never reads resource payload bytes. The caller creating `release-input.json` must first verify the immutable archive and its descriptor through the authoritative release chain. Because the actual 0.0.18 archives are unavailable here, this input boundary and extractor output are not yet integration-tested; existing icons data remains untouched. The public npm artifact `moe-icons@0.0.17` has registry integrity `sha512-kBGt15kVMqFnbGYkZwSehd/vhuuqhwOUwMIFTqxfKYVUzdKge2AlrP9CX7gnwJBaKkiGHiJ1DhL8MrzJwqBdBg==`, but its own `package.json` points to the older `yyh0808/moe-icons` repository and exposes only legacy `react`/`vue` entry points. It is not the `moewolf-dev/moe-icons-code-library` release and cannot supply current Vanilla/Assets/Pro contracts. Its tarball was inspected only in `/tmp` and removed; no resource bytes were copied into this repository. Pro metadata availability/publication permission and exact archive inputs remain external dependencies; retain existing data if these inputs are absent.

Known version facts differ: the production **resource version** is `0.0.18` (confirmed by the CLI's accepted `resource-release.json`, bundled catalog, and the [official Worker versions endpoint](https://api.moeicons.com/v1/icon-library/versions)), while the code-library checkout's npm `package.json` version is `0.0.17`. The `moe-icons@0.0.18` name/version expectation applies to the resource release; npm's separate `moe-icons` package currently ends at `0.0.17` and points to the older `yyh0808/moe-icons` repository. The accepted resource record binds `0.0.18` to source commit `fd422d968bd8e72169884773d44e9d6e5cc64d56`, generator commit `e68efd02a0fa99a54432f370df24bfad3c822b70`, and public/private descriptor digests. Those source commits are not present in the local code-library Git object database; its current checkout is `0df656e961c2a7e7b2ccad47809279c0018b591b`. The plugin map currently claims library `0.0.17` and has no source commit or CLI version, so it cannot authenticate the `0.0.18` generated project snapshot.

## CLI session and account API

CLI session storage uses macOS Keychain service `moeicons`, account `active-session`; Linux Secret Service uses the same service/account attributes; Windows uses PasswordVault resource `moeicons`, user `active-session`. The stored value is a JSON session with `accessToken`, `refreshToken`, `expiresAt` (epoch milliseconds), and `storedAt` (epoch milliseconds). The CLI prefers the native store unless `MOEICONS_DISABLE_SYSTEM_KEYCHAIN=1`; it reads a file store only when `MOEICONS_TOKEN_STORE_DIR` is explicitly configured. VS Code reads only the access-token and expiry fields. A failed/denied native-store call is unknown, never a reason to inspect a possibly stale file. The plugin never invokes CLI `status`, which may refresh credentials.

The Worker plugin endpoint is `GET https://api.moeicons.com/v1/plugin/account`, with `Authorization: Bearer ...` and `X-Moeicons-Plugin: vscode`; it is limited to requests without an `Origin`. It reuses Auth0 JWT verification and the public entitlement projection and returns only `schemaVersion`, `tier`, `status`, and `checkedAt`. A `pro` tier is effective only with `status=active`. The endpoint code is local and has not been deployed or verified against a real account. Missing keychain, unknown state, and network failures fail open for diagnostics.

The extension maps the read-only session result to independent states:
`signedOut`, `sessionExpired`, `sessionStore` (with `keychainToolMissing`,
`corruptSession` or `sessionStore` reasons), `rateLimited`, `policy`,
`unavailable` and `authenticated` (`free`/`pro`). A missing credential helper is
not "signed out". Token values are never copied, exported, generated or logged.

Host contract: this implementation runs from the extension host and reads that host's OS credential store. A remote extension host reads the remote machine's store; it does not forward a local token. Remote SSH, WSL and containers therefore require `moeicons login` on that host. Browser-hosted extension contexts do not have this OS-store contract.

## Output channel and redaction

The activation message uses a VS Code `OutputChannel`, not `console.log`.
Default output records lifecycle events and stable `MOE-ICON-*` codes only.
`moeicons.enableDiagnosticOutput` (default `false`) enables short-lived,
session-only detail. `src/logging/redact.ts` removes bearer/basic credentials,
JWTs, token/password pairs, query signatures, emails, absolute home paths,
private keys, data URIs and SVG source. Detail uses an allowlist of scalar fields,
so session JSON, network bodies and icon source cannot be attached by accident.

## Palette behavior

The plugin contributes default semantic-token colors through `editor.semanticTokenColorCustomizations`: violet 600 (`#7c3aed`) for light icon tokens, violet 300 (`#c4b5fd`) for dark icon tokens, and cyan 600 (`#0891b2`) for keywords, using the Tailwind CSS color palette as the reference. Users can override these rules in normal editor semantic token settings. `moeicons.highlightColorMode=auto` follows the active VS Code theme; `light` and `dark` force the corresponding icon modifier. Actual light/dark/high-contrast rendering and coexistence with language extensions still require Extension Host validation.
