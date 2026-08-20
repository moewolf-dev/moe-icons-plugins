#!/usr/bin/env bash
#
# Multi-IDE packaging middleware (skeleton).
#
# This script only builds the VS Code .vsix for now. ZED / Cursor targets are
# intentionally reserved as commented placeholders for a future iteration.
#
# Usage:
#   ./packaging/build-vsix.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Building VS Code extension (.vsix)"
npm run build
npx vsce package

echo "==> Done. .vsix written to $ROOT"

# Reserved targets (not implemented):
#   ZED    -> ./packaging/build-zed.sh
#   Cursor -> ./packaging/build-cursor.sh
