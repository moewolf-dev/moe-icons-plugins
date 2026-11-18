# Changelog

## Unreleased

- Separate the VS Code Extension Host runtime from the Node.js 24 requirement for CLI users and for extension development, CI, VSIX packaging and Marketplace publication. GitHub Actions workflows now use Node 24; `engines.vscode` remains `^1.85.0` and no user-facing `engines.node` requirement was added.
- Record CLI metadata schema, optional CLI version, installed CLI version, and artifact/resource versions when reading CLI-generated projects. Distinguish a missing CLI, a project that was not generated, invalid metadata, schema drift, stale generated files and a CLI below the verified minimum.
- Keep account states independent (`signedOut`, `sessionExpired`, `sessionStore`, `rateLimited`, `policy`, `unavailable`, authenticated Free/Pro) with concrete hints and explicit Remote SSH/WSL/container keychain limitations. The extension still reads the CLI session store read-only and never copies or generates tokens.
- Replace the bare activation `console.log` with a VS Code `OutputChannel`. Add `moeicons.enableDiagnosticOutput` (default `false`) for short-lived detail and a central redaction helper; never log tokens, email, authorization, session JSON, absolute home paths, icon source or network bodies.
- Add project-contract recovery guidance that never invokes a terminal or auto-installs the CLI: upgrade Node 24, reinstall/upgrade the CLI, then run init/install/generate. New metadata refreshes completion, highlighting and diagnostics without reinstalling the plugin.
- Add the plugin/CLI/resource compatibility table, Marketplace-facing copy and release-runbook notes. The plugin version does not auto-follow CLI patch releases; only verified combinations are recorded.
- Expand tests for missing/expired/corrupt sessions, missing keychain tools, low CLI versions, metadata schema drift, stale generated files, output redaction, remote-host messaging, Free/Pro entitlement, CLI-not-installed, Node 24 workflows and the VS Code engine boundary.

## 0.0.7

- Read full-package installation metadata up to 8 MB while retaining the existing per-module and total analysis budgets.
- Cover metadata with 17000 unrelated artifacts, matching the size of full Pro Vanilla installations.

## 0.0.6

- Refresh already open files when a nested CLI project is installed.
- Recognize installation metadata changes with Windows path separators.
- Add a VS Code host regression for new child installations without text edits.

## 0.0.5

- Load only verified artifact modules reached from generated exports, allowing full Vanilla installations with thousands of unused modules.
- Reuse parsed source files and bound analysis by the modules a project actually imports.
- Cover an installed compiled factory alongside 3100 unrelated artifact files.

## 0.0.4

- Resolve verified compiled artifact modules imported by CLI-generated Vanilla factories.
- Recognize canonical public exports even when the library build shortens local names.
- Add a real CLI generation regression with an installed compiled factory.

## 0.0.3

- Find CLI installations in nested projects and resolve safe local path aliases.
- Show installed versions and styles; retire ignored manual version/style settings.
- Share document analysis and avoid clearing every project after unrelated edits.
- Load the parser on demand and fix watch mode and immutable release tooling.
- Cover real CLI output for React/Vue SVG and bitmap, and Vanilla SVG.

## 0.0.2

- Add the Moe Icons logo to the VS Code extension and Marketplace listing.
- Add official website, documentation and CLI installation links.
- Explain the required CLI installation and project generation steps.
- Add bug reports and support contact: info@moeicons.com.
- Update the default documentation link to the official website.

## 0.0.1

- Initial preview of project-aware icon completion, semantic highlighting and diagnostics.
