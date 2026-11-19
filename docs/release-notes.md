# Release notes draft (Unreleased)

Use this text for the next GitHub Release and Marketplace update. Keep the three
runtime statements explicit and do not imply that the extension itself needs
Node.js 24.

## Moe Icons for VS Code — Unreleased

### Runtime boundaries

- **Extension users:** VS Code **1.85+**. The extension runs in the VS Code
  **Extension Host**; you do not install Node.js for the extension.
- **CLI users:** the Moeicons CLI requires **Node.js 24+** in the terminal.
- **Developers/release:** compile, tests, VSIX packaging and Marketplace
  publication require **Node.js 24+**.

### Highlights

- Project status now distinguishes a missing CLI, an ungenerated project,
  invalid metadata, unsupported schema drift, stale generated files and a CLI
  below the verified minimum, with ordered Node 24 → CLI upgrade →
  init/install/generate recovery steps.
- The account view keeps `signedOut`, `sessionExpired`, `sessionStore`,
  `rateLimited`, `policy`, `unavailable` and authenticated Free/Pro as separate
  states, with Remote SSH/WSL/container keychain guidance.
- Activation and diagnostics use a redacted `OutputChannel`;
  `moeicons.enableDiagnosticOutput` (default `false`) adds short-lived detail.
- New metadata refreshes completion, highlighting and diagnostics without
  reinstalling the extension. The extension never runs the CLI or auto-installs
  packages.
- Added the verified plugin/CLI/resource combination table and Marketplace
  copy. Plugin releases do not automatically follow every CLI patch.

### Compatibility

See [version-compatibility.md](version-compatibility.md) for the recorded
combinations. The current package version is authoritative in `package.json`;
`npm run release:validate` checks the release baseline.
