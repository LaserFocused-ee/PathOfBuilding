#!/usr/bin/env bash
# Build the browser view: pob-web's driver (Lua VM + SimpleGraphic bridge compiled to WebAssembly)
# and a pack of this repository's own Path of Building sources at one commit.
# Usage: api/web/build-web.sh [commit]   (default: HEAD; the server's worker runs the same tree)
# Env: POB_WEB_BUILD (cache dir, default api/web/.build), POB_WEB_DIST (output, default api/web/dist; emptied by Vite),
#      POB_WEB_FONTIN=1 keeps the Fontin font files in the output (local builds only; see THIRD-PARTY.md).
# Output: api/web/dist, a static site to serve at the root of the API server's origin (README.md).
# Needs git, gcc, cmake, ninja, python3 (emsdk) and deno. No root: everything lands in $B (gitignored).
set -euo pipefail
unset NODE_ENV # an inherited NODE_ENV=development makes Vite ship React's development build
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
B="${POB_WEB_BUILD:-$HERE/.build}"
COMMIT="$(git -C "$REPO" rev-parse "${1:-HEAD}^{commit}")"
VERSION_ID="${COMMIT:0:10}" # names the packed sources in URLs: /pob/<VERSION_ID>/
DIST="${POB_WEB_DIST:-$HERE/dist}"
# Pins (THIRD-PARTY.md lists them): pob-web main at 2026-10-05; its Lua and luautf8 submodules
# come from that commit's tree; emsdk version from its mise.toml.
POBWEB_REV=aead90ff705e511ca6b20e488cef093211570c27
EMSDK_VERSION=6.0.6
EMSDK_REV=708dcbcc9ee23bc7d2dad44fc90db377e38b771c # emsdk main, 2026-11-12
# Software BC7 decoder (used when the GPU lacks BPTC): the C++ library and the bindings of the npm
# package pob-web uses (texture2ddecoder-wasm 1.2.2), rebuilt without dynamic code (step 2b).
T2D_REV=a111654b8b891e72b8dca19a0f06551dcf63b1a0         # K0lb3/texture2ddecoder, the package's submodule
T2D_BINDINGS_REV=f1acf3bd55281346b48929f281212b244f2bfe70 # fatal10110/texture2ddecoder-wasm v1.2.2
# Compiled code records source paths (DWARF, __FILE__); map the builder's directories to fixed names.
MAPS=("-ffile-prefix-map=$B=/build" "-ffile-prefix-map=$HERE=/pob-view" "-ffile-prefix-map=$REPO=/repo")
mkdir -p "$B/bin"

# 1. Toolchain: emsdk.
[ -d "$B/emsdk/.git" ] || git clone -q https://github.com/emscripten-core/emsdk.git "$B/emsdk"
git -C "$B/emsdk" checkout -q "$EMSDK_REV"
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
(cd "$P" && deno ci >"$B/deno-ci.log" 2>&1) ||
  { echo "deno ci failed; see $B/deno-ci.log" >&2; tail -n 20 "$B/deno-ci.log" >&2; exit 1; }
# patches/: small changes to pob-web's boot script (compiled into the driver), each explained in its file.
# The driver is rebuilt when a patch or a pin changes. Patched files go back to the pin first, so an
# edited patch applies cleanly over the old one.
# A path the patch adds is untracked at the pin: move it to $B/stale-old instead of checking it out.
for patch in "$HERE"/patches/*.patch; do
  git -C "$P" apply --numstat "$patch" | cut -f3 | while IFS= read -r path; do
    if git -C "$P" ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then git -C "$P" checkout -q -- "$path"
    elif [ -e "$P/$path" ]; then mkdir -p "$B/stale-old"; mv "$P/$path" "$B/stale-old/$(date +%s)-$(basename "$path")"; fi
  done
done
for patch in "$HERE"/patches/*.patch; do git -C "$P" apply "$patch"; done
STAMP="$P/packages/driver/dist/release/.view-patches"
PATCHES_SUM="$( (echo "$POBWEB_REV $EMSDK_VERSION map4"; cat "$HERE"/patches/*.patch) | sha256sum | cut -d' ' -f1)"
if [ ! -f "$P/packages/driver/dist/release/driver.wasm" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$PATCHES_SUM" ]; then
  (cd "$P" && CFLAGS="${MAPS[*]}" CXXFLAGS="${MAPS[*]}" LDFLAGS="${MAPS[*]}" deno task repo driver-build >"$B/driver-build.log" 2>&1)
  # pob-web's worker bundle references its debug driver and the release DWARF side file, so Vite ships
  # them; their debug info records build paths and the page never loads them ("release"). Strip it.
  for f in "$P/packages/driver/dist/debug/driver.wasm" "$P/packages/driver/dist/release/driver.wasm.debug.wasm"; do
    [ ! -f "$f" ] || "$EMSDK/upstream/bin/llvm-strip" --strip-debug "$f"
  done
  echo "$PATCHES_SUM" >"$STAMP"
fi
# 2c. The load-build patch against real Path of Building, in the engine's LuaJIT runtime (no browser):
# getBuildCode answers the sentinel for every build the page did not load (tools/load-build-probe.lua),
# and the sentinel is the string main.ts compares.
SENTINEL="$(sed -n 's/^+ *return "\(![a-z-]*\)"$/\1/p' "$HERE/patches/pob-web-load-build.patch")"
if [ -z "$SENTINEL" ] || ! grep -qF "code === \"$SENTINEL\"" "$HERE/src/main.ts"; then
  echo "load-build sentinel '$SENTINEL' from the patch is not the one src/main.ts compares" >&2
  exit 1
fi
RT="${POB_RUNTIME_DIR:-$REPO/api/runtime/rt}"
[ -x "$RT/bin/luajit" ] || RT="$RT" "$REPO/api/runtime/build-runtime.sh"
PR="$B/load-build-probe"; mkdir -p "$PR"
PS="$(mktemp -d "$PR/state.XXXXXX")" # ponytail: one small directory per build, left in the gitignored cache
{
  sed -n '/^package\.path = /,/^main\.buildPath = /p' "$REPO/api/lua/worker.lua"
  echo 'local mainObject = launch'
  awk '/^local function markLoadedBuilds/{p=1} p' "$P/packages/driver/boot.lua"
  cat "$HERE/tools/load-build-probe.lua"
} >"$PR/probe.lua"
(cd "$REPO/src" && SENTINEL="$SENTINEL" FIXTURE="$REPO/api/server/test/fixtures/witch-elementalist-3_30.xml" \
  POB_STATE_DIR="$PS" LUA_CPATH="$RT/?.so" "$RT/bin/luajit" "$PR/probe.lua" >"$PR/result.txt" 2>"$PR/stderr.log") ||
  { echo "load-build probe failed; see $PR/result.txt and $PR/stderr.log" >&2; grep -v '^ok' "$PR/result.txt" >&2; exit 1; }

# 2b. The published decoder module compiles its bindings with `new Function`, which the serve
# contract's Content-Security-Policy refuses; this build uses -sDYNAMIC_EXECUTION=0 and no eval.
T2D="$B/texture2ddecoder"
pin() { # pin <dir> <url> <rev>
  [ -d "$1/.git" ] || git clone -q "$2" "$1"
  [ "$(git -C "$1" rev-parse HEAD)" = "$3" ] || { git -C "$1" fetch -q origin "$3" 2>/dev/null || true; git -C "$1" checkout -q -f "$3"; }
}
if [ "$(cat "$T2D/out/.pins" 2>/dev/null)" != "$T2D_REV $T2D_BINDINGS_REV $EMSDK_VERSION map2" ]; then
  pin "$T2D/lib" https://github.com/K0lb3/texture2ddecoder.git "$T2D_REV"
  pin "$T2D/bindings" https://github.com/fatal10110/texture2ddecoder-wasm.git "$T2D_BINDINGS_REV"
  mkdir -p "$T2D/out"
  TS="$T2D/lib/src/Texture2DDecoder"
  em++ "$TS"/{bcn,pvrtc,etc,atc,astc,crunch,unitycrunch}.cpp "$T2D/bindings/wasm_bindings.cpp" -I"$TS" \
    "${MAPS[@]}" -D__LITTLE_ENDIAN__=1 -O3 -std=c++17 --bind -sDYNAMIC_EXECUTION=0 -sALLOW_MEMORY_GROWTH=1 -sALLOW_TABLE_GROWTH=1 \
    -sMODULARIZE=1 -sEXPORT_NAME=createModule -sEXPORT_ES6=1 -sENVIRONMENT=web,worker -sFILESYSTEM=0 \
    -sDISABLE_EXCEPTION_CATCHING=0 '-sINCOMING_MODULE_JS_API=["locateFile"]' \
    -o "$T2D/out/texture2ddecoder.js" >"$B/texture2ddecoder-build.log" 2>&1
  if grep -q 'new Function\|eval(' "$T2D/out/texture2ddecoder.js"; then echo "decoder still uses dynamic code" >&2; exit 1; fi
  echo "$T2D_REV $T2D_BINDINGS_REV $EMSDK_VERSION map2" >"$T2D/out/.pins"
fi

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
# The staged tree depends on the rewrite tools as well as the commit: restage (and repack) when they change.
TOOLS_SUM="$(cat "$HERE/tools/transform.ts" "$HERE/tools/rewrite-tree.ts" | sha256sum | cut -d' ' -f1)"
if [ -d "$STAGE/repo" ] && [ "$(cat "$STAGE/.tools-sum" 2>/dev/null)" != "$TOOLS_SUM" ]; then
  STALE="$B/stale/$VERSION_ID-$(date +%Y%m%d%H%M%S)"
  mkdir -p "$STALE"
  mv "$STAGE/repo" "$STALE/repo"
  [ ! -f "$STAGE/rewrites.jsonl" ] || mv "$STAGE/rewrites.jsonl" "$STALE/rewrites.jsonl"
  [ ! -d "$OUT" ] || mv "$OUT" "$STALE/packed" # the packer skips a version whose output exists
  # Keep the newest 2 staged trees in $B/stale; older ones move to $B/stale-old (delete them by hand).
  mkdir -p "$B/stale-old"
  find "$B/stale" -mindepth 1 -maxdepth 1 -printf '%T@ %p\n' | sort -rn | tail -n +3 | cut -d' ' -f2- |
    while IFS= read -r OLD; do mv "$OLD" "$B/stale-old/"; done
fi
if [ ! -d "$STAGE/repo" ]; then
  TMP="$(mktemp -d "$STAGE/repo.XXXX")"
  git -C "$REPO" archive "$COMMIT" src runtime/lua manifest.xml changelog.txt help.txt LICENSE.md | tar -x -C "$TMP"
  deno run --quiet --allow-read --allow-write "$HERE/tools/rewrite-tree.ts" "$TMP" >"$TMP.rewrites.jsonl"
  mv "$TMP" "$STAGE/repo" && mv "$TMP.rewrites.jsonl" "$STAGE/rewrites.jsonl"
  echo "$TOOLS_SUM" >"$STAGE/.tools-sum"
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
(cd "$P" && POB_VERSION_ID="$VERSION_ID" POB_WEB_OUT="$DIST" POB_WEB_DECODER_DIR="$T2D/out" deno task vite build --config packages/view/vite.config.ts >"$B/view-build.log" 2>&1) ||
  { tail -n 30 "$B/view-build.log"; exit 1; }
# Fontin's licence does not cover a published image or package holding it: left out unless asked for
# (patches/pob-web-optional-fontin.patch then draws that text in Liberation Sans).
# The page credits Fontin (its licence asks for that) only when the files are in the build: <span data-fontin>.
if [ "${POB_WEB_FONTIN:-0}" != 1 ]; then
  rm -f "$DIST"/Fontin-*.woff
  perl -0pi -e 's#<span data-fontin>.*?</span>##gs' "$DIST/index.html"
  if grep -qi fontin "$DIST/index.html"; then echo "index.html still credits Fontin, which this build leaves out" >&2; exit 1; fi
fi
mkdir -p "$DIST/licenses"
cp "$P/LICENSE" "$DIST/licenses/pob-web-LICENSE"
cp "$P/NOTICE.md" "$DIST/licenses/pob-web-NOTICE.md"
cp "$REPO/LICENSE.md" "$DIST/licenses/PathOfBuilding-LICENSE.md"
cp "$HERE/THIRD-PARTY.md" "$DIST/licenses/THIRD-PARTY.md"
cp "$T2D/lib/LICENSE" "$DIST/licenses/texture2ddecoder-LICENSE"
cp "$T2D/bindings/LICENSE" "$DIST/licenses/texture2ddecoder-wasm-LICENSE"
# Output checks: no React development build, no builder path in anything but the packed sources and licences.
if [ -n "$(grep -rlF jsxDEV "$DIST/assets" || true)" ]; then echo "output contains React's development build (jsxDEV)" >&2; exit 1; fi
# Lowered optional calls (`x?.(a)` built as `x.call(this, a)`) post the worker object through Comlink
# proxies: a DataCloneError on every diagnostic. vite.config.ts build.target keeps them native.
deno run --quiet --allow-read "$HERE/tools/lowered-calls.ts" "$DIST/assets"
LEAK="$(grep -rlF -e "$REPO" -e "$HERE" -e "$B" -e "$HOME/" "$DIST" --exclude-dir=pob --exclude-dir=licenses || true)"
if [ -n "$LEAK" ]; then echo "builder path leaked into output:" >&2; echo "$LEAK" | head -n 20 >&2; exit 1; fi
mkdir -p "$DIST/pob"
cp -al "$OUT" "$DIST/pob/$VERSION_ID" 2>/dev/null || cp -r "$OUT" "$DIST/pob/$VERSION_ID"
echo "built $DIST (assets /pob/$VERSION_ID)"
