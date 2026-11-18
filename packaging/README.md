# Multi-IDE Packaging Middleware

Development and packaging require **Node.js 24+**. The resulting VS Code
extension still runs on the VS Code **Extension Host**; Node 24 is not a user
runtime requirement for extension users. See
[`docs/version-compatibility.md`](../docs/version-compatibility.md).

Skeleton for producing distributable packages across IDEs.

Supported now:

- **VS Code** — produces a `.vsix` via `@vscode/vsce`.

Planned (skeleton only, not implemented):

- **ZED** — reserved. ZED extension packaging is not implemented yet.
- **Cursor** — reserved. Cursor is VS Code-compatible; a dedicated pipeline is
  not implemented yet.

## Usage

```bash
./packaging/build-vsix.sh
```

The resulting `.vsix` is written to the repository root.
