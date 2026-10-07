# Changelog

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
