#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${WASI_SDK_PATH:?Set WASI_SDK_PATH to an installed WASI SDK directory.}"
wasi_sdk_base=$(CDPATH= cd -- "$WASI_SDK_PATH" && pwd)
compiler="$wasi_sdk_base/bin/clang"
[ -x "$compiler" ] || { echo "WASI SDK clang is not executable: $compiler" >&2; exit 1; }
cd "$base"
mkdir -p build
node prepare-build.mjs
output=${FORKWAKE_BUILD_OUT:-"$base/build/quickjs-template.raw.wasm"}
"$compiler" -O1 -mexec-model=reactor -D__EMSCRIPTEN__ -D_GNU_SOURCE '-DCONFIG_VERSION="2026-06-04"' \
 -Ivendor/quickjs-2026-06-04 bridge.c vendor/quickjs-2026-06-04/quickjs.c vendor/quickjs-2026-06-04/cutils.c \
 vendor/quickjs-2026-06-04/libregexp.c vendor/quickjs-2026-06-04/libunicode.c build/dtoa.c \
 -Wl,--wrap=__wasi_fd_write -Wl,--wrap=__wasi_fd_close -Wl,--wrap=__wasi_fd_seek -Wl,--wrap=__wasi_proc_exit -Wl,--wrap=__wasi_clock_time_get \
 -Wl,--export-memory -Wl,--initial-memory=4194304 -Wl,--max-memory=33554432 -Wl,-z,stack-size=524288 -o "$output"
node build-manifest.mjs "$output"
