#!/usr/bin/env bash
# Build the worker runtime without root: LuaJIT 2.1 and the lua-utf8 C module into $RT.
# zlib is the system libz.so.1, reached from api/lua/worker.lua through the LuaJIT FFI.
# Needs git, gcc, make. Output (rt/ and .src/ beside this script) is gitignored.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RT="${RT:-$HERE/rt}"
SRC="${SRC:-$HERE/.src}"
# Pins: the LuaJIT commit the upstream Dockerfile builds; the luautf8 commit of the tag the upstream test image installs.
LUAJIT_REV=2460b3ff93a1c955de3d62cfc825de7d68dc272e
LUAUTF8_REV=1bb70d45208d4033dcc75efee968be70534dd3ab # tag 0.1.6
mkdir -p "$RT" "$SRC"
[ -d "$SRC/luajit/.git" ] || git clone -q https://github.com/LuaJIT/LuaJIT.git "$SRC/luajit"
git -C "$SRC/luajit" fetch -q origin "$LUAJIT_REV" 2>/dev/null || true
git -C "$SRC/luajit" checkout -q "$LUAJIT_REV"
make -C "$SRC/luajit" -j"$(nproc)" PREFIX="$RT" >/dev/null
make -C "$SRC/luajit" install PREFIX="$RT" >/dev/null
[ -d "$SRC/luautf8/.git" ] || git clone -q https://github.com/starwing/luautf8.git "$SRC/luautf8"
git -C "$SRC/luautf8" checkout -q "$LUAUTF8_REV"
gcc -O2 -fPIC -shared -I"$RT/include/luajit-2.1" "$SRC/luautf8/lutf8lib.c" -o "$RT/lua-utf8.so"
"$RT/bin/luajit" -v
LUA_CPATH="$RT/?.so" "$RT/bin/luajit" -e 'assert(require("lua-utf8").reverse("ab") == "ba"); print("lua-utf8 ok")'
