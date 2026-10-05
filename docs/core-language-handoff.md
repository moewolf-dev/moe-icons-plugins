# Core language implementation handoff — 2026-10-04

The maintainer requested implementing the hardest shared core first, rather than executing one whole plan task at a time. This work is a local core slice across several tasks, not completion of the entire iteration or permission to publish.

## Implemented

- `src/language/contracts.ts`: typed module exports, component/factory/namespace identities, occurrences and diagnostics. This is an internal analysis interface, **not** the versioned bundled icon manifest required by task 4.1.
- `src/language/project.ts`: async, read-only project snapshots. Require CLI install metadata, matching catalog/managed hashes and `generatedOutputDir`; inspect actual generated export declarations. Reject outside-root symlinks, unsafe paths, edited barrels, excessive file counts/bytes and naming collisions. Resolve project-relative modules independently of the old bundled resource version.
- `src/language/analyze.ts`: in-memory TypeScript compiler/binder identities prevent lexical shadowing mistakes. Vue compiler DOM SFC mode preserves original offsets, exposes script setup imports to template tags and conservatively skips loop/slot/dynamic contexts. No project code/config execution or network calls.
- `src/language/service.ts`: shared document/project cache, per-document workspace selection, invalidation and disposal. Dirty managed modules disable authoritative analysis; untrusted workspaces do not load project metadata.
- Completion: real in-scope aliases and namespace members only, including incomplete JSX and factory member prefixes. No guessed suffix or guessed additional import edit.
- Highlighting: verified occurrences only. Semantic token IDs now use the valid `moeiconsIcon` / `moeiconsKeyword` names, replacing invalid dotted type IDs.
- Diagnostics: registered collection, `MOE-ICON-0001` catalog, exact ranges, source and help link; 300 ms debounce, stale-version cancellation, clearing on edits/close/project changes. Unknown provenance fails open.
- `src/language/naming.ts`: naming equivalent to the inspected code-library/CLI source, including reserved/numeric prefix guards; no universal `Icon` suffix.

## Verification

Run from this repository:

```sh
npm run compile
npm test
npm run test:core-host
npm run package
```

`test:core-host` launches an isolated installed VS Code, using temporary user/extension/workspace directories. Set `MOEICONS_VSCODE_BIN` when the CLI is not in the default macOS location/PATH. It requires a host-written pass report; a zero exit code from the `code` launcher is not sufficient. The fixture is synthetic and hash-consistent, not a real live install.

32 unit tests cover binding identity, aliases, namespace members, shadowing, type imports, comments/strings, incomplete JSX, Vue setup/kebab tags, loop/slot scopes, dynamic expressions, catalog/barrel drift, outside-root symlinks and naming. VS Code 1.140.0 core smoke validation covers activation, coded diagnostic/range, namespace completion and clearing after edit. A separate source drill called the actual sibling CLI generator for React/Vue (`archive` -> `Archive`, catalog 0.0.18); the local install metadata was synthesized for that drill. It is not full CLI install, live API or cross-platform acceptance. Evidence is recorded in the coordination workspace.

VSIX packaging succeeded locally. The bundled compiler is approximately 10.8 MB uncompressed; the initial VSIX is approximately 1.8 MB. Use the machine's current Node >=22 for packaging if old npm/node on PATH cannot run current vsce dependencies. Do not update all dependencies or run audit fix as part of this core slice.

## Outstanding boundaries

- No account-token reader/API/tier diagnostics, Marketplace publish or dispatch changes.
- No task-4.1/4.2 versioned bundled manifest or complete free/pro extraction. Legacy data remains for existing style/version commands only.
- No npm package export-map adapter, tsconfig/jsconfig aliases or unimported-icon/automatic-import completion. `completion/imports.ts` is legacy and is **not called** by the new provider; do not restore its hard-coded `moe-icons` import.
- Assets reference completion is outstanding. Vue normal Options API/global components and scoped loop/slot subtrees are intentionally unknown. Static imported setup tags work; arbitrary template expressions do not.
- MALFORMED_USAGE and invalid-name diagnostics are not implemented; do not invent an Icon suffix rule. Partial JSX tags do not emit unknown-member warnings. Completed prefixes may correctly produce a warning because they are then full syntax.
- Colors/theme/provider coexistence, real account lifecycle, all desktop platforms, remote hosts and minimum VS Code version remain to be tested. The local core host smoke does not certify those tasks.
- Bounds currently skip documents over 500,000 characters, project source files over 2 MB, more than 3,000 managed modules or over 8 million source characters. This is fail-open; tune only with measured fixtures.
- CLI managed digests provide local consistency, not cryptographic proof of package publisher identity or account authorization. Never infer account rights from project metadata/tier.

## Next work

1. Finish source/support/release-input contracts (5.1, 3.1, 3.2), then freeze the real bundled manifest (4.1/4.2). Add adapters through `ModuleResolver`, reusing the same occurrence engine.
2. Add unimported completion/import planning without executing workspace scripts; preserve the negative/shadowing tests. Add Assets reference parsing separately.
3. Freeze the account state machine and actual CLI storage-selection contract before implementing account readers and cross-repository APIs.
4. Easy independent work: error-code catalog expansion after those contracts, display/settings/refresh view, documentation and publisher setup. Reuse core interfaces; do not replace the parser with regex scans.
5. Complete actual integration, theme and platform acceptance before production release.

The coordination TODO records partial tasks as `[~]`. Each future model must read the current files and tests before modifying them.
