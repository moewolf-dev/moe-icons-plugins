# Moe Icons for VS Code

Code completion and semantic highlighting for the
[Moe Icons](https://github.com/moewolf-dev/moe-icons) icon library, for both
React and Vue.

> This plugin only completes icon **names**. It never embeds or completes SVG
> source code, and it never downloads anything at runtime — the icon name data
> is bundled offline and updated only by upgrading the plugin.

## Features

- **Completion** for `<IconName />` in `typescriptreact`, `javascriptreact`
  and `vue` files. Each candidate shows a tag with its style library and
  `free` / `pro` tier.
- **Semantic highlighting** for icon names and the `moe-icon` keyword prefix,
  with a light and a dark palette.
- **Config detection**: reads `moeicons.config.ts` from the workspace root to
  detect the installed icon library version.
- **Version map**: a 1:1 plugin-version ↔ library-version mapping, exposed in
  settings so you can downgrade when your installed library is older.

## Usage

Install the plugin, then type `<` followed by the first letters of an icon
name inside a React or Vue template:

```tsx
<ArrowChev {/* completion lists ArrowChevronDownIcon, ... */}
```

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `moeicons.highlightColorMode` | `light` | `light` or `dark` highlighting palette. |
| `moeicons.styleGroup` | `outline` | Style library used for completion/highlighting. |
| `moeicons.libraryVersion` | `""` | Library version to match (empty = latest bundled). |
| `moeicons.websiteUrl` | `https://moeicons.com` | Official website link. |
| `moeicons.repositoryUrl` | `https://github.com/moewolf-dev/moe-icons` | Public repo link. |
| `moeicons.pluginRepositoryUrl` | `https://github.com/moewolf-dev/moe-icons-plugins` | Plugin repo link. |
| `moeicons.documentationUrl` | `https://github.com/moewolf-dev/moe-icons#readme` | Docs link. |

## Commands

- `Moe Icons: List Style Libraries` — list style libraries with `free`/`pro` markers.
- `Moe Icons: Show Plugin/Library Version Map` — show the 1:1 version mapping.

## Development

```bash
npm install
npm run compile   # type-check
npm run build     # bundle to dist/
npm test          # unit tests
npm run package   # produce a .vsix
```

Press `F5` in VS Code to launch an Extension Development Host.
