#!/usr/bin/env bash
# Lays this Claude Code build's API types beside the mod, as the engine does
# when it loads the mod from a --plugin-dir folder, so `tsc -p` works before
# the first load. The folder is git-ignored.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
src="$(ls -td /tmp/claude-*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts 2>/dev/null | head -1 || true)"
if [ -z "$src" ]; then
  echo "No bundled types found: load the plugin-authoring skill once, or start a session with --plugin-dir." >&2
  exit 1
fi
dest="$here/plugins/fishing/.claude-plugin/types/claude-code"
mkdir -p "$dest"
cp "$src" "$dest/index.d.ts"
echo "types: $src -> $dest/index.d.ts"
