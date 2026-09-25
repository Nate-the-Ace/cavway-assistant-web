#!/usr/bin/env bash
# Copies the CaveCAD Cave Survey Core files the 3D view runs on, from a
# cavecad-tools checkout beside this repo (or $CAVECAD_TOOLS). Same GPLv3.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
src="${CAVECAD_TOOLS:-$here/../cavecad-tools}"
core="$src/scripts/CaveSurvey/Core"
files=(CsAngles.js CsModel.js CsTraverse.js CsLrud.js CsClosure.js CsFrontier.js CsNetwork.js Format/CsCsv.js CsMesh3d.js)
dest="$here/vendor/cavecad"
rm -rf "$dest"; mkdir -p "$dest/Format"
for f in "${files[@]}"; do cp "$core/$f" "$dest/$f"; done
rev="$(git -C "$src" rev-parse --short HEAD)"; ver="$(cat "$src/VERSION" 2>/dev/null || echo '?')"
cat > "$dest/SOURCE.md" <<MD
Copied unmodified from https://github.com/Nate-the-Ace/CaveCAD
(scripts/CaveSurvey/Core) at $rev, version $ver, by tools/sync-cavecad.sh.
GPLv3. Do not edit here; change CaveCAD and re-run the script.

Load order: ${files[*]}
MD
echo "vendored ${#files[@]} files from $rev ($ver)"
