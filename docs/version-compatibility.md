# Plugin, CLI and resource compatibility

This page records the verified combination contract. The plugin version, CLI
version and icon-resource version are independent; a plugin release does not
automatically follow every CLI patch, and a CLI release does not automatically
publish a plugin.

## Runtime matrix

| Runtime | Requirement | Managed by |
| --- | --- | --- |
| VS Code extension (`moeicons.*`) | VS Code **1.85+**, Extension Host | VS Code supplies the extension-host Node runtime. Users do **not** install Node.js for the extension. |
| Moeicons CLI (`moeicons ...`) | **Node.js 24+** | The user's terminal/Node manager. |
| Extension development, tests, VSIX packaging, Marketplace release | **Node.js 24+** | Repository `.nvmrc`, local toolchain and GitHub Actions workflows. |

`package.json` intentionally keeps `"engines": { "vscode": "^1.85.0" }` and does
not declare a user-facing `engines.node`. Node 24 is a CLI and development
requirement, not a VS Code extension requirement.

## Generation contract read by the plugin

- Install metadata schema: **1** (`SUPPORTED_METADATA_SCHEMA`).
- Generated catalog schema: **1** (`SUPPORTED_CATALOG_SCHEMA`).
- Minimum verified CLI version recorded by CI/release metadata: **0.0.5**
  (`MIN_SUPPORTED_CLI_VERSION`).
- CLI version in `.moeicons/install-metadata.json` is optional. When absent the
  plugin records the installed CLI package version if it can read one, and does
  not classify the project as "too old".
- Generated files are authoritative only when their SHA-256 hashes match
  install metadata and the catalog.
- Unknown/newer metadata or catalog schemas produce `schemaDrift`; they are not
  silently treated as an empty project.

## Recorded combinations

Source of truth: [`data/version-map.json`](../data/version-map.json) and
[`data/release-state.json`](../data/release-state.json). `npm run
release:validate` fails when the package version and accepted baseline diverge.

| Plugin | CLI | Resource | Notes |
| --- | --- | --- | --- |
| 0.0.1–0.0.2 | not recorded | 0.0.17 | Early preview; legacy metadata had no CLI version. |
| 0.0.3–0.0.7 | not recorded | 0.0.18 | Project-aware completion/highlighting; CLI version not in metadata. |
| 0.0.8 | 0.0.5 | 0.0.19 | First entry with a recorded CLI baseline. |
| 0.0.9 | 0.0.6 | 0.0.19 |  |
| 0.0.10–0.0.12 | 0.0.8 | 0.0.19 |  |
| 0.0.13 | 0.0.9 | 0.0.19 |  |
| 0.0.14 | 0.0.10 | 0.0.19 | Current package baseline at the time of this document. |

Rows 0.0.1–0.0.7 are historical; the current plugin tolerates their metadata but
may report missing CLI version as "not recorded" rather than "too old".

## Rules for maintainers

1. A CLI patch does not require a plugin version bump when the generation
   contract is unchanged and the existing plugin still reads the output.
2. If a CLI change alters install metadata, catalog layout or generated exports,
   add a fixture and update `data/version-map.json`, `data/release-state.json`
   and this table in the same reviewed change.
3. `npm run release:validate` must pass before tagging; the release workflow
   packages the exact tagged VSIX and reuses an existing reviewed artifact only
   when every file matches.
4. Release evidence and smoke checks are separate: GitHub Action result,
   downloaded VSIX install, CLI `npx`/`--version` behavior and Marketplace
   listing verification are recorded separately. One passing surface does not
   certify the others.
5. Do not claim a combination is verified from a version number alone. The table
   records repository release metadata; re-run compile, unit, core-host, packaged
   VSIX and Marketplace checks for the release being published.
