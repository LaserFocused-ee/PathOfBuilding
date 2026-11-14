#!/usr/bin/env bash
# Build the browser view: pob-web's driver (Lua VM + SimpleGraphic bridge compiled to WebAssembly)
# and a pack of this repository's own Path of Building sources at one commit.
# Usage: api/web/build-web.sh [commit]   (default: HEAD; the server's worker runs the same tree)
# Output: api/web/dist, a static site to serve at the root of the API server's origin (README.md).
# Needs git, gcc, cmake, ninja, python3 (emsdk) and deno. No root: everything lands in $B (gitignored).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
B="${B:-$HERE/.build}"
COMMIT="$(git -C "$REPO" rev-parse "${1:-HEAD}^{commit}")"
VERSION_ID="${COMMIT:0:10}" # names the packed sources in URLs: /pob/<VERSION_ID>/
DIST="${DIST:-$HERE/dist}"
# Pins (THIRD-PARTY.md lists them): pob-web main at 2026-10-05; its Lua and luautf8 submodules
# come from that commit's tree; emsdk version from its mise.toml.
POBWEB_REV=aead90ff705e511ca6b20e488cef093211570c27
EMSDK_VERSION=6.0.6
mkdir -p "$B/bin"

# 1. Toolchain: emsdk.
[ -d "$B/emsdk/.git" ] || git clone -q https://github.com/emscripten-core/emsdk.git "$B/emsdk"
if [ ! -f "$B/emsdk/.installed-$EMSDK_VERSION" ]; then
  "$B/emsdk/emsdk" install "$EMSDK_VERSION" >/dev/null
  "$B/emsdk/emsdk" activate "$EMSDK_VERSION" >/dev/null
  touch "$B/emsdk/.installed-$EMSDK_VERSION"
fi
# shellcheck disable=SC1091
source "$B/emsdk/emsdk_env.sh" >/dev/null 2>&1

# 2. pob-web at its pin, dependencies, driver build.
P="$B/pob-web"
[ -d "$P/.git" ] || git clone -q https://github.com/atty303/pob-web.git "$P"
if [ "$(git -C "$P" rev-parse HEAD)" != "$POBWEB_REV" ]; then
  git -C "$P" fetch -q origin "$POBWEB_REV" 2>/dev/null || true
  git -C "$P" checkout -q -f "$POBWEB_REV"
fi
# Our page joins pob-web's Deno workspace as packages/view (step 6) so it type-checks against the driver.
grep -q '"packages/view"' "$P/deno.json" || sed -i 's#"packages/web"#"packages/web",\n    "packages/view"#' "$P/deno.json"
git -C "$P" submodule update -q --init --recursive
(cd "$P" && deno ci >/dev/null 2>&1)
[ -f "$P/packages/driver/dist/release/driver.wasm" ] || (cd "$P" && deno task repo driver-build >"$B/driver-build.log" 2>&1)

# 3. Parse checker: the browser VM's parser, built natively (tools/parse-check.c).
L="$P/vendor/lua"
if [ ! -x "$B/bin/parse-check" ]; then
  mkdir -p "$B/stub" && echo '#define EMSCRIPTEN_KEEPALIVE' >"$B/stub/emscripten.h"
  CSRC=()
  for f in "$L"/*.c; do case "$f" in */lua.c | */ltests.c) ;; *) CSRC+=("$f") ;; esac; done
  gcc -O2 -w -I"$B/stub" -I"$L" -o "$B/bin/parse-check" "$HERE/tools/parse-check.c" "${CSRC[@]}" -lm
fi

# 4. Stage the sources at $COMMIT (never the working tree), rewrite compound assignment, check.
GAME=poe1
STAGE="$P/packages/packer/build/$GAME/$VERSION_ID"
OUT="$P/packages/packer/r2/games/$GAME/versions/$VERSION_ID"
mkdir -p "$STAGE"
if [ ! -d "$STAGE/repo" ]; then
  TMP="$(mktemp -d "$STAGE/repo.XXXX")"
  git -C "$REPO" archive "$COMMIT" src runtime/lua manifest.xml changelog.txt help.txt LICENSE.md | tar -x -C "$TMP"
  deno run --quiet --allow-read --allow-write "$HERE/tools/rewrite-tree.ts" "$TMP" >"$TMP.rewrites.jsonl"
  mv "$TMP" "$STAGE/repo" && mv "$TMP.rewrites.jsonl" "$STAGE/rewrites.jsonl"
fi
# The packer leaves out src/Export (data export scripts, not loaded by the application).
# runtime/lua/sha1/lua53_ops.lua uses Lua 5.3 operators and is only required on a 5.3 VM.
(cd "$STAGE/repo" && find src runtime/lua -name '*.lua' -not -path 'src/Export/*' \
  -not -path 'runtime/lua/sha1/lua53_ops.lua' -print0 | xargs -0 "$B/bin/parse-check")

# 5. Pack with pob-web's packer (no clone: it reads $STAGE/repo), then write the manifest.
(cd "$P" && deno task --filter pob-packer pack "$VERSION_ID" "$GAME" >/dev/null)
deno run --quiet --allow-read --allow-write "$HERE/tools/manifest.ts" "$OUT" "$STAGE/root-zipfs" "$COMMIT" "$POBWEB_REV" "$STAGE/rewrites.jsonl"
echo "packed $GAME $COMMIT as $VERSION_ID"

# 6. The page (src/), built inside pob-web's workspace, then the packed sources beside it.
mkdir -p "$P/packages/view"
cp -r "$HERE/src/." "$P/packages/view/"
mv "$P/packages/view/view.deno.json" "$P/packages/view/deno.json"
(cd "$P" && deno check packages/view/main.ts)
(cd "$P" && POB_VERSION_ID="$VERSION_ID" POB_WEB_OUT="$DIST" deno task vite build --config packages/view/vite.config.ts >"$B/view-build.log" 2>&1) ||
  { tail -n 30 "$B/view-build.log"; exit 1; }
mkdir -p "$DIST/pob"
cp -al "$OUT" "$DIST/pob/$VERSION_ID" 2>/dev/null || cp -r "$OUT" "$DIST/pob/$VERSION_ID"
echo "built $DIST (assets /pob/$VERSION_ID)"
