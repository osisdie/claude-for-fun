#!/usr/bin/env bash
# Renders the README's screenshots from the mod's own renderer: no terminal,
# no session, made-up demo figures. Needs Bun, Python 3 with Pillow, and
# fontconfig (fc-match) with a CJK font.
#
#   tools/screenshots.sh
set -euo pipefail
cd "$(dirname "$0")/.."
out=docs/screenshots
mkdir -p "$out"
shot() { bun tools/preview.ts "$@" >/dev/null; }

shot river-rpg --cols 60 --rows 26 --scale 8 --session idle --state waiting --shot "$out/scene-river-rpg.png"
for state in thinking tool waiting done error compacting; do
  shot river-rpg --cols 48 --rows 22 --scale 6 --session "$state" --tool edit --shot "$out/state-$state.png"
done
shot river-rpg --cols 40 --rows 12 --scale 12 --session waiting --locale en --shot "$out/hud.png"

ls -la "$out"
