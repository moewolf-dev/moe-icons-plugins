# Code Symbol Contract

This note records the symbol and import behavior implemented by the code-library generator and the `moeicons generate` CLI. It is a source-derived contract for plugin completion/highlighting work, not a release-input or publication acceptance record.

## Authoritative implementation

- `moe-icons-code-library/scripts/generator-core.cjs` owns library icon naming through `toComponentName` and `toExportName`.
- `moe-icons-code-library/scripts/generate-components.cjs` lays out React, Vue, Vanilla, tier, and asset outputs and writes framework/style-group barrels.
- `moe-icons-code-library/scripts/emitters.cjs` emits the framework component/factory source.
- `moe-icons-cli/src/core/icon-names.ts` owns CLI proxy/file naming; `moe-icons-cli/src/generator/generate.ts` plans generated source files; `moe-icons-cli/src/core/generate.ts` loads the installed artifact and reconciles files into the project.

## Names and aliases

For library IDs, `toComponentName` splits on hyphens, capitalizes segments and joins them. Empty/filtered names fall back to `Icon`; names beginning with a digit or matching the reserved JavaScript identifier list receive an `Icon` prefix. `toExportName` lowercases the first character of that result. Thus a normal ID such as `heart` yields `Heart` and `heart`; `ui-search` yields `UiSearch` and `uiSearch`. Ordinary component names do **not** receive an `Icon` suffix.

The CLI uses the same general PascalCase convention in `toProxyName` (plus its own reserved-name guard), and `toLibraryExportName` derives the camelCase package export. React/Vue CLI proxy files are named from the PascalCase icon ID, e.g. `icons/UiSearch.tsx` or `icons/UiSearch.vue`; the exported proxy symbol is `UiSearch`. Vanilla files likewise use `<PascalCase>.ts`. The CLI does not append `Icon` to these symbols.

At the iteration baseline, the plugin had a separate convention: `moe-icons-plugins/src/data/index.ts` appends `COMPONENT_SUFFIX` (`Icon`) after PascalCasing. Completion and highlighting therefore proposed names such as `HeartIcon`, whereas the generated library contract exports `heart`/`Heart` and the CLI generates `Heart`. Treat this suffix as plugin-owned behavior, not as evidence about library or CLI output. Baseline plugin completion built `import { <componentName> } from 'moe-icons'`; that import shape must be checked against the actual selected package/output before it is presented as a usable import.

## Library output shapes

The library generator writes each icon under a tier and style group:

- React: `<tier>/react/<style-group>/<Component>.tsx`. The file imports React and `ReactIconProps` from `../types`, defines a component, and default-exports the PascalCase component. The style-group `index.ts` aliases that default export to the lower-camel name, for example `export { default as heart } from './Heart';`.
- Vue: `<tier>/vue/<style-group>/<Component>.vue`. The SFC imports `defineComponent` from `vue`, uses the PascalCase name as the component `name`, and default-exports the component. Its style-group index aliases the default export to the lower-camel name with a `.vue` path.
- Vanilla: `<tier>/vanilla/<style-group>/<Component>.ts`. The module exports `create<Component>(options)` and default-exports that factory. Its group barrel aliases the default factory as both the lower-camel icon name and PascalCase name, and exports the named `create<Component>` factory.
- Assets: `<tier>/assets/` contains copied raw SVG/bitmap asset bytes plus `manifest.json` (`schemaVersion: 1`, path/size/SHA-256 entries). This output has no generated component symbol.

At each framework root, style groups are exposed as PascalCase namespaces (for example, `MoeOutline`) and the framework props type is exported. Tier roots expose `React`, `Vue`, and `Vanilla` namespaces. The package root exposes `Free` and `Pro`, and also re-exports free Vanilla at top-level as `Vanilla`. A namespace is how duplicate icon IDs across style groups remain disambiguated. These are namespace/barrel exports, not per-icon `Icon` suffixes.

A practical library import shape is `import { heart } from 'moe-icons/free/react/moe-outline'` (the package export map maps `free/react/*` to built files). For the CLI's generated proxies, the configured output directory has its own `index.ts`; it should not be conflated with a published `moe-icons` package import.

## CLI targets, output directory, and imports

`MoeiconsConfigFile.outputDir` is a required project-relative POSIX path; the default created by config initialization is `src/moeicons`. `planGeneratedFiles(config, outputDir, ...)` prefixes every generated path with the supplied output directory. `runGenerateUseCase` supplies the configured `outputDir`, then reconciles those planned files as managed project files.

- React and Vue targets generate one proxy per selected icon, plus type/provider/barrel files. SVG proxies import the matching installed code-library component from `.moeicons/artifact/<target>/<style-group>/...` using a relative import calculated from `<outputDir>/icons`. The internal import name combines the logical theme, style group, and icon name. Bitmap variants instead use generated local wrappers with static asset imports. The public generated proxy is the PascalCase icon name and switches/forwards the configured theme behavior.
- Vanilla emits a `<style-group>/<Component>.ts` factory/re-export and group barrel, plus `runtime.ts`. Its output `index.ts` exports one namespace per selected style group using `toProxyName(styleGroup)`, then `createMoeiconsRuntime`, `Theme`, and `VanillaIconOptions`. Namespace collisions and collisions with reserved exports are rejected.
- Assets emits raw selected files under the output directory and `assets/manifest.json`; it emits no component wrapper code.

Vanilla currently rejects bitmap themes (`vanilla target supports SVG themes only`). Assets can consume selected raw bitmap variants as well as SVG resources.

## Tier, permission, and version authority

The generator's names do not grant access. CLI config has a `tier` (`free` or `pro`), but availability comes from the style-group/icon catalog and installed resource state. `runGenerateUseCase` requires install metadata containing a version-pinned artifact; it checks that the installed artifact target matches the configured target. The installed `.moeicons/catalog.json` is preferred and hash-checked against `.moeicons/install-metadata.json`; it supplies the installed release's actual style-group, icon, tier, and media availability. A present but missing, malformed, or hash-drifting installed catalog is an error instead of an entitlement fallback.

The CLI install path verifies the selected tier/release artifact and records `artifactVersion`, `artifactSha256`, tier, catalog digest, target, and managed-file hashes in install metadata. `generate` reuses the installed artifact/cache identified by that metadata and refuses to proceed when the version-pinned install is missing. Free and Pro are therefore release/catalog entitlements, not inferred from a plugin completion candidate or its component spelling.

The plugin's own `data/icons.json` contains `name`, `styleGroup`, and `tier`; `scripts/generate-icons-data.mjs` documents this as a metadata-only snapshot sourced from the code-library SVG directory. `data/version-map.json` maps plugin version to library version, and `src/version/index.ts` reads it. These files explain plugin search/version hints; the installed CLI catalog and install metadata remain the authority for current CLI generation availability and artifact version.

## Scope boundary

This document establishes code-derived symbols, import forms, namespace layout, output paths, and entitlement/version sources only. It does not claim that a complete release input, publication, or 5.1/3.1/3.2 acceptance package has been assembled or accepted.
