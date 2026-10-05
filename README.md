# Moe Icons for VS Code

Code completion and semantic highlighting for the
[Moe Icons](https://github.com/moewolf-dev/moe-icons) icon library, for both
React and Vue.

> This plugin only completes icon **names**. It never embeds or completes SVG
> source code, and it never downloads anything at runtime — the icon name data
> is bundled offline and updated only by upgrading the plugin.

## Core iteration status (2026-10-04)

Completion, highlighting and coded diagnostics now share a scope-aware TypeScript/Vue parser. They use the current project's hash-verified CLI-managed exports instead of inventing an `Icon` suffix or a package import. The installed catalog and managed module hashes are checked before a module is treated as authoritative.

The current core supports relative imports from the CLI's generated output directory, named/default aliases, namespace members, React JSX, Vue script setup tags and Vanilla namespace calls. Namespace completion also works while typing an incomplete JSX tag. Vue loop/slot scopes, dynamic expressions and unverified modules are skipped conservatively. Diagnostics use `MOE-ICON-0001` for unavailable exports and clear on edit, close and project invalidation.

The account view and refresh command read an existing CLI access token and call the dedicated Worker endpoint. That endpoint and account path have not been deployed or validated against real accounts. The bundled icon data is still the legacy free/outline list; without a verified package archive and complete release metadata, it is not an authoritative source for new target exports or Pro diagnostics. Unimported-icon completion/automatic imports, npm and path-alias adapters, Assets reference completion, and automated publication remain outstanding.

See [the core handoff](docs/core-language-handoff.md) and [the symbol contract](docs/code-symbol-contract.md) before extending the providers.

## Usage

After `moeicons generate`, import the actual generated namespace or component:

```tsx
import * as Icons from './moeicons';
const icon = <Icons.Archive />;
// Type <Icons.Ar to complete the existing installed export.
```

The generated output must still match `.moeicons/install-metadata.json`. Edited or unknown inputs disable authoritative diagnostics rather than silently switching to the old bundled list.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `moeicons.highlightColorMode` | `auto` | Follow the editor theme, or force `light` / `dark` semantic-token modifiers. Override colors in `editor.semanticTokenColorCustomizations`. |
| `moeicons.styleGroup` | `outline` | Style library used for completion/highlighting. |
| `moeicons.libraryVersion` | `""` | Library version to match (empty = latest bundled). |
| `moeicons.websiteUrl` | `https://moeicons.com` | Official website link. |
| `moeicons.repositoryUrl` | `https://github.com/moewolf-dev/moe-icons` | Public repo link. |
| `moeicons.pluginRepositoryUrl` | `https://github.com/moewolf-dev/moe-icons-plugins` | Plugin repo link. |
| `moeicons.documentationUrl` | `https://github.com/moewolf-dev/moe-icons#readme` | Docs link. |

## Commands

- `Moe Icons: List Style Libraries` — list style libraries with `free`/`pro` markers.
- `Moe Icons: Show Plugin/Library Version Map` — show the 1:1 version mapping.
- `Moe Icons: Show Account` — focus the account/version view.
- `Moe Icons: Refresh Account` — read the current CLI session and refresh entitlement status.

## Development

```bash
npm install
npm run compile   # type-check
npm run build     # bundle to dist/
npm test          # unit tests
npm run test:core-host # isolated local VS Code core smoke test
npm run package   # produce a .vsix
```

Press `F5` in VS Code to launch an Extension Development Host.


## Marketplace publishing

Publisher: `moewolf`; extension ID: `moewolf.moe-icons-plugins`.
Development and packaging require Node.js 22 or newer.
PRs and branch pushes run CI. A matching `vX.Y.Z` tag triggers the Marketplace
OIDC release workflow; configure the trusted policy for
`moewolf-dev/moe-icons-plugins` and `release.yml` before using it.
See [the publishing runbook](docs/marketplace-publishing.md) for first VSIX upload,
version synchronization, and policy setup.
